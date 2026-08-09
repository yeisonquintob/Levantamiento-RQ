import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { AiProviderConfigurationListResponse } from "@levantamiento-rq/shared-contracts";

import { AiProvidersWorkspace } from "./ai-providers-workspace";

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000";

async function loadProviders(): Promise<{
  list?: AiProviderConfigurationListResponse;
  error?: string;
}> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("rq_access")?.value;
  if (!accessToken) redirect("/sign-in");

  try {
    const response = await fetch(`${GATEWAY_URL}/api/v1/admin/ai-providers`, {
      cache: "no-store",
      headers: { cookie: `rq_access=${encodeURIComponent(accessToken)}` },
    });
    if (response.status === 401) redirect("/sign-in");
    if (!response.ok) {
      return { error: "No fue posible consultar los proveedores de IA." };
    }
    return {
      list: (await response.json()) as AiProviderConfigurationListResponse,
    };
  } catch {
    return { error: "AI Analysis Service o Gateway no están disponibles." };
  }
}

export default async function AiProvidersPage() {
  const initial = await loadProviders();
  return (
    <AiProvidersWorkspace
      initialError={initial.error}
      initialList={initial.list}
    />
  );
}
