import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type {
  ProjectListResponse,
  RequirementDocumentListResponse,
} from "@levantamiento-rq/shared-contracts";

import { DocumentsWorkspace } from "./documents-workspace";

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000";

interface DocumentsPageProps {
  searchParams: Promise<{ projectId?: string }>;
}

async function loadInitial(projectId?: string): Promise<{
  projects?: ProjectListResponse;
  documents?: RequirementDocumentListResponse;
  projectId?: string;
  error?: string;
  unauthorized?: boolean;
}> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("rq_access")?.value;
  if (!accessToken) redirect("/sign-in");
  const headers = { cookie: `rq_access=${encodeURIComponent(accessToken)}` };

  try {
    const projectsResponse = await fetch(
      `${GATEWAY_URL}/api/v1/projects?page=1&pageSize=50`,
      { cache: "no-store", headers },
    );
    if (projectsResponse.status === 401) return { unauthorized: true };
    if (!projectsResponse.ok) {
      return { error: "No fue posible cargar los proyectos disponibles." };
    }
    const projects = (await projectsResponse.json()) as ProjectListResponse;
    const selectedProjectId =
      projects.items.find((project) => project.id === projectId)?.id ??
      projects.items[0]?.id;

    if (!selectedProjectId) return { projects };
    const documentsResponse = await fetch(
      `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(selectedProjectId)}/documents`,
      { cache: "no-store", headers },
    );
    if (documentsResponse.status === 401) return { unauthorized: true };
    if (!documentsResponse.ok) {
      return {
        projects,
        projectId: selectedProjectId,
        error: "No fue posible cargar los documentos del proyecto.",
      };
    }

    return {
      projects,
      projectId: selectedProjectId,
      documents:
        (await documentsResponse.json()) as RequirementDocumentListResponse,
    };
  } catch {
    return {
      error:
        "No fue posible comunicarse con el Gateway para cargar Documentos.",
    };
  }
}

export default async function DocumentsPage({
  searchParams,
}: DocumentsPageProps) {
  const query = await searchParams;
  const initial = await loadInitial(query.projectId);
  if (initial.unauthorized) redirect("/sign-in");

  return (
    <DocumentsWorkspace
      initialDocuments={initial.documents}
      initialError={initial.error}
      initialProjectId={initial.projectId}
      initialProjects={initial.projects}
    />
  );
}
