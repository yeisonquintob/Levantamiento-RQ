"use client";

import React, {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  AiAnalysisDraft,
  AiAnalysisLocalOnlyV2Draft,
  AiAnalysisRequestDetail,
  AiAnalysisRequestListResponse,
  AiProviderCode,
  DocumentHistoryEntry,
  DocumentJsonValue,
  DocumentSection,
  DocumentSectionKey,
  DocumentStatus,
  DocumentVersionDetail,
  ExportRequestDetail,
  ProjectDetail,
  ProjectStatus,
  RequirementDocumentDetail,
  SourceBatchProcessingResponse,
  SourceDetail,
  SourceUploadBatchResponse,
  WorkflowReviewDetail,
  WorkflowReviewListResponse,
} from "@levantamiento-rq/shared-contracts";
import {
  RqActionButton,
  RqKpiCard,
  RqKpiGrid,
  RqStatusBadge,
} from "@levantamiento-rq/shared-ui";

import { WorkspaceKpiIcon } from "../../workspace-kpi-icon";

import { createBrowserUuid } from "../../../browser-uuid";
import { useDialogAccessibility } from "../../../use-dialog-accessibility";
import {
  buildColombianBusinessSprintSchedule,
  colombianBusinessDateAt,
  formatColombianCalendarDate,
} from "./colombian-business-calendar";
import {
  DocumentHumanValue,
  DocumentSectionBusinessEditor,
  DocumentSectionView,
  IntegratedPoint6Point7Panel,
  composeRequirementsContent,
  presentSectionContent,
} from "./document-section-presenter";
import { useAutoDismiss } from "../../../use-auto-dismiss";
import { AiEngineChips, useAiEngineSelection } from "../../ai-engine-selection";
import { useConfirm } from "../../../confirm-dialog";
import { jsonEqual } from "./json-equal";

const GATEWAY_URL =
  process.env.NODE_ENV === "development" && typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : (process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000");
const PENDING = "[PENDIENTE POR DEFINIR]";
const AI_EVIDENCE_FILE_ACCEPT =
  ".pdf,.docx,.xlsx,.txt,.vtt,.csv,.png,.jpg,.jpeg,.webp";

function visibleSectionTitle(
  section: Pick<DocumentSection, "key" | "title">,
): string {
  if (section.key === "writingRules") return "Plantilla aplicada";
  if (section.key === "visualFormat") return "Prototipo";
  if (section.key === "automationInstruction") return "KPIs";
  if (section.key === "scrumPlan") return "Plan de trabajo";
  return section.title;
}

const RETURNED_WORD_INSTRUCTION =
  "El archivo Word adjunto es una revisión humana del borrador exportado de esta misma versión. Compáralo con el consolidado actual y aplica únicamente las adiciones, correcciones y eliminaciones realizadas por la persona revisora. Conserva sin cambios todo contenido que no haya sido modificado. No trates rótulos, encabezados, pies de página, instrucciones del documento ni campos vacíos como evidencia nueva. Si una modificación es ambigua, consérvala como pendiente explícito en lugar de inventar información.";

type AiVersionMode = "general" | "returned-word";
const DIAGRAM_EXPORT_STYLE_PROPERTIES = [
  "color",
  "dominant-baseline",
  "fill",
  "fill-opacity",
  "filter",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "letter-spacing",
  "opacity",
  "paint-order",
  "stroke",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-opacity",
  "stroke-width",
  "text-anchor",
  "vector-effect",
] as const;

function functionalStoryTargetFromValidation(error: string): string | null {
  if (!/functional\s+requirements/iu.test(error)) return null;
  const match = error.match(/Registro\s+(\d+)/iu);
  if (!match?.[1]) return null;
  const index = Number(match[1]) - 1;
  return Number.isInteger(index) && index >= 0
    ? `functional-story-${index}`
    : null;
}

function revealFunctionalStory(targetId: string): void {
  const target = document.getElementById(targetId);
  if (!(target instanceof HTMLDetailsElement)) return;
  const milestone = target.closest<HTMLDetailsElement>(
    ".rq-requirement-milestone",
  );
  if (milestone) milestone.open = true;
  target.open = true;
  window.requestAnimationFrame(() => {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target
      .querySelector<HTMLElement>("summary")
      ?.focus({ preventScroll: true });
  });
}

function diagramExportFileName(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/gu, "")
      .replace(/[^a-zA-Z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .toLowerCase() || "diagrama"
  );
}

function inlineDiagramStyles(
  source: SVGSVGElement,
  target: SVGSVGElement,
): void {
  const sourceElements: SVGElement[] = [
    source,
    ...source.querySelectorAll<SVGElement>("*"),
  ];
  const targetElements: SVGElement[] = [
    target,
    ...target.querySelectorAll<SVGElement>("*"),
  ];

  sourceElements.forEach((sourceElement, index) => {
    const targetElement = targetElements[index];
    if (!targetElement) return;
    const computed = window.getComputedStyle(sourceElement);
    for (const property of DIAGRAM_EXPORT_STYLE_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      if (value) targetElement.style.setProperty(property, value);
    }
  });
}

async function exportDiagramAsPng(
  source: SVGSVGElement,
  fileName: string,
): Promise<void> {
  const viewBox = source.viewBox.baseVal;
  const width = viewBox.width || source.getBoundingClientRect().width;
  const height = viewBox.height || source.getBoundingClientRect().height;
  if (width <= 0 || height <= 0) {
    throw new Error("El diagrama seleccionado no tiene dimensiones válidas.");
  }

  const clone = source.cloneNode(true) as SVGSVGElement;
  inlineDiagramStyles(source, clone);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;

  const viewport = source.closest<HTMLElement>(".rq-process-flow__viewport");
  const viewportBackground = viewport
    ? window.getComputedStyle(viewport).backgroundColor
    : "rgb(255, 255, 255)";
  const background =
    !viewportBackground || viewportBackground === "rgba(0, 0, 0, 0)"
      ? "rgb(255, 255, 255)"
      : viewportBackground;
  const svgBlob = new Blob([new XMLSerializer().serializeToString(clone)], {
    type: "image/svg+xml;charset=utf-8",
  });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error("No fue posible preparar la imagen."));
      image.src = svgUrl;
    });

    const maximumCanvasDimension = 8192;
    const scale = Math.min(
      2,
      maximumCanvasDimension / width,
      maximumCanvasDimension / height,
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("El navegador no permitió crear la imagen.");
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("No fue posible convertir el diagrama a PNG."));
      }, "image/png");
    });
    const pngUrl = URL.createObjectURL(pngBlob);
    try {
      const anchor = document.createElement("a");
      anchor.href = pngUrl;
      anchor.download = `${diagramExportFileName(fileName)}.png`;
      anchor.click();
    } finally {
      URL.revokeObjectURL(pngUrl);
    }
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

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
  features: "Funcionalidades",
  userStories: "Historias de usuario",
  inScope: "Incluye",
  outOfScope: "Fuera de alcance",
  sourceIds: "Evidencias",
  scenarios: "Escenarios de prueba",
  sprints: "Sprints",
  tasks: "Tareas",
  dependencyCodes: "Dependencias",
  deliverables: "Entregables",
  functionalRequirements: "Requerimientos funcionales",
  nonFunctionalRequirements: "Requerimientos no funcionales",
  epics: "Épicas",
  sourceNumber: "Número de origen",
  documentationObservation: "Observación de documentación",
  assignmentObservation: "Observación de asignación",
};

const TECHNICAL_CONTENT_KEYS = new Set([
  "sourceIds",
  "sourceIdsA",
  "sourceIdsB",
  "clientId",
  "structuredAnalysis",
  "id",
  "from",
  "to",
  "kind",
  "scheduleBasis",
  "startDay",
  "endDay",
  "startDate",
  "endDate",
  "period",
]);
const NULLABLE_CONTENT_KEYS = new Set([
  "label",
  "laneId",
  "confirmedStartDate",
  "startDate",
  "endDate",
]);
const FUNCTIONAL_REQUIREMENT_NULLABLE_KEYS = new Set([
  "category",
  "measure",
  "target",
]);

const NON_FUNCTIONAL_REQUIREMENT_NULLABLE_KEYS = new Set([
  "milestone",
  "functionality",
]);

const REQUIRED_COLLECTION_KEYS = new Set(["nodes", "acceptanceCriteria"]);

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

function isLocalOnlyV2Draft(
  draft: AiAnalysisDraft | AiAnalysisLocalOnlyV2Draft,
): draft is AiAnalysisLocalOnlyV2Draft {
  return "pipelineId" in draft && draft.pipelineId === "LOCAL_ONLY_V2";
}

function contradictionLabel(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "Contradicción estructurada pendiente de decisión.";
  }
  const record = value as Readonly<Record<string, unknown>>;
  return `A: ${String(record.statementA ?? "Sin información")} · B: ${String(record.statementB ?? "Sin información")} · Decisión: ${String(record.decision ?? PENDING)}`;
}

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function humanContentPath(path: readonly string[]): string {
  if (path.length === 0) return "Campo";
  return path
    .map((part, index) => {
      if (!/^\d+$/u.test(part)) return fieldLabel(part);
      const parent = path[index - 1] ?? "Registro";
      const singular =
        parent === "features"
          ? "Funcionalidad"
          : parent === "userStories"
            ? "Historia"
            : parent === "acceptanceCriteria"
              ? "Criterio"
              : parent === "scenarios"
                ? "Escenario"
                : parent === "sprints"
                  ? "Sprint"
                  : parent === "tasks"
                    ? "Tarea"
                    : "Registro";
      return `${singular} ${part}`;
    })
    .filter(
      (part, index, items) =>
        !/^\d+$/u.test(path[index] ?? "") || part !== items[index - 1],
    )
    .join(" · ");
}

function statusLabel(status: DocumentStatus): string {
  if (status === "IN_REVIEW") return "En validación";
  if (status === "CHANGES_REQUESTED") return "Correcciones solicitadas";
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
  if (status === "CHANGES_REQUESTED") return "pending";
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
        ? [`${humanContentPath(path)} requiere definición.`]
        : pending
          ? [`${humanContentPath(path)} está pendiente por definir.`]
          : [],
    };
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return { total: 1, completed: 1, pending: 0, errors: [] };
  }
  if (value === null) {
    const key = path.at(-1) ?? "";
    const optionalForFunctionalRequirement =
      path.includes("functionalRequirements") &&
      FUNCTIONAL_REQUIREMENT_NULLABLE_KEYS.has(key);

    const optionalForNonFunctionalRequirement =
      path.includes("nonFunctionalRequirements") &&
      NON_FUNCTIONAL_REQUIREMENT_NULLABLE_KEYS.has(key);

    if (
      NULLABLE_CONTENT_KEYS.has(key) ||
      TECHNICAL_CONTENT_KEYS.has(key) ||
      optionalForFunctionalRequirement ||
      optionalForNonFunctionalRequirement
    ) {
      return {
        total: 0,
        completed: 0,
        pending: 0,
        errors: [],
      };
    }
    return {
      total: 1,
      completed: 0,
      pending: 0,
      errors: [`${humanContentPath(path)} requiere definición.`],
    };
  }
  if (Array.isArray(value)) {
    const key = path.at(-1);
    const emptyAllowed = !key || !REQUIRED_COLLECTION_KEYS.has(key);
    if (value.length === 0) {
      return {
        total: 1,
        completed: emptyAllowed ? 1 : 0,
        pending: 0,
        errors: emptyAllowed
          ? []
          : [`${humanContentPath(path)} requiere al menos un elemento.`],
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
      if (TECHNICAL_CONTENT_KEYS.has(key)) return result;
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

function contentRecord(
  value: DocumentJsonValue | undefined,
): Readonly<Record<string, DocumentJsonValue>> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, DocumentJsonValue>>)
    : null;
}

function contentRecords(
  value: DocumentJsonValue | undefined,
): readonly Readonly<Record<string, DocumentJsonValue>>[] {
  return Array.isArray(value)
    ? value.map(contentRecord).filter((item) => item !== null)
    : [];
}

function codeValue(value: DocumentJsonValue | undefined): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function duplicateCodes(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values.filter(Boolean)) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

/** Advertencias informativas: no cambian por sí solas la política de aprobación. */
export function documentSemanticWarnings(
  version: DocumentVersionDetail,
): readonly string[] {
  const warnings: string[] = [];
  const process = contentRecord(
    version.sections.find((section) => section.key === "processFlow")?.content,
  );
  const nodes = contentRecords(process?.nodes);
  const edges = contentRecords(process?.edges);
  const nodeCodes = nodes.map((node) => codeValue(node.id));
  const nodeIds = new Set(nodeCodes);
  const nodeName = (nodeId: string): string => {
    const index = nodeCodes.indexOf(nodeId);
    const label = nodes[index]?.label;
    return typeof label === "string" && label.trim()
      ? label.trim()
      : `Paso ${index + 1}`;
  };
  if (nodes.length > 0 && !nodes.some((node) => node.kind === "START")) {
    warnings.push("Diagrama de flujo · falta un paso de inicio.");
  }
  if (nodes.length > 0 && !nodes.some((node) => node.kind === "END")) {
    warnings.push("Diagrama de flujo · falta un paso de fin.");
  }
  for (const duplicate of duplicateCodes(nodeCodes)) {
    warnings.push(
      `Diagrama de flujo · ${nodeName(duplicate)} está definido más de una vez.`,
    );
  }
  for (const [index, edge] of edges.entries()) {
    if (
      !nodeIds.has(codeValue(edge.from)) ||
      !nodeIds.has(codeValue(edge.to))
    ) {
      warnings.push(
        `Diagrama de flujo · la conexión ${index + 1} referencia un paso inexistente.`,
      );
    }
  }
  for (const [index, node] of nodes.entries()) {
    if (node.kind !== "DECISION") continue;
    const outgoing = edges.filter(
      (edge) => codeValue(edge.from) === nodeCodes[index],
    );
    if (
      outgoing.length > 1 &&
      outgoing.some(
        (edge) => typeof edge.label !== "string" || !edge.label.trim(),
      )
    ) {
      warnings.push(
        `Diagrama de flujo · la decisión “${nodeName(nodeCodes[index] ?? "")}” tiene ramas sin condición funcional.`,
      );
    }
  }
  const connectedNodeIds = new Set(
    edges.flatMap((edge) => [codeValue(edge.from), codeValue(edge.to)]),
  );
  nodes.forEach((node, index) => {
    const id = codeValue(node.id);
    if (nodes.length > 1 && id && !connectedNodeIds.has(id)) {
      warnings.push(
        `Diagrama de flujo · ${typeof node.label === "string" ? node.label : `Paso ${index + 1}`} está desconectado.`,
      );
    }
  });

  const milestones = contentRecord(
    version.sections.find((section) => section.key === "milestones")?.content,
  );
  const features = contentRecords(milestones?.features);
  const stories = contentRecords(milestones?.userStories);
  const featureCodes = features.map((feature) => codeValue(feature.code));
  const storyCodes = stories.map((story) => codeValue(story.code));
  for (const duplicate of duplicateCodes(featureCodes)) {
    warnings.push(
      `Requerimientos · Funcionalidad ${duplicate} está duplicada.`,
    );
  }
  for (const duplicate of duplicateCodes(storyCodes)) {
    warnings.push(`Requerimientos · HU ${duplicate} está duplicada.`);
  }
  const featureSet = new Set(featureCodes);
  const storySet = new Set(storyCodes);
  const criterionCodes = stories.flatMap((story) =>
    contentRecords(story.acceptanceCriteria).map((criterion) =>
      codeValue(criterion.code),
    ),
  );
  const criterionSet = new Set(criterionCodes);
  for (const duplicate of duplicateCodes(criterionCodes)) {
    warnings.push(`Requerimientos · criterio ${duplicate} está duplicado.`);
  }
  for (const story of stories) {
    const storyCode = codeValue(story.code) || "sin código";
    if (!featureSet.has(codeValue(story.featureCode))) {
      warnings.push(
        `Requerimientos · ${storyCode} referencia una funcionalidad inexistente.`,
      );
    }
    if (contentRecords(story.acceptanceCriteria).length === 0) {
      warnings.push(
        `Requerimientos · ${storyCode} no contiene criterios de aceptación.`,
      );
    }
  }
  for (const feature of features) {
    const featureCode = codeValue(feature.code) || "sin código";
    const referenced = Array.isArray(feature.userStoryCodes)
      ? feature.userStoryCodes.map(codeValue)
      : [];
    if (referenced.length === 0) {
      warnings.push(
        `Requerimientos · Funcionalidad ${featureCode} no agrupa historias de usuario.`,
      );
    }
    for (const storyCode of referenced) {
      if (!storySet.has(storyCode)) {
        warnings.push(
          `Requerimientos · Funcionalidad ${featureCode} referencia ${storyCode} inexistente.`,
        );
      }
    }
  }

  const tests = contentRecord(
    version.sections.find((section) => section.key === "tests")?.content,
  );
  for (const scenario of contentRecords(tests?.scenarios)) {
    const testCode = codeValue(scenario.code) || "sin código";
    const referencedStories = Array.isArray(scenario.userStoryCodes)
      ? scenario.userStoryCodes.map(codeValue)
      : [];
    const referencedCriteria = Array.isArray(scenario.acceptanceCriterionCodes)
      ? scenario.acceptanceCriterionCodes.map(codeValue)
      : [];
    if (referencedStories.length === 0) {
      warnings.push(`Pruebas · ${testCode} no referencia ninguna HU.`);
    }
    for (const storyCode of referencedStories) {
      if (!storySet.has(storyCode)) {
        warnings.push(
          `Pruebas · ${testCode} referencia ${storyCode} inexistente.`,
        );
      }
    }
    for (const criterionCode of referencedCriteria) {
      if (!criterionSet.has(criterionCode)) {
        warnings.push(
          `Pruebas · ${testCode} referencia ${criterionCode} inexistente.`,
        );
      }
    }
  }

  for (const requirement of version.requirements) {
    if (requirement.acceptanceCriteria.length === 0) {
      warnings.push(
        `Requerimientos estructurados · ${requirement.code} no contiene criterios.`,
      );
    }
  }
  for (const duplicate of duplicateCodes(
    version.requirements.map((item) => item.code.toUpperCase()),
  )) {
    warnings.push(
      `Requerimientos estructurados · ${duplicate} está duplicado.`,
    );
  }

  const scrum = contentRecord(
    version.sections.find((section) => section.key === "scrumPlan")?.content,
  );
  if (scrum && scrum.cadenceDays !== 15) {
    warnings.push(
      "Plan de trabajo · la cadencia debe ser de 15 días calendario.",
    );
  }
  return warnings;
}

function versionStats(version: DocumentVersionDetail): ContentStats {
  const content = version.sections.reduce<ContentStats>(
    (result, section) => {
      const next = analyzeContent(presentSectionContent(section.content), [
        section.title,
      ]);
      return {
        total: result.total + next.total,
        completed: result.completed + next.completed,
        pending: result.pending + next.pending,
        errors: [...result.errors, ...next.errors],
      };
    },
    { total: 0, completed: 0, pending: 0, errors: [] },
  );
  return {
    ...content,
    errors: [...content.errors, ...documentSemanticWarnings(version)],
  };
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

interface RequirementDocumentEditorProps {
  initialDocument: RequirementDocumentDetail;
  initialVersion?: DocumentVersionDetail;
  project: ProjectDetail;
  returnToAllProjects?: boolean;
}

export function RequirementDocumentEditor({
  initialDocument,
  initialVersion,
  project,
  returnToAllProjects = false,
}: RequirementDocumentEditorProps) {
  const confirm = useConfirm();
  const selectedInitialVersion =
    initialVersion ?? initialDocument.currentVersionDetail;
  const [documentState, setDocumentState] = useState(initialDocument);
  const [version, setVersion] = useState(selectedInitialVersion);
  const [activeKey, setActiveKey] = useState<DocumentSectionKey>(
    selectedInitialVersion.sections[0]?.key ?? "header",
  );
  const [draftContent, setDraftContent] = useState<DocumentJsonValue>(
    selectedInitialVersion.sections[0]?.content ?? {},
  );
  const [editingSection, setEditingSection] = useState(false);
  const [exportingDiagram, setExportingDiagram] = useState(false);
  const [wordExportBusy, setWordExportBusy] = useState(false);
  const [validationExpanded, setValidationExpanded] = useState(false);
  const [sectionMenuOpen, setSectionMenuOpen] = useState(false);
  const [versionMenuOpen, setVersionMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  useAutoDismiss(alert, () => setAlert(null));
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
  // La nube nunca se preselecciona: los motores salen de la elección explícita
  // de la persona. Solo se consulta cuando el diálogo está abierto.
  const aiEngines = useAiEngineSelection(
    aiVersionOpen ? project.id : "",
    "document-ai-version",
  );
  const aiEnginesMissing = aiEngines.engines.length === 0;
  const [aiVersionMode, setAiVersionMode] = useState<AiVersionMode>("general");
  const [aiHistoryOpen, setAiHistoryOpen] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiSectionInstructions, setAiSectionInstructions] = useState<
    Partial<Record<DocumentSectionKey, string>>
  >({});
  const [aiAdditionalInformation, setAiAdditionalInformation] = useState("");
  const [aiEvidenceFiles, setAiEvidenceFiles] = useState<readonly File[]>([]);
  const [aiGenerationStage, setAiGenerationStage] = useState("");
  const [aiHistory, setAiHistory] = useState<
    readonly AiAnalysisRequestDetail[]
  >([]);
  const [aiGeneratedVersionIds, setAiGeneratedVersionIds] = useState<
    Set<string>
  >(() => new Set());
  const [aiVersionGenerationDetails, setAiVersionGenerationDetails] = useState<
    Map<string, AiVersionGenerationDetails>
  >(() => new Map());
  const sectionEditorRef = useRef<HTMLElement>(null);
  const syncedProjectStatusRef = useRef<ProjectStatus>(project.status);

  useEffect(() => {
    // Consultar una versión histórica no modifica el estado actual del proyecto.
    if (
      version.versionNumber !== documentState.currentVersionNumber ||
      project.status === "ARCHIVED"
    )
      return;
    let targetStatus: ProjectStatus | null = null;

    if (version.status === "APPROVED") {
      targetStatus = "APPROVED";
    } else if (
      ["IN_REVIEW", "CHANGES_REQUESTED", "REJECTED"].includes(version.status)
    ) {
      targetStatus = "VALIDATION";
    } else {
      targetStatus = "DOCUMENT_GENERATED";
    }

    if (!targetStatus || targetStatus === syncedProjectStatusRef.current) {
      return;
    }

    syncedProjectStatusRef.current = targetStatus;
    void fetch(
      `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(project.id)}`,
      {
        method: "PATCH",
        credentials: "include",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({ status: targetStatus }),
      },
    )
      .then((response) => {
        if (!response.ok) syncedProjectStatusRef.current = project.status;
      })
      .catch(() => {
        syncedProjectStatusRef.current = project.status;
      });
  }, [
    documentState.currentVersionNumber,
    project.id,
    project.status,
    version.status,
    version.versionNumber,
  ]);
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
  const validationDialogRef = useDialogAccessibility<HTMLElement>(
    validationExpanded,
    () => setValidationExpanded(false),
  );

  const activeSection =
    version.sections.find((section) => section.key === activeKey) ??
    version.sections[0];
  // Comparación profunda con salida temprana: no serializa el contenido en cada pulsación.
  const unsaved = useMemo(
    () =>
      Boolean(activeSection) && !jsonEqual(draftContent, activeSection?.content),
    [activeSection, draftContent],
  );
  const currentVersion =
    version.versionNumber === documentState.currentVersionNumber;
  const readOnly =
    !currentVersion ||
    (version.status !== "DRAFT" && version.status !== "CHANGES_REQUESTED") ||
    documentState.status === "ARCHIVED";
  const activeScrumPlan =
    activeSection?.key === "scrumPlan"
      ? contentRecord(activeSection.content)
      : null;
  const scrumStartDate =
    typeof activeScrumPlan?.confirmedStartDate === "string"
      ? activeScrumPlan.confirmedStartDate
      : "";
  const legacyNonFunctionalSection = version.sections.find(
    (section) => section.key === "nonFunctionalRequirements",
  );
  const legacyRequirementTabs: DocumentJsonValue | null =
    activeSection?.key === "milestones" && legacyNonFunctionalSection
      ? ({
          functionalRequirements:
            version.requirements.filter(
              (item) => item.sectionKey === "milestones",
            ).length > 0
              ? version.requirements.filter(
                  (item) => item.sectionKey === "milestones",
                )
              : Array.isArray(activeSection.content)
                ? activeSection.content
                : (() => {
                    const legacyMilestones = activeSection.content as Record<
                      string,
                      DocumentJsonValue
                    >;
                    const stories = legacyMilestones.userStories;
                    return Array.isArray(stories) ? stories : [];
                  })(),
          nonFunctionalRequirements:
            version.requirements.filter(
              (item) => item.sectionKey === "nonFunctionalRequirements",
            ).length > 0
              ? version.requirements.filter(
                  (item) => item.sectionKey === "nonFunctionalRequirements",
                )
              : Object.entries(
                  (legacyNonFunctionalSection.content ?? {}) as Record<
                    string,
                    DocumentJsonValue
                  >,
                ).flatMap(([category, values]) =>
                  (Array.isArray(values) ? values : [values]).map(
                    (description, index) => ({
                      code: `RNF-${String(index + 1).padStart(3, "0")}`,
                      category,
                      title: category,
                      description,
                      requirementType: "NON_FUNCTIONAL",
                      acceptanceCriteria: [],
                      sourceIds: [],
                    }),
                  ),
                ),
        } as unknown as DocumentJsonValue)
      : null;
  const backlogStructureSection = version.sections.find(
    (section) => section.key === "backlogStructure",
  );
  const scopeSection = version.sections.find(
    (section) => section.key === "scope",
  );
  const solutionProposalSection = version.sections.find(
    (section) => section.key === "solutionProposal",
  );

  /*
   * POINT_7_INTEGRATED_VIEW_CONTEXT_V4_7_7
   *
   * La vista y el editor reciben simultáneamente Punto 6 y Punto 7 para mostrar
   * la raíz común Epic/Hito sin mezclar HU-F con HU-P ni alterar persistencia.
   */
  const milestonesSection = version.sections.find(
    (section) => section.key === "milestones",
  );

  /*
   * PUNTO_6_CURRENT_DOCUMENT_ENRICHMENT
   *
   * También corrige la versión que ya está guardada:
   * no obliga al usuario a gastar otra generación de IA.
   */
  const requirementsPresentationContent = useMemo(
    () =>
      activeSection?.key === "milestones" && backlogStructureSection
        ? composeRequirementsContent(
            draftContent,
            backlogStructureSection.content,
          )
        : draftContent,
    [activeSection?.key, backlogStructureSection, draftContent],
  );

  /*
   * PUNTO_6_CANONICAL_VIEW_CONTENT
   *
   * Vista normal y Editar deben consumir la misma representación
   * cuando el Punto 6 ya está persistido en el formato moderno:
   *
   * {
   *   functionalRequirements: [...],
   *   nonFunctionalRequirements: [...]
   * }
   *
   * legacyRequirementTabs se conserva exclusivamente como fallback
   * para documentos históricos que todavía no tienen ese formato.
   */
  const requirementsContentRecord =
    activeSection?.key === "milestones" &&
    draftContent !== null &&
    typeof draftContent === "object" &&
    !Array.isArray(draftContent)
      ? (draftContent as Record<string, DocumentJsonValue>)
      : null;

  const hasCanonicalRequirementTabs =
    Array.isArray(requirementsContentRecord?.functionalRequirements) &&
    Array.isArray(requirementsContentRecord?.nonFunctionalRequirements);

  const requirementsViewContent =
    activeSection?.key === "milestones" && hasCanonicalRequirementTabs
      ? requirementsPresentationContent
      : (legacyRequirementTabs ?? requirementsPresentationContent);

  // Las estadísticas recorren todo el contenido: se calculan con un valor diferido para que
  // escribir no espere a recalcularlas.
  const deferredPresentationContent = useDeferredValue(
    requirementsPresentationContent,
  );
  const activeStats = useMemo(
    () =>
      analyzeContent(presentSectionContent(deferredPresentationContent), [
        activeSection?.title ?? "Sección",
      ]),
    [activeSection?.title, deferredPresentationContent],
  );
  // Referencia estable: sin esto el editor de la sección recibía un objeto nuevo en cada render.
  const businessEditorContext = useMemo(
    () => ({
      projectId: documentState.projectId,
      backlogStructure: backlogStructureSection?.content ?? null,
      milestones: milestonesSection?.content ?? null,
      scope: scopeSection?.content ?? null,
      solutionProposal: solutionProposalSection?.content ?? null,
      templateName: documentState.template.name,
      templateVersion: documentState.template.version,
    }),
    [
      documentState.projectId,
      documentState.template.name,
      documentState.template.version,
      backlogStructureSection,
      milestonesSection,
      scopeSection,
      solutionProposalSection,
    ],
  );
  const overallStats = useMemo(() => versionStats(version), [version]);
  const validationGroups = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const issue of overallStats.errors) {
      const [group = "Documento"] = issue.split(" · ");
      groups.set(group, [...(groups.get(group) ?? []), issue]);
    }
    return [...groups.entries()];
  }, [overallStats.errors]);
  const sectionStatusSummary = useMemo(
    () =>
      version.sections.reduce(
        (summary, section) => {
          const stats = analyzeContent(presentSectionContent(section.content), [
            section.title,
          ]);
          if (stats.pending > 0) summary.pending += 1;
          else if (stats.errors.length > 0) summary.needsReview += 1;
          else summary.complete += 1;
          return summary;
        },
        { complete: 0, needsReview: 0, pending: 0 },
      ),
    [version],
  );
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

  async function exportSelectedDiagram(): Promise<void> {
    const root =
      sectionEditorRef.current?.querySelector<HTMLElement>(
        ".rq-diagram-models",
      );
    const selectedTab = root?.querySelector<HTMLButtonElement>(
      '[role="tab"][aria-selected="true"]',
    );
    const activePanel = root?.querySelector<HTMLElement>('[role="tabpanel"]');
    const svg = activePanel?.querySelector<SVGSVGElement>("svg");
    if (!svg) {
      showAlert(
        "El modelo seleccionado no contiene un diagrama para exportar.",
        "warning",
      );
      return;
    }

    setExportingDiagram(true);
    try {
      const modelName = selectedTab?.textContent?.trim() || "diagrama";
      await exportDiagramAsPng(
        svg,
        `${project.code}-${modelName}-v${version.version}`,
      );
      showAlert(`Se descargó ${modelName} como imagen PNG.`, "success");
    } catch (error) {
      showAlert(
        error instanceof Error ? error.message : String(error),
        "danger",
      );
    } finally {
      setExportingDiagram(false);
    }
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

          const draft = item.result?.draft;
          const legacyDraft =
            draft && !isLocalOnlyV2Draft(draft) ? draft : null;

          return [
            [
              item.documentVersionId.toLowerCase(),
              {
                provider: execution.provider,
                pendingQuestions: legacyDraft?.pendingQuestions ?? [],
                contradictions: (legacyDraft?.contradictions ?? []).map(
                  contradictionLabel,
                ),
              },
            ] as const,
          ];
        }),
      ),
    );
  }

  async function chooseSection(section: DocumentSection): Promise<void> {
    if (
      unsaved &&
      !(await confirm({
        title: "Cambios sin guardar",
        message: "Hay cambios sin guardar. ¿Deseas descartarlos y cambiar de sección?",
        confirmLabel: "Descartar y cambiar",
        destructive: true,
      }))
    )
      return;
    setActiveKey(section.key);
    setDraftContent(section.content);
    setEditingSection(false);
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
      setEditingSection(false);
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
      setEditingSection(false);
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

  async function saveScrumStartDate(startDate: string): Promise<void> {
    if (!activeSection || activeSection.key !== "scrumPlan" || readOnly) return;
    const plan = contentRecord(activeSection.content);
    const sprints = contentRecords(plan?.sprints);
    if (!plan || sprints.length === 0) {
      showAlert(
        "El plan de trabajo no contiene Sprints para calendarizar.",
        "warning",
      );
      return;
    }

    let scheduledContent: DocumentJsonValue;
    let effectiveStartDate = startDate;
    try {
      const schedule = buildColombianBusinessSprintSchedule(
        startDate,
        sprints.length,
        15,
      );
      effectiveStartDate = schedule[0]?.startDate ?? startDate;
      scheduledContent = {
        ...plan,
        cadenceDays: 15,
        scheduleBasis: "CONFIRMED_DATE",
        confirmedStartDate: startDate,
        calendarMode: "COLOMBIA_BUSINESS_DAYS",
        calendarCountry: "CO",
        calendarTimeZone: "America/Bogota",
        sprints: sprints.map((sprint, index) => {
          const dates = schedule[index];
          if (!dates) return sprint;
          return {
            ...sprint,
            startDate: dates.startDate,
            endDate: dates.endDate,
            period: `${dates.startDate} al ${dates.endDate}`,
            tasks: contentRecords(sprint.tasks).map((task) => {
              const taskStartDay =
                typeof task.startDay === "number" ? task.startDay : null;
              const taskEndDay =
                typeof task.endDay === "number" ? task.endDay : null;
              return taskStartDay !== null && taskEndDay !== null
                ? {
                    ...task,
                    startDate: colombianBusinessDateAt(startDate, taskStartDay),
                    endDate: colombianBusinessDateAt(startDate, taskEndDay),
                  }
                : task;
            }),
            calendarExcludedDates: dates.excludedDays.map((day) => ({
              date: day.date,
              reason: day.reason,
            })),
          };
        }),
      };
    } catch (error) {
      showAlert(
        error instanceof Error ? error.message : String(error),
        "danger",
      );
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
            content: scheduledContent,
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
      showAlert(
        effectiveStartDate === startDate
          ? `Calendario colombiano aplicado desde el ${formatColombianCalendarDate(startDate)}.`
          : `La fecha seleccionada no es laborable. El inicio operativo se ajustó al ${formatColombianCalendarDate(effectiveStartDate)}.`,
        "success",
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

  async function loadVersion(versionNumber: number): Promise<void> {
    if (
      unsaved &&
      !(await confirm({
        title: "Cambios sin guardar",
        message: "Hay cambios sin guardar. ¿Deseas descartarlos y abrir otra versión?",
        confirmLabel: "Descartar y abrir",
        destructive: true,
      }))
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
      setEditingSection(false);
      const url = new URL(window.location.href);
      url.searchParams.delete("version");
      window.history.replaceState(null, "", url);
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
      setEditingSection(false);
      setAlert(null);
      const url = new URL(window.location.href);
      url.searchParams.set("version", String(versionNumber));
      window.history.replaceState(null, "", url);
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
      setEditingSection(false);
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
    const reviewQuestion =
      documentaryPending > 0
        ? `La validación documental detectó ${documentaryPending} advertencia(s) o pendiente(s). Revisa su ubicación en el panel antes de aprobar. ¿Deseas enviar de todos modos esta versión a validación?`
        : "¿Deseas enviar esta versión a validación?";
    if (
      !(await confirm({
        title: "Enviar a validación",
        message: reviewQuestion,
        confirmLabel: "Enviar a validación",
      }))
    )
      return;
    setBusy(true);
    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(project.id)}/documents/${encodeURIComponent(documentState.id)}/versions/${version.versionNumber}/reviews`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-idempotency-key": createBrowserUuid(),
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
            "x-idempotency-key": createBrowserUuid(),
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

    if (
      !(await confirm({
        title: "Confirmar decisión de validación",
        message: `¿Deseas ${labels[action]}?`,
        confirmLabel: action === "approve" ? "Aprobar" : action === "reject" ? "Rechazar" : "Solicitar correcciones",
        destructive: action === "reject",
      }))
    )
      return;

    setBusy(true);
    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(project.id)}/reviews/${encodeURIComponent(review.id)}/${action}`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-idempotency-key": createBrowserUuid(),
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

  async function retryAiGeneration(analysisRequestId: string): Promise<void> {
    setBusy(true);
    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(project.id)}/analysis-requests/${encodeURIComponent(analysisRequestId)}/retry`,
        {
          method: "POST",
          credentials: "include",
        },
      );
      if (!response.ok) throw new Error(await responseError(response));
      const items = await loadAiRequests(true);
      setAiHistory(items);
      synchronizeAiVersionDetails(items);
      showAlert(
        "La generación se reintentará sobre la misma versión. No se creó otro borrador vacío.",
        "success",
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

  async function openAiVersionDialog(
    mode: AiVersionMode = "general",
  ): Promise<void> {
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
      setAiVersionMode(mode);
      setAiInstruction(
        mode === "returned-word" ? RETURNED_WORD_INSTRUCTION : "",
      );
      setAiSectionInstructions({});
      setAiAdditionalInformation("");
      setAiEvidenceFiles([]);
      setAiGenerationStage("");
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

  function selectAiEvidenceFiles(files: FileList | null): void {
    if (!files) return;
    const selectedFiles = Array.from(files);
    if (
      aiVersionMode === "returned-word" &&
      (selectedFiles.length !== 1 ||
        !selectedFiles[0]?.name.toLocaleLowerCase().endsWith(".docx"))
    ) {
      setAiEvidenceFiles([]);
      showAlert(
        "Selecciona un único documento Word en formato .docx.",
        "warning",
      );
      return;
    }
    setAiEvidenceFiles(
      selectedFiles.slice(0, aiVersionMode === "returned-word" ? 1 : 20),
    );
  }

  function removeAiEvidenceFile(index: number): void {
    setAiEvidenceFiles((current) =>
      current.filter((_, currentIndex) => currentIndex !== index),
    );
  }

  async function prepareNewAiEvidence(
    traceableChangeRequest: string,
  ): Promise<readonly string[]> {
    const sourceIds: string[] = [];
    const traceableInformation =
      aiAdditionalInformation.trim() ||
      (aiEvidenceFiles.length === 0 ? traceableChangeRequest : "");
    if (traceableInformation) {
      setAiGenerationStage("Guardando la nueva información…");
      const textResponse = await fetch(
        `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(project.id)}/sources`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sourceType: "NOTE",
            title: `Cambio solicitado para versión IA ${new Date().toISOString()}`,
            content: traceableInformation,
          }),
        },
      );
      if (!textResponse.ok) throw new Error(await responseError(textResponse));
      const textSource = (await textResponse.json()) as SourceDetail;
      sourceIds.push(textSource.id);
    }
    if (aiEvidenceFiles.length === 0) return sourceIds;
    setAiGenerationStage("Almacenando la nueva evidencia…");
    const data = new FormData();
    data.append(
      "metadata",
      JSON.stringify(
        aiEvidenceFiles.map((file) => ({
          fileName: file.name,
          classification: "EVIDENCE",
          description: "Evidencia agregada para una nueva versión con IA.",
          ...(aiVersionMode === "returned-word"
            ? {
                description:
                  "Borrador Word devuelto con correcciones de revisión humana.",
              }
            : {}),
        })),
      ),
    );
    for (const file of aiEvidenceFiles) data.append("files", file, file.name);

    const uploadResponse = await fetch(
      `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(project.id)}/sources/files`,
      { method: "POST", credentials: "include", body: data },
    );
    if (!uploadResponse.ok)
      throw new Error(await responseError(uploadResponse));
    const uploaded = (await uploadResponse.json()) as SourceUploadBatchResponse;
    const rejectedWithoutExistingSource = uploaded.rejected.filter(
      (item) => !item.duplicateSourceId,
    );
    if (rejectedWithoutExistingSource.length > 0) {
      throw new Error(
        rejectedWithoutExistingSource
          .map((item) => `${item.fileName}: ${item.reason}`)
          .join(" "),
      );
    }
    const uploadedSourceIds = [
      ...uploaded.accepted.map((source) => source.id),
      ...uploaded.rejected.flatMap((item) =>
        item.duplicateSourceId ? [item.duplicateSourceId] : [],
      ),
    ];
    // El endpoint omite de forma segura las fuentes READY. Incluir también los
    // duplicados permite recuperar una carga anterior que todavía esté PENDING.
    const pendingIds = uploadedSourceIds;

    if (pendingIds.length > 0) {
      setAiGenerationStage("Procesando la nueva evidencia…");
      const processingResponse = await fetch(
        `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(project.id)}/sources/process`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sourceIds: pendingIds }),
        },
      );
      if (!processingResponse.ok)
        throw new Error(await responseError(processingResponse));
      const processing =
        (await processingResponse.json()) as SourceBatchProcessingResponse;
      if (processing.failed > 0 && processing.enqueued === 0) {
        throw new Error(
          processing.results.map((item) => item.message).join(" "),
        );
      }
    }

    const deadline = Date.now() + 180_000;
    for (const sourceId of uploadedSourceIds) {
      let source: SourceDetail | null = null;
      while (Date.now() < deadline) {
        const detailResponse = await fetch(
          `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(project.id)}/sources/${encodeURIComponent(sourceId)}`,
          { credentials: "include", cache: "no-store" },
        );
        if (!detailResponse.ok)
          throw new Error(await responseError(detailResponse));
        source = (await detailResponse.json()) as SourceDetail;
        if (source.processingStatus === "READY") break;
        if (source.processingStatus === "FAILED") {
          throw new Error(
            `${source.title}: ${source.processingMessage || "el procesamiento falló."}`,
          );
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
      if (source?.processingStatus !== "READY") {
        throw new Error(
          "La nueva evidencia continúa procesándose. Intenta generar la versión nuevamente cuando esté lista.",
        );
      }
    }
    return [...sourceIds, ...uploadedSourceIds];
  }

  async function downloadWordDocument(): Promise<void> {
    if (unsaved) {
      showAlert(
        "Guarda los cambios de la sección antes de generar el documento Word.",
        "warning",
      );
      return;
    }
    setWordExportBusy(true);
    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(project.id)}/documents/${encodeURIComponent(documentState.id)}/versions/${version.versionNumber}/exports`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-idempotency-key": createBrowserUuid(),
          },
          body: JSON.stringify({ format: "DOCX" }),
        },
      );
      if (!response.ok) throw new Error(await responseError(response));
      let exportRequest = (await response.json()) as ExportRequestDetail;
      const deadline = Date.now() + 90_000;
      while (
        exportRequest.status === "PENDING" ||
        exportRequest.status === "PROCESSING"
      ) {
        if (Date.now() >= deadline) {
          throw new Error(
            "El documento sigue procesándose. Puedes descargarlo desde Validación cuando termine.",
          );
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        const statusResponse = await fetch(
          `${GATEWAY_URL}/api/v1/exports/${encodeURIComponent(exportRequest.id)}`,
          { credentials: "include", cache: "no-store" },
        );
        if (!statusResponse.ok)
          throw new Error(await responseError(statusResponse));
        exportRequest = (await statusResponse.json()) as ExportRequestDetail;
      }
      if (exportRequest.status !== "COMPLETED") {
        throw new Error(
          exportRequest.errorMessage ||
            "No fue posible generar el documento Word.",
        );
      }
      window.location.assign(
        `${GATEWAY_URL}/api/v1/exports/${encodeURIComponent(exportRequest.id)}/download`,
      );
      showAlert("Documento Word generado correctamente.", "success");
    } catch (error) {
      showAlert(
        error instanceof Error ? error.message : String(error),
        "danger",
      );
    } finally {
      setWordExportBusy(false);
    }
  }

  async function createAiVersion(): Promise<void> {
    const sectionInstructions = version.sections.flatMap((section) => {
      const instruction = aiSectionInstructions[section.key]?.trim();
      return instruction ? [{ sectionKey: section.key, instruction }] : [];
    });
    if (aiVersionMode === "returned-word" && aiEvidenceFiles.length !== 1) {
      showAlert(
        "Selecciona el documento Word corregido antes de crear la versión.",
        "warning",
      );
      return;
    }
    if (
      aiEvidenceFiles.length === 0 &&
      !aiAdditionalInformation.trim() &&
      !aiInstruction.trim() &&
      sectionInstructions.length === 0
    ) {
      showAlert(
        "Agrega una instrucción, nueva información o un archivo.",
        "warning",
      );
      return;
    }
    if (aiEngines.engines.length === 0) {
      showAlert(
        "Selecciona al menos un motor de IA (local o nube) antes de crear la versión.",
        "warning",
      );
      return;
    }
    const operationKey = createBrowserUuid();
    setBusy(true);
    try {
      const traceableChangeRequest = [
        aiInstruction.trim(),
        ...sectionInstructions.map(
          (item) => `${item.sectionKey}: ${item.instruction}`,
        ),
      ]
        .filter(Boolean)
        .join("\n\n");
      const newEvidenceSourceIds = await prepareNewAiEvidence(
        traceableChangeRequest,
      );
      const sourceIds = [...new Set(newEvidenceSourceIds)];
      setAiGenerationStage("Creando una revisión desde el consolidado actual…");
      const versionResponse = await fetch(
        `${GATEWAY_URL}/api/v1/documents/${encodeURIComponent(documentState.id)}/versions`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expectedRevision: documentState.revision,
            changeSummary:
              aiVersionMode === "returned-word"
                ? "Nueva versión creada desde un borrador Word corregido por revisión humana"
                : "Nueva versión con IA basada en el consolidado actual y priorizando la nueva evidencia e instrucciones",
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
      setEditingSection(false);

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
            sourceIds,
            engines: aiEngines.engines,
            providerSelections: aiEngines.providerSelections,
            purpose: "AI_VERSION",
            instruction: aiInstruction.trim() || null,
            sectionInstructions,
            idempotencyKey: operationKey,
          }),
        },
      );
      if (!analysisResponse.ok)
        throw new Error(await responseError(analysisResponse));
      const analysis =
        (await analysisResponse.json()) as AiAnalysisRequestDetail;
      setAiVersionOpen(false);
      setAiGenerationStage("Abriendo el seguimiento en Fuentes…");
      window.location.assign(
        `/workspace/sources?projectId=${encodeURIComponent(project.id)}&analysisRequestId=${encodeURIComponent(analysis.id)}`,
      );
    } catch (error) {
      showAlert(
        error instanceof Error ? error.message : String(error),
        "danger",
      );
    } finally {
      setAiGenerationStage("");
      setBusy(false);
    }
  }

  return (
    <section className="rq-document-editor">
      <header className="rq-document-editor__header">
        <div className="rq-document-editor__kpis">
          <RqKpiGrid label="Datos del documento">
            <RqKpiCard
              description={project.requestingArea}
              icon={<WorkspaceKpiIcon name="projects" />}
              title="Proyecto"
              value={project.title}
            />
            <RqKpiCard
              description={`Versión ${documentState.template.version}`}
              icon={<WorkspaceKpiIcon name="drafts" />}
              title="Plantilla"
              value={documentState.template.name}
            />
            <RqKpiCard
              description={`Revisión ${version.revision}`}
              icon={<WorkspaceKpiIcon name="clock" />}
              title="Última modificación"
              value={formatDate(version.updatedAt)}
            />
          </RqKpiGrid>
        </div>
        <div className="rq-document-editor__header-actions">
          <RqActionButton
            disabled={
              busy ||
              wordExportBusy ||
              unsaved ||
              !["DRAFT", "IN_REVIEW", "CHANGES_REQUESTED", "APPROVED"].includes(
                version.status,
              )
            }
            onClick={() => void downloadWordDocument()}
            tone="consult"
          >
            {wordExportBusy ? "Generando Word…" : "Descargar borrador Word"}
          </RqActionButton>
          <details
            className="rq-document-overflow-menu"
            onBlur={(event) => {
              // Al perder el foco el menú se minimiza.
              if (
                !event.currentTarget.contains(
                  event.relatedTarget as Node | null,
                )
              ) {
                event.currentTarget.open = false;
              }
            }}
          >
            <summary aria-label="Más acciones" title="Más acciones">
              <span
                aria-hidden="true"
                className="rq-document-overflow-menu__icon"
              >
                <i />
                <i />
                <i />
              </span>
            </summary>
            <div>
              <button
                disabled={
                  busy ||
                  wordExportBusy ||
                  unsaved ||
                  !currentVersion ||
                  documentState.status === "ARCHIVED"
                }
                onClick={() => void openAiVersionDialog("returned-word")}
                type="button"
              >
                Importar Word corregido
              </button>
              <button
                disabled={
                  busy ||
                  wordExportBusy ||
                  unsaved ||
                  !currentVersion ||
                  documentState.status === "ARCHIVED"
                }
                onClick={() => void openAiVersionDialog()}
                type="button"
              >
                Nueva versión con IA
              </button>
              <a
                href={
                  returnToAllProjects
                    ? "/workspace/documents"
                    : `/workspace/documents?projectId=${encodeURIComponent(project.id)}`
                }
                onClick={(event) => {
                  if (!unsaved) return;
                  // El cuadro es asíncrono: se detiene el enlace y se navega al confirmar.
                  event.preventDefault();
                  const destination = returnToAllProjects
                    ? "/workspace/documents"
                    : `/workspace/documents?projectId=${encodeURIComponent(project.id)}`;
                  void confirm({
                    title: "Cambios sin guardar",
                    message: "Hay cambios sin guardar. ¿Deseas salir del editor?",
                    confirmLabel: "Salir sin guardar",
                    destructive: true,
                  }).then((leave) => {
                    if (leave) window.location.assign(destination);
                  });
                }}
              >
                Volver a documentos
              </a>
              <button
                disabled={busy}
                onClick={() => void openHistory()}
                type="button"
              >
                Historial
              </button>
              <button
                disabled={busy || documentState.currentVersionNumber < 2}
                onClick={() => void loadComparison()}
                type="button"
              >
                Comparar versiones
              </button>
              <button
                disabled={busy}
                onClick={() => void openAiHistory()}
                type="button"
              >
                Historial IA
              </button>
              <button
                disabled={
                  busy || wordExportBusy || documentState.status === "ARCHIVED"
                }
                onClick={openVersionDialog}
                type="button"
              >
                Nueva versión
              </button>
            </div>
          </details>
        </div>
      </header>

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

      <section
        aria-label="Asistencia del documento"
        className="rq-document-status-row"
      >
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

        <div
          className="rq-document-completeness"
          role="status"
          style={
            {
              "--rq-completeness-hue": `${Math.round(Math.min(Math.max(progress, 0), 100) * 1.2)}`,
            } as React.CSSProperties
          }
        >
          <strong>Completitud estructural · {progress}%</strong>
          <span>{documentaryPending} pendientes por resolver</span>
        </div>
      </section>

      {!currentVersion ? (
        <div className="rq-document-version-banner" role="status">
          Estás consultando una versión histórica. La edición está bloqueada.
          {version.status === "APPROVED"
            ? " Esta versión fue aprobada y es inmutable."
            : ""}
        </div>
      ) : null}

      <section className="rq-document-section-bar">
        <div
          className="rq-projects-filter rq-document-section-select"
          onBlur={(event) => {
            // Al perder el foco la lista se minimiza.
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            ) {
              setSectionMenuOpen(false);
            }
          }}
        >
          <span>Sección:</span>
          <button
            aria-expanded={sectionMenuOpen}
            aria-haspopup="listbox"
            aria-label="Seleccionar sección del documento"
            className="rq-doc-select__button"
            onClick={() => setSectionMenuOpen((current) => !current)}
            type="button"
          >
            <strong>
              {activeSection
                ? `${activeSection.order}. ${
                    activeSection.key === "milestones" &&
                    legacyNonFunctionalSection
                      ? "Requerimientos"
                      : visibleSectionTitle(activeSection)
                  }`
                : "Elegir sección"}
            </strong>
            <svg
              aria-hidden="true"
              fill="none"
              height="16"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
              viewBox="0 0 24 24"
              width="16"
            >
              <path d="m5 9 7 7 7-7" />
            </svg>
          </button>
          {sectionMenuOpen ? (
            <ul
              aria-label="Secciones del documento"
              className="rq-doc-select__list"
              role="listbox"
            >
              {version.sections.map((section) => (
                <li
                  aria-selected={activeKey === section.key}
                  key={section.key}
                  role="option"
                >
                  <button
                    onClick={() => {
                      chooseSection(section);
                      setSectionMenuOpen(false);
                    }}
                    type="button"
                  >
                    <span>{section.order}</span>
                    {section.key === "milestones" && legacyNonFunctionalSection
                      ? "Requerimientos"
                      : visibleSectionTitle(section)}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <nav
          aria-label="Secciones del documento"
          className="rq-document-section-strip"
        >
          <ol>
            {version.sections.map((section) => (
              <li key={section.key}>
                <button
                  aria-current={activeKey === section.key ? "step" : undefined}
                  aria-label={`Sección ${section.order}: ${
                    section.key === "milestones" && legacyNonFunctionalSection
                      ? "Requerimientos"
                      : visibleSectionTitle(section)
                  }`}
                  onClick={() => chooseSection(section)}
                  title={visibleSectionTitle(section)}
                  type="button"
                >
                  <span>{section.order}</span>
                  <strong>
                    {section.key === "milestones" && legacyNonFunctionalSection
                      ? "Requerimientos"
                      : visibleSectionTitle(section)}
                  </strong>
                </button>
              </li>
            ))}
            {validationGroups.length > 0 ? (
              <li className="rq-document-section-strip__details-item">
                <button
                  aria-expanded={validationExpanded}
                  aria-label={
                    validationExpanded
                      ? "Ocultar detalles del documento"
                      : "Mostrar detalles del documento"
                  }
                  className="rq-document-section-bar__details"
                  onClick={() => setValidationExpanded((current) => !current)}
                  title={
                    validationExpanded ? "Ocultar detalles" : "Ver detalles"
                  }
                  type="button"
                >
                  <span aria-hidden="true">!</span>
                  <strong>Detalles</strong>
                </button>
              </li>
            ) : null}
          </ol>
        </nav>
        <span className="rq-document-section-bar__summary">
          {version.sections.length} secciones · {sectionStatusSummary.complete}{" "}
          completas · {sectionStatusSummary.pending} pendientes
        </span>
      </section>

      <div className="rq-document-editor__layout">
        <main
          className="rq-document-section-editor"
          ref={sectionEditorRef}
          tabIndex={-1}
        >
          {activeSection ? (
            <>
              <header>
                <div>
                  <span>
                    Sección {activeSection.order} de {version.sections.length}
                  </span>
                  <h2>
                    {legacyRequirementTabs
                      ? "Requerimientos"
                      : visibleSectionTitle(activeSection)}
                  </h2>
                  <p>
                    {editingSection
                      ? "Edita la información funcional y guarda esta sección."
                      : "Consulta el contenido consolidado en lenguaje de negocio."}
                  </p>
                </div>
                <div className="rq-document-section-editor__status">
                  {unsaved ? (
                    <span data-unsaved="true">Cambios sin guardar</span>
                  ) : (
                    <small>Guardado</small>
                  )}
                  {activeStats.pending > 0 ? (
                    <small>{activeStats.pending} datos pendientes</small>
                  ) : null}
                  {editingSection ? (
                    <div className="rq-document-section-editor__actions">
                      <RqActionButton
                        disabled={busy}
                        onClick={() => {
                          setDraftContent(activeSection.content);
                          setEditingSection(false);
                        }}
                      >
                        Cancelar
                      </RqActionButton>
                      <RqActionButton
                        disabled={
                          readOnly ||
                          busy ||
                          !unsaved ||
                          activeStats.errors.length > 0
                        }
                        onClick={() => void saveSection()}
                        tone="affirmative"
                      >
                        {busy ? "Guardando…" : "Guardar"}
                      </RqActionButton>
                    </div>
                  ) : activeSection.key === "processFlow" || !readOnly ? (
                    <div className="rq-document-section-editor__actions">
                      {activeSection.key === "processFlow" ? (
                        <RqActionButton
                          aria-label="Exportar como imagen el diagrama seleccionado"
                          disabled={busy || exportingDiagram}
                          onClick={() => void exportSelectedDiagram()}
                          tone="consult"
                        >
                          {exportingDiagram ? "Exportando…" : "Exportar imagen"}
                        </RqActionButton>
                      ) : null}
                      {!readOnly && activeSection.key === "scrumPlan" ? (
                        <label className="rq-document-calendar-picker">
                          <span aria-hidden="true">📅</span>
                          <span>Fecha de inicio</span>
                          <input
                            aria-label="Fecha de inicio del plan de trabajo"
                            disabled={busy || exportingDiagram}
                            onChange={(event) => {
                              if (event.target.value) {
                                void saveScrumStartDate(event.target.value);
                              }
                            }}
                            type="date"
                            value={scrumStartDate}
                          />
                        </label>
                      ) : null}
                      {!readOnly ? (
                        <RqActionButton
                          disabled={busy || exportingDiagram}
                          onClick={() => setEditingSection(true)}
                          tone="operation"
                        >
                          Editar sección
                        </RqActionButton>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </header>

              {activeStats.errors.length > 0 ? (
                <details className="rq-document-validation">
                  <summary>
                    <strong>Campos obligatorios por corregir</strong>
                    <span>{activeStats.errors.length}</span>
                  </summary>
                  <ul>
                    {activeStats.errors.slice(0, 12).map((error) => {
                      const targetId =
                        functionalStoryTargetFromValidation(error);
                      return (
                        <li key={error}>
                          <span>{error}</span>
                          {targetId ? (
                            <button
                              aria-label={`Ver historia relacionada con: ${error}`}
                              onClick={() => revealFunctionalStory(targetId)}
                              title="Ver historia de usuario"
                              type="button"
                            >
                              <span aria-hidden="true">👁</span>
                              Ver
                            </button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              ) : null}

              {editingSection ? (
                <form
                  className="rq-document-business-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveSection();
                  }}
                >
                  <DocumentSectionBusinessEditor
                    context={businessEditorContext}
                    onChange={setDraftContent}
                    readOnly={readOnly || busy}
                    sectionKey={activeSection.key}
                    value={requirementsPresentationContent}
                  />
                  <footer>
                    <span>
                      Los datos técnicos y la trazabilidad se conservan sin
                      mostrarse en el formulario.
                    </span>
                  </footer>
                </form>
              ) : (
                <section className="rq-document-business-view">
                  <DocumentSectionView
                    context={{
                      projectId: documentState.projectId,
                      backlogStructure:
                        backlogStructureSection?.content ?? null,
                      milestones: milestonesSection?.content ?? null,
                      scope: scopeSection?.content ?? null,
                      solutionProposal:
                        solutionProposalSection?.content ?? null,
                      templateName: documentState.template.name,
                      templateVersion: documentState.template.version,
                    }}
                    sectionKey={activeSection.key}
                    templateControlled={activeSection.templateControlled}
                    value={requirementsViewContent}
                  />
                </section>
              )}

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

              {activeSection.key === "milestones" ? (
                <IntegratedPoint6Point7Panel
                  backlogValue={backlogStructureSection?.content ?? null}
                  collapsed
                  requirementsValue={requirementsViewContent}
                />
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
        <div className="rq-document-editor__side">
          <aside
            aria-label="Versión consultada"
            className="rq-document-workflow rq-document-version-card"
          >
            <div
              className="rq-projects-filter rq-document-version-select"
              onBlur={(event) => {
                // Al perder el foco la lista se minimiza.
                if (
                  !event.currentTarget.contains(
                    event.relatedTarget as Node | null,
                  )
                ) {
                  setVersionMenuOpen(false);
                }
              }}
            >
              <span>Versión:</span>
              <button
                aria-expanded={versionMenuOpen}
                aria-haspopup="listbox"
                aria-label="Versión consultada"
                className="rq-doc-select__button"
                disabled={busy || unsaved}
                onClick={() => setVersionMenuOpen((current) => !current)}
                type="button"
              >
                <strong>
                  Versión {version.versionNumber}
                  {version.versionNumber === documentState.currentVersionNumber
                    ? " · actual"
                    : ""}
                </strong>
                <svg
                  aria-hidden="true"
                  fill="none"
                  height="16"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                  viewBox="0 0 24 24"
                  width="16"
                >
                  <path d="m5 9 7 7 7-7" />
                </svg>
              </button>
              {versionMenuOpen ? (
                <ul
                  aria-label="Versiones del documento"
                  className="rq-doc-select__list"
                  role="listbox"
                >
                  {Array.from(
                    { length: documentState.currentVersionNumber },
                    (_, index) => documentState.currentVersionNumber - index,
                  ).map((item) => (
                    <li
                      aria-selected={version.versionNumber === item}
                      key={item}
                      role="option"
                    >
                      <button
                        onClick={() => {
                          setVersionMenuOpen(false);
                          void loadVersion(item);
                        }}
                        type="button"
                      >
                        <span>{item}</span>
                        Versión {item}
                        {item === documentState.currentVersionNumber
                          ? " · actual"
                          : ""}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <small>SemVer {version.version}</small>
          </aside>
          {currentVersion ? (
            <aside
              className="rq-document-workflow"
              aria-label="Revisión y aprobación"
            >
              <header>
                <div>
                  <strong>Revisión y aprobación</strong>
                  <span>
                    Comentarios, correcciones y decisiones conservan actor,
                    fecha y correlación.
                  </span>
                </div>
                <RqStatusBadge tone={statusTone(version.status)}>
                  {statusLabel(version.status)}
                </RqStatusBadge>
              </header>

              {version.status === "DRAFT" ||
              version.status === "CHANGES_REQUESTED" ||
              version.status === "IN_REVIEW" ? (
                <label className="rq-document-review-comment">
                  <span>
                    {version.status === "DRAFT" ||
                    version.status === "CHANGES_REQUESTED"
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
                {version.status === "DRAFT" ||
                version.status === "CHANGES_REQUESTED" ? (
                  <RqActionButton
                    disabled={busy || unsaved}
                    onClick={() => void requestReview()}
                    tone="operation"
                  >
                    {version.status === "CHANGES_REQUESTED"
                      ? "Reenviar a validación"
                      : "Enviar a validación"}
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
            </aside>
          ) : null}
        </div>
      </div>

      {validationExpanded ? (
        <div
          className="rq-project-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setValidationExpanded(false);
            }
          }}
          role="presentation"
        >
          <section
            aria-labelledby="document-corrections-title"
            aria-modal="true"
            className="rq-project-modal rq-document-corrections-modal"
            ref={validationDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <header className="rq-project-modal__header rq-document-corrections-modal__header">
              <div>
                <span>Revisión de completitud</span>
                <h2 id="document-corrections-title">
                  Puntos que requieren atención
                </h2>
                <p>
                  {validationGroups.length} puntos presentan información por
                  completar o corregir.
                </p>
              </div>
              <button
                aria-label="Cerrar correcciones"
                onClick={() => setValidationExpanded(false)}
                type="button"
              >
                ×
              </button>
            </header>
            <div className="rq-document-corrections-list">
              {validationGroups.map(([group, issues]) => {
                const section = version.sections.find(
                  (item) => item.title === group,
                );
                return (
                  <details
                    className="rq-doc-issue"
                    key={group}
                    open={issues.length <= 3}
                  >
                    <summary>
                      <span>
                        {section
                          ? `Punto ${section.order} de ${version.sections.length}`
                          : "Documento"}
                      </span>
                      <h3>{group}</h3>
                      <small>
                        {issues.length}{" "}
                        {issues.length === 1 ? "observación" : "observaciones"}
                      </small>
                      <i aria-hidden="true">⌄</i>
                    </summary>
                    <ul>
                      {issues.map((issue) => (
                        <li key={issue}>{issue.replace(`${group} · `, "")}</li>
                      ))}
                    </ul>
                    {section ? (
                      <button
                        className="rq-doc-issue__go"
                        onClick={() => {
                          chooseSection(section);
                          setValidationExpanded(false);
                        }}
                        type="button"
                      >
                        Ir al punto {section.order}
                      </button>
                    ) : null}
                  </details>
                );
              })}
            </div>
            <footer className="rq-document-corrections-modal__footer">
              <RqActionButton
                onClick={() => setValidationExpanded(false)}
                tone="operation"
              >
                Entendido
              </RqActionButton>
            </footer>
          </section>
        </div>
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
                    <DocumentHumanValue value={entry.details} />
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
                <span>
                  {aiVersionMode === "returned-word"
                    ? "Revisión humana"
                    : "Generación explícita"}
                </span>
                <h2 id="ai-version-title">
                  {aiVersionMode === "returned-word"
                    ? "Importar Word corregido"
                    : "Nueva versión con IA"}
                </h2>
              </div>
              <button
                aria-label={
                  aiVersionMode === "returned-word"
                    ? "Cerrar importación del Word corregido"
                    : "Cerrar nueva versión con IA"
                }
                disabled={busy}
                onClick={() => setAiVersionOpen(false)}
                type="button"
              >
                ×
              </button>
            </header>
            <div className="rq-document-ai-version-content">
              {aiVersionMode === "returned-word" ? (
                <p>
                  Selecciona el Word que descargaste y corregiste. La IA lo
                  comparará con la versión actual, aplicará las mejoras en una
                  nueva versión y conservará intacta la versión anterior.
                </p>
              ) : (
                <p>
                  La IA tomará la versión actual como base consolidada y
                  conservará lo que no deba cambiar.{" "}
                  {
                    "No necesitas volver a seleccionar los archivos anteriores: "
                  }
                  la nueva evidencia, el contexto y tu instrucción tendrán
                  prioridad. La versión anterior permanecerá sin cambios.
                </p>
              )}
              <fieldset>
                <legend>
                  {aiVersionMode === "returned-word"
                    ? "Documento Word corregido"
                    : "Nueva evidencia"}
                </legend>
                <label className="rq-document-ai-file-picker">
                  <span>
                    {aiVersionMode === "returned-word"
                      ? "Seleccionar Word corregido"
                      : "Agregar archivos o diagramas"}
                  </span>
                  <input
                    accept={
                      aiVersionMode === "returned-word"
                        ? ".docx"
                        : AI_EVIDENCE_FILE_ACCEPT
                    }
                    disabled={busy}
                    multiple={aiVersionMode !== "returned-word"}
                    onChange={(event) =>
                      selectAiEvidenceFiles(event.target.files)
                    }
                    type="file"
                  />
                  <small>
                    {aiVersionMode === "returned-word"
                      ? "Un archivo .docx correspondiente a este documento."
                      : "PDF, Word, Excel, CSV, TXT, VTT e imágenes PNG, JPG o WEBP. Máximo 20 archivos."}
                  </small>
                </label>
                {aiEvidenceFiles.length > 0 ? (
                  <ul className="rq-document-ai-file-list">
                    {aiEvidenceFiles.map((file, index) => (
                      <li
                        key={`${file.name}-${file.size}-${file.lastModified}`}
                      >
                        <span>
                          <strong>{file.name}</strong>
                          <small>{Math.ceil(file.size / 1024)} KB</small>
                        </span>
                        <button
                          disabled={busy}
                          onClick={() => removeAiEvidenceFile(index)}
                          type="button"
                        >
                          Quitar
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </fieldset>
              <label className="rq-field">
                <span>
                  {aiVersionMode === "returned-word"
                    ? "Indicaciones adicionales (opcional)"
                    : "Nueva información o contexto"}
                </span>
                <textarea
                  disabled={busy}
                  maxLength={20000}
                  onChange={(event) =>
                    setAiAdditionalInformation(event.target.value)
                  }
                  placeholder={
                    aiVersionMode === "returned-word"
                      ? "Opcional: explica qué partes corregiste o qué debe revisarse con especial cuidado."
                      : "Registra aquí hechos, decisiones, reglas o necesidades nuevas que deban quedar como evidencia trazable de esta versión."
                  }
                  rows={5}
                  value={aiAdditionalInformation}
                />
                <small>{aiAdditionalInformation.length}/20000</small>
              </label>
              {aiVersionMode === "general" ? (
                <label className="rq-field">
                  <span>Cambio general o transversal</span>
                  <textarea
                    disabled={busy}
                    maxLength={20000}
                    onChange={(event) => setAiInstruction(event.target.value)}
                    placeholder="Describe aquí únicamente los cambios que afectan al documento completo o a varias secciones."
                    rows={4}
                    value={aiInstruction}
                  />
                  <small>{aiInstruction.length}/20000</small>
                </label>
              ) : null}
              {aiVersionMode === "general" ? (
                <fieldset className="rq-document-ai-section-instructions">
                  <legend>Cambios por punto del documento</legend>
                  <p>
                    Indica el cambio en el punto exacto donde debe quedar. La IA
                    conservará lo demás y actualizará las secciones
                    dependientes.
                  </p>
                  {version.sections.map((section, index) => (
                    <details key={section.key}>
                      <summary>
                        <span>
                          Punto {index + 1} · {section.title}
                        </span>
                        <small>
                          {aiSectionInstructions[section.key]?.trim()
                            ? "Cambio definido"
                            : "Sin cambios específicos"}
                        </small>
                      </summary>
                      <label className="rq-field">
                        <span>Qué debe cambiar en este punto</span>
                        <textarea
                          disabled={busy}
                          maxLength={6000}
                          onChange={(event) =>
                            setAiSectionInstructions((current) => ({
                              ...current,
                              [section.key]: event.target.value,
                            }))
                          }
                          placeholder={`Describe el resultado esperado para ${section.title}.`}
                          rows={4}
                          value={aiSectionInstructions[section.key] ?? ""}
                        />
                        <small>
                          {(aiSectionInstructions[section.key] ?? "").length}
                          /6000
                        </small>
                      </label>
                    </details>
                  ))}
                </fieldset>
              ) : null}
              <fieldset className="rq-document-ai-engines">
                <legend>Motores de IA</legend>
                <AiEngineChips
                  capabilities={aiEngines.capabilities}
                  loading={aiEngines.loading}
                  locked={busy}
                  providerSelections={aiEngines.providerSelections}
                  selectProvider={aiEngines.selectProvider}
                  selection={aiEngines.selection}
                  toggle={aiEngines.toggle}
                />
                {aiEngines.error ? (
                  <small role="alert">{aiEngines.error}</small>
                ) : null}
                {!aiEngines.loading && aiEnginesMissing ? (
                  <small id="ai-engines-required" role="status">
                    Enciende y configura un motor de IA (local o nube) para
                    habilitar la creación. La IA nube nunca se activa sin tu
                    elección.
                  </small>
                ) : null}
              </fieldset>
              {busy && aiGenerationStage ? (
                <p
                  aria-live="polite"
                  className="rq-document-ai-generation-stage"
                >
                  {aiGenerationStage}
                </p>
              ) : null}
            </div>
            <div className="rq-project-modal__actions">
              <RqActionButton
                disabled={busy}
                onClick={() => setAiVersionOpen(false)}
              >
                Cancelar
              </RqActionButton>
              <RqActionButton
                aria-describedby={
                  aiEnginesMissing ? "ai-engines-required" : undefined
                }
                disabled={
                  busy ||
                  aiEngines.loading ||
                  aiEnginesMissing ||
                  (aiVersionMode === "returned-word"
                    ? aiEvidenceFiles.length !== 1
                    : aiEvidenceFiles.length === 0 &&
                      !aiAdditionalInformation.trim() &&
                      !aiInstruction.trim() &&
                      !Object.values(aiSectionInstructions).some((value) =>
                        value?.trim(),
                      ))
                }
                onClick={() => void createAiVersion()}
                tone="affirmative"
              >
                {busy
                  ? "Generando…"
                  : aiVersionMode === "returned-word"
                    ? "Crear versión desde Word"
                    : "Crear versión con IA"}
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
                      {item.status === "FAILED" ? (
                        <div className="rq-project-modal__actions">
                          <RqActionButton
                            disabled={busy}
                            onClick={() => void retryAiGeneration(item.id)}
                            tone="consult"
                          >
                            Reintentar esta generación
                          </RqActionButton>
                        </div>
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
                      <DocumentSectionView
                        sectionKey={leftSection.key}
                        templateControlled={leftSection.templateControlled}
                        value={leftSection.content}
                      />
                      <DocumentSectionView
                        sectionKey={rightSection?.key ?? leftSection.key}
                        templateControlled={rightSection?.templateControlled}
                        value={rightSection?.content ?? null}
                      />
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
