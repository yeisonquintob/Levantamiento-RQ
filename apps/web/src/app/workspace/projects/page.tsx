import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type {
  DocumentTemplateListResponse,
  ProjectListResponse,
  ProjectMetrics,
} from "@levantamiento-rq/shared-contracts";

import { ProjectsWorkspace } from "../projects-workspace";

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000";

async function loadInitialData(): Promise<{
  list?: ProjectListResponse;
  metrics?: ProjectMetrics;
  templates?: DocumentTemplateListResponse;
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
    const [listResponse, metricsResponse, templatesResponse] =
      await Promise.all([
        fetch(`${GATEWAY_URL}/api/v1/projects?page=1&pageSize=50`, {
          cache: "no-store",
          headers,
        }),
        fetch(`${GATEWAY_URL}/api/v1/projects/summary`, {
          cache: "no-store",
          headers,
        }),
        fetch(
          `${GATEWAY_URL}/api/v1/templates?page=1&pageSize=50&status=PUBLISHED`,
          {
            cache: "no-store",
            headers,
          },
        ),
      ]);

    if (
      listResponse.status === 401 ||
      metricsResponse.status === 401 ||
      templatesResponse.status === 401
    ) {
      return { unauthorized: true };
    }

    if (
      !listResponse.ok ||
      !metricsResponse.ok ||
      !templatesResponse.ok
    ) {
      return {
        error:
          "Projects Service no respondió correctamente. Recarga la vista después de validar los servicios.",
      };
    }

    return {
      list: (await listResponse.json()) as ProjectListResponse,
      metrics: (await metricsResponse.json()) as ProjectMetrics,
      templates:
        (await templatesResponse.json()) as DocumentTemplateListResponse,
    };
  } catch {
    return {
      error:
        "No fue posible consultar Projects Service. Verifica los puertos 3000 y 3002.",
    };
  }
}

export default async function WorkspacePage() {
  const initial = await loadInitialData();

  if (initial.unauthorized) {
    redirect("/sign-in");
  }

  return (
    <ProjectsWorkspace
      initialError={initial.error}
      initialList={initial.list}
      initialMetrics={initial.metrics}
      initialTemplates={initial.templates}
    />
  );
}
