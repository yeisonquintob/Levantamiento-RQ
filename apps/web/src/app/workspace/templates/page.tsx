import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type {
  DocumentTemplateListResponse,
  DocumentTemplateMetrics,
} from "@levantamiento-rq/shared-contracts";

import { TemplatesWorkspace } from "./templates-workspace";

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000";

async function loadTemplates(): Promise<{
  list?: DocumentTemplateListResponse;
  metrics?: DocumentTemplateMetrics;
  error?: string;
  unauthorized?: boolean;
}> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("rq_access")?.value;

  if (!accessToken) {
    redirect("/sign-in");
  }

  const headers = {
    cookie: `rq_access=${encodeURIComponent(accessToken)}`,
  };

  try {
    const [listResponse, metricsResponse] = await Promise.all([
      fetch(`${GATEWAY_URL}/api/v1/templates?page=1&pageSize=50`, {
        cache: "no-store",
        headers,
      }),
      fetch(`${GATEWAY_URL}/api/v1/templates/summary`, {
        cache: "no-store",
        headers,
      }),
    ]);

    if (listResponse.status === 401 || metricsResponse.status === 401) {
      return { unauthorized: true };
    }

    if (!listResponse.ok || !metricsResponse.ok) {
      return {
        error:
          "Documents Service no respondió correctamente. Valida el puerto 3004 y recarga la vista.",
      };
    }

    return {
      list: (await listResponse.json()) as DocumentTemplateListResponse,
      metrics: (await metricsResponse.json()) as DocumentTemplateMetrics,
    };
  } catch {
    return {
      error:
        "No fue posible consultar Documents Service. Verifica los puertos 3000 y 3004.",
    };
  }
}

export default async function TemplatesPage() {
  const initial = await loadTemplates();

  if (initial.unauthorized) {
    redirect("/sign-in");
  }

  return (
    <TemplatesWorkspace
      initialError={initial.error}
      initialList={initial.list}
      initialMetrics={initial.metrics}
    />
  );
}
