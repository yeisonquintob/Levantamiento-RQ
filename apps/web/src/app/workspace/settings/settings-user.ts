import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000";

export interface SettingsUser {
  displayName: string;
  email: string;
  roles: readonly string[];
  permissions: readonly string[];
}

export const loadSettingsUser = cache(async (): Promise<SettingsUser> => {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("rq_access")?.value;

  if (!accessToken) {
    redirect("/sign-in");
  }

  try {
    const response = await fetch(`${GATEWAY_URL}/api/v1/auth/me`, {
      cache: "no-store",
      headers: { cookie: `rq_access=${encodeURIComponent(accessToken)}` },
    });

    if (!response.ok) {
      redirect("/sign-in");
    }

    const payload = (await response.json()) as Partial<SettingsUser>;
    if (
      typeof payload.displayName !== "string" ||
      typeof payload.email !== "string" ||
      !Array.isArray(payload.roles) ||
      !payload.roles.every((role) => typeof role === "string") ||
      !Array.isArray(payload.permissions) ||
      !payload.permissions.every((permission) => typeof permission === "string")
    ) {
      redirect("/sign-in");
    }

    return {
      displayName: payload.displayName,
      email: payload.email,
      roles: payload.roles,
      permissions: payload.permissions,
    };
  } catch {
    redirect("/sign-in");
  }
});
