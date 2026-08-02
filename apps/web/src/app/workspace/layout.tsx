import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "../app-shell";

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000";

interface SessionUser {
  displayName: string;
  email: string;
}

async function resolveUser(): Promise<SessionUser> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("rq_access")?.value;

  if (!accessToken) {
    redirect("/sign-in");
  }

  try {
    const response = await fetch(`${GATEWAY_URL}/api/v1/auth/me`, {
      cache: "no-store",
      headers: {
        cookie: `rq_access=${encodeURIComponent(accessToken)}`,
      },
    });

    if (!response.ok) {
      redirect("/sign-in");
    }

    const payload = (await response.json()) as Partial<SessionUser>;

    if (
      typeof payload.displayName !== "string" ||
      typeof payload.email !== "string"
    ) {
      redirect("/sign-in");
    }

    return {
      displayName: payload.displayName,
      email: payload.email,
    };
  } catch {
    redirect("/sign-in");
  }
}

export default async function WorkspaceLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const user = await resolveUser();

  return <AppShell user={user}>{children}</AppShell>;
}
