"use client";

import React, { useEffect, useMemo, useState } from "react";

import type {
  AiAnalysisRequestDetail,
  AiAnalysisRequestListResponse,
  AiProviderCode,
  DocumentHistoryEntry,
  DocumentJsonValue,
  DocumentSection,
  DocumentSectionKey,
  DocumentStatus,
  DocumentVersionDetail,
  ProjectDetail,
  RequirementDocumentDetail,
  SourceListResponse,
  WorkflowReviewDetail,
  WorkflowReviewListResponse,
} from "@levantamiento-rq/shared-contracts";
import { RqActionButton, RqStatusBadge } from "@levantamiento-rq/shared-ui";

import { useDialogAccessibility } from "../../../use-dialog-accessibility";

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000";
const PENDING = "[PENDIENTE POR DEFINIR]";

const FIELD_LABELS: Readonly<Record<string, string>> = {
  title: "Título",
  projectCode: "Código del proyecto",
  documentVersion: "Versión del documento",
  createdDate: "Fecha de creación",
  requestingArea: "Área solicitante",
  preparedBy: "Elaborado por",
  reviewedBy: "Revisado por",
  approvedBy: "Aprobado por",
  status: "Estado",
  name: "Nombre",
  position: "Cargo",
  general: "Objetivo general",
  specific: "Objetivos específicos",
  currentState: "Estado actual",
  operationalImpact: "Impacto operacional",
  included: "Incluye",
  excluded: "No incluye",
  involvedSystems: "Sistemas involucrados",
  notation: "Notación",
  content: "Contenido",
  actors: "Actores",
  inputs: "Entradas",
  outputs: "Salidas",
  systems: "Sistemas",
  number: "Número",
  description: "Descripción",
  keyActivities: "Actividades clave",
  userStory: "Historia de usuario",
  code: "Código",
  asA: "Como",
  iWant: "Quiero",
  soThat: "Para",
  acceptanceCriteria: "Criterios de aceptación",
  businessRules: "Reglas de negocio",
  requiredFields: "Campos requeridos",
  type: "Tipo",
  required: "Obligatorio",
  validationOrObservation: "Validación u observación",
  security: "Seguridad",
  traceability: "Trazabilidad",
  performance: "Rendimiento",
  compatibility: "Compatibilidad",
  availability: "Disponibilidad",
  usability: "Usabilidad",
  objective: "Objetivo de pruebas",
  minimumScenarios: "Escenarios mínimos",
  assumptions: "Supuestos",
  dependencies: "Dependencias",
  pendingItems: "Pendientes",
  changeControl: "Control de cambios",
  approvals: "Aprobaciones",
  templateControlled: "Controlado por plantilla",
};

export interface ContentStats {
  total: number;
  completed: number;
  pending: number;
  errors: readonly string[];
}

interface AiVersionGenerationDetails {
  provider: AiProviderCode;
  pendingQuestions: readonly string[];
  contradictions: readonly string[];
}

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function statusLabel(status: DocumentStatus): string {
  if (status === "IN_REVIEW") return "En validación";
  if (status === "APPROVED") return "Aprobado";
  if (status === "REJECTED") return "Rechazado";
  if (status === "ARCHIVED") return "Archivado";
  return "Borrador";
}

function statusTone(
  status: DocumentStatus,
): "success" | "process" | "pending" | "danger" | "inactive" {
  if (status === "APPROVED") return "success";
  if (status === "IN_REVIEW") return "process";
  if (status === "REJECTED") return "danger";
  if (status === "ARCHIVED") return "inactive";
  return "pending";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function workflowActivityLabel(
  type: WorkflowReviewDetail["activities"][number]["type"],
): string {
  if (type === "REVIEW_REQUESTED") return "Revisión solicitada";
  if (type === "COMMENTED") return "Comentario";
  if (type === "CHANGES_REQUESTED") return "Correcciones solicitadas";
  if (type === "APPROVED") return "Versión aprobada";
  return "Versión rechazada";
}

export function analyzeContent(
  value: DocumentJsonValue,
  path: readonly string[] = [],
): ContentStats {
  if (typeof value === "string") {
    const empty = value.trim().length === 0;
    const pending = value.includes(PENDING);
    return {
      total: 1,
      completed: empty || pending ? 0 : 1,
      pending: pending ? 1 : 0,
      errors: empty
        ? [`${path.map(fieldLabel).join(" · ") || "Campo"} es obligatorio.`]
        : [],
    };
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return { total: 1, completed: 1, pending: 0, errors: [] };
  }
  if (value === null) {
    return {
      total: 1,
      completed: 0,
      pending: 0,
      errors: [
        `${path.map(fieldLabel).join(" · ") || "Campo"} es obligatorio.`,
      ],
    };
  }
  if (Array.isArray(value)) {
    const key = path.at(-1);
    const emptyAllowed = key === "changeControl" || key === "approvals";
    if (value.length === 0) {
      return {
        total: 1,
        completed: emptyAllowed ? 1 : 0,
        pending: 0,
        errors: emptyAllowed
          ? []
          : [
              `${path.map(fieldLabel).join(" · ")} requiere al menos un elemento.`,
            ],
      };
    }
    return value.reduce<ContentStats>(
      (result, item, index) => {
        const next = analyzeContent(item, [...path, String(index + 1)]);
        return {
          total: result.total + next.total,
          completed: result.completed + next.completed,
          pending: result.pending + next.pending,
          errors: [...result.errors, ...next.errors],
        };
      },
      { total: 0, completed: 0, pending: 0, errors: [] },
    );
  }
  return Object.entries(value).reduce<ContentStats>(
    (result, [key, item]) => {
      const next = analyzeContent(item, [...path, key]);
      return {
        total: result.total + next.total,
        completed: result.completed + next.completed,
        pending: result.pending + next.pending,
        errors: [...result.errors, ...next.errors],
      };
    },
    { total: 0, completed: 0, pending: 0, errors: [] },
  );
}

function versionStats(version: DocumentVersionDetail): ContentStats {
  return version.sections.reduce<ContentStats>(
    (result, section) => {
      const next = analyzeContent(section.content, [section.title]);
      return {
        total: result.total + next.total,
        completed: result.completed + next.completed,
        pending: result.pending + next.pending,
        errors: [...result.errors, ...next.errors],
      };
    },
    { total: 0, completed: 0, pending: 0, errors: [] },
  );
}

function cloneForNewItem(
  value: DocumentJsonValue | undefined,
): DocumentJsonValue {
  if (value === undefined) return PENDING;
  if (typeof value === "string") return PENDING;
  if (typeof value === "number") return value + 1;
  if (typeof value === "boolean") return false;
  if (value === null) return PENDING;
  if (Array.isArray(value)) return value.map((item) => cloneForNewItem(item));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, cloneForNewItem(item)]),
  );
}

async function responseError(response: Response): Promise<string> {
  if (response.status === 401) {
    window.location.assign("/sign-in");
    return "La sesión terminó.";
  }
  const text = await response.text();
  try {
    const payload = JSON.parse(text) as {
      detail?: string;
      message?: string | readonly string[];
      correlationId?: string;
    };
    const message =
      typeof payload.detail === "string"
        ? payload.detail
        : typeof payload.message === "string"
          ? payload.message
          : payload.message
            ? [...payload.message].join(" ")
            : "La operación no pudo completarse.";
    return payload.correlationId
      ? `${message} Código de seguimiento: ${payload.correlationId}.`
      : message;
  } catch {
    return text || "La operación no pudo completarse.";
  }
}

interface JsonValueEditorProps {
  value: DocumentJsonValue;
  label: string;
  path: string;
  readOnly: boolean;
  onChange: (value: DocumentJsonValue) => void;
}

function JsonValueEditor({
  value,
  label,
  path,
  readOnly,
  onChange,
}: JsonValueEditorProps) {
  if (typeof value === "string") {
    const multiline =
      value.length > 80 ||
      !["code", "status", "notation"].includes(path.split(".").at(-1) ?? "");
    return (
      <label className="rq-document-json-field">
        <span>{label}</span>
        {multiline ? (
          <textarea
            aria-invalid={!value.trim()}
            disabled={readOnly}
            onChange={(event) => onChange(event.target.value)}
            rows={Math.min(8, Math.max(2, Math.ceil(value.length / 90)))}
            value={value}
          />
        ) : (
          <input
            aria-invalid={!value.trim()}
            disabled={readOnly}
            onChange={(event) => onChange(event.target.value)}
            value={value}
          />
        )}
        {value.includes(PENDING) ? (
          <small data-pending="true">Pendiente de definición</small>
        ) : null}
      </label>
    );
  }
  if (typeof value === "number") {
    return (
      <label className="rq-document-json-field">
        <span>{label}</span>
        <input
          disabled={readOnly}
          min={1}
          onChange={(event) => onChange(Number(event.target.value))}
          type="number"
          value={value}
        />
      </label>
    );
  }
  if (typeof value === "boolean") {
    return (
      <label className="rq-document-json-check">
        <input
          checked={value}
          disabled={readOnly}
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
        <span>{label}</span>
      </label>
    );
  }
  if (value === null) {
    return (
      <label className="rq-document-json-field">
        <span>{label}</span>
        <input
          disabled={readOnly}
          onChange={(event) => onChange(event.target.value)}
          value=""
        />
      </label>
    );
  }
  if (Array.isArray(value)) {
    return (
      <fieldset className="rq-document-json-group rq-document-json-array">
        <legend>{label}</legend>
        {value.length === 0 ? <p>Sin registros en esta versión.</p> : null}
        {value.map((item, index) => (
          <section
            className="rq-document-json-array__item"
            key={`${path}-${index}`}
          >
            <header>
              <strong>
                {label} {index + 1}
              </strong>
              {!readOnly && value.length > 1 ? (
                <button
                  aria-label={`Eliminar ${label} ${index + 1}`}
                  onClick={() =>
                    onChange(
                      value.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                  type="button"
                >
                  Eliminar
                </button>
              ) : null}
            </header>
            <JsonValueEditor
              label={`${label} ${index + 1}`}
              onChange={(next) =>
                onChange(
                  value.map((current, itemIndex) =>
                    itemIndex === index ? next : current,
                  ),
                )
              }
              path={`${path}.${index}`}
              readOnly={readOnly}
              value={item}
            />
          </section>
        ))}
        {!readOnly ? (
          <button
            className="rq-document-add-item"
            onClick={() => onChange([...value, cloneForNewItem(value[0])])}
            type="button"
          >
            Agregar elemento
          </button>
        ) : null}
      </fieldset>
    );
  }
  return (
    <fieldset className="rq-document-json-group">
      <legend>{label}</legend>
      <div className="rq-document-json-grid">
        {Object.entries(value).map(([key, item]) => (
          <JsonValueEditor
            key={`${path}.${key}`}
            label={fieldLabel(key)}
            onChange={(next) => onChange({ ...value, [key]: next })}
            path={`${path}.${key}`}
            readOnly={readOnly}
            value={item}
          />
        ))}
      </div>
    </fieldset>
  );
}

interface RequirementDocumentEditorProps {
  initialDocument: RequirementDocumentDetail;
  project: ProjectDetail;
}

export function RequirementDocumentEditor({
  initialDocument,
  project,
}: RequirementDocumentEditorProps) {
  const [documentState, setDocumentState] = useState(initialDocument);
  const [version, setVersion] = useState(initialDocument.currentVersionDetail);
  const [activeKey, setActiveKey] = useState<DocumentSectionKey>(
    initialDocument.currentVersionDetail.sections[0]?.key ?? "header",
  );
  const [draftContent, setDraftContent] = useState<DocumentJsonValue>(
    initialDocument.currentVersionDetail.sections[0]?.content ?? {},
  );
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [alertTone, setAlertTone] = useState<"success" | "danger" | "warning">(
    "success",
  );
  const [conflict, setConflict] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<readonly DocumentHistoryEntry[]>([]);
  const [versionOpen, setVersionOpen] = useState(false);
  const [versionSummary, setVersionSummary] = useState(
    "Ajustes posteriores a la revisión",
  );
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareLeft, setCompareLeft] = useState(1);
  const [compareRight, setCompareRight] = useState(
    documentState.currentVersionNumber,
  );
  const [leftVersion, setLeftVersion] = useState<DocumentVersionDetail | null>(
    null,
  );
  const [rightVersion, setRightVersion] =
    useState<DocumentVersionDetail | null>(null);
  const [review, setReview] = useState<WorkflowReviewDetail | null>(null);
  const [reviewComment, setReviewComment] = useState("");
  const [aiVersionOpen, setAiVersionOpen] = useState(false);
  const [aiHistoryOpen, setAiHistoryOpen] = useState(false);
  const [aiSources, setAiSources] = useState<SourceListResponse["items"]>([]);
  const [selectedAiSourceIds, setSelectedAiSourceIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiHistory, setAiHistory] = useState<
    readonly AiAnalysisRequestDetail[]
  >([]);
  const [aiGeneratedVersionIds, setAiGeneratedVersionIds] = useState<
    Set<string>
  >(() => new Set());
  const [aiVersionGenerationDetails, setAiVersionGenerationDetails] = useState<
    Map<string, AiVersionGenerationDetails>
  >(() => new Map());
  const versionDialogRef = useDialogAccessibility<HTMLElement>(
    versionOpen,
    () => {
      if (!busy) setVersionOpen(false);
    },
  );
  const historyDialogRef = useDialogAccessibility<HTMLElement>(
    historyOpen,
    () => setHistoryOpen(false),
  );
  const aiVersionDialogRef = useDialogAccessibility<HTMLElement>(
    aiVersionOpen,
    () => {
      if (!busy) setAiVersionOpen(false);
    },
  );
  const aiHistoryDialogRef = useDialogAccessibility<HTMLElement>(
    aiHistoryOpen,
    () => setAiHistoryOpen(false),
  );
  const compareDialogRef = useDialogAccessibility<HTMLElement>(
    compareOpen && Boolean(leftVersion) && Boolean(rightVersion),
    () => setCompareOpen(false),
  );

  const activeSection =
    version.sections.find((section) => section.key === activeKey) ??
    version.sections[0];
  const unsaved =
    Boolean(activeSection) &&
    JSON.stringify(draftContent) !== JSON.stringify(activeSection.content);
  const currentVersion =
    version.versionNumber === documentState.currentVersionNumber;
  const readOnly =
    !currentVersion ||
    version.status !== "DRAFT" ||
    documentState.status === "ARCHIVED" ||
    Boolean(activeSection?.templateControlled);
  const activeStats = useMemo(
    () => analyzeContent(draftContent),
    [draftContent],
  );
  const overallStats = useMemo(() => versionStats(version), [version]);
  const progress = overallStats.total
    ? Math.round((overallStats.completed / overallStats.total) * 100)
    : 0;
  const currentAiGeneration = aiVersionGenerationDetails.get(
    version.id.toLowerCase(),
  );
  const documentaryPending =
    overallStats.pending +
    overallStats.errors.length +
    (currentAiGeneration?.pendingQuestions.length ?? 0) +
    (currentAiGeneration?.contradictions.length ?? 0);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!unsaved) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [unsaved]);

  useEffect(() => {
    if (currentVersion && version.status !== "DRAFT") {
      void loadReview();
    } else {
      setReview(null);
    }
  }, [
    currentVersion,
    documentState.id,
    project.id,
    version.status,
    version.versionNumber,
  ]);

  useEffect(() => {
    let active = true;
    void loadAiRequests(true)
      .then((items) => {
        if (!active) return;
        synchronizeAiVersionDetails(items);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [documentState.id, project.id]);

  function showAlert(message: string, tone: "success" | "danger" | "warning") {
    setAlert(message);
    setAlertTone(tone);
  }

  function synchronizeAiVersionDetails(
    items: readonly AiAnalysisRequestDetail[],
  ): void {
    const completed = items.filter((item) => item.status === "COMPLETED");
    setAiGeneratedVersionIds(
      new Set(completed.map((item) => item.documentVersionId.toLowerCase())),
    );
    setAiVersionGenerationDetails(
      new Map(
        completed.flatMap((item) => {
          const execution = item.executions.at(-1);
          if (!execution) return [];
          return [
            [
              item.documentVersionId.toLowerCase(),
              {
                provider: execution.provider,
                pendingQuestions: item.result?.draft.pendingQuestions ?? [],
                contradictions: item.result?.draft.contradictions ?? [],
              },
            ] as const,
          ];
        }),
      ),
    );
  }

  function chooseSection(section: DocumentSection): void {
    if (
      unsaved &&
      !window.confirm(
        "Hay cambios sin guardar. ¿Deseas descartarlos y cambiar de sección?",
      )
    )
      return;
    setActiveKey(section.key);
    setDraftContent(section.content);
    setAlert(null);
    setConflict(false);
  }

  async function reloadDocument(message?: string): Promise<void> {
    setBusy(true);
    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/documents/${encodeURIComponent(documentState.id)}`,
        { credentials: "include", cache: "no-store" },
      );
      if (!response.ok) throw new Error(await responseError(response));
      const next = (await response.json()) as RequirementDocumentDetail;
      setDocumentState(next);
      setVersion(next.currentVersionDetail);
      const section =
        next.currentVersionDetail.sections.find(
          (item) => item.key === activeKey,
        ) ?? next.currentVersionDetail.sections[0];
      if (section) {
        setActiveKey(section.key);
        setDraftContent(section.content);
      }
      setConflict(false);
      if (message) showAlert(message, "success");
    } catch (error) {
      showAlert(
        error instanceof Error ? error.message : String(error),
        "danger",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveSection(): Promise<void> {
    if (!activeSection || readOnly) return;
    if (activeStats.errors.length > 0) {
      showAlert("Corrige los campos obligatorios antes de guardar.", "danger");
      return;
    }
    setBusy(true);
    setConflict(false);
    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/documents/${encodeURIComponent(documentState.id)}/versions/${version.versionNumber}/sections/${encodeURIComponent(activeSection.key)}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expectedRevision: version.revision,
            content: draftContent,
          }),
        },
      );
      if (!response.ok) {
        const message = await responseError(response);
        if (response.status === 409) setConflict(true);
        throw new Error(message);
      }
      const saved = (await response.json()) as DocumentVersionDetail;
      setVersion(saved);
      setDocumentState((current) => ({
        ...current,
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
        currentVersionDetail: saved,
      }));
      const savedSection = saved.sections.find(
        (item) => item.key === activeSection.key,
      );
      if (savedSection) setDraftContent(savedSection.content);
      showAlert("La sección se guardó correctamente.", "success");
    } catch (error) {
      showAlert(
        error instanceof Error ? error.message : String(error),
        "danger",
      );
    } finally {
      setBusy(false);
    }
  }

  async function loadVersion(versionNumber: number): Promise<void> {
    if (
      unsaved &&
      !window.confirm(
        "Hay cambios sin guardar. ¿Deseas descartarlos y abrir otra versión?",
      )
    )
      return;
    if (versionNumber === documentState.currentVersionNumber) {
      const current = documentState.currentVersionDetail;
      setVersion(current);
      const section =
        current.sections.find((item) => item.key === activeKey) ??
        current.sections[0];
      if (section) {
        setActiveKey(section.key);
        setDraftContent(section.content);
      }
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/documents/${encodeURIComponent(documentState.id)}/versions/${versionNumber}`,
        { credentials: "include", cache: "no-store" },
      );
      if (!response.ok) throw new Error(await responseError(response));
      const loaded = (await response.json()) as DocumentVersionDetail;
      setVersion(loaded);
      const section =
        loaded.sections.find((item) => item.key === activeKey) ??
        loaded.sections[0];
      if (section) {
        setActiveKey(section.key);
        setDraftContent(section.content);
      }
      setAlert(null);
    } catch (error) {
      showAlert(
        error instanceof Error ? error.message : String(error),
        "danger",
      );
    } finally {
      setBusy(false);
    }
  }

  function openVersionDialog(): void {
    if (unsaved) {
      showAlert(
        "Guarda o descarta los cambios antes de crear una versión.",
        "warning",
      );
      return;
    }
    setVersionSummary("Ajustes posteriores a la revisión");
    setVersionOpen(true);
  }

  async function createVersion(): Promise<void> {
    const summary = versionSummary.trim();
    if (summary.length < 3) {
      showAlert("Describe el motivo de la nueva versión.", "danger");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/documents/${encodeURIComponent(documentState.id)}/versions`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expectedRevision: documentState.revision,
            changeSummary: summary,
          }),
        },
      );
      if (!response.ok) {
        const message = await responseError(response);
        if (response.status === 409) setConflict(true);
        throw new Error(message);
      }
      const next = (await response.json()) as RequirementDocumentDetail;
      setDocumentState(next);
      setVersion(next.currentVersionDetail);
      const first = next.currentVersionDetail.sections[0];
      if (first) {
        setActiveKey(first.key);
        setDraftContent(first.content);
      }
      setVersionOpen(false);
      setReview(null);
      showAlert(`Se creó la versión ${next.currentVersion}.`, "success");
    } catch (error) {
      showAlert(
        error instanceof Error ? error.message : String(error),
        "danger",
      );
    } finally {
      setBusy(false);
    }
  }

  async function loadReview(): Promise<void> {
    try {
      const listResponse = await fetch(
        `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(project.id)}/reviews`,
        { credentials: "include", cache: "no-store" },
      );
      if (!listResponse.ok) throw new Error(await responseError(listResponse));
      const list = (await listResponse.json()) as WorkflowReviewListResponse;
      const summary = list.items.find(
        (item) =>
          item.documentId.toLowerCase() === documentState.id.toLowerCase() &&
          item.versionNumber === version.versionNumber,
      );

      if (!summary) {
        setReview(null);
        return;
      }

      const detailResponse = await fetch(
        `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(project.id)}/reviews/${encodeURIComponent(summary.id)}`,
        { credentials: "include", cache: "no-store" },
      );
      if (!detailResponse.ok)
        throw new Error(await responseError(detailResponse));
      setReview((await detailResponse.json()) as WorkflowReviewDetail);
    } catch (error) {
      showAlert(
        error instanceof Error ? error.message : String(error),
        "danger",
      );
    }
  }

  async function requestReview(): Promise<void> {
    if (unsaved) {
      showAlert(
        "Guarda o descarta los cambios antes de cambiar el estado.",
        "warning",
      );
      return;
    }
    if (!window.confirm("¿Deseas enviar esta versión a validación?")) return;
    setBusy(true);
    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(project.id)}/documents/${encodeURIComponent(documentState.id)}/versions/${version.versionNumber}/reviews`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            expectedDocumentRevision: version.revision,
            comment: reviewComment.trim() || null,
          }),
        },
      );
      if (!response.ok) {
        const message = await responseError(response);
        if (response.status === 409) setConflict(true);
        throw new Error(message);
      }
      setReview((await response.json()) as WorkflowReviewDetail);
      setReviewComment("");
      await reloadDocument("La versión quedó en validación.");
    } catch (error) {
      showAlert(
        error instanceof Error ? error.message : String(error),
        "danger",
      );
    } finally {
      setBusy(false);
    }
  }

  async function addReviewComment(): Promise<void> {
    if (!review || !reviewComment.trim()) {
      showAlert("Escribe el comentario que deseas registrar.", "warning");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(project.id)}/reviews/${encodeURIComponent(review.id)}/comments`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            expectedReviewRevision: review.revision,
            comment: reviewComment.trim(),
          }),
        },
      );
      if (!response.ok) {
        const message = await responseError(response);
        if (response.status === 409) setConflict(true);
        throw new Error(message);
      }
      setReview((await response.json()) as WorkflowReviewDetail);
      setReviewComment("");
      showAlert("El comentario quedó registrado en la revisión.", "success");
    } catch (error) {
      showAlert(
        error instanceof Error ? error.message : String(error),
        "danger",
      );
    } finally {
      setBusy(false);
    }
  }

  async function decideReview(
    action: "request-changes" | "approve" | "reject",
  ): Promise<void> {
    if (!review) {
      showAlert("No se encontró la revisión activa.", "danger");
      return;
    }

    const labels = {
      "request-changes": "solicitar correcciones",
      approve: "aprobar y bloquear esta versión",
      reject: "rechazar definitivamente esta versión",
    } as const;

    if (!window.confirm(`¿Deseas ${labels[action]}?`)) return;

    setBusy(true);
    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(project.id)}/reviews/${encodeURIComponent(review.id)}/${action}`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            expectedReviewRevision: review.revision,
            expectedDocumentRevision: version.revision,
            comment: reviewComment.trim() || null,
          }),
        },
      );
      if (!response.ok) {
        const message = await responseError(response);
        if (response.status === 409) setConflict(true);
        throw new Error(message);
      }
      const updated = (await response.json()) as WorkflowReviewDetail;
      setReview(updated);
      setReviewComment("");
      await reloadDocument(
        action === "approve"
          ? "La versión fue aprobada y quedó bloqueada."
          : action === "request-changes"
            ? "Las correcciones quedaron solicitadas."
            : "La versión fue rechazada.",
      );
    } catch (error) {
      showAlert(
        error instanceof Error ? error.message : String(error),
        "danger",
      );
    } finally {
      setBusy(false);
    }
  }

  async function openHistory(): Promise<void> {
    setBusy(true);
    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/documents/${encodeURIComponent(documentState.id)}/history`,
        { credentials: "include", cache: "no-store" },
      );
      if (!response.ok) throw new Error(await responseError(response));
      setHistory((await response.json()) as readonly DocumentHistoryEntry[]);
      setHistoryOpen(true);
    } catch (error) {
      showAlert(
        error instanceof Error ? error.message : String(error),
        "danger",
      );
    } finally {
      setBusy(false);
    }
  }

  async function loadComparison(): Promise<void> {
    setBusy(true);
    try {
      const get = async (value: number) => {
        const response = await fetch(
          `${GATEWAY_URL}/api/v1/documents/${encodeURIComponent(documentState.id)}/versions/${value}`,
          { credentials: "include", cache: "no-store" },
        );
        if (!response.ok) throw new Error(await responseError(response));
        return (await response.json()) as DocumentVersionDetail;
      };
      const [left, right] = await Promise.all([
        get(compareLeft),
        get(compareRight),
      ]);
      setLeftVersion(left);
      setRightVersion(right);
      setCompareOpen(true);
    } catch (error) {
      showAlert(
        error instanceof Error ? error.message : String(error),
        "danger",
      );
    } finally {
      setBusy(false);
    }
  }

  async function loadAiRequests(
    includeDetails: boolean,
  ): Promise<readonly AiAnalysisRequestDetail[]> {
    const response = await fetch(
      `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(project.id)}/analysis-requests?page=1&pageSize=100`,
      { credentials: "include", cache: "no-store" },
    );
    if (!response.ok) throw new Error(await responseError(response));
    const list = (await response.json()) as AiAnalysisRequestListResponse;
    const summaries = list.items.filter(
      (item) =>
        item.documentId.toLowerCase() === documentState.id.toLowerCase(),
    );
    if (!includeDetails) {
      return summaries.map((item) => ({
        ...item,
        sources: [],
        executions: [],
        result: null,
      }));
    }
    return Promise.all(
      summaries.map(async (item) => {
        const detailResponse = await fetch(
          `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(project.id)}/analysis-requests/${encodeURIComponent(item.id)}`,
          { credentials: "include", cache: "no-store" },
        );
        if (!detailResponse.ok)
          throw new Error(await responseError(detailResponse));
        return (await detailResponse.json()) as AiAnalysisRequestDetail;
      }),
    );
  }

  async function openAiHistory(): Promise<void> {
    setBusy(true);
    try {
      const items = await loadAiRequests(true);
      setAiHistory(items);
      synchronizeAiVersionDetails(items);
      setAiHistoryOpen(true);
    } catch (error) {
      showAlert(
        error instanceof Error ? error.message : String(error),
        "danger",
      );
    } finally {
      setBusy(false);
    }
  }

  async function openAiVersionDialog(): Promise<void> {
    if (unsaved) {
      showAlert(
        "Guarda o descarta los cambios antes de generar una versión con IA.",
        "warning",
      );
      return;
    }
    if (!currentVersion) {
      showAlert(
        "Abre la versión actual antes de generar una nueva versión con IA.",
        "warning",
      );
      return;
    }
    setBusy(true);
    try {
      const activeGeneration = (await loadAiRequests(false)).find(
        (item) => item.status === "PENDING" || item.status === "PROCESSING",
      );
      if (activeGeneration) {
        throw new Error(
          "Ya existe una generación de IA en curso para este documento.",
        );
      }
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(project.id)}/sources?page=1&pageSize=100&status=ACTIVE&processingStatus=READY`,
        { credentials: "include", cache: "no-store" },
      );
      if (!response.ok) throw new Error(await responseError(response));
      const list = (await response.json()) as SourceListResponse;
      setAiSources(list.items);
      setSelectedAiSourceIds(new Set());
      setAiInstruction("");
      setAiVersionOpen(true);
    } catch (error) {
      showAlert(
        error instanceof Error ? error.message : String(error),
        "danger",
      );
    } finally {
      setBusy(false);
    }
  }

  function toggleAiSource(sourceId: string): void {
    setSelectedAiSourceIds((current) => {
      const next = new Set(current);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  }

  async function createAiVersion(): Promise<void> {
    if (selectedAiSourceIds.size === 0) {
      showAlert("Selecciona al menos una fuente READY.", "warning");
      return;
    }
    const operationKey = crypto.randomUUID();
    setBusy(true);
    try {
      const versionResponse = await fetch(
        `${GATEWAY_URL}/api/v1/documents/${encodeURIComponent(documentState.id)}/versions`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expectedRevision: documentState.revision,
            changeSummary:
              "Nueva versión generada con IA a partir de fuentes seleccionadas",
            idempotencyKey: operationKey,
          }),
        },
      );
      if (!versionResponse.ok)
        throw new Error(await responseError(versionResponse));
      const next = (await versionResponse.json()) as RequirementDocumentDetail;
      setDocumentState(next);
      setVersion(next.currentVersionDetail);
      const first = next.currentVersionDetail.sections[0];
      if (first) {
        setActiveKey(first.key);
        setDraftContent(first.content);
      }

      const analysisResponse = await fetch(
        `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(project.id)}/analysis-requests`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            analysisType: "REQUIREMENT_DOCUMENT",
            documentId: next.id,
            documentVersionId: next.currentVersionDetail.id,
            sourceIds: [...selectedAiSourceIds],
            purpose: "AI_VERSION",
            instruction: aiInstruction.trim() || null,
            idempotencyKey: operationKey,
          }),
        },
      );
      if (!analysisResponse.ok)
        throw new Error(await responseError(analysisResponse));
      let analysis = (await analysisResponse.json()) as AiAnalysisRequestDetail;
      const deadline = Date.now() + 180_000;
      while (
        analysis.status !== "COMPLETED" &&
        analysis.status !== "FAILED" &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        const detailResponse = await fetch(
          `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(project.id)}/analysis-requests/${encodeURIComponent(analysis.id)}`,
          { credentials: "include", cache: "no-store" },
        );
        if (!detailResponse.ok)
          throw new Error(await responseError(detailResponse));
        analysis = (await detailResponse.json()) as AiAnalysisRequestDetail;
      }
      if (analysis.status === "FAILED") {
        throw new Error(
          analysis.errorMessage ||
            "La IA falló. La nueva versión DRAFT se conservó sin sobrescribir la anterior.",
        );
      }
      if (analysis.status !== "COMPLETED") {
        throw new Error(
          "La generación continúa en segundo plano. Revisa Historial IA.",
        );
      }
      setAiGeneratedVersionIds((current) => {
        const updated = new Set(current);
        updated.add(next.currentVersionDetail.id.toLowerCase());
        return updated;
      });
      setAiVersionOpen(false);
      await reloadDocument(
        `La versión ${next.currentVersion} fue generada con IA y requiere revisión humana.`,
      );
    } catch (error) {
      showAlert(
        error instanceof Error ? error.message : String(error),
        "danger",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rq-document-editor">
      <header className="rq-document-editor__header">
        <div>
          <span>Editor documental versionado</span>
          <h1>{documentState.title}</h1>
          <p>
            {project.code} · {project.title}
          </p>
        </div>
        <div className="rq-document-editor__header-actions">
          <a
            href={`/workspace/documents?projectId=${encodeURIComponent(project.id)}`}
            onClick={(event) => {
              if (
                unsaved &&
                !window.confirm(
                  "Hay cambios sin guardar. ¿Deseas salir del editor?",
                )
              )
                event.preventDefault();
            }}
          >
            Volver
          </a>
          <RqActionButton
            disabled={busy}
            onClick={() => void openHistory()}
            tone="consult"
          >
            Historial
          </RqActionButton>
          <RqActionButton
            disabled={busy || documentState.currentVersionNumber < 2}
            onClick={() => void loadComparison()}
            tone="operation"
          >
            Comparar versiones
          </RqActionButton>
          <RqActionButton
            disabled={busy}
            onClick={() => void openAiHistory()}
            tone="consult"
          >
            Historial IA
          </RqActionButton>
          <RqActionButton
            disabled={busy || documentState.status === "ARCHIVED"}
            onClick={openVersionDialog}
            tone="affirmative"
          >
            Nueva versión
          </RqActionButton>
          <RqActionButton
            disabled={
              busy ||
              unsaved ||
              !currentVersion ||
              documentState.status === "ARCHIVED"
            }
            onClick={() => void openAiVersionDialog()}
            tone="operation"
          >
            Nueva versión con IA
          </RqActionButton>
        </div>
      </header>

      <section
        className="rq-document-editor__metadata"
        aria-label="Datos del documento"
      >
        <article>
          <span>Proyecto</span>
          <strong>{project.code}</strong>
          <small>{project.requestingArea}</small>
        </article>
        <article>
          <span>Plantilla</span>
          <strong>{documentState.template.name}</strong>
          <small>v{documentState.template.version}</small>
        </article>
        <article>
          <span>Versión consultada</span>
          <select
            aria-label="Versión consultada"
            disabled={busy || unsaved}
            onChange={(event) => void loadVersion(Number(event.target.value))}
            value={version.versionNumber}
          >
            {Array.from(
              { length: documentState.currentVersionNumber },
              (_, index) => index + 1,
            ).map((item) => (
              <option key={item} value={item}>
                Versión {item}
                {item === documentState.currentVersionNumber ? " · actual" : ""}
              </option>
            ))}
          </select>
          <small>SemVer {version.version}</small>
        </article>
        <article>
          <span>Estado</span>
          <RqStatusBadge tone={statusTone(version.status)}>
            {statusLabel(version.status)}
          </RqStatusBadge>
          <small>
            {version.status === "APPROVED"
              ? "Versión inmutable"
              : "Control de cambios activo"}
          </small>
        </article>
        <article>
          <span>Última modificación</span>
          <strong>{formatDate(version.updatedAt)}</strong>
          <small>Revisión {version.revision}</small>
        </article>
        <article className="rq-document-progress-card">
          <span>Completitud estructural</span>
          <strong>{progress}%</strong>
          <progress
            aria-label={`Completitud estructural ${progress}%`}
            max={100}
            value={progress}
          />
          <small>{documentaryPending} pendientes por resolver</small>
        </article>
      </section>

      {alert ? (
        <div className="rq-document-alert" data-tone={alertTone} role="alert">
          <span>{alert}</span>
          {conflict ? (
            <button
              disabled={busy}
              onClick={() =>
                void reloadDocument("Se cargó la revisión más reciente.")
              }
              type="button"
            >
              Recargar versión
            </button>
          ) : null}
          <button
            aria-label="Cerrar mensaje"
            onClick={() => setAlert(null)}
            type="button"
          >
            ×
          </button>
        </div>
      ) : null}

      {aiGeneratedVersionIds.has(version.id.toLowerCase()) ? (
        <div
          className="rq-document-ai-disclosure"
          data-provider={currentAiGeneration?.provider ?? "UNKNOWN"}
          role="status"
        >
          <strong>
            {currentAiGeneration?.provider === "FAKE"
              ? "Generado en modo de prueba · contenido simulado"
              : "Generado con IA · requiere revisión humana"}
          </strong>
          <span>
            {currentAiGeneration?.provider === "FAKE"
              ? "Este borrador valida el pipeline y no representa un análisis semántico real."
              : "Revisa la evidencia, las contradicciones y los pendientes antes de enviarlo a validación."}
          </span>
        </div>
      ) : null}

      {!currentVersion ? (
        <div className="rq-document-version-banner" role="status">
          Estás consultando una versión histórica. La edición está bloqueada.
          {version.status === "APPROVED"
            ? " Esta versión fue aprobada y es inmutable."
            : ""}
        </div>
      ) : version.status === "APPROVED" ? (
        <div
          className="rq-document-version-banner"
          data-approved="true"
          role="status"
        >
          Esta versión está aprobada y bloqueada. Usa “Nueva versión” para
          realizar cambios posteriores.
        </div>
      ) : null}

      <div className="rq-document-editor__layout">
        <nav
          aria-label="Secciones del documento"
          className="rq-document-sections"
        >
          <header>
            <strong>13 secciones</strong>
            <span>{overallStats.pending} pendientes</span>
          </header>
          <ol>
            {version.sections.map((section) => {
              const stats = analyzeContent(section.content);
              return (
                <li key={section.key}>
                  <button
                    aria-current={
                      activeKey === section.key ? "step" : undefined
                    }
                    onClick={() => chooseSection(section)}
                    type="button"
                  >
                    <span>{section.order}</span>
                    <span>
                      <strong>{section.title}</strong>
                      <small>
                        {stats.pending > 0
                          ? `${stats.pending} pendientes`
                          : stats.errors.length > 0
                            ? `${stats.errors.length} errores`
                            : "Completa"}
                      </small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <main className="rq-document-section-editor">
          {activeSection ? (
            <>
              <header>
                <div>
                  <span>Sección {activeSection.order} de 13</span>
                  <h2>{activeSection.title}</h2>
                  <p>
                    {activeSection.templateControlled
                      ? "Contenido institucional controlado por la plantilla."
                      : "Edita los campos obligatorios y guarda esta sección."}
                  </p>
                </div>
                <div className="rq-document-section-editor__status">
                  {unsaved ? (
                    <span data-unsaved="true">Cambios sin guardar</span>
                  ) : (
                    <span>Sin cambios pendientes</span>
                  )}
                  {activeStats.pending > 0 ? (
                    <small>{activeStats.pending} datos pendientes</small>
                  ) : null}
                </div>
              </header>

              {activeStats.errors.length > 0 ? (
                <section
                  className="rq-document-validation"
                  aria-labelledby="document-validation-title"
                >
                  <strong id="document-validation-title">
                    Campos obligatorios por corregir
                  </strong>
                  <ul>
                    {activeStats.errors.slice(0, 12).map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveSection();
                }}
              >
                <JsonValueEditor
                  label={activeSection.title}
                  onChange={setDraftContent}
                  path={activeSection.key}
                  readOnly={readOnly || busy}
                  value={draftContent}
                />
                <footer>
                  <span>
                    {readOnly
                      ? "Edición bloqueada para esta versión o sección."
                      : "Los marcadores pendientes se conservan hasta que exista información real."}
                  </span>
                  <RqActionButton
                    disabled={
                      readOnly ||
                      busy ||
                      !unsaved ||
                      activeStats.errors.length > 0
                    }
                    tone="affirmative"
                    type="submit"
                  >
                    {busy ? "Guardando…" : "Guardar sección"}
                  </RqActionButton>
                </footer>
              </form>

              {version.fields.some(
                (field) => field.sectionKey === activeSection.key,
              ) ||
              version.requirements.some(
                (item) => item.sectionKey === activeSection.key,
              ) ||
              version.evidence.some(
                (item) => item.sectionKey === activeSection.key,
              ) ? (
                <section className="rq-document-structured-summary">
                  <h3>Trazabilidad estructurada de la sección</h3>
                  <p>
                    {
                      version.fields.filter(
                        (item) => item.sectionKey === activeSection.key,
                      ).length
                    }{" "}
                    campos ·{" "}
                    {
                      version.requirements.filter(
                        (item) => item.sectionKey === activeSection.key,
                      ).length
                    }{" "}
                    requisitos ·{" "}
                    {
                      version.evidence.filter(
                        (item) => item.sectionKey === activeSection.key,
                      ).length
                    }{" "}
                    evidencias
                  </p>
                </section>
              ) : null}
            </>
          ) : null}

          <aside
            className="rq-document-ai-future"
            aria-labelledby="ai-document-title"
          >
            <span aria-hidden="true">IA</span>
            <div>
              <h3 id="ai-document-title">Asistencia con revisión humana</h3>
              <p>
                La IA solo genera el borrador inicial o una nueva versión
                solicitada explícitamente. Editar, guardar, comparar y validar
                nunca ejecutan IA.
              </p>
            </div>
          </aside>
        </main>
      </div>

      {currentVersion ? (
        <section
          className="rq-document-workflow"
          aria-label="Revisión y aprobación"
        >
          <header>
            <div>
              <strong>Revisión y aprobación</strong>
              <span>
                Comentarios, correcciones y decisiones conservan actor, fecha y
                correlación.
              </span>
            </div>
            {review ? (
              <RqStatusBadge
                tone={
                  review.status === "APPROVED"
                    ? "success"
                    : review.status === "IN_REVIEW"
                      ? "process"
                      : "danger"
                }
              >
                {review.status.replaceAll("_", " ")}
              </RqStatusBadge>
            ) : null}
          </header>

          {version.status === "DRAFT" || version.status === "IN_REVIEW" ? (
            <label className="rq-document-review-comment">
              <span>
                {version.status === "DRAFT"
                  ? "Comentario inicial (opcional)"
                  : "Comentario u observación"}
              </span>
              <textarea
                disabled={busy}
                maxLength={4000}
                onChange={(event) => setReviewComment(event.target.value)}
                rows={3}
                value={reviewComment}
              />
            </label>
          ) : null}

          <div className="rq-document-workflow-actions">
            <div>
              <strong>Estado de la versión actual</strong>
              <span>
                Solo los roles asignados pueden ejecutar cada decisión.
              </span>
            </div>
            {version.status === "DRAFT" ? (
              <RqActionButton
                disabled={busy || unsaved}
                onClick={() => void requestReview()}
                tone="operation"
              >
                Enviar a validación
              </RqActionButton>
            ) : null}
            {version.status === "IN_REVIEW" && review ? (
              <>
                <RqActionButton
                  disabled={busy || !reviewComment.trim()}
                  onClick={() => void addReviewComment()}
                  tone="consult"
                >
                  Agregar comentario
                </RqActionButton>
                <RqActionButton
                  disabled={busy}
                  onClick={() => void decideReview("request-changes")}
                  tone="operation"
                >
                  Solicitar correcciones
                </RqActionButton>
                <RqActionButton
                  disabled={busy}
                  onClick={() => void decideReview("reject")}
                  tone="danger"
                >
                  Rechazar
                </RqActionButton>
                <RqActionButton
                  disabled={busy}
                  onClick={() => void decideReview("approve")}
                  tone="affirmative"
                >
                  Aprobar y bloquear
                </RqActionButton>
              </>
            ) : null}
          </div>

          {version.status === "IN_REVIEW" && !review ? (
            <p className="rq-document-review-warning">
              La versión está en validación, pero todavía no se encontró su
              expediente de Workflow.
            </p>
          ) : null}

          {review && review.activities.length > 0 ? (
            <ol className="rq-document-review-activity">
              {review.activities.map((activity) => (
                <li key={activity.id}>
                  <span aria-hidden="true" />
                  <div>
                    <strong>{workflowActivityLabel(activity.type)}</strong>
                    <small>
                      {formatDate(activity.createdAt)} · Actor{" "}
                      {activity.actorUserId}
                    </small>
                    {activity.comment ? <p>{activity.comment}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      ) : null}

      {versionOpen ? (
        <div className="rq-project-modal-backdrop" role="presentation">
          <section
            aria-labelledby="new-version-title"
            aria-modal="true"
            className="rq-project-modal rq-document-version-modal"
            ref={versionDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <header className="rq-project-modal__header">
              <div>
                <span>Control de versiones</span>
                <h2 id="new-version-title">Nueva versión</h2>
              </div>
              <button
                aria-label="Cerrar nueva versión"
                disabled={busy}
                onClick={() => setVersionOpen(false)}
                type="button"
              >
                ×
              </button>
            </header>
            <form
              className="rq-project-form"
              onSubmit={(event) => {
                event.preventDefault();
                void createVersion();
              }}
            >
              <label className="rq-field">
                <span>Motivo de la nueva versión</span>
                <textarea
                  disabled={busy}
                  minLength={3}
                  onChange={(event) => setVersionSummary(event.target.value)}
                  required
                  rows={4}
                  value={versionSummary}
                />
              </label>
              <p className="rq-document-version-modal__confirmation">
                Se clonará la versión actual como un nuevo borrador. La versión
                anterior conservará su contenido e historial.
              </p>
              <div className="rq-project-modal__actions">
                <RqActionButton
                  disabled={busy}
                  onClick={() => setVersionOpen(false)}
                >
                  Cancelar
                </RqActionButton>
                <RqActionButton
                  disabled={busy || versionSummary.trim().length < 3}
                  tone="affirmative"
                  type="submit"
                >
                  {busy ? "Creando…" : "Confirmar nueva versión"}
                </RqActionButton>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {historyOpen ? (
        <div className="rq-project-modal-backdrop" role="presentation">
          <section
            aria-labelledby="history-title"
            aria-modal="true"
            className="rq-project-modal rq-document-history-modal"
            ref={historyDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <header className="rq-project-modal__header">
              <div>
                <span>Auditoría documental</span>
                <h2 id="history-title">Historial</h2>
              </div>
              <button
                aria-label="Cerrar historial"
                onClick={() => setHistoryOpen(false)}
                type="button"
              >
                ×
              </button>
            </header>
            <ol className="rq-document-history-list">
              {history.map((entry) => (
                <li key={entry.id}>
                  <span aria-hidden="true" />
                  <div>
                    <strong>{entry.eventType.replaceAll("_", " ")}</strong>
                    <small>{formatDate(entry.createdAt)}</small>
                    <pre>{JSON.stringify(entry.details, null, 2)}</pre>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      ) : null}

      {aiVersionOpen ? (
        <div className="rq-project-modal-backdrop" role="presentation">
          <section
            aria-labelledby="ai-version-title"
            aria-modal="true"
            className="rq-project-modal rq-document-ai-version-modal"
            ref={aiVersionDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <header className="rq-project-modal__header">
              <div>
                <span>Generación explícita</span>
                <h2 id="ai-version-title">Nueva versión con IA</h2>
              </div>
              <button
                aria-label="Cerrar nueva versión con IA"
                disabled={busy}
                onClick={() => setAiVersionOpen(false)}
                type="button"
              >
                ×
              </button>
            </header>
            <div className="rq-document-ai-version-content">
              <p>
                Se clonará la versión actual y una única ejecución de IA
                completará el nuevo DRAFT. La versión anterior no se modifica.
              </p>
              <fieldset>
                <legend>Fuentes READY</legend>
                {aiSources.length === 0 ? (
                  <p>No hay fuentes listas para usar.</p>
                ) : (
                  <div className="rq-document-ai-source-list">
                    {aiSources.map((source) => (
                      <label key={source.id}>
                        <input
                          checked={selectedAiSourceIds.has(source.id)}
                          disabled={busy}
                          onChange={() => toggleAiSource(source.id)}
                          type="checkbox"
                        />
                        <span>
                          <strong>{source.title}</strong>
                          <small>
                            {source.sourceType} ·{" "}
                            {source.classification ?? "Sin clasificación"}
                          </small>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
              <label className="rq-field">
                <span>Instrucción adicional opcional</span>
                <textarea
                  disabled={busy}
                  maxLength={2000}
                  onChange={(event) => setAiInstruction(event.target.value)}
                  placeholder="Ejemplo: prioriza los vacíos y contradicciones identificados."
                  rows={4}
                  value={aiInstruction}
                />
                <small>{aiInstruction.length}/2000</small>
              </label>
            </div>
            <div className="rq-project-modal__actions">
              <RqActionButton
                disabled={busy}
                onClick={() => setAiVersionOpen(false)}
              >
                Cancelar
              </RqActionButton>
              <RqActionButton
                disabled={busy || selectedAiSourceIds.size === 0}
                onClick={() => void createAiVersion()}
                tone="affirmative"
              >
                {busy ? "Generando…" : "Crear versión con IA"}
              </RqActionButton>
            </div>
          </section>
        </div>
      ) : null}

      {aiHistoryOpen ? (
        <div className="rq-project-modal-backdrop" role="presentation">
          <section
            aria-labelledby="ai-history-title"
            aria-modal="true"
            className="rq-project-modal rq-document-ai-history-modal"
            ref={aiHistoryDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <header className="rq-project-modal__header">
              <div>
                <span>Trazabilidad técnica</span>
                <h2 id="ai-history-title">Historial IA</h2>
              </div>
              <button
                aria-label="Cerrar historial IA"
                onClick={() => setAiHistoryOpen(false)}
                type="button"
              >
                ×
              </button>
            </header>
            {aiHistory.length === 0 ? (
              <p className="rq-document-ai-history-empty">
                Este documento todavía no tiene generaciones con IA.
              </p>
            ) : (
              <ol className="rq-document-ai-history-list">
                {aiHistory.map((item) => {
                  const execution = item.executions.at(-1);
                  return (
                    <li key={item.id}>
                      <header>
                        <div>
                          <strong>
                            {item.purpose === "INITIAL_DRAFT"
                              ? "Borrador inicial"
                              : "Nueva versión con IA"}
                          </strong>
                          <span>
                            Versión {item.generatedVersion} · {item.status}
                          </span>
                        </div>
                        <div className="rq-document-ai-history-statuses">
                          {execution?.provider === "FAKE" ? (
                            <RqStatusBadge tone="pending">
                              SIMULACIÓN / PRUEBA
                            </RqStatusBadge>
                          ) : null}
                          <RqStatusBadge
                            tone={
                              item.status === "COMPLETED"
                                ? "success"
                                : item.status === "FAILED"
                                  ? "danger"
                                  : "process"
                            }
                          >
                            {item.status}
                          </RqStatusBadge>
                        </div>
                      </header>
                      <dl>
                        <div>
                          <dt>Solicitud</dt>
                          <dd>{item.id}</dd>
                        </div>
                        <div>
                          <dt>Ejecución</dt>
                          <dd>{execution?.id ?? "Pendiente"}</dd>
                        </div>
                        <div>
                          <dt>Proveedor</dt>
                          <dd>{execution?.provider ?? "—"}</dd>
                        </div>
                        <div>
                          <dt>Modelo</dt>
                          <dd>{execution?.model ?? "—"}</dd>
                        </div>
                        <div>
                          <dt>Fuentes</dt>
                          <dd>
                            {item.sources
                              .map(
                                (source) =>
                                  source.sourceTitle ?? source.sourceId,
                              )
                              .join(", ")}
                          </dd>
                        </div>
                        <div>
                          <dt>Tokens entrada / salida</dt>
                          <dd>
                            {execution?.inputTokens ?? "—"} /{" "}
                            {execution?.outputTokens ?? "—"}
                          </dd>
                        </div>
                        <div>
                          <dt>Duración</dt>
                          <dd>{execution?.durationMs ?? "—"} ms</dd>
                        </div>
                        <div>
                          <dt>Intento / ejecuciones</dt>
                          <dd>
                            {execution?.attempt ?? "—"} / {item.executionCount}
                          </dd>
                        </div>
                        <div>
                          <dt>Fecha</dt>
                          <dd>{formatDate(item.createdAt)}</dd>
                        </div>
                      </dl>
                      {item.errorMessage || execution?.errorMessage ? (
                        <p role="alert">
                          {item.errorMessage ?? execution?.errorMessage}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>
      ) : null}

      {compareOpen && leftVersion && rightVersion ? (
        <div className="rq-project-modal-backdrop" role="presentation">
          <section
            aria-labelledby="compare-title"
            aria-modal="true"
            className="rq-project-modal rq-document-compare-modal"
            ref={compareDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <header className="rq-project-modal__header">
              <div>
                <span>Control de cambios</span>
                <h2 id="compare-title">Comparar versiones</h2>
              </div>
              <button
                aria-label="Cerrar comparación"
                onClick={() => setCompareOpen(false)}
                type="button"
              >
                ×
              </button>
            </header>
            <div className="rq-document-compare-selectors">
              <label>
                <span>Versión izquierda</span>
                <select
                  onChange={(event) =>
                    setCompareLeft(Number(event.target.value))
                  }
                  value={compareLeft}
                >
                  {Array.from(
                    { length: documentState.currentVersionNumber },
                    (_, index) => index + 1,
                  ).map((item) => (
                    <option key={item} value={item}>
                      Versión {item}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Versión derecha</span>
                <select
                  onChange={(event) =>
                    setCompareRight(Number(event.target.value))
                  }
                  value={compareRight}
                >
                  {Array.from(
                    { length: documentState.currentVersionNumber },
                    (_, index) => index + 1,
                  ).map((item) => (
                    <option key={item} value={item}>
                      Versión {item}
                    </option>
                  ))}
                </select>
              </label>
              <RqActionButton
                disabled={busy}
                onClick={() => void loadComparison()}
                tone="consult"
              >
                Actualizar comparación
              </RqActionButton>
            </div>
            <div className="rq-document-compare-summary">
              <span>
                v{leftVersion.version} · {statusLabel(leftVersion.status)}
              </span>
              <span>
                v{rightVersion.version} · {statusLabel(rightVersion.status)}
              </span>
            </div>
            <div className="rq-document-compare-list">
              {leftVersion.sections.map((leftSection) => {
                const rightSection = rightVersion.sections.find(
                  (item) => item.key === leftSection.key,
                );
                const changed =
                  JSON.stringify(leftSection.content) !==
                  JSON.stringify(rightSection?.content);
                return (
                  <article data-changed={changed} key={leftSection.key}>
                    <header>
                      <strong>
                        {leftSection.order}. {leftSection.title}
                      </strong>
                      <span>{changed ? "Con cambios" : "Sin cambios"}</span>
                    </header>
                    <div>
                      <pre>{JSON.stringify(leftSection.content, null, 2)}</pre>
                      <pre>
                        {JSON.stringify(rightSection?.content ?? null, null, 2)}
                      </pre>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
