import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type {
  ProjectDetail,
  RequirementDocumentDetail,
} from "@levantamiento-rq/shared-contracts";

import { RequirementDocumentEditor } from "./requirement-document-editor";

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000";

interface EditorPageProps {
  params: Promise<{ documentId: string }>;
}

async function loadEditor(documentId: string): Promise<{
  document?: RequirementDocumentDetail;
  project?: ProjectDetail;
  error?: string;
  unauthorized?: boolean;
}> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("rq_access")?.value;
  if (!accessToken) redirect("/sign-in");
  const headers = { cookie: `rq_access=${encodeURIComponent(accessToken)}` };

  try {
    const documentResponse = await fetch(
      `${GATEWAY_URL}/api/v1/documents/${encodeURIComponent(documentId)}`,
      { cache: "no-store", headers },
    );
    if (documentResponse.status === 401) return { unauthorized: true };
    if (!documentResponse.ok) {
      return { error: "No fue posible abrir el documento solicitado." };
    }
    const document =
      (await documentResponse.json()) as RequirementDocumentDetail;
    const projectResponse = await fetch(
      `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(document.projectId)}`,
      { cache: "no-store", headers },
    );
    if (projectResponse.status === 401) return { unauthorized: true };
    if (!projectResponse.ok) {
      return {
        document,
        error: "El documento existe, pero no fue posible cargar su proyecto.",
      };
    }
    return {
      document,
      project: (await projectResponse.json()) as ProjectDetail,
    };
  } catch {
    return {
      error: "No fue posible comunicarse con el Gateway para abrir el editor.",
    };
  }
}

export default async function EditorPage({ params }: EditorPageProps) {
  const { documentId } = await params;
  const initial = await loadEditor(documentId);
  if (initial.unauthorized) redirect("/sign-in");

  if (!initial.document || !initial.project) {
    return (
      <section className="rq-editor-error" role="alert">
        <span aria-hidden="true">!</span>
        <h1>No se pudo abrir el editor</h1>
        <p>{initial.error ?? "El documento no está disponible."}</p>
        <a href="/workspace/documents">Volver a Documentos</a>
      </section>
    );
  }

  return (
    <RequirementDocumentEditor
      initialDocument={initial.document}
      project={initial.project}
    />
  );
}
