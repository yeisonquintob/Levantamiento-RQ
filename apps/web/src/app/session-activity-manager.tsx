"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { SESSION_INACTIVITY_TIMEOUT_SECONDS } from "@levantamiento-rq/shared-contracts";

const GATEWAY_URL =
  process.env.NODE_ENV === "development" && typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : (process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000");

const SESSION_INACTIVITY_MS =
  SESSION_INACTIVITY_TIMEOUT_SECONDS * 1000;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const ACTIVITY_WINDOW_MS = 5 * 60 * 1000;
const CHECK_INTERVAL_MS = 30 * 1000;
const TRANSIENT_RETRY_MS = 30 * 1000;

const REFRESH_LOCK_NAME =
  "levantamiento-rq-session-refresh";
const REFRESH_CHANNEL_NAME =
  "levantamiento-rq-session";

type ExpirationReason =
  | "expired"
  | "inactivity";

type SessionBroadcast =
  | {
      type: "refreshed";
      at: number;
    }
  | {
      type: "signed-out";
      reason: ExpirationReason;
    };

/*
 * SESSION_REFRESH_COORDINATION_V2
 *
 * Una familia de refresh rota su token en cada renovación.
 * Dos pestañas renovando al mismo tiempo podrían reutilizar
 * accidentalmente el mismo token anterior.
 *
 * Web Locks evita la renovación simultánea y BroadcastChannel
 * sincroniza el momento de la última renovación sin persistir
 * tokens ni información sensible en storage.
 */
export function SessionActivityManager() {
  const pathname = usePathname();

  const lastActivityAt =
    useRef(Date.now());
  const lastRefreshAt =
    useRef(Date.now());
  const lastRefreshAttemptAt =
    useRef(0);
  const refreshing =
    useRef(false);
  const redirecting =
    useRef(false);
  const channel =
    useRef<BroadcastChannel | null>(
      null,
    );

  function redirectToSignIn(
    reason: ExpirationReason,
  ): void {
    if (redirecting.current) return;

    redirecting.current = true;

    channel.current?.postMessage({
      type: "signed-out",
      reason,
    } satisfies SessionBroadcast);

    window.location.assign(
      `/sign-in?reason=${reason}`,
    );
  }

  function markRefreshed(
    at = Date.now(),
  ): void {
    lastRefreshAt.current = Math.max(
      lastRefreshAt.current,
      at,
    );

    channel.current?.postMessage({
      type: "refreshed",
      at: lastRefreshAt.current,
    } satisfies SessionBroadcast);
  }

  async function refreshSession(): Promise<void> {
    if (refreshing.current) return;

    const now = Date.now();

    if (
      now - lastRefreshAt.current <
        REFRESH_INTERVAL_MS ||
      now - lastRefreshAttemptAt.current <
        TRANSIENT_RETRY_MS
    ) {
      return;
    }

    refreshing.current = true;
    lastRefreshAttemptAt.current = now;

    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/auth/refresh`,
        {
          method: "POST",
          credentials: "include",
          cache: "no-store",
        },
      );

      if (response.ok) {
        markRefreshed();
        return;
      }

      /*
       * Solo una respuesta de autenticación definitiva
       * debe cerrar la sesión.
       *
       * 429, 5xx y fallas temporales de infraestructura
       * NO equivalen a una sesión vencida.
       */
      if (
        response.status === 401 ||
        response.status === 403
      ) {
        redirectToSignIn("expired");
      }
    } catch {
      /*
       * Gateway/Redis/red pueden fallar de forma transitoria.
       * Conservamos la sesión y permitimos reintento posterior.
       */
    } finally {
      refreshing.current = false;
    }
  }

  async function coordinatedRefresh(): Promise<void> {
    const locks = navigator.locks;

    if (locks?.request) {
      await locks.request(
        REFRESH_LOCK_NAME,
        {
          mode: "exclusive",
          ifAvailable: true,
        },
        async (lock) => {
          if (!lock) return;

          /*
           * Otra pestaña pudo renovar y notificar mientras
           * intentábamos tomar el lock.
           */
          if (
            Date.now() -
              lastRefreshAt.current <
            REFRESH_INTERVAL_MS
          ) {
            return;
          }

          await refreshSession();
        },
      );

      return;
    }

    /*
     * Fallback para navegadores sin Web Locks.
     * El ref local evita duplicados dentro de la misma pestaña.
     */
    await refreshSession();
  }

  useEffect(() => {
    lastActivityAt.current = Date.now();
  }, [pathname]);

  useEffect(() => {
    if (
      typeof BroadcastChannel !==
      "undefined"
    ) {
      const sessionChannel =
        new BroadcastChannel(
          REFRESH_CHANNEL_NAME,
        );

      sessionChannel.onmessage = (
        event: MessageEvent<SessionBroadcast>,
      ) => {
        const message = event.data;

        if (
          message?.type ===
            "refreshed" &&
          Number.isFinite(message.at)
        ) {
          lastRefreshAt.current =
            Math.max(
              lastRefreshAt.current,
              message.at,
            );

          return;
        }

        if (
          message?.type ===
            "signed-out" &&
          !redirecting.current
        ) {
          redirecting.current = true;

          window.location.assign(
            `/sign-in?reason=${message.reason}`,
          );
        }
      };

      channel.current = sessionChannel;
    }

    function registerActivity(): void {
      const previousActivity =
        lastActivityAt.current;
      const now = Date.now();

      lastActivityAt.current = now;

      /*
       * Al regresar después de varios minutos,
       * renueva antes del siguiente ciclo de 30 s.
       * Esto reduce cierres al volver a una pestaña.
       */
      if (
        now - previousActivity >
          ACTIVITY_WINDOW_MS &&
        now - lastRefreshAt.current >=
          REFRESH_INTERVAL_MS
      ) {
        void coordinatedRefresh();
      }
    }

    function registerVisibility(): void {
      if (
        document.visibilityState ===
        "visible"
      ) {
        registerActivity();
      }
    }

    const activityEvents: readonly (
      keyof WindowEventMap
    )[] = [
      "pointerdown",
      "keydown",
      "input",
      "scroll",
      "focus",
    ];

    for (
      const eventName of activityEvents
    ) {
      window.addEventListener(
        eventName,
        registerActivity,
        { passive: true },
      );
    }

    document.addEventListener(
      "visibilitychange",
      registerVisibility,
    );

    const timer = window.setInterval(
      () => {
        const now = Date.now();
        const idleFor =
          now -
          lastActivityAt.current;

        if (
          idleFor >=
          SESSION_INACTIVITY_MS
        ) {
          window.clearInterval(timer);

          void fetch(
            `${GATEWAY_URL}/api/v1/auth/sign-out`,
            {
              method: "POST",
              credentials: "include",
            },
          ).finally(() =>
            redirectToSignIn(
              "inactivity",
            ),
          );

          return;
        }

        if (
          idleFor >
          ACTIVITY_WINDOW_MS
        ) {
          return;
        }

        void coordinatedRefresh();
      },
      CHECK_INTERVAL_MS,
    );

    return () => {
      window.clearInterval(timer);

      for (
        const eventName of
          activityEvents
      ) {
        window.removeEventListener(
          eventName,
          registerActivity,
        );
      }

      document.removeEventListener(
        "visibilitychange",
        registerVisibility,
      );

      channel.current?.close();
      channel.current = null;
    };
  }, []);

  return null;
}
