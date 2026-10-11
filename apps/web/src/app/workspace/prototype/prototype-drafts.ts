import type {
  ExportRequestDetail,
  ExportRequestListResponse,
  PrototypeGenerationDetail,
  ProjectListResponse,
  RequirementDocumentListResponse,
} from "@levantamiento-rq/shared-contracts";

import { authenticatedFetch } from "../../authenticated-fetch";
import { createBrowserUuid } from "../../browser-uuid";

const GATEWAY_URL =
  process.env.NODE_ENV === "development" && typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : (process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000");

const APPROVED_STATUSES = ["APPROVED", "EXECUTION", "COMPLETED"];
const EXPORT_POLL_MS = 1_500;
const EXPORT_POLL_ATTEMPTS = 30;

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(`${GATEWAY_URL}${path}`, {
    cache: "no-store",
    ...init,
  });
  if (!response.ok) throw new Error(`Solicitud rechazada (${response.status}).`);
  return (await response.json()) as T;
}

function safeFileName(value: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/gu, "")
    .replace(/[^a-zA-Z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLowerCase();
  return `${cleaned || "prototipo"}.md`;
}

/** Markdown aprobado de la versión vigente: reutiliza la exportación lista o la solicita. */
async function approvedMarkdown(
  projectId: string,
  documentId: string,
  versionNumber: number,
): Promise<string | null> {
  const base = `/api/v1/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}`;
  const findReady = (items: readonly ExportRequestDetail[]) =>
    items.find(
      (item) =>
        item.format === "MARKDOWN" &&
        item.status === "COMPLETED" &&
        item.versionNumber === versionNumber &&
        item.artifact,
    );
  let ready = findReady((await json<ExportRequestListResponse>(`${base}/exports`)).items);
  if (!ready) {
    const created = await json<ExportRequestDetail>(
      `${base}/versions/${versionNumber}/exports`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-idempotency-key": createBrowserUuid(),
        },
        body: JSON.stringify({ format: "MARKDOWN" }),
      },
    );
    for (let attempt = 0; attempt < EXPORT_POLL_ATTEMPTS && !ready; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, EXPORT_POLL_MS));
      const current = await json<ExportRequestDetail>(
        `/api/v1/exports/${encodeURIComponent(created.id)}`,
      );
      if (current.status === "FAILED") return null;
      ready = findReady([current]);
    }
  }
  if (!ready) return null;
  const file = await authenticatedFetch(
    `${GATEWAY_URL}/api/v1/exports/${encodeURIComponent(ready.id)}/download`,
    { cache: "no-store" },
  );
  return file.ok ? file.text() : null;
}

/**
 * Crea un borrador de prototipo para cada proyecto aprobado cuyo documento tiene prototipo y que
 * todavía no tiene ninguno en el historial. Devuelve cuántos creó.
 */
let running: Promise<number> | null = null;

export function ensureApprovedPrototypeDrafts(
  history: readonly PrototypeGenerationDetail[],
): Promise<number> {
  // Una sola ejecución a la vez: evita borradores duplicados al montar el módulo dos veces.
  running ??= createMissingDrafts(history).finally(() => {
    running = null;
  });
  return running;
}

async function createMissingDrafts(
  history: readonly PrototypeGenerationDetail[],
): Promise<number> {
  const projects = await json<ProjectListResponse>(
    "/api/v1/projects?page=1&pageSize=50",
  );
  const withDraft = new Set(
    history.map((item) => item.projectId?.toLowerCase()).filter(Boolean),
  );
  let created = 0;
  for (const project of projects.items) {
    if (
      project.activityState !== "ACTIVE" ||
      !APPROVED_STATUSES.includes(project.status) ||
      withDraft.has(project.id.toLowerCase())
    ) {
      continue;
    }
    try {
      const documents = await json<RequirementDocumentListResponse>(
        `/api/v1/projects/${encodeURIComponent(project.id)}/documents`,
      );
      const approved = documents.items.find((item) => item.status === "APPROVED");
      if (!approved || approved.hasPrototype !== true) continue;
      const markdown = await approvedMarkdown(
        project.id,
        approved.id,
        approved.currentVersionNumber,
      );
      if (!markdown?.trim()) continue;
      await json<PrototypeGenerationDetail>("/api/v1/prototypes/generations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          sourceFileName: safeFileName(project.title),
          markdown,
          targetDevice: "RESPONSIVE",
        }),
      });
      created += 1;
    } catch {
      // Un proyecto que falla no impide preparar los demás; se reintenta al volver a abrir.
    }
  }
  return created;
}
