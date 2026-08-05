import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type {
  IdentityRoleSummary,
  IdentityUserListResponse,
  IdentityUserMetrics,
} from "@levantamiento-rq/shared-contracts";

import { UsersWorkspace } from "./users-workspace";

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000";

async function loadUsers() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("rq_access")?.value;

  if (!accessToken) redirect("/sign-in");

  const headers = { cookie: `rq_access=${encodeURIComponent(accessToken)}` };

  try {
    const [list, metrics, roles] = await Promise.all([
      fetch(`${GATEWAY_URL}/api/v1/users?page=1&pageSize=50`, {
        cache: "no-store",
        headers,
      }),
      fetch(`${GATEWAY_URL}/api/v1/users/summary`, {
        cache: "no-store",
        headers,
      }),
      fetch(`${GATEWAY_URL}/api/v1/users/roles`, {
        cache: "no-store",
        headers,
      }),
    ]);

    if ([list, metrics, roles].some((response) => response.status === 401)) {
      redirect("/sign-in");
    }

    if (!list.ok || !metrics.ok || !roles.ok) {
      return { error: "No fue posible consultar la administración de usuarios." };
    }

    return {
      list: (await list.json()) as IdentityUserListResponse,
      metrics: (await metrics.json()) as IdentityUserMetrics,
      roles: (await roles.json()) as readonly IdentityRoleSummary[],
    };
  } catch {
    return { error: "Identity Service o Gateway no están disponibles." };
  }
}

export default async function UsersPage() {
  const initial = await loadUsers();

  return (
    <UsersWorkspace
      initialError={initial.error}
      initialList={initial.list}
      initialMetrics={initial.metrics}
      initialRoles={initial.roles}
    />
  );
}
