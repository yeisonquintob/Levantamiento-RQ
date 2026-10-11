import {
  type DocumentJsonValue,
  type DocumentVersionDetail,
} from "@levantamiento-rq/shared-contracts";
import {
  type ExportContentLine,
  type ExportDocumentSection,
  type ExportPresentationProfile,
  type RenderApprovedDocumentInput,
} from "./export-document.types";

export function presentationProfile(
  input: RenderApprovedDocumentInput,
): ExportPresentationProfile {
  switch (input.document.template.templateType) {
    case "SMALL_REQUIREMENT":
      return "COMPACT";
    case "LARGE_REQUIREMENT":
      return "EXTENDED";
    case "ERP_FDD":
      return "ERP";
    default:
      return "BALANCED";
  }
}

export function documentTemplateDescription(
  input: RenderApprovedDocumentInput,
): string {
  return (
    input.templateDescription?.trim() ||
    input.document.template.name.trim() ||
    "Documento de levantamiento de requerimientos"
  );
}

const LABELS: Readonly<Record<string, string>> = {
  title: "Título",
  projectCode: "Código del proyecto",
  documentVersion: "Versión del documento",
  createdDate: "Fecha de creación",
  requestingArea: "Área solicitante",
  preparedBy: "Elaborado por",
  reviewedBy: "Revisado por",
  approvedBy: "Aprobado por",
  status: "Estado",
  general: "Objetivo general",
  specific: "Objetivos específicos",
  qualitative: "Objetivos específicos cualitativos",
  quantitative: "Objetivos específicos cuantitativos",
  kpis: "KPIs de estado",
  relatedObjective: "Objetivo relacionado",
  measurement: "Cómo se mide",
  target: "Meta",
  currentState: "Estado actual",
  operationalImpact: "Impacto operacional",
  need: "Necesidad",
  included: "Incluye",
  excluded: "No incluye",
  involvedSystems: "Sistemas involucrados",
  involvedElements: "Elementos involucrados",
  flowAlignment: "Correspondencia con el flujo",
  evaluation: "Evaluación de la solución",
  expectedResult: "Resultado esperado",
  content: "Contenido",
  actors: "Actores",
  inputs: "Entradas",
  outputs: "Salidas",
  systems: "Sistemas",
  description: "Descripción",
  details: "Detalles",
  result: "Resultado",
  keyActivities: "Actividades clave",
  userStory: "Historia de usuario",
  acceptanceCriteria: "Criterios de aceptación",
  businessRules: "Reglas de negocio",
  requiredFields: "Campos requeridos",
  validationOrObservation: "Validación u observación",
  security: "Seguridad",
  traceability: "Trazabilidad",
  performance: "Rendimiento",
  compatibility: "Compatibilidad",
  availability: "Disponibilidad",
  usability: "Usabilidad",
  objective: "Objetivo",
  minimumScenarios: "Escenarios mínimos",
  assumptions: "Supuestos",
  dependencies: "Dependencias",
  pendingItems: "Pendientes",
  changeControl: "Control de cambios",
  approvals: "Aprobaciones",
  features: "Features",
  userStories: "Historias de usuario",
  scenarios: "Escenarios de prueba",
  cadenceDays: "Cadencia (días calendario)",
  scheduleBasis: "Base del calendario",
  confirmedStartDate: "Fecha de inicio confirmada",
  sprints: "Sprints",
};

export function label(key: string): string {
  return (
    LABELS[key] ??
    key
      .replace(/([a-záéíóúñ])([A-Z])/g, "$1 $2")
      .replaceAll("_", " ")
      .replace(/^./, (value) => value.toUpperCase())
  );
}

function scalar(value: string | number | boolean | null): string {
  if (value === null) return "Sin información";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  return String(value).trim() || "Sin información";
}

export function flattenDocumentContent(
  value: DocumentJsonValue,
  level = 0,
): ExportContentLine[] {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return [{ text: scalar(value), level, bullet: false }];
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [{ text: "Sin registros", level, bullet: false }];
    }
    return value.flatMap((item) => {
      if (
        item === null ||
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean"
      ) {
        return [{ text: scalar(item), level, bullet: true }];
      }
      return flattenDocumentContent(item, level + 1);
    });
  }
  return Object.entries(value).flatMap(([key, item]) => {
    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean"
    ) {
      return [
        {
          text: `${label(key)}: ${scalar(item)}`,
          level,
          bullet: false,
        },
      ];
    }
    return [
      { text: label(key), level, bullet: false },
      ...flattenDocumentContent(item, level + 1),
    ];
  });
}

export const TEMPLATE_CONTROLLED_EXPORT_TEXT: Readonly<Record<string, string>> =
  {
    writingRules:
      "Contenido institucional controlado por la plantilla. Aplicar redacción clara, consistente, verificable, trazable y sin información inventada.",
    visualFormat:
      "Contenido institucional controlado por la plantilla. Mantener jerarquía visual, tablas compactas y diagramas legibles en los entregables.",
    automationInstruction:
      "Contenido institucional controlado por la plantilla. Conservar la estructura canónica para análisis, versionamiento y exportación controlada.",
  };

export function templatePlaceholderOnly(
  section: DocumentVersionDetail["sections"][number],
): boolean {
  if (
    !section.templateControlled ||
    !section.content ||
    typeof section.content !== "object" ||
    Array.isArray(section.content)
  ) {
    return false;
  }

  const record = section.content as Readonly<Record<string, DocumentJsonValue>>;

  return (
    record.templateControlled === true &&
    Object.keys(record).every((key) => key === "templateControlled")
  );
}

function mermaidNodeLabel(value: string): string {
  const cleaned = value.trim().replace(/;$/u, "");

  const match = cleaned.match(
    /^[A-Za-z0-9_]+(?:\[(.*?)\]|\((.*?)\)|\{(.*?)\})$/u,
  );

  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? cleaned).trim();
}

export function mermaidFlowSteps(source: string): string[] {
  const steps: string[] = [];
  const seen = new Set<string>();

  for (const raw of source.split(/\r?\n/u)) {
    let line = raw.trim();

    if (
      !line ||
      /^flowchart\b/iu.test(line) ||
      /^graph\b/iu.test(line) ||
      line.startsWith("%%")
    ) {
      continue;
    }

    line = line.replace(/\s+--\s*([^>\n]+?)\s*-->\s+/gu, " -->|$1| ");

    const edge = line.match(/^(.+?)\s*-->\s*(?:\|([^|]+)\|\s*)?(.+?)\s*;?$/u);

    if (!edge) continue;

    const from = mermaidNodeLabel(edge[1] ?? "");
    const condition = edge[2]?.trim();
    const to = mermaidNodeLabel(edge[3] ?? "");

    if (!from || !to) continue;

    const value = condition
      ? `${from} -> ${condition} -> ${to}`
      : `${from} -> ${to}`;

    if (!seen.has(value)) {
      seen.add(value);
      steps.push(value);
    }
  }

  return steps;
}

export function jsonRecord(
  value: DocumentJsonValue | undefined,
): Readonly<Record<string, DocumentJsonValue>> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, DocumentJsonValue>>)
    : null;
}

export function jsonRecords(
  value: DocumentJsonValue | undefined,
): readonly Readonly<Record<string, DocumentJsonValue>>[] {
  return Array.isArray(value)
    ? value.map(jsonRecord).filter((item) => item !== null)
    : [];
}

export function visibleText(value: DocumentJsonValue | undefined): string {
  if (value === undefined || value === null) return "Sin información";
  if (typeof value === "string") return value.trim() || "Sin información";
  if (typeof value === "number" || typeof value === "boolean") {
    return scalar(value);
  }
  if (Array.isArray(value)) {
    return value.map(visibleText).filter(Boolean).join("; ") || "Sin registros";
  }
  return Object.entries(value)
    .map(([key, item]) => `${label(key)}: ${visibleText(item)}`)
    .join("; ");
}

const UUID_TEXT =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu;

export function businessText(value: string): string {
  return value
    .replace(/\[PENDIENTE POR DEFINIR\]/giu, "")
    .replace(/\s*\((?:fuente|sourceIds?)\s*:\s*[0-9a-f-]{36}\)\.?/giu, "")
    .replace(
      /^\s*(?:fuente(?:\s+(?:única|primaria)(?:\s+de\s+referencia)?)?|sourceIds?)\s*:\s*[0-9a-f-]{36}\.?\s*$/gimu,
      "",
    )
    .replace(UUID_TEXT, "Fuente vinculada")
    .replace(/\b(?:según|documentado en)\s+la\s+fuente\b/giu, "")
    .replace(
      /\b(?:generad[oa]|elaborad[oa])\s+(?:con|por)\s+(?:la\s+)?IA\b[\s·,:;-]*/giu,
      "",
    )
    .replace(
      /\b(?:asistencia|apoyo)\s+(?:con|de)\s+(?:la\s+)?IA\b[\s·,:;-]*/giu,
      "",
    )
    .replace(/\bborrador\s+(?:con\s+)?IA\b[\s·,:;-]*/giu, "")
    .replace(/\brequiere\s+revisi[oó]n\s+humana\b[\s·,:;-]*/giu, "")
    .replace(/\s+([,.;:])/gu, "$1")
    .replace(/[ \t]{2,}/gu, " ")
    .trim();
}

export function businessValue(value: DocumentJsonValue | undefined): string {
  return businessText(visibleText(value));
}

export function optionalBusinessValue(
  value: DocumentJsonValue | undefined,
): string {
  const text = businessValue(value);
  return /^(?:Sin información|Sin registros)$/iu.test(text) ? "" : text;
}

// Regla de compactLines: solo descarta líneas que son ruido de plantilla
// (marcas de trazabilidad de IA, marcadores "pendiente por definir" aislados y
// rótulos vacíos sin hijos). NUNCA filtra por palabra (una línea que menciona
// "pendiente" es contenido legítimo) y NUNCA deduplica por texto en toda la
// sección: el mismo texto puede repetirse legítimamente entre Sprints, tareas
// o historias. Lo único que se colapsa son líneas consecutivas idénticas con el
// mismo nivel y la misma viñeta (duplicado accidental de la fuente).
export function compactLines(
  lines: readonly ExportContentLine[],
): readonly ExportContentLine[] {
  const result: ExportContentLine[] = [];
  for (const [index, line] of lines.entries()) {
    const text = businessText(line.text);
    if (!text) continue;
    if (
      /^(?:trazabilidad propuesta por ia|requiere revisión humana|fuente vinculada)\.?$/iu.test(
        text,
      )
    ) {
      continue;
    }
    if (
      /^(?:[^:]{1,80}:\s*)?(?:pendiente por definir|campos? obligatorios? por corregir)\.?$/iu.test(
        text,
      )
    ) {
      continue;
    }
    if (/^[^:]{1,80}:\s*$/u.test(text)) {
      // Un rótulo sin valor solo se descarta si no encabeza líneas hijas.
      const next = lines[index + 1];
      if (!next || next.level <= line.level) continue;
    }
    const previous = result.at(-1);
    if (
      previous &&
      previous.level === line.level &&
      previous.bullet === line.bullet &&
      previous.text === text
    ) {
      continue;
    }
    result.push({ ...line, text });
  }
  return result;
}

export function recordText(
  record: Readonly<Record<string, DocumentJsonValue>> | null,
  key: string,
): string | null {
  if (!record || !(key in record)) return null;
  const value = businessValue(record[key]);
  return value && value !== "Sin información" && value !== "Sin registros"
    ? value
    : null;
}

export function uniqueTexts(
  values: readonly (string | null | undefined)[],
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = value ? businessText(value) : "";
    if (!text) continue;
    const key = text.toLocaleLowerCase("es").replace(/\s+/gu, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

export function versionSection(
  input: RenderApprovedDocumentInput,
  key: DocumentVersionDetail["sections"][number]["key"],
): DocumentVersionDetail["sections"][number] | undefined {
  return input.version.sections.find((section) => section.key === key);
}

export function exportNumber(value: number | string): string {
  return String(value)
    .split(".")
    .map((part) => part.replace(/^0+(?=\d)/u, ""))
    .join(".");
}

export function exportSectionTitle(section: ExportDocumentSection): string {
  return section.number === 1 && !section.headingNumber
    ? "Objetivos"
    : section.title;
}

export function date(value: Date | string | null): string {
  if (!value) return "No registrada";
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Bogota",
  }).format(new Date(value));
}

export function shortDate(value: Date | string | null): string {
  if (!value) return "No registrada";
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeZone: "America/Bogota",
  }).format(new Date(value));
}
