import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type {
  AiAnalysisRequestListResponse,
  DocumentVersionSummary,
  ProjectListResponse,
  RequirementDocumentListResponse,
} from "@levantamiento-rq/shared-contracts";

import {
  type DocumentListItem,
  type DocumentVersionListItem,
  DocumentsWorkspace,
} from "./documents-workspace";

const GATEWAY_URL =
  process.env.NODE_ENV === "development" && typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : (process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000");

interface DocumentsPageProps {
  searchParams: Promise<{ projectId?: string }>;
}

interface DocumentsInitialData {
  projects?: ProjectListResponse;
  documents: readonly DocumentListItem[];
  versions: readonly DocumentVersionListItem[];
  projectId?: string;
  error?: string;
  unauthorized?: boolean;
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function loadInitial(projectId?: string): Promise<DocumentsInitialData> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("rq_access")?.value;
  if (!accessToken) redirect("/sign-in");
  const headers = { cookie: `rq_access=${encodeURIComponent(accessToken)}` };

  try {
    const projectsResponse = await fetch(
      `${GATEWAY_URL}/api/v1/projects?page=1&pageSize=50`,
      { cache: "no-store", headers },
    );
    if (projectsResponse.status === 401) {
      return { documents: [], versions: [], unauthorized: true };
    }
    if (!projectsResponse.ok) {
      return {
        documents: [],
        versions: [],
        error: "No fue posible cargar los proyectos disponibles.",
      };
    }

    const projects = (await projectsResponse.json()) as ProjectListResponse;
    const selectedProject = projectId
      ? projects.items.find(
          (project) => project.id.toLowerCase() === projectId.toLowerCase(),
        )
      : undefined;
    const projectsToLoad = selectedProject ? [selectedProject] : projects.items;
    const documentResponses = await Promise.all(
      projectsToLoad.map(async (project) => ({
        project,
        response: await fetch(
          `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(project.id)}/documents`,
          { cache: "no-store", headers },
        ),
      })),
    );

    if (documentResponses.some(({ response }) => response.status === 401)) {
      return { documents: [], versions: [], unauthorized: true };
    }

    const failedDocuments = documentResponses.filter(
      ({ response }) => !response.ok,
    );
    const loadedDocuments = await Promise.all(
      documentResponses
        .filter(({ response }) => response.ok)
        .map(async ({ project, response }) => ({
          project,
          documents: (await response.json()) as RequirementDocumentListResponse,
        })),
    );
    const documents = loadedDocuments
      .flatMap(({ project, documents: list }) =>
        list.items.map((document) => ({
          ...document,
          projectCode: project.code,
          projectTitle: project.title,
        })),
      )
      .sort(
        (left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt),
      );

    if (!selectedProject) {
      return {
        projects,
        documents,
        versions: [],
        ...(failedDocuments.length > 0
          ? { error: "Algunos proyectos no pudieron cargarse." }
          : {}),
      };
    }

    // Las versiones y los análisis de IA son independientes: se piden a la vez.
    const [versionResponses, analysesResponse] = await Promise.all([
      Promise.all(
        documents.map(async (document) => ({
          document,
          response: await fetch(
            `${GATEWAY_URL}/api/v1/documents/${encodeURIComponent(document.id)}/versions`,
            { cache: "no-store", headers },
          ),
        })),
      ),
      fetch(
        `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(selectedProject.id)}/analysis-requests?page=1&pageSize=100`,
        { cache: "no-store", headers },
      ),
    ]);
    const analyses = analysesResponse.ok
      ? ((await analysesResponse.json()) as AiAnalysisRequestListResponse).items
      : [];

    if (versionResponses.some(({ response }) => response.status === 401)) {
      return { documents: [], versions: [], unauthorized: true };
    }

    const failedVersions = versionResponses.filter(
      ({ response }) => !response.ok,
    );
    const versions = (
      await Promise.all(
        versionResponses
          .filter(({ response }) => response.ok)
          .map(async ({ document, response }) => {
            const versions =
              (await response.json()) as readonly DocumentVersionSummary[];
            return versions.map(
              (version) =>
                ({
                  ...version,
                  documentId: document.id,
                  documentTitle: document.title,
                  documentArchived: document.status === "ARCHIVED",
                  currentVersionNumber: document.currentVersionNumber,
                  projectId: document.projectId,
                  projectCode: document.projectCode,
                  projectTitle: document.projectTitle,
                  aiEngines:
                    analyses.find(
                      (analysis) =>
                        analysis.documentId.toLowerCase() ===
                          document.id.toLowerCase() &&
                        analysis.generatedVersionNumber ===
                          version.versionNumber,
                    )?.engines ?? [],
                  aiModels:
                    analyses.find(
                      (analysis) =>
                        analysis.documentId.toLowerCase() ===
                          document.id.toLowerCase() &&
                        analysis.generatedVersionNumber ===
                          version.versionNumber,
                    )?.models ?? {},
                }) satisfies DocumentVersionListItem,
            );
          }),
      )
    )
      .flat()
      .sort(
        (left, right) =>
          timestamp(right.createdAt) - timestamp(left.createdAt) ||
          right.versionNumber - left.versionNumber,
      );

    return {
      projects,
      documents,
      versions,
      projectId: selectedProject?.id,
      ...(failedDocuments.length > 0 || failedVersions.length > 0
        ? {
            error:
              "Parte del historial no pudo cargarse. La tabla muestra las versiones disponibles.",
          }
        : {}),
    };
  } catch {
    return {
      documents: [],
      versions: [],
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
      key={initial.projectId ?? "all"}
      initialDocuments={initial.documents}
      initialError={initial.error}
      initialProjectId={initial.projectId}
      initialProjects={initial.projects}
      initialVersions={initial.versions}
    />
  );
}
