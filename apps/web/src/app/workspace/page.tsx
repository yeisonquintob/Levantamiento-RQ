import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type {
  ProjectListResponse,
  ProjectMetrics,
} from "@levantamiento-rq/shared-contracts";

import { HomeWorkspace } from "./home-workspace";

const GATEWAY_URL =
  process.env.NODE_ENV === "development" && typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : (process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000");

async function loadHomeData(): Promise<{
  list?: ProjectListResponse;
  metrics?: ProjectMetrics;
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
      fetch(`${GATEWAY_URL}/api/v1/projects?page=1&pageSize=50`, {
        cache: "no-store",
        headers,
      }),
      fetch(`${GATEWAY_URL}/api/v1/projects/summary`, {
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
          "No fue posible cargar el resumen general. Valida Projects Service y recarga la vista.",
      };
    }

    return {
      list: (await listResponse.json()) as ProjectListResponse,
      metrics: (await metricsResponse.json()) as ProjectMetrics,
    };
  } catch {
    return {
      error:
        "No fue posible consultar Projects Service. Verifica los puertos 3000 y 3002.",
    };
  }
}

export default async function WorkspaceHomePage() {
  const initial = await loadHomeData();

  if (initial.unauthorized) {
    redirect("/sign-in");
  }

  return (
    <HomeWorkspace
      initialError={initial.error}
      initialList={initial.list}
      initialMetrics={initial.metrics}
    />
  );
}
