import { loadSettingsUser } from "../settings-user";
import { canManageSystem } from "../settings-access";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { ProjectListResponse } from "@levantamiento-rq/shared-contracts";

import { AuditWorkspace } from "../../audit/audit-workspace";

const GATEWAY_URL =
  process.env.NODE_ENV === "development" && typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : (process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000");

async function loadProjects(): Promise<{
  projects?: ProjectListResponse;
  error?: string;
}> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("rq_access")?.value;
  if (!accessToken) redirect("/sign-in");
  try {
    const response = await fetch(
      `${GATEWAY_URL}/api/v1/projects?page=1&pageSize=100`,
      {
        cache: "no-store",
        headers: { cookie: `rq_access=${encodeURIComponent(accessToken)}` },
      },
    );
    if (response.status === 401) redirect("/sign-in");
    if (!response.ok) return { error: "No fue posible cargar los proyectos." };
    return { projects: (await response.json()) as ProjectListResponse };
  } catch {
    return { error: "Gateway o Projects Service no están disponibles." };
  }
}

export default async function AuditPage() {
  const user = await loadSettingsUser();
  if (!canManageSystem(user))
    return <p role="alert">La auditoría requiere permiso de administración.</p>;
  const initial = await loadProjects();
  return (
    <AuditWorkspace
      initialError={initial.error}
      initialProjects={initial.projects}
    />
  );
}
