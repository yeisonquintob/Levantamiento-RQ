import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { NotificationListResponse } from "@levantamiento-rq/shared-contracts";

import { NotificationsWorkspace } from "./notifications-workspace";

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000";

async function loadNotifications(): Promise<{
  list?: NotificationListResponse;
  error?: string;
}> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("rq_access")?.value;
  if (!accessToken) redirect("/sign-in");
  try {
    const response = await fetch(
      `${GATEWAY_URL}/api/v1/notifications?state=ALL&page=1&pageSize=50`,
      {
        cache: "no-store",
        headers: { cookie: `rq_access=${encodeURIComponent(accessToken)}` },
      },
    );
    if (response.status === 401) redirect("/sign-in");
    if (!response.ok) {
      return { error: "No fue posible consultar las notificaciones." };
    }
    return { list: (await response.json()) as NotificationListResponse };
  } catch {
    return { error: "Gateway u Operations Service no están disponibles." };
  }
}

export default async function NotificationsPage() {
  const initial = await loadNotifications();
  return (
    <NotificationsWorkspace
      initialError={initial.error}
      initialList={initial.list}
    />
  );
}
