import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { ProjectListResponse } from "@levantamiento-rq/shared-contracts";

import { SourcesWorkspace } from "./sources-workspace";
import { SourcesProjectList } from "./sources-project-list";

const GATEWAY_URL =
  process.env.NODE_ENV === "development" && typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : (process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000");

interface SourcesPageProps {
  searchParams: Promise<{
    projectId?: string;
    analysisRequestId?: string;
  }>;
}

async function loadProjects(): Promise<{
  projects?: ProjectListResponse;
  error?: string;
  unauthorized?: boolean;
}> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("rq_access")?.value;

  if (!accessToken) {
    redirect("/sign-in");
  }

  try {
    const response = await fetch(
      `${GATEWAY_URL}/api/v1/projects?page=1&pageSize=50`,
      {
        cache: "no-store",
        headers: {
          cookie: `rq_access=${encodeURIComponent(accessToken)}`,
        },
      },
    );

    if (response.status === 401) {
      return { unauthorized: true };
    }

    if (!response.ok) {
      return {
        error:
          "No fue posible cargar los proyectos disponibles para administrar fuentes.",
      };
    }

    return {
      projects: (await response.json()) as ProjectListResponse,
    };
  } catch {
    return {
      error:
        "No fue posible consultar Projects Service. Verifica los puertos 3000 y 3002.",
    };
  }
}

export default async function SourcesPage({ searchParams }: SourcesPageProps) {
  const [initial, query] = await Promise.all([loadProjects(), searchParams]);

  if (initial.unauthorized) {
    redirect("/sign-in");
  }

  if (!query.projectId) {
    return (
      <SourcesProjectList
        initialError={initial.error}
        projects={initial.projects?.items ?? []}
      />
    );
  }

  return (
    <SourcesWorkspace
      initialError={initial.error}
      initialAnalysisRequestId={query.analysisRequestId}
      initialProjectId={query.projectId}
      initialProjects={initial.projects}
    />
  );
}
