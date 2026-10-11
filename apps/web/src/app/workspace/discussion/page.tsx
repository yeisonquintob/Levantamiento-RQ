import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type {
  ProjectListResponse,
  ProjectSummary,
  ViabilityConfiguration,
} from "@levantamiento-rq/shared-contracts";

// RQ DISCUSION FILTRO AUTOMATICO Y ORDEN V1.1
import { DiscussionProjectList } from "./discussion-project-list";

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000";

async function loadProjects(): Promise<{
  projects: readonly ProjectSummary[];
  viability?: ViabilityConfiguration;
  error?: string;
}> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("rq_access")?.value;
  if (!accessToken) redirect("/sign-in");

  try {
    const [response, viabilityResponse] = await Promise.all([
      fetch(`${GATEWAY_URL}/api/v1/projects?page=1&pageSize=50`, {
        cache: "no-store",
        headers: { cookie: `rq_access=${encodeURIComponent(accessToken)}` },
      }),
      fetch(`${GATEWAY_URL}/api/v1/viability-criteria`, {
        cache: "no-store",
        headers: { cookie: `rq_access=${encodeURIComponent(accessToken)}` },
      }),
    ]);
    if (response.status === 401) redirect("/sign-in");
    if (!response.ok) {
      return {
        projects: [],
        error: "No fue posible consultar los proyectos disponibles.",
      };
    }
    const payload = (await response.json()) as ProjectListResponse;
    return {
      projects: payload.items,
      viability: viabilityResponse.ok
        ? ((await viabilityResponse.json()) as ViabilityConfiguration)
        : undefined,
    };
  } catch {
    return {
      projects: [],
      error: "No fue posible conectar con el servicio de proyectos.",
    };
  }
}

export default async function DiscussionIndexPage() {
  const { projects, viability, error } = await loadProjects();

  return (
    <div className="rq-discussion-index">
      {error ? (
        <div className="rq-project-alert" data-tone="danger" role="alert">
          <span>{error}</span>
        </div>
      ) : null}

      <DiscussionProjectList projects={projects} viability={viability} />
    </div>
  );
}
