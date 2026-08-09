"use client";

import { useEffect, useState } from "react";

import type { NotificationListResponse } from "@levantamiento-rq/shared-contracts";

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000";

export function NotificationsIndicator() {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const response = await fetch(
          `${GATEWAY_URL}/api/v1/notifications?state=UNREAD&page=1&pageSize=1`,
          { credentials: "include", cache: "no-store" },
        );
        if (!response.ok || !active) return;
        const payload = (await response.json()) as NotificationListResponse;
        setUnread(payload.unreadItems);
      } catch {
        // El indicador no interrumpe el resto del Workspace si Operations no responde.
      }
    }
    function focus() {
      void refresh();
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    window.addEventListener("focus", focus);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, []);

  return (
    <a
      aria-label={
        unread === 1
          ? "1 notificación sin leer"
          : `${unread} notificaciones sin leer`
      }
      className="rq-notifications-indicator"
      href="/workspace/notifications"
    >
      <span aria-hidden="true">N</span>
      {unread > 0 ? (
        <strong aria-hidden="true">{unread > 99 ? "99+" : unread}</strong>
      ) : null}
    </a>
  );
}
