import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type {
  ProjectListResponse,
  RequirementDocumentListResponse,
} from "@levantamiento-rq/shared-contracts";

import {
  type ValidationDocumentItem,
  ValidationWorkspace,
} from "./validation-workspace";

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000";

interface ValidationInitialData {
  projects?: ProjectListResponse;
  documents: readonly ValidationDocumentItem[];
  error?: string;
  unauthorized?: boolean;
}

async function loadValidation(): Promise<ValidationInitialData> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("rq_access")?.value;
  if (!accessToken) redirect("/sign-in");
  const headers = { cookie: `rq_access=${encodeURIComponent(accessToken)}` };

  try {
    const projectsResponse = await fetch(
      `${GATEWAY_URL}/api/v1/projects?page=1&pageSize=50`,
      { cache: "no-store", headers },
    );
    if (projectsResponse.status === 401)
      return { documents: [], unauthorized: true };
    if (!projectsResponse.ok) {
      return {
        documents: [],
        error: "No fue posible cargar los proyectos disponibles.",
      };
    }

    const projects = (await projectsResponse.json()) as ProjectListResponse;
    const responses = await Promise.all(
      projects.items.map(async (project) => ({
        project,
        response: await fetch(
          `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(project.id)}/documents`,
          { cache: "no-store", headers },
        ),
      })),
    );

    if (responses.some(({ response }) => response.status === 401)) {
      return { documents: [], unauthorized: true };
    }

    const failedProjects = responses.filter(({ response }) => !response.ok);
    const loaded = await Promise.all(
      responses
        .filter(({ response }) => response.ok)
        .map(async ({ project, response }) => ({
          project,
          documents: (await response.json()) as RequirementDocumentListResponse,
        })),
    );
    const documents = loaded.flatMap(({ project, documents: list }) =>
      list.items.map((document) => ({
        ...document,
        projectCode: project.code,
        projectTitle: project.title,
      })),
    );

    return {
      projects,
      documents,
      ...(failedProjects.length > 0
        ? {
            error:
              "Algunos proyectos no pudieron cargarse. La bandeja muestra la información disponible.",
          }
        : {}),
    };
  } catch {
    return {
      documents: [],
      error:
        "No fue posible comunicarse con el Gateway para cargar Validación.",
    };
  }
}

export default async function ValidationPage() {
  const initial = await loadValidation();
  if (initial.unauthorized) redirect("/sign-in");

  return (
    <ValidationWorkspace
      initialDocuments={initial.documents}
      initialError={initial.error}
      initialProjects={initial.projects}
    />
  );
}
