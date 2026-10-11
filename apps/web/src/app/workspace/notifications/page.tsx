import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type {
  NotificationListResponse,
  ProjectListResponse,
} from "@levantamiento-rq/shared-contracts";

import { NotificationsWorkspace } from "./notifications-workspace";

const GATEWAY_URL =
  process.env.NODE_ENV === "development" && typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : (process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000");

async function loadNotifications(): Promise<{
  list?: NotificationListResponse;
  projects?: ProjectListResponse;
  error?: string;
}> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("rq_access")?.value;
  if (!accessToken) redirect("/sign-in");
  try {
    const [response, projectsResponse] = await Promise.all([
      fetch(
        `${GATEWAY_URL}/api/v1/notifications?state=ALL&page=1&pageSize=50`,
        {
          cache: "no-store",
          headers: { cookie: `rq_access=${encodeURIComponent(accessToken)}` },
        },
      ),
      fetch(`${GATEWAY_URL}/api/v1/projects?page=1&pageSize=100`, {
        cache: "no-store",
        headers: { cookie: `rq_access=${encodeURIComponent(accessToken)}` },
      }),
    ]);
    if (response.status === 401 || projectsResponse.status === 401)
      redirect("/sign-in");
    if (!response.ok) {
      return { error: "No fue posible consultar las notificaciones." };
    }
    return {
      list: (await response.json()) as NotificationListResponse,
      projects: projectsResponse.ok
        ? ((await projectsResponse.json()) as ProjectListResponse)
        : undefined,
    };
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
      initialProjects={initial.projects}
    />
  );
}
