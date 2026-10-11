import {
  conciseFunctionalStoryDescription,
  type DocumentJsonValue,
} from "@levantamiento-rq/shared-contracts";

export const PENDING = "[PENDIENTE POR DEFINIR]";

const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu;

const UUID_TEST_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu;

const TECHNICAL_KEYS = new Set([
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

const LABELS: Readonly<Record<string, string>> = {
  title: "Título",
  projectCode: "Código",
  documentVersion: "Versión",
  createdDate: "Fecha",
  requestingArea: "Área solicitante",
  preparedBy: "Elaborado por",
  reviewedBy: "Revisado por",
  approvedBy: "Aprobado por",
  status: "Estado",
  name: "Nombre",
  position: "Cargo",
  general: "Objetivo general",
  specific: "Objetivos específicos",
  qualitative: "Objetivos específicos cualitativos",
  quantitative: "Objetivos específicos cuantitativos",
  currentState: "Situación actual",
  operationalImpact: "Impacto operacional",
  included: "Incluye",
  excluded: "Fuera de alcance",
  involvedSystems: "Sistemas involucrados",
  involvedElements: "Elementos involucrados",
  flowAlignment: "Correspondencia con el flujo",
  evaluation: "Evaluación de la solución",
  kpis: "KPIs de estado",
  relatedObjective: "Objetivo relacionado",
  measurement: "Cómo se mide",
  target: "Meta",
  objective: "Objetivo",
  description: "Descripción",
  inScope: "Incluye",
  outOfScope: "Fuera de alcance",
  userStoryCodes: "Historias relacionadas",
  featureCode: "Funcionalidad relacionada",
  role: "Como",
  want: "Quiero",
  benefit: "Para",
  context: "Contexto",
  premises: "Premisas",
  impactedSystems: "Sistemas impactados",
  fields: "Campos",
  dataType: "Tipo de dato",
  required: "Obligatorio",
  validation: "Validación",
  acceptanceCriteria: "Criterios de aceptación",
  given: "Dado",
  when: "Cuando",
  then: "Entonces",
  scenarios: "Escenarios",
  precondition: "Precondición",
  action: "Acción",
  expectedResult: "Resultado esperado",
  userStoryCode: "Historia relacionada",
  acceptanceCriterionCodes: "Criterios relacionados",
  assumptions: "Supuestos",
  dependencies: "Dependencias",
  pendingItems: "Pendientes",
  pendingQuestions: "Preguntas pendientes",
  contradictions: "Contradicciones",
  warnings: "Aspectos por revisar",
  narrative: "Resumen",
  changeControl: "Control de cambios",
  approvals: "Aprobaciones",
  cadenceDays: "Cadencia",
  confirmedStartDate: "Fecha de inicio confirmada",
  sprints: "Sprints",
  number: "Número",
  featureCodes: "Funcionalidades",
  tasks: "Tareas",
  dependencyCodes: "Dependencias",
  testCodes: "Pruebas",
  deliverables: "Entregables",
  closingCriterion: "Criterio de cierre",
  risks: "Riesgos",
  suggestedRole: "Rol sugerido",
  statementA: "Información A",
  statementB: "Información B",
  decision: "Decisión",
};

const ENUM_LABELS: Readonly<Record<string, string>> = {
  START: "Inicio",
  END: "Fin",
  ACTOR: "Actor",
  PROCESS: "Proceso",
  DECISION: "Decisión",
  SYSTEM: "Sistema",
  ANALYSIS: "Análisis",
  DESIGN: "Diseño",
  DEVELOPMENT: "Desarrollo",
  CONFIGURATION: "Configuración",
  INTEGRATION: "Integración",
  DATA: "Datos",
  TESTING: "Pruebas",
  UAT: "Pruebas de usuario",
  DOCUMENTATION: "Documentación",
  DEPLOYMENT: "Despliegue",
  DRAFT: "Borrador",
  IN_REVIEW: "En validación",
  APPROVED: "Aprobado",
  REJECTED: "Rechazado",
  ARCHIVED: "Archivado",
};

export type JsonRecord = Record<string, DocumentJsonValue>;

export function isRecord(value: DocumentJsonValue): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function recordValue(
  value: DocumentJsonValue | undefined,
): JsonRecord | null {
  return value && isRecord(value) ? value : null;
}

export function recordList(value: DocumentJsonValue | undefined): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter(isRecord).map((item) => ({ ...item }))
    : [];
}

export function stringValue(value: DocumentJsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

export function functionalStoryDescriptionForDisplay(
  story: Readonly<Record<string, DocumentJsonValue>>,
): string {
  return conciseFunctionalStoryDescription({
    description: stringValue(story.description),
    title: stringValue(story.title),
    want: stringValue(story.want),
  });
}

export function stringList(value: DocumentJsonValue | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function numberValue(
  value: DocumentJsonValue | undefined,
): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function humanLabel(key: string): string {
  return LABELS[key] ?? key.replace(/([a-z])([A-Z])/gu, "$1 $2");
}

export function cleanDocumentText(value: string): string {
  return value
    .replace(/\(?\s*source\s*ids?\s*:\s*\[[^\]]*\]\s*\)?/giu, "")
    .replace(
      /\(\s*(?:scheduleBasis|startDay|endDay|startDate|endDate|period|clientId)\s*:[^)]*\)/giu,
      "",
    )
    .replace(
      /(?:el\s+)?(?:plan\s+en\s+)?detalle\s+(?:está|se encuentra)\s+en\s+structuredAnalysis\.[\w.]+\s*\.?/giu,
      "",
    )
    .replace(/structuredAnalysis\.[\w.]+/giu, "")
    .replace(UUID_PATTERN, "")
    .replace(/\(\s*\)/gu, "")
    .replace(/[ \t]{2,}/gu, " ")
    .replace(/\s+([,.;:])/gu, "$1")
    .trim();
}

export function presentSectionContent(
  value: DocumentJsonValue,
): DocumentJsonValue {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed) as DocumentJsonValue;
  } catch {
    return value;
  }
}

export function restoreSectionContent(
  original: DocumentJsonValue,
  next: DocumentJsonValue,
): DocumentJsonValue {
  if (
    typeof original === "string" &&
    presentSectionContent(original) !== original &&
    typeof next !== "string"
  ) {
    return JSON.stringify(next);
  }
  return next;
}

export function visibleEntries(
  value: JsonRecord,
): [string, DocumentJsonValue][] {
  return Object.entries(value).filter(
    ([key, item]) =>
      !TECHNICAL_KEYS.has(key) &&
      !(typeof item === "string" && UUID_TEST_PATTERN.test(item)),
  );
}

export function displayText(value: string): string {
  const cleaned = cleanDocumentText(value);
  const visible = cleaned.replaceAll(PENDING, "Pendiente de definición");
  return ENUM_LABELS[visible] ?? visible;
}
