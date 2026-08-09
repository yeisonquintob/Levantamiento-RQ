"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { SESSION_INACTIVITY_TIMEOUT_SECONDS } from "@levantamiento-rq/shared-contracts";

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000";
const SESSION_INACTIVITY_MS = SESSION_INACTIVITY_TIMEOUT_SECONDS * 1000;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const ACTIVITY_WINDOW_MS = 5 * 60 * 1000;
const CHECK_INTERVAL_MS = 30 * 1000;

type ExpirationReason = "expired" | "inactivity";

function redirectToSignIn(reason: ExpirationReason): void {
  window.location.assign(`/sign-in?reason=${reason}`);
}

export function SessionActivityManager() {
  const pathname = usePathname();
  const lastActivityAt = useRef(Date.now());
  const lastRefreshAt = useRef(Date.now());
  const refreshing = useRef(false);

  useEffect(() => {
    lastActivityAt.current = Date.now();
  }, [pathname]);

  useEffect(() => {
    function registerActivity(): void {
      lastActivityAt.current = Date.now();
    }

    const activityEvents: readonly (keyof WindowEventMap)[] = [
      "pointerdown",
      "keydown",
      "input",
      "scroll",
    ];

    for (const eventName of activityEvents) {
      window.addEventListener(eventName, registerActivity, { passive: true });
    }

    const timer = window.setInterval(() => {
      const now = Date.now();
      const idleFor = now - lastActivityAt.current;

      if (idleFor >= SESSION_INACTIVITY_MS) {
        window.clearInterval(timer);
        void fetch(`${GATEWAY_URL}/api/v1/auth/sign-out`, {
          method: "POST",
          credentials: "include",
        }).finally(() => redirectToSignIn("inactivity"));
        return;
      }

      if (
        refreshing.current ||
        idleFor > ACTIVITY_WINDOW_MS ||
        now - lastRefreshAt.current < REFRESH_INTERVAL_MS
      ) {
        return;
      }

      refreshing.current = true;
      void fetch(`${GATEWAY_URL}/api/v1/auth/refresh`, {
        method: "POST",
        credentials: "include",
      })
        .then((response) => {
          if (!response.ok) {
            redirectToSignIn("expired");
            return;
          }

          lastRefreshAt.current = Date.now();
        })
        .catch(() => undefined)
        .finally(() => {
          refreshing.current = false;
        });
    }, CHECK_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
      for (const eventName of activityEvents) {
        window.removeEventListener(eventName, registerActivity);
      }
    };
  }, []);

  return null;
}
