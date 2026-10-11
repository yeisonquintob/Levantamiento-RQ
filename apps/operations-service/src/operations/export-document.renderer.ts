import {
  buildExportEpicTimeline,
  type ExportEpicTimeline,
} from "./export-work-plan";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  WidthType,
} from "docx";
import {
  PDFDocument,
  PageSizes,
  rgb,
  StandardFonts,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";

import type {
  DocumentTemplateLogo,
  DocumentJsonValue,
  DocumentVersionDetail,
  ProjectDetail,
  RequirementDocumentDetail,
} from "@levantamiento-rq/shared-contracts";
import {
  conciseFunctionalStoryDescription,
  layoutProcessFlow,
  type ProcessFlowLayoutResult,
} from "@levantamiento-rq/shared-contracts";

export interface RenderApprovedDocumentInput {
  project: ProjectDetail;
  document: RequirementDocumentDetail;
  version: DocumentVersionDetail;
  generatedAt: Date;
  templateLogo?: DocumentTemplateLogo | null;
  templateDescription?: string | null;
}

export interface RenderedExportArtifact {
  buffer: Buffer;
  mediaType: string;
  extension: "pdf" | "docx" | "md";
}

export interface ExportContentLine {
  text: string;
  level: number;
  bullet: boolean;
}

export interface ExportContentTable {
  title: string;
  headers: readonly string[];
  rows: readonly (readonly string[])[];
  columnWeights?: readonly number[];
}

export interface ExportFlowNode {
  id: string;
  label: string;
  kind: "START" | "ACTOR" | "PROCESS" | "DECISION" | "SYSTEM" | "END";
  laneId?: string | null;
}

export interface ExportFlowEdge {
  from: string;
  to: string;
  label: string | null;
}

export interface ExportFlowDiagram {
  title: string;
  nodes: readonly ExportFlowNode[];
  edges: readonly ExportFlowEdge[];
  objective?: string | null;
  lanes?: readonly ExportFlowLane[];
}

export interface ExportFlowLane {
  id: string;
  name: string;
  kind: "ACTOR" | "SYSTEM";
}

export interface ExportEntityAttribute {
  name: string;
  dataType: string;
  primaryKey: boolean;
  foreignKey: boolean;
  required: boolean;
}

export interface ExportEntityDefinition {
  id: string;
  name: string;
  attributes: readonly ExportEntityAttribute[];
}

export interface ExportEntityRelationship {
  from: string;
  to: string;
  cardinality: string;
  label: string;
}

export interface ExportEntityRelationshipDiagram {
  title: string;
  entities: readonly ExportEntityDefinition[];
  relationships: readonly ExportEntityRelationship[];
}

export interface ExportSectionPresentation {
  lines: readonly ExportContentLine[];
  flowSteps: readonly string[];
  tables: readonly ExportContentTable[];
  flowDiagram?: ExportFlowDiagram | null;
}

interface ExportObjectivesLayout {
  general: string;
  qualitative: readonly string[];
  quantitative: readonly string[];
}

interface ExportKpiCard {
  name: string;
  relatedObjective: string;
  measurement: string;
  target: string;
}

export interface ExportDocumentSection {
  number: number;
  // Número visible cuando las secciones vacías dejan huecos (p. ej. 8 → 11).
  displayNumber?: number;
  headingNumber?: string;
  title: string;
  lines: readonly ExportContentLine[];
  tables: readonly ExportContentTable[];
  objectivesLayout?: ExportObjectivesLayout | null;
  kpiCards?: readonly ExportKpiCard[];
  flowDiagram?: ExportFlowDiagram | null;
  entityRelationshipDiagram?: ExportEntityRelationshipDiagram | null;
}

type ExportPresentationProfile = "COMPACT" | "BALANCED" | "EXTENDED" | "ERP";

function presentationProfile(
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

function documentTemplateDescription(
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

function label(key: string): string {
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

const TEMPLATE_CONTROLLED_EXPORT_TEXT: Readonly<Record<string, string>> = {
  writingRules:
    "Contenido institucional controlado por la plantilla. Aplicar redacción clara, consistente, verificable, trazable y sin información inventada.",
  visualFormat:
    "Contenido institucional controlado por la plantilla. Mantener jerarquía visual, tablas compactas y diagramas legibles en los entregables.",
  automationInstruction:
    "Contenido institucional controlado por la plantilla. Conservar la estructura canónica para análisis, versionamiento y exportación controlada.",
};

function templatePlaceholderOnly(
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

function mermaidFlowSteps(source: string): string[] {
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

function jsonRecord(
  value: DocumentJsonValue | undefined,
): Readonly<Record<string, DocumentJsonValue>> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, DocumentJsonValue>>)
    : null;
}

function jsonRecords(
  value: DocumentJsonValue | undefined,
): readonly Readonly<Record<string, DocumentJsonValue>>[] {
  return Array.isArray(value)
    ? value.map(jsonRecord).filter((item) => item !== null)
    : [];
}

function visibleText(value: DocumentJsonValue | undefined): string {
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

function businessText(value: string): string {
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

function businessValue(value: DocumentJsonValue | undefined): string {
  return businessText(visibleText(value));
}

function optionalBusinessValue(value: DocumentJsonValue | undefined): string {
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

function recordText(
  record: Readonly<Record<string, DocumentJsonValue>> | null,
  key: string,
): string | null {
  if (!record || !(key in record)) return null;
  const value = businessValue(record[key]);
  return value && value !== "Sin información" && value !== "Sin registros"
    ? value
    : null;
}

function uniqueTexts(values: readonly (string | null | undefined)[]): string[] {
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

function structuredFlowDiagram(
  content: Readonly<Record<string, DocumentJsonValue>>,
): ExportFlowDiagram | null {
  const lanes = jsonRecords(content.lanes)
    .map((lane): ExportFlowLane | null => {
      const id = businessValue(lane.id);
      const name = businessValue(lane.name);
      const kind = businessValue(lane.kind).toUpperCase();
      return id && name
        ? { id, name, kind: kind === "SYSTEM" ? "SYSTEM" : "ACTOR" }
        : null;
    })
    .filter((lane) => lane !== null);
  const nodes = jsonRecords(content.nodes)
    .map((node): ExportFlowNode | null => {
      const id = businessValue(node.id);
      const nodeLabel = businessValue(node.label);
      const rawKind = businessValue(node.kind).toUpperCase();
      const kind = [
        "START",
        "ACTOR",
        "PROCESS",
        "DECISION",
        "SYSTEM",
        "END",
      ].includes(rawKind)
        ? (rawKind as ExportFlowNode["kind"])
        : "PROCESS";
      const laneId = recordText(node, "laneId");
      return id && nodeLabel ? { id, label: nodeLabel, kind, laneId } : null;
    })
    .filter((node) => node !== null);
  const ids = new Set(nodes.map((node) => node.id));
  const edges = jsonRecords(content.edges)
    .map((edge): ExportFlowEdge | null => {
      const from = businessValue(edge.from);
      const to = businessValue(edge.to);
      if (!ids.has(from) || !ids.has(to)) return null;
      const edgeLabel = edge.label === null ? null : businessValue(edge.label);
      return {
        from,
        to,
        label: edgeLabel && edgeLabel !== "Sin información" ? edgeLabel : null,
      };
    })
    .filter((edge) => edge !== null);
  if (nodes.length === 0 || edges.length === 0) return null;
  return {
    title: recordText(content, "title") ?? "Flujo funcional",
    nodes,
    edges,
    objective: recordText(content, "objective"),
    lanes,
  };
}

function structuredFlowSteps(
  content: Readonly<Record<string, DocumentJsonValue>>,
): readonly string[] {
  const nodes = jsonRecords(content.nodes);
  const edges = jsonRecords(content.edges);
  if (nodes.length === 0 || edges.length === 0) return [];
  const labels = new Map(
    nodes.map((node) => [visibleText(node.id), visibleText(node.label)]),
  );
  return edges.map((edge) => {
    const from = labels.get(visibleText(edge.from)) ?? visibleText(edge.from);
    const to = labels.get(visibleText(edge.to)) ?? visibleText(edge.to);
    const condition = edge.label === null ? "" : visibleText(edge.label);
    return condition && condition !== "Sin información"
      ? `${from} -> ${condition} -> ${to}`
      : `${from} -> ${to}`;
  });
}

function flowDiagramFromSteps(
  title: string,
  steps: readonly string[],
): ExportFlowDiagram | null {
  if (steps.length === 0) return null;
  const idByLabel = new Map<string, string>();
  const nodes: ExportFlowNode[] = [];
  const nodeId = (nodeLabel: string): string => {
    const normalized = businessText(nodeLabel);
    const existing = idByLabel.get(normalized);
    if (existing) return existing;
    const id = `node-${nodes.length + 1}`;
    idByLabel.set(normalized, id);
    nodes.push({
      id,
      label: normalized,
      kind: /^(?:inicio|start)$/iu.test(normalized)
        ? "START"
        : /^(?:fin|end)$/iu.test(normalized)
          ? "END"
          : /\?|validar|confirmar|existe|autorizad/iu.test(normalized)
            ? "DECISION"
            : "PROCESS",
    });
    return id;
  };
  const edges: ExportFlowEdge[] = [];
  for (const step of steps) {
    const parts = step
      .split(/\s*->\s*/u)
      .map(businessText)
      .filter(Boolean);
    if (parts.length < 2) continue;
    const from = nodeId(parts[0] ?? "");
    const to = nodeId(parts.at(-1) ?? "");
    edges.push({
      from,
      to,
      label: parts.length > 2 ? parts.slice(1, -1).join(" / ") : null,
    });
  }
  return edges.length ? { title, nodes, edges } : null;
}

function structuredMilestoneTables(
  content: Readonly<Record<string, DocumentJsonValue>>,
): readonly ExportContentTable[] {
  const features = jsonRecords(content.features);
  const stories = jsonRecords(content.userStories);
  if (features.length === 0 && stories.length === 0) return [];
  const tables: ExportContentTable[] = [];
  if (features.length > 0) {
    tables.push({
      title: "Mapa de Features",
      headers: [
        "Feature",
        "Descripción funcional",
        "Objetivo",
        "Alcance",
        "HU",
      ],
      columnWeights: [1.1, 2.1, 1.8, 2.1, 0.9],
      rows: features.map((feature) => [
        `${businessValue(feature.code)}\n${businessValue(feature.title)}`,
        businessValue(feature.description),
        businessValue(feature.objective),
        [
          optionalBusinessValue(feature.inScope)
            ? `Incluye: ${optionalBusinessValue(feature.inScope)}`
            : "",
          optionalBusinessValue(feature.outOfScope)
            ? `No incluye: ${optionalBusinessValue(feature.outOfScope)}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
        businessValue(feature.userStoryCodes),
      ]),
    });
  }
  if (stories.length > 0) {
    tables.push({
      title: "Historias de Usuario",
      headers: [
        "HU / Feature",
        "Título",
        "COMO / QUIERO / PARA",
        "Contexto y premisas",
      ],
      columnWeights: [0.9, 1.5, 2.8, 2.3],
      rows: stories.map((story) => [
        `${businessValue(story.code)}\n${businessValue(story.featureCode)}`,
        businessValue(story.title),
        `COMO: ${businessValue(story.role)}\nQUIERO: ${businessValue(story.want)}\nPARA: ${businessValue(story.benefit)}`,
        `${businessValue(story.context)}\nPremisas: ${businessValue(story.premises)}\nAplicaciones: ${businessValue(story.impactedSystems)}`,
      ]),
    });
    const criterionRows = stories.flatMap((story) =>
      jsonRecords(story.acceptanceCriteria).map((criterion) => [
        businessValue(story.code),
        businessValue(criterion.code),
        businessValue(criterion.given),
        businessValue(criterion.when),
        businessValue(criterion.then),
      ]),
    );
    if (criterionRows.length > 0) {
      tables.push({
        title: "Criterios de aceptación",
        headers: ["HU", "CA", "DADO", "CUANDO", "ENTONCES"],
        columnWeights: [0.65, 0.65, 2.1, 2.1, 2.5],
        rows: criterionRows,
      });
    }
    const fieldsByDefinition = new Map<
      string,
      {
        storyCodes: Set<string>;
        name: string;
        dataType: string;
        required: string;
        validation: string;
      }
    >();
    for (const story of stories) {
      const storyCode = businessValue(story.code);
      for (const field of jsonRecords(story.fields)) {
        const name = businessValue(field.name);
        const dataType = businessValue(field.dataType);
        const required = businessValue(field.required);
        const validation = businessValue(field.validation);
        const key = [name, dataType, required, validation]
          .join("|")
          .toLocaleLowerCase("es");
        const current = fieldsByDefinition.get(key) ?? {
          storyCodes: new Set<string>(),
          name,
          dataType,
          required,
          validation,
        };
        current.storyCodes.add(storyCode);
        fieldsByDefinition.set(key, current);
      }
    }
    const fieldRows = [...fieldsByDefinition.values()].map((field) => [
      [...field.storyCodes].join("; "),
      field.name,
      field.dataType,
      field.required,
      field.validation,
    ]);
    if (fieldRows.length > 0) {
      tables.push({
        title: "Datos y campos",
        headers: [
          "HU",
          "Campo",
          "Tipo",
          "Obligatorio",
          "Validación / observación",
        ],
        columnWeights: [0.65, 1.3, 0.9, 0.9, 3.1],
        rows: fieldRows,
      });
    }
  }
  return tables;
}

function requirementsGroupTables(
  content: Readonly<Record<string, DocumentJsonValue>>,
  milestoneRoots: readonly Readonly<Record<string, DocumentJsonValue>>[] = [],
): readonly ExportContentTable[] {
  const functionalRequirements = jsonRecords(content.functionalRequirements);
  const milestoneGroups = new Map<
    string,
    {
      code: string;
      title: string;
      description: string;
      pending: boolean;
      stories: Readonly<Record<string, DocumentJsonValue>>[];
    }
  >();

  for (const story of functionalRequirements) {
    const milestoneCode = optionalBusinessValue(story.milestone);
    const assignmentStatus = optionalBusinessValue(
      story.assignmentStatus,
    ).toUpperCase();
    const pending = assignmentStatus === "PENDING_ASSIGNMENT" || !milestoneCode;
    const key = pending ? "__PENDING__" : milestoneCode.toUpperCase();
    const current = milestoneGroups.get(key) ?? {
      code: pending ? "" : milestoneCode,
      title: pending
        ? "Historias pendientes por asignar"
        : optionalBusinessValue(story.functionality) || "Hito sin título",
      description: pending
        ? "Historias funcionales que todavía no tienen un hito confirmado."
        : optionalBusinessValue(story.milestoneDescription),
      pending,
      stories: [],
    };
    if (!current.description) {
      current.description = optionalBusinessValue(story.milestoneDescription);
    }
    current.stories.push(story);
    milestoneGroups.set(key, current);
  }

  milestoneRoots.forEach((root, index) => {
    const code = `H-${String(index + 1).padStart(3, "0")}`;
    const key = code.toUpperCase();
    if (milestoneGroups.has(key)) return;
    milestoneGroups.set(key, {
      code,
      title: optionalBusinessValue(root.title) || "Hito sin título",
      description: optionalBusinessValue(root.description),
      pending: false,
      stories: [],
    });
  });

  const milestoneNumber = (code: string): number => {
    const match = code.match(/(\d+)/u);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
  };
  const groups = [...milestoneGroups.values()].sort((left, right) => {
    if (left.pending !== right.pending) return left.pending ? 1 : -1;
    return (
      milestoneNumber(left.code) - milestoneNumber(right.code) ||
      left.code.localeCompare(right.code, "es")
    );
  });

  const criteriaText = (value: DocumentJsonValue | undefined): string => {
    if (!Array.isArray(value) || value.length === 0) {
      return "Sin criterios de aceptación definidos.";
    }
    return value
      .map((criterion, index) => {
        const record = jsonRecord(criterion);
        if (!record) return businessValue(criterion);
        const code = optionalBusinessValue(record.code) || `CA-${index + 1}`;
        const given = optionalBusinessValue(record.given);
        const when = optionalBusinessValue(record.when);
        const then = optionalBusinessValue(record.then);
        const statement = [
          given && `DADO: ${given}`,
          when && `CUANDO: ${when}`,
          then && `ENTONCES: ${then}`,
        ]
          .filter(Boolean)
          .join(" · ");
        return `${code}: ${statement || businessValue(record.description)}`;
      })
      .filter(Boolean)
      .join("\n");
  };

  const fieldsText = (value: DocumentJsonValue | undefined): string => {
    const fields = jsonRecords(value);
    if (fields.length === 0) return "Sin campos definidos.";
    return fields
      .map((field) => {
        const name = businessValue(field.name);
        const details = [
          optionalBusinessValue(field.dataType),
          optionalBusinessValue(field.required),
          optionalBusinessValue(field.validation),
        ].filter(Boolean);
        return details.length > 0 ? `${name}: ${details.join(" · ")}` : name;
      })
      .join("\n");
  };

  const functionalTables: ExportContentTable[] = groups.flatMap(
    (group, groupIndex) => {
      const groupNumber = `6.1.${groupIndex + 1}`;
      const groupLabel = group.pending
        ? `${groupNumber} ${group.title}`
        : `${groupNumber} Hito ${group.code} · ${group.title}`;
      const overview: ExportContentTable = {
        title: groupLabel,
        headers: ["Descripción del hito", "Historias relacionadas"],
        columnWeights: [5.5, 1.5],
        rows: [
          [
            group.description || "Sin descripción del hito definida.",
            `${group.stories.length} HU`,
          ],
        ],
      };
      const storyTables = group.stories.map<ExportContentTable>(
        (story, storyIndex) => {
          const code = businessValue(story.code);
          const title = businessValue(story.title);
          const role = optionalBusinessValue(story.role);
          const want = optionalBusinessValue(story.want);
          const benefit = optionalBusinessValue(story.benefit);
          const narrative = [
            role && `COMO: ${role}`,
            want && `QUIERO: ${want}`,
            benefit && `PARA: ${benefit}`,
          ]
            .filter(Boolean)
            .join("\n");
          return {
            title: `${groupNumber}.${storyIndex + 1} ${code} · ${title}`,
            headers: ["Información de la historia", "Detalle"],
            columnWeights: [1.55, 5.45],
            rows: [
              [
                "Descripción funcional breve",
                conciseFunctionalStoryDescription({
                  description: optionalBusinessValue(story.description),
                  title,
                  want,
                }),
              ],
              ["Historia de usuario", narrative || "Sin narrativa definida."],
              ["Contexto", businessValue(story.context)],
              ["Premisas", businessValue(story.premises)],
              ["Sistemas impactados", businessValue(story.impactedSystems)],
              ["Campos", fieldsText(story.fields)],
              [
                "Criterios de aceptación",
                criteriaText(story.acceptanceCriteria),
              ],
            ],
          };
        },
      );
      return [overview, ...storyTables];
    },
  );

  const nonFunctionalRequirements = jsonRecords(
    content.nonFunctionalRequirements,
  );
  const nonFunctionalTable: ExportContentTable = {
    title: "6.2 Requerimientos no funcionales",
    headers: [
      "Código",
      "Título",
      "Categoría",
      "Descripción",
      "Medida / objetivo",
    ],
    columnWeights: [0.8, 1.4, 1.2, 2.8, 1.8],
    rows: nonFunctionalRequirements.map((item) => [
      businessValue(item.code),
      businessValue(item.title),
      businessValue(item.category ?? item.requirementType),
      businessValue(item.description),
      [optionalBusinessValue(item.measure), optionalBusinessValue(item.target)]
        .filter(Boolean)
        .join(" / "),
    ]),
  };

  return [...functionalTables, nonFunctionalTable];
}

function backlogStructureTreeLines(
  content: Readonly<Record<string, DocumentJsonValue>>,
): readonly ExportContentLine[] {
  const epics = jsonRecords(content.epics);
  if (epics.length === 0) return [];

  const lines: ExportContentLine[] = [
    {
      text: "Esquema visual: Epics → Features → Historias de Usuario → Tareas.",
      level: 0,
      bullet: false,
    },
  ];

  const nodeText = (
    kind: "EPIC" | "FEATURE" | "HU" | "TAREA",
    node: Readonly<Record<string, DocumentJsonValue>>,
  ): string => {
    const code = optionalBusinessValue(node.code);
    const title =
      optionalBusinessValue(node.title) ||
      (kind === "TAREA" ? optionalBusinessValue(node.description) : "");
    return [kind, code, title].filter(Boolean).join(" · ");
  };

  const nodeDescription = (
    kind: "EPIC" | "FEATURE" | "HU",
    node: Readonly<Record<string, DocumentJsonValue>>,
  ): string => {
    const explicit =
      optionalBusinessValue(node.description) ||
      optionalBusinessValue(node.objective);
    if (explicit) return explicit;
    if (kind !== "HU") return "";
    const role = optionalBusinessValue(node.role);
    const want = optionalBusinessValue(node.want);
    const benefit = optionalBusinessValue(node.benefit);
    return [
      role ? `Como ${role}` : "",
      want ? `quiero ${want}` : "",
      benefit ? `para ${benefit}` : "",
    ]
      .filter(Boolean)
      .join(", ");
  };

  const appendDescription = (
    kind: "EPIC" | "FEATURE" | "HU",
    node: Readonly<Record<string, DocumentJsonValue>>,
    level: number,
  ): void => {
    const description = nodeDescription(kind, node);
    if (description) {
      lines.push({
        text: `Descripción: ${description}`,
        level,
        bullet: false,
      });
    }
  };

  const taskTypeLabel = (value: DocumentJsonValue | undefined): string => {
    const type = optionalBusinessValue(value).toUpperCase();
    return (
      {
        ANALYSIS: "Análisis",
        DESIGN: "Diseño",
        DEVELOPMENT: "Desarrollo",
        TESTING: "Pruebas",
        INTEGRATION: "Integración",
        CONFIGURATION: "Configuración",
      }[type] ?? optionalBusinessValue(value)
    );
  };

  for (const epic of epics) {
    lines.push({ text: nodeText("EPIC", epic), level: 0, bullet: true });
    appendDescription("EPIC", epic, 1);
    const features = jsonRecords(epic.features);
    for (const feature of features) {
      lines.push({
        text: nodeText("FEATURE", feature),
        level: 1,
        bullet: true,
      });
      appendDescription("FEATURE", feature, 2);
      const stories = jsonRecords(feature.userStories);
      for (const story of stories) {
        lines.push({ text: nodeText("HU", story), level: 2, bullet: true });
        appendDescription("HU", story, 3);
        const tasks = jsonRecords(story.tasks);
        for (const task of tasks) {
          const type = taskTypeLabel(task.type);
          const dependencies = optionalBusinessValue(task.dependencyCodes);
          const detail = [
            type ? `Tipo: ${type}` : "",
            dependencies ? `Depende de: ${dependencies}` : "Sin dependencias",
          ]
            .filter(Boolean)
            .join(" · ");
          lines.push({
            text: `${nodeText("TAREA", task)} (${detail})`,
            level: 3,
            bullet: true,
          });
        }
      }
    }
  }
  return lines;
}

function fallbackBacklogTreeLines(
  content: Readonly<Record<string, DocumentJsonValue>> | null,
): readonly ExportContentLine[] {
  if (!content) return [];
  const features = jsonRecords(content.features);
  const stories = jsonRecords(content.userStories);
  if (features.length === 0 && stories.length === 0) return [];

  const lines: ExportContentLine[] = [
    {
      text: "Esquema visual: Epics → Features → Historias de Usuario.",
      level: 0,
      bullet: false,
    },
    {
      text: "EPIC · EP-001 · Estructura funcional del proyecto",
      level: 0,
      bullet: true,
    },
    {
      text: "Descripción: Agrupa las capacidades funcionales documentadas para esta versión.",
      level: 1,
      bullet: false,
    },
  ];

  for (const [featureIndex, feature] of features.entries()) {
    const featureCode =
      optionalBusinessValue(feature.code) ||
      `FE-${String(featureIndex + 1).padStart(3, "0")}`;
    const featureTitle =
      optionalBusinessValue(feature.title) || "Funcionalidad documentada";
    lines.push({
      text: `FEATURE · ${featureCode} · ${featureTitle}`,
      level: 1,
      bullet: true,
    });
    const featureDescription =
      optionalBusinessValue(feature.description) ||
      optionalBusinessValue(feature.objective);
    if (featureDescription) {
      lines.push({
        text: `Descripción: ${featureDescription}`,
        level: 2,
        bullet: false,
      });
    }
    for (const story of stories.filter(
      (item) => optionalBusinessValue(item.featureCode) === featureCode,
    )) {
      lines.push({
        text: `HU · ${optionalBusinessValue(story.code)} · ${optionalBusinessValue(story.title)}`,
        level: 2,
        bullet: true,
      });
      const storyDescription =
        optionalBusinessValue(story.description) ||
        conciseFunctionalStoryDescription({
          description: optionalBusinessValue(story.description),
          title: optionalBusinessValue(story.title),
          want: optionalBusinessValue(story.want),
        });
      if (storyDescription) {
        lines.push({
          text: `Descripción: ${storyDescription}`,
          level: 3,
          bullet: false,
        });
      }
      const role = optionalBusinessValue(story.role);
      const want = optionalBusinessValue(story.want);
      const benefit = optionalBusinessValue(story.benefit);
      if (role || want || benefit) {
        lines.push({
          text: [
            role ? `COMO: ${role}` : "",
            want ? `QUIERO: ${want}` : "",
            benefit ? `PARA: ${benefit}` : "",
          ]
            .filter(Boolean)
            .join(" · "),
          level: 3,
          bullet: false,
        });
      }
      const acceptanceCriteria = jsonRecords(story.acceptanceCriteria);
      if (acceptanceCriteria.length > 0) {
        lines.push({
          text: "Criterios de aceptación:",
          level: 3,
          bullet: false,
        });
      }
      for (const criterion of acceptanceCriteria) {
        const code = optionalBusinessValue(criterion.code);
        const given = optionalBusinessValue(criterion.given);
        const when = optionalBusinessValue(criterion.when);
        const then = optionalBusinessValue(criterion.then);
        lines.push({
          text: `${code ? `${code}: ` : ""}DADO ${given} · CUANDO ${when} · ENTONCES ${then}`,
          level: 3,
          bullet: false,
        });
      }
    }
  }
  return lines;
}

function structuredActorsTable(
  content: Readonly<Record<string, DocumentJsonValue>>,
): ExportContentTable | null {
  const stories = jsonRecords(content.userStories);
  const rows = uniqueTexts(
    stories.map((story) => businessValue(story.role)),
  ).map((role) => {
    const responsibilities = uniqueTexts(
      stories
        .filter((story) => businessValue(story.role) === role)
        .map((story) => businessValue(story.want)),
    );
    return [role, responsibilities.join("; ")];
  });
  return rows.length
    ? {
        title: "Actores principales",
        headers: ["Rol", "Responsabilidad funcional"],
        columnWeights: [1.6, 4.4],
        rows,
      }
    : null;
}

function structuredIntegrationTable(
  content: Readonly<Record<string, DocumentJsonValue>>,
): ExportContentTable | null {
  const stories = jsonRecords(content.userStories);
  const systems = uniqueTexts(
    stories.flatMap((story) =>
      Array.isArray(story.impactedSystems)
        ? story.impactedSystems.map((item) => businessValue(item))
        : [businessValue(story.impactedSystems)],
    ),
  );
  return systems.length
    ? {
        title: "Aplicaciones e integraciones",
        headers: ["Sistema / aplicación", "Uso dentro del requerimiento"],
        columnWeights: [1.7, 4.3],
        rows: systems.map((system) => [
          system,
          uniqueTexts(
            stories
              .filter((story) =>
                businessValue(story.impactedSystems).includes(system),
              )
              .map((story) => businessValue(story.want)),
          ).join("; "),
        ]),
      }
    : null;
}

function structuredTestTables(
  content: Readonly<Record<string, DocumentJsonValue>>,
): readonly ExportContentTable[] {
  const scenarios = jsonRecords(content.scenarios);
  return scenarios.length
    ? [
        {
          title: "Matriz de pruebas",
          headers: [
            "Prueba",
            "Trazabilidad",
            "Precondición",
            "Acción",
            "Resultado esperado",
          ],
          columnWeights: [1.2, 1.1, 1.8, 1.8, 2.1],
          rows: scenarios.map((scenario) => [
            `${businessValue(scenario.code)}\n${businessValue(scenario.title)}`,
            `HU: ${businessValue(scenario.userStoryCodes)}\nCA: ${businessValue(scenario.acceptanceCriterionCodes)}\nTareas: ${businessValue(scenario.taskCodes)}`,
            businessValue(scenario.precondition),
            businessValue(scenario.action),
            businessValue(scenario.expectedResult),
          ]),
        },
      ]
    : [];
}

function structuredScrumLines(
  content: Readonly<Record<string, DocumentJsonValue>>,
): readonly ExportContentLine[] {
  const sprints = jsonRecords(content.sprints);
  if (sprints.length === 0) return [];
  const usesColombianBusinessCalendar =
    content.calendarMode === "COLOMBIA_BUSINESS_DAYS";
  const lines: ExportContentLine[] = [
    {
      text: usesColombianBusinessCalendar
        ? `Cadencia: ${visibleText(content.cadenceDays)} días hábiles · calendario Colombia · Inicio: ${visibleText(content.confirmedStartDate)}`
        : `Cadencia: ${visibleText(content.cadenceDays)} días calendario`,
      level: 0,
      bullet: false,
    },
  ];

  for (const [index, sprint] of sprints.entries()) {
    const number = optionalBusinessValue(sprint.number) || String(index + 1);
    const period = optionalBusinessValue(sprint.period);
    const tasks = jsonRecords(sprint.tasks);
    const featureCodes = businessValue(sprint.featureCodes);
    const storyCodes = businessValue(sprint.userStoryCodes);
    const deliverables = businessValue(sprint.deliverables);
    const testCodes = businessValue(sprint.testCodes);
    lines.push({
      text: `Sprint ${number}${period ? ` · ${period}` : ""}`,
      level: 0,
      bullet: false,
    });
    lines.push({
      text: `Objetivo: ${businessValue(sprint.objective)}`,
      level: 1,
      bullet: true,
    });
    lines.push({
      text: `Alcance: ${featureCodes || "Sin Feature asignada"}${storyCodes ? ` · HU: ${storyCodes}` : ""}`,
      level: 1,
      bullet: true,
    });
    lines.push({
      text: `Trabajo previsto: ${tasks.length} tarea(s)${testCodes ? ` · Pruebas: ${testCodes}` : ""}`,
      level: 1,
      bullet: true,
    });
    lines.push({
      text: `Entregable: ${deliverables || "Por definir"}`,
      level: 1,
      bullet: true,
    });
    lines.push({
      text: `Criterio de cierre: ${businessValue(sprint.closingCriterion)}`,
      level: 1,
      bullet: true,
    });
  }
  return lines;
}

export function sectionPresentation(
  section: DocumentVersionDetail["sections"][number],
): ExportSectionPresentation {
  if (templatePlaceholderOnly(section)) {
    return {
      lines: [
        {
          text:
            TEMPLATE_CONTROLLED_EXPORT_TEXT[section.key] ??
            "Contenido institucional controlado por la plantilla.",
          level: 0,
          bullet: false,
        },
      ],
      flowSteps: [],
      tables: [],
    };
  }

  if (section.key === "header") {
    const content = jsonRecord(section.content);
    const visibleHeader = content
      ? Object.fromEntries(
          [
            "title",
            "projectCode",
            "documentVersion",
            "createdDate",
            "requestingArea",
            "status",
          ].flatMap((key) =>
            content[key] === undefined ? [] : [[key, content[key]]],
          ),
        )
      : typeof section.content === "string"
        ? section.content
            .split(/\r?\n/u)
            .filter(
              (line) =>
                !/^\s*(?:elaborado|preparado|revisado|aprobado)\s+por\s*:/iu.test(
                  line,
                ),
            )
            .join("\n")
        : section.content;
    return {
      lines: compactLines(flattenDocumentContent(visibleHeader)),
      flowSteps: [],
      tables: [],
    };
  }

  if (section.key === "processFlow" && typeof section.content === "string") {
    const match = section.content.match(/```mermaid\s*([\s\S]*?)```/iu);

    if (match) {
      const code = match[1] ?? "";
      const before = section.content
        .slice(0, match.index ?? 0)
        .trim()
        .replace(
          /flowchart\s*\(mermaid\)\s*representado\s*a\s*partir\s*de\s*la\s*fuente\s*:?\s*$/iu,
          "",
        )
        .trim();

      const after = section.content
        .slice((match.index ?? 0) + match[0].length)
        .trim();

      const narrative = [before, after].filter(Boolean).join("\n");

      return {
        lines: narrative ? compactLines(flattenDocumentContent(narrative)) : [],
        flowSteps: mermaidFlowSteps(code),
        tables: [],
        flowDiagram: flowDiagramFromSteps(
          "Flujo funcional",
          mermaidFlowSteps(code),
        ),
      };
    }

    if (/^\s*(?:flowchart|graph)\b/iu.test(section.content)) {
      return {
        lines: [],
        flowSteps: mermaidFlowSteps(section.content),
        tables: [],
        flowDiagram: flowDiagramFromSteps(
          "Flujo funcional",
          mermaidFlowSteps(section.content),
        ),
      };
    }
  }

  const content = jsonRecord(section.content);
  if (content) {
    if (section.key === "solutionProposal") {
      const visibleContent = { ...content };
      delete visibleContent.prototypeMarkdown;
      return {
        lines: compactLines(flattenDocumentContent(visibleContent)),
        flowSteps: [],
        tables: [],
      };
    }
    if (section.key === "processFlow") {
      return {
        lines: content.title
          ? compactLines(flattenDocumentContent(content.title))
          : [],
        flowSteps: structuredFlowSteps(content),
        tables: [],
        flowDiagram: structuredFlowDiagram(content),
      };
    }
    if (
      section.key === "milestones" &&
      (content.features || content.userStories)
    ) {
      return {
        lines: [],
        flowSteps: [],
        tables: structuredMilestoneTables(content),
      };
    }
    if (
      section.key === "milestones" &&
      (content.functionalRequirements || content.nonFunctionalRequirements)
    ) {
      return {
        lines: [],
        flowSteps: [],
        tables: requirementsGroupTables(content),
      };
    }
    if (section.key === "backlogStructure" && content.epics) {
      return {
        lines: backlogStructureTreeLines(content),
        flowSteps: [],
        tables: [],
      };
    }
    if (section.key === "tests" && content.scenarios) {
      return {
        lines: [],
        flowSteps: [],
        tables: structuredTestTables(content),
      };
    }
    if (section.key === "scrumPlan" && content.sprints) {
      return {
        lines: structuredScrumLines(content),
        flowSteps: [],
        tables: [],
      };
    }
  }

  return {
    lines: compactLines(flattenDocumentContent(section.content)),
    flowSteps: [],
    tables: [],
  };
}

function versionSection(
  input: RenderApprovedDocumentInput,
  key: DocumentVersionDetail["sections"][number]["key"],
): DocumentVersionDetail["sections"][number] | undefined {
  return input.version.sections.find((section) => section.key === key);
}

function prototypeDescriptionLines(
  input: RenderApprovedDocumentInput,
): readonly ExportContentLine[] {
  const content = jsonRecord(
    versionSection(input, "solutionProposal")?.content,
  );
  const markdown = content?.prototypeMarkdown;
  if (typeof markdown !== "string" || !markdown.trim()) return [];

  const description =
    optionalBusinessValue(content?.description) ||
    optionalBusinessValue(content?.objective) ||
    "La especificación define el propósito, los módulos, la navegación, las pantallas, los datos, las reglas, las integraciones y los criterios necesarios para implementar y validar el prototipo.";

  const coveredAreas = uniqueTexts(
    markdown
      .split(/\r?\n/gu)
      .map((line) => line.match(/^#{1,4}\s+(.+)$/u)?.[1]?.trim() ?? "")
      .filter(Boolean),
  ).slice(0, 8);

  return [
    {
      text: "Descripción del prototipo",
      level: 0,
      bullet: false,
    },
    { text: description, level: 1, bullet: true },
    ...(coveredAreas.length > 0
      ? [
          {
            text: `Cobertura de la especificación: ${coveredAreas.join("; ")}.`,
            level: 1,
            bullet: true,
          } satisfies ExportContentLine,
        ]
      : []),
  ];
}

function presentationFor(
  input: RenderApprovedDocumentInput,
  key: DocumentVersionDetail["sections"][number]["key"],
): ExportSectionPresentation {
  const section = versionSection(input, key);
  return section
    ? sectionPresentation(section)
    : { lines: [], flowSteps: [], tables: [], flowDiagram: null };
}

function tableByTitle(
  presentation: ExportSectionPresentation,
  title: string,
): ExportContentTable[] {
  return presentation.tables.filter((table) => table.title === title);
}

function requirementTables(
  input: RenderApprovedDocumentInput,
  includeCriteria: boolean,
): ExportContentTable[] {
  if (input.version.requirements.length === 0) return [];
  if (includeCriteria) {
    const rows = input.version.requirements.flatMap((requirement) =>
      requirement.acceptanceCriteria.map((criterion, index) => [
        requirement.code,
        `CA${String(index + 1).padStart(2, "0")}`,
        businessText(criterion.description),
      ]),
    );
    return rows.length
      ? [
          {
            title: "Criterios asociados a requerimientos",
            headers: ["Requerimiento", "CA", "Condición verificable"],
            columnWeights: [1.1, 0.65, 5.25],
            rows,
          },
        ]
      : [];
  }
  return [
    {
      title: "Requerimientos funcionales",
      headers: ["Código", "Título", "Descripción"],
      columnWeights: [0.9, 2.1, 4],
      rows: input.version.requirements.map((requirement) => [
        requirement.code,
        businessText(requirement.title),
        businessText(requirement.description),
      ]),
    },
  ];
}

function approvalTables(input: RenderApprovedDocumentInput): {
  approvals: ExportContentTable[];
  changes: ExportContentTable[];
} {
  const approvalContent = jsonRecord(
    versionSection(input, "approvalsAndChangeControl")?.content,
  );
  const people = jsonRecords(approvalContent?.approvals);
  const approvals: ExportContentTable[] = [
    {
      title: "Responsables y decisión",
      headers: ["Actividad", "Responsable", "Cargo / estado", "Fecha"],
      columnWeights: [1.1, 2.2, 2.2, 1.3],
      rows: people.map((person) => [
        businessValue(person.responsibility),
        businessValue(person.name),
        `${businessValue(person.position)}\n${businessValue(person.status)}`,
        businessValue(person.approvalMoment),
      ]),
    },
  ];
  const changes = jsonRecords(approvalContent?.changeControl).slice(-1);
  const changeRows = changes.map((change) => [
    businessValue(change.version),
    businessValue(change.date),
    businessValue(change.description ?? change.change),
    businessValue(change.approvedBy),
  ]);
  return {
    approvals,
    changes: [
      {
        title: "Control de cambios",
        headers: ["Versión", "Fecha", "Modificación", "Aprobó el cambio"],
        columnWeights: [0.9, 1.2, 3.7, 1.8],
        rows: changeRows,
      },
    ],
  };
}

function nonFunctionalTable(
  input: RenderApprovedDocumentInput,
): ExportContentTable | null {
  const content = jsonRecord(
    versionSection(input, "nonFunctionalRequirements")?.content,
  );
  if (!content) return null;
  const rows = Object.entries(content)
    .map(([key, value]) => [label(key), businessValue(value)])
    .filter(([, value]) => Boolean(value));
  return rows.length
    ? {
        title: "6.2 Requerimientos no funcionales",
        headers: ["Atributo", "Condición"],
        columnWeights: [1.5, 5.5],
        rows,
      }
    : null;
}

function processModelLines(
  flow: Readonly<Record<string, DocumentJsonValue>> | null,
): ExportContentLine[] {
  if (!flow) return [];
  const lines: ExportContentLine[] = [];
  const objective = recordText(flow, "objective");
  if (objective) {
    lines.push({ text: `Objetivo: ${objective}`, level: 0, bullet: false });
  }
  for (const [key, heading] of [
    ["problems", "Problemas identificados"],
    ["improvements", "Mejoras del proceso"],
    ["expectedResults", "Resultados esperados"],
  ] as const) {
    const values = Array.isArray(flow[key])
      ? flow[key].map((item) => businessValue(item))
      : [];
    if (values.length === 0) continue;
    lines.push({ text: heading, level: 0, bullet: false });
    lines.push(
      ...values.map((text) => ({ text, level: 1, bullet: true as const })),
    );
  }
  return lines;
}

function processLaneTable(
  flow: Readonly<Record<string, DocumentJsonValue>> | null,
): ExportContentTable[] {
  const lanes = jsonRecords(flow?.lanes);
  return lanes.length > 0
    ? [
        {
          title: "Actores y sistemas del flujo",
          headers: ["Carril", "Tipo"],
          columnWeights: [4.5, 1.5],
          rows: lanes.map((lane) => [
            businessValue(lane.name),
            businessValue(lane.kind) === "SYSTEM" ? "Sistema" : "Actor",
          ]),
        },
      ]
    : [];
}

function entityRelationshipDiagram(
  model: Readonly<Record<string, DocumentJsonValue>> | null,
): ExportEntityRelationshipDiagram | null {
  if (!model) return null;
  const entities = jsonRecords(model.entities)
    .map((entity): ExportEntityDefinition | null => {
      const id = businessValue(entity.id);
      const name = businessValue(entity.name);
      if (!id || !name) return null;
      return {
        id,
        name,
        attributes: jsonRecords(entity.attributes)
          .map((attribute): ExportEntityAttribute | null => {
            const attributeName = businessValue(attribute.name);
            if (!attributeName) return null;
            return {
              name: attributeName,
              dataType: businessValue(attribute.dataType),
              primaryKey: attribute.primaryKey === true,
              foreignKey: attribute.foreignKey === true,
              required: attribute.required === true,
            };
          })
          .filter((attribute) => attribute !== null),
      };
    })
    .filter((entity) => entity !== null);
  const ids = new Set(entities.map((entity) => entity.id));
  const relationships = jsonRecords(model.relationships)
    .map((relationship): ExportEntityRelationship | null => {
      const from = businessValue(relationship.from);
      const to = businessValue(relationship.to);
      if (!ids.has(from) || !ids.has(to)) return null;
      return {
        from,
        to,
        cardinality: businessValue(relationship.cardinality),
        label: businessValue(relationship.label),
      };
    })
    .filter((relationship) => relationship !== null);
  return entities.length > 0
    ? {
        title: recordText(model, "title") ?? "Modelo entidad-relación",
        entities,
        relationships,
      }
    : null;
}

function entityRelationshipTables(
  model: Readonly<Record<string, DocumentJsonValue>> | null,
): ExportContentTable[] {
  if (!model) return [];
  const entities = jsonRecords(model.entities);
  const entityNames = new Map(
    entities.map((entity) => [
      businessValue(entity.id),
      businessValue(entity.name),
    ]),
  );
  const tables: ExportContentTable[] = [];
  const attributeRows = entities.flatMap((entity) => {
    const attributes = jsonRecords(entity.attributes);
    if (attributes.length === 0) {
      return [
        [
          businessValue(entity.name),
          businessValue(entity.description),
          "Sin atributos sustentados",
          "",
          "",
        ],
      ];
    }
    return attributes.map((attribute) => [
      businessValue(entity.name),
      businessValue(entity.description),
      businessValue(attribute.name),
      businessValue(attribute.dataType),
      [
        attribute.primaryKey === true ? "PK" : "",
        attribute.foreignKey === true ? "FK" : "",
        attribute.required === true ? "Obligatorio" : "Opcional",
      ]
        .filter(Boolean)
        .join(" · "),
    ]);
  });
  if (attributeRows.length > 0) {
    tables.push({
      title: recordText(model, "title") ?? "Entidades y atributos",
      headers: ["Entidad", "Descripción", "Atributo", "Tipo", "Clave / regla"],
      columnWeights: [1.2, 2.2, 1.4, 1, 1.2],
      rows: attributeRows,
    });
  }
  const relationships = jsonRecords(model.relationships);
  if (relationships.length > 0) {
    tables.push({
      title: "Relaciones y cardinalidades",
      headers: [
        "Entidad origen",
        "Relación",
        "Cardinalidad",
        "Entidad destino",
      ],
      columnWeights: [1.6, 2.2, 1, 1.6],
      rows: relationships.map((relationship) => [
        entityNames.get(businessValue(relationship.from)) ??
          businessValue(relationship.from),
        businessValue(relationship.label),
        businessValue(relationship.cardinality),
        entityNames.get(businessValue(relationship.to)) ??
          businessValue(relationship.to),
      ]),
    });
  }
  return tables;
}

function exportStringItems(value: DocumentJsonValue | undefined): string[] {
  if (Array.isArray(value)) {
    return uniqueTexts(value.map((item) => optionalBusinessValue(item)));
  }

  if (typeof value === "string") {
    return uniqueTexts(
      businessText(value)
        .split(/\s*(?:\r?\n+|[;•▪◦])\s*/gu)
        .map((item) =>
          item.replace(/^\s*(?:[-–—*]|\d{1,2}[.)])\s*/u, "").trim(),
        )
        .filter(Boolean),
    );
  }

  return [];
}

function isQuantitativeExportObjective(value: string): boolean {
  return /(?:\d+(?:[.,]\d+)?\s*(?:%|por\s+ciento|d[ií]as?|semanas?|meses?|a[nñ]os?|horas?|minutos?|segundos?|solicitudes?|registros?|usuarios?|casos?|errores?|cop|usd)|(?:reducir|aumentar|alcanzar|lograr|mantener|atender|procesar)\b[^.]{0,120}\d|porcentaje|cantidad|tasa|promedio|meta\s+de)/iu.test(
    value,
  );
}

function exportObjectivesLayout(
  input: RenderApprovedDocumentInput,
): ExportObjectivesLayout {
  const section = versionSection(input, "objectives");
  const content = jsonRecord(section?.content);

  if (!content) {
    const general = section ? optionalBusinessValue(section.content) : "";

    return {
      general,
      qualitative: [],
      quantitative: [],
    };
  }

  const explicitQualitative = exportStringItems(
    content.qualitative ?? content.qualitativeObjectives,
  );
  const explicitQuantitative = exportStringItems(
    content.quantitative ?? content.quantitativeObjectives,
  );
  const legacySpecific = exportStringItems(
    content.specific ?? content.specificObjectives,
  );

  const classifiedLegacy = legacySpecific.reduce(
    (result, objective) => {
      if (isQuantitativeExportObjective(objective)) {
        result.quantitative.push(objective);
      } else {
        result.qualitative.push(objective);
      }
      return result;
    },
    {
      qualitative: [] as string[],
      quantitative: [] as string[],
    },
  );

  const qualitative = uniqueTexts([
    ...explicitQualitative,
    ...classifiedLegacy.qualitative,
  ]);
  const quantitative = uniqueTexts([
    ...explicitQuantitative,
    ...classifiedLegacy.quantitative,
  ]);

  return {
    general:
      recordText(content, "general") ??
      recordText(content, "generalObjective") ??
      "",
    qualitative,
    quantitative,
  };
}

function exportKpiCards(
  input: RenderApprovedDocumentInput,
): readonly ExportKpiCard[] {
  const scope = jsonRecord(versionSection(input, "scope")?.content);
  if (!scope) return [];

  return jsonRecords(scope.kpis)
    .slice(0, 3)
    .map((kpi) => ({
      name: recordText(kpi, "name") ?? "",
      relatedObjective: recordText(kpi, "relatedObjective") ?? "",
      measurement: recordText(kpi, "measurement") ?? "",
      target: recordText(kpi, "target") ?? "",
    }))
    .filter((kpi) =>
      [kpi.name, kpi.relatedObjective, kpi.measurement, kpi.target].some(
        Boolean,
      ),
    );
}

function scopeLinesWithoutKpis(
  input: RenderApprovedDocumentInput,
  fallback: readonly ExportContentLine[],
): readonly ExportContentLine[] {
  const scope = jsonRecord(versionSection(input, "scope")?.content);

  if (!scope || !("kpis" in scope)) {
    return compactLines(fallback);
  }

  const content: Record<string, DocumentJsonValue> = {};

  for (const [key, value] of Object.entries(scope)) {
    if (key !== "kpis") {
      content[key] = value;
    }
  }

  return compactLines(flattenDocumentContent(content));
}

export function buildExportDocumentSections(
  input: RenderApprovedDocumentInput,
): readonly ExportDocumentSection[] {
  const scope = presentationFor(input, "scope");
  const solution = presentationFor(input, "solutionProposal");
  const objectivesLayout = exportObjectivesLayout(input);
  const kpiCards = exportKpiCards(input);
  const scopeLines = scopeLinesWithoutKpis(input, scope.lines);
  const problem = presentationFor(input, "problemDescription");
  const flow = presentationFor(input, "processFlow");
  const flowSectionContent = versionSection(input, "processFlow")?.content;
  const flowRoot = jsonRecord(flowSectionContent);
  const processFlows = jsonRecord(flowRoot?.processFlows);
  const historicalFlow = !processFlows;
  const asIsFlow = processFlows ? jsonRecord(processFlows.asIs) : flowRoot;
  const toBeFlow = processFlows ? jsonRecord(processFlows.toBe) : null;
  const entityRelationship = processFlows
    ? jsonRecord(flowRoot?.entityRelationship)
    : null;
  const milestones = presentationFor(input, "milestones");
  const backlog = presentationFor(input, "backlogStructure");
  const backlogContent = jsonRecord(
    versionSection(input, "backlogStructure")?.content,
  );
  const hasBacklogTree = jsonRecords(backlogContent?.epics).length > 0;
  const tests = presentationFor(input, "tests");
  const assumptions = presentationFor(input, "assumptionsDependenciesPending");
  const scrum = presentationFor(input, "scrumPlan");
  const milestoneContent = jsonRecord(
    versionSection(input, "milestones")?.content,
  );
  const schemeLines = hasBacklogTree
    ? compactLines(backlog.lines)
    : fallbackBacklogTreeLines(milestoneContent);
  const milestoneTables =
    milestoneContent &&
    (milestoneContent.functionalRequirements ||
      milestoneContent.nonFunctionalRequirements)
      ? requirementsGroupTables(
          milestoneContent,
          jsonRecords(backlogContent?.epics),
        )
      : milestones.tables;
  const actors = milestoneContent
    ? structuredActorsTable(milestoneContent)
    : null;
  const integrations = milestoneContent
    ? structuredIntegrationTable(milestoneContent)
    : null;
  const nonFunctional = nonFunctionalTable(input);
  const groupedFunctionalTables = milestoneTables.filter((table) =>
    /^6\.1(?:\.|\s)/u.test(table.title),
  );
  const groupedNonFunctionalTables = milestoneTables.filter((table) =>
    /^6\.2(?:\.|\s)/u.test(table.title),
  );
  const functionalRequirementTables =
    groupedFunctionalTables.length > 0
      ? groupedFunctionalTables
      : requirementTables(input, false).map((table) => ({
          ...table,
          title: "Resumen de requerimientos funcionales",
        }));
  const nonFunctionalRequirementTables =
    groupedNonFunctionalTables.length > 0
      ? groupedNonFunctionalTables.map((table) => ({
          ...table,
          title: "Matriz de requerimientos no funcionales",
        }))
      : nonFunctional
        ? [
            {
              ...nonFunctional,
              title: "Matriz de requerimientos no funcionales",
            },
          ]
        : [];
  const structuredFields = tableByTitle(milestones, "Datos y campos");
  // La sección incluye "pendientes": no se filtra por palabra.
  const assumptionLines = compactLines(assumptions.lines);
  const approval = approvalTables(input);
  const sections: ExportDocumentSection[] = [
    {
      number: 1,
      title: "Objetivo",
      lines: [],
      tables: [],
      objectivesLayout,
    },
    {
      number: 2,
      title: "Contexto y problema",
      lines: compactLines(problem.lines),
      tables: actors ? [actors] : [],
    },
    {
      number: 3,
      title: "Alcance",
      lines: scopeLines,
      tables: [],
      kpiCards,
    },
    {
      number: 4,
      title: "Solución propuesta del profesional de soluciones",
      lines: [
        ...compactLines(solution.lines),
        ...prototypeDescriptionLines(input),
      ],
      tables: [],
    },
    {
      number: 5,
      title: "Diagramas",
      lines: [
        {
          text: "Modelos del proceso y de la información incluidos en esta versión.",
          level: 0,
          bullet: false,
        },
      ],
      tables: [],
    },
    {
      number: 5,
      headingNumber: "5.1",
      title: "Flujo AS-IS",
      lines: historicalFlow
        ? compactLines(flow.lines)
        : processModelLines(asIsFlow),
      tables: processLaneTable(asIsFlow),
      flowDiagram: historicalFlow
        ? (flow.flowDiagram ??
          flowDiagramFromSteps("Flujo AS-IS", flow.flowSteps))
        : asIsFlow
          ? structuredFlowDiagram(asIsFlow)
          : null,
    },
    {
      number: 5,
      headingNumber: "5.2",
      title: "Flujo TO-BE",
      lines: toBeFlow
        ? processModelLines(toBeFlow)
        : [
            {
              text: "No existe flujo TO-BE en esta versión histórica.",
              level: 0,
              bullet: false,
            },
          ],
      tables: processLaneTable(toBeFlow),
      flowDiagram: toBeFlow ? structuredFlowDiagram(toBeFlow) : null,
    },
    {
      number: 5,
      headingNumber: "5.3",
      title: "Modelo entidad-relación",
      lines: entityRelationship
        ? []
        : [
            {
              text: "No existe modelo entidad-relación en esta versión histórica.",
              level: 0,
              bullet: false,
            },
          ],
      tables: entityRelationshipTables(entityRelationship),
      entityRelationshipDiagram: entityRelationshipDiagram(entityRelationship),
    },
    {
      number: 6,
      title: "Requerimientos",
      lines: [
        {
          text: "Los requerimientos se presentan por bloques para conservar la relación entre cada Hito y sus Historias de Usuario.",
          level: 0,
          bullet: false,
        },
      ],
      tables: [],
    },
    {
      number: 6,
      headingNumber: "6.1",
      title: "Requerimientos funcionales",
      lines:
        milestones.lines.length > 0
          ? compactLines(milestones.lines)
          : [
              {
                text: "Cada bloque contiene el código, título y descripción del Hito, seguido por el contenido completo de sus Historias de Usuario.",
                level: 0,
                bullet: false,
              },
            ],
      tables: functionalRequirementTables,
    },
    {
      number: 6,
      headingNumber: "6.2",
      title: "Requerimientos no funcionales",
      lines: [],
      tables: nonFunctionalRequirementTables,
    },
    {
      number: 7,
      title: "Esquema",
      lines: schemeLines,
      tables: [],
    },
    {
      number: 8,
      title: "Pruebas",
      lines: compactLines(tests.lines),
      tables: tests.tables,
    },
    {
      number: 9,
      title: "Datos, campos e integraciones",
      lines: [],
      tables: [...structuredFields, ...(integrations ? [integrations] : [])],
    },
    {
      number: 11,
      title: "Supuestos y dependencias",
      lines: assumptionLines,
      tables: [],
    },
    {
      number: 12,
      title: "Aprobación",
      lines:
        input.version.status === "APPROVED"
          ? []
          : [
              {
                text: "La versión aún no ha sido aprobada.",
                level: 0,
                bullet: false,
              },
            ],
      tables: input.version.status === "APPROVED" ? approval.approvals : [],
    },
    {
      number: 13,
      title: "Control de cambios",
      lines: approval.changes.some((table) => table.rows.length > 0)
        ? []
        : [
            {
              text: "No hay cambios registrados en esta versión.",
              level: 0,
              bullet: false,
            },
          ],
      // Una tabla sin filas solo dejaba el encabezado y una página vacía.
      tables: approval.changes.filter((table) => table.rows.length > 0),
    },
  ];
  if (versionSection(input, "scrumPlan")) {
    sections.push({
      number: 14,
      title: "Plan Scrum",
      lines: compactLines(scrum.lines),
      tables: [],
    });
  }
  const visible = sections.filter(
    (section) =>
      section.number <= 5 ||
      (section.number >= 6 && section.number <= 8) ||
      section.number >= 10 ||
      section.lines.length > 0 ||
      section.tables.length > 0 ||
      Boolean(section.flowDiagram) ||
      Boolean(section.entityRelationshipDiagram),
  );
  // AI_EXPORT_CONSECUTIVE_SECTION_NUMBERS_V1
  // Las secciones opcionales sin contenido (p. ej. "Datos, campos e
  // integraciones") no se exportan; la numeración visible de las siguientes
  // debe seguir siendo consecutiva (8 → 9, no 8 → 11).
  let nextDisplayNumber = 9;
  const displayByNumber = new Map<number, number>();
  return visible.map((section) => {
    if (section.number < 9) return section;
    let display = displayByNumber.get(section.number);
    if (display === undefined) {
      display = nextDisplayNumber;
      nextDisplayNumber += 1;
      displayByNumber.set(section.number, display);
    }
    return display === section.number
      ? section
      : { ...section, displayNumber: display };
  });
}

function exportNumber(value: number | string): string {
  return String(value)
    .split(".")
    .map((part) => part.replace(/^0+(?=\d)/u, ""))
    .join(".");
}

function exportSectionTitle(section: ExportDocumentSection): string {
  return section.number === 1 && !section.headingNumber
    ? "Objetivos"
    : section.title;
}

const NAVI_DOCUMENT_FONT = "Inter";

const NAVI_DOCUMENT_COLORS = {
  text: "363534",
  muted: "637077",
  border: "C3CAC8",
  institutional: "354550",
  operation: "675579",
  surfaceSoft: "F7F8F8",
  white: "FFFFFF",
} as const;

const NAVI_DOCUMENT_PDF_COLORS = {
  text: [0.212, 0.208, 0.204],
  muted: [0.388, 0.439, 0.467],
  border: [0.765, 0.792, 0.784],
  institutional: [0.208, 0.271, 0.314],
  operation: [0.404, 0.333, 0.475],
  surfaceSoft: [0.969, 0.973, 0.973],
  white: [1, 1, 1],
} as const satisfies Readonly<
  Record<string, readonly [number, number, number]>
>;

type ExportHeadingKind = "section" | "subsection";

function ensureSubtitleColon(value: string): string {
  const text = businessText(value).replace(/[.:]\s*$/u, "");
  return `${text}:`;
}

function numberedSectionLines(
  section: ExportDocumentSection,
): readonly ExportContentLine[] {
  const base = exportNumber(
    section.headingNumber ?? section.displayNumber ?? section.number,
  );
  let subsection = 0;
  let item = 0;

  return section.lines.map((line, index) => {
    const text = businessText(line.text);
    const next = section.lines[index + 1];
    const hasChildren =
      Boolean(next) &&
      ((next?.level ?? 0) > line.level || Boolean(next?.bullet));

    const isSubtitle =
      !line.bullet && line.level === 0 && hasChildren && !/:\s+\S/u.test(text);

    if (isSubtitle) {
      subsection += 1;
      item = 0;
      return {
        ...line,
        text: `${base}.${subsection}. ${ensureSubtitleColon(text)}`,
        bullet: false,
      };
    }

    if (line.bullet && subsection > 0) {
      item += 1;
      return {
        ...line,
        text: `${base}.${subsection}.${item}. ${text}`,
        level: Math.max(1, line.level),
        bullet: false,
      };
    }

    return { ...line, text };
  });
}

function exportLineHeadingDepth(line: ExportContentLine): number | null {
  if (line.level !== 0 || line.bullet) return null;
  const match = businessText(line.text).match(/^(\d+(?:\.\d+)+)\.\s+\S/u);
  return match?.[1] ? match[1].split(".").length : null;
}

type ExportTreeNodeKind = "EPIC" | "FEATURE" | "HU" | "TAREA";

function exportTreeNodeKind(
  line: ExportContentLine,
): ExportTreeNodeKind | null {
  if (!line.bullet) return null;
  return (
    (line.text.match(/^(EPIC|FEATURE|HU|TAREA)\s+·\s+/u)?.[1] as
      ExportTreeNodeKind | undefined) ?? null
  );
}

function exportTreeNodeBody(line: ExportContentLine): string {
  return businessText(line.text).replace(
    /^(?:EPIC|FEATURE|HU|TAREA)\s+·\s+/u,
    "",
  );
}

function date(value: Date | string | null): string {
  if (!value) return "No registrada";
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Bogota",
  }).format(new Date(value));
}

function shortDate(value: Date | string | null): string {
  if (!value) return "No registrada";
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeZone: "America/Bogota",
  }).format(new Date(value));
}

function corporateMetadata(
  input: RenderApprovedDocumentInput,
): readonly (readonly [string, string])[] {
  const header = jsonRecord(versionSection(input, "header")?.content);
  const headerValue = (key: string, fallback: string): string =>
    recordText(header, key) ?? fallback;
  return [
    ["Título", headerValue("title", input.document.title)],
    ["Código", headerValue("projectCode", input.project.code)],
    ["Versión", headerValue("documentVersion", input.version.version)],
    ["Fecha", headerValue("createdDate", shortDate(input.version.createdAt))],
    [
      "Área solicitante",
      headerValue("requestingArea", input.project.requestingArea),
    ],
    ["Estado", headerValue("status", input.version.status)],
  ];
}

function docxRuns(
  text: string,
  options: {
    bold?: boolean;
    color?: string;
    size?: number;
    italics?: boolean;
  } = {},
): TextRun[] {
  const value = businessText(text);
  return value
    .split(/(\bPendiente\b)/giu)
    .filter(Boolean)
    .map(
      (part) =>
        new TextRun({
          text: part,
          bold: options.bold,
          color:
            options.color ??
            (options.bold
              ? NAVI_DOCUMENT_COLORS.institutional
              : NAVI_DOCUMENT_COLORS.text),
          font: NAVI_DOCUMENT_FONT,
          size: options.size,
          italics: options.italics,
          underline: /^Pendiente$/iu.test(part)
            ? { type: UnderlineType.SINGLE }
            : undefined,
        }),
    );
}

function docxMetadata(input: RenderApprovedDocumentInput): Table {
  const items = corporateMetadata(input);
  const pairs: Array<
    readonly [
      readonly [string, string] | undefined,
      readonly [string, string] | undefined,
    ]
  > = [
    [items[0], items[1]],
    [items[2], items[3]],
    [items[4], items[5]],
  ];
  const border = {
    style: BorderStyle.SINGLE,
    size: 4,
    color: NAVI_DOCUMENT_COLORS.border,
  };
  const card = (item: readonly [string, string] | undefined): TableCell => {
    const [key, value] = item ?? ["", ""];
    return new TableCell({
      width: { size: 50, type: WidthType.PERCENTAGE },
      shading: { fill: NAVI_DOCUMENT_COLORS.surfaceSoft },
      borders: {
        top: border,
        bottom: border,
        left: border,
        right: border,
      },
      margins: {
        top: 110,
        bottom: 110,
        left: 140,
        right: 140,
      },
      children: [
        new Paragraph({
          spacing: { before: 0, after: 35 },
          children: docxRuns(key.toUpperCase(), {
            bold: true,
            color: NAVI_DOCUMENT_COLORS.muted,
            size: 16,
          }),
        }),
        new Paragraph({
          spacing: { before: 0, after: 0 },
          children: docxRuns(value, {
            bold: true,
            color: NAVI_DOCUMENT_COLORS.text,
            size: 18,
          }),
        }),
      ],
    });
  };

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: pairs.map(
      ([left, right]) =>
        new TableRow({
          children: [card(left), card(right)],
        }),
    ),
  });
}

function docxObjectivesLayout(
  layout: ExportObjectivesLayout,
): Array<Paragraph | Table> {
  const border = {
    style: BorderStyle.SINGLE,
    size: 4,
    color: NAVI_DOCUMENT_COLORS.border,
  };

  const objectiveCell = (title: string, values: readonly string[]): TableCell =>
    new TableCell({
      width: { size: 50, type: WidthType.PERCENTAGE },
      shading: { fill: NAVI_DOCUMENT_COLORS.surfaceSoft },
      borders: {
        top: border,
        bottom: border,
        left: border,
        right: border,
      },
      margins: {
        top: 100,
        bottom: 100,
        left: 130,
        right: 130,
      },
      children: [
        new Paragraph({
          spacing: { before: 0, after: 70 },
          children: docxRuns(title, {
            bold: true,
            color: NAVI_DOCUMENT_COLORS.institutional,
            size: 18,
          }),
        }),
        ...values.map(
          (objective, index) =>
            new Paragraph({
              spacing: { before: 0, after: 55 },
              children: docxRuns(`${index + 1}. ${objective}`, {
                color: NAVI_DOCUMENT_COLORS.text,
                size: 18,
              }),
            }),
        ),
      ],
    });

  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      keepNext: true,
      spacing: { before: 20, after: 45 },
      children: docxRuns("1.1. Objetivo general:", {
        bold: true,
        color: NAVI_DOCUMENT_COLORS.operation,
        size: 24,
      }),
    }),
    new Paragraph({
      spacing: { before: 0, after: 100 },
      children: docxRuns(layout.general, {
        color: NAVI_DOCUMENT_COLORS.text,
        size: 18,
      }),
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_3,
      keepNext: true,
      spacing: { before: 20, after: 55 },
      children: docxRuns("1.1.1. Objetivos específicos:", {
        bold: true,
        color: NAVI_DOCUMENT_COLORS.operation,
        size: 22,
      }),
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            objectiveCell("Cualitativos", layout.qualitative),
            objectiveCell("Cuantitativos", layout.quantitative),
          ],
        }),
      ],
    }),
  ];
}

function docxKpiCards(
  cards: readonly ExportKpiCard[],
  sectionNumber: number,
): Array<Paragraph | Table> {
  if (cards.length === 0) return [];

  const border = {
    style: BorderStyle.SINGLE,
    size: 4,
    color: NAVI_DOCUMENT_COLORS.border,
  };

  const card = (item: ExportKpiCard): TableCell =>
    new TableCell({
      width: {
        size: Math.round(100 / cards.length),
        type: WidthType.PERCENTAGE,
      },
      shading: { fill: NAVI_DOCUMENT_COLORS.surfaceSoft },
      borders: {
        top: border,
        bottom: border,
        left: border,
        right: border,
      },
      margins: {
        top: 95,
        bottom: 95,
        left: 110,
        right: 110,
      },
      children: [
        new Paragraph({
          spacing: { before: 0, after: 55 },
          children: docxRuns(item.name, {
            bold: true,
            color: NAVI_DOCUMENT_COLORS.institutional,
            size: 17,
          }),
        }),
        new Paragraph({
          spacing: { before: 0, after: 45 },
          children: [
            new TextRun({
              text: `Inicio 0%  ░░░░░░░░░░  Meta ${item.target}`,
              bold: true,
              color: NAVI_DOCUMENT_COLORS.operation,
              font: NAVI_DOCUMENT_FONT,
              size: 18,
            }),
          ],
        }),
        new Paragraph({
          spacing: { before: 0, after: 35 },
          children: [
            new TextRun({
              text: "Cálculo: ",
              bold: true,
              color: NAVI_DOCUMENT_COLORS.muted,
              font: NAVI_DOCUMENT_FONT,
              size: 16,
            }),
            ...docxRuns(item.measurement, {
              color: NAVI_DOCUMENT_COLORS.text,
              size: 16,
            }),
          ],
        }),
      ],
    });

  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      keepNext: true,
      spacing: { before: 120, after: 65 },
      children: docxRuns(`${exportNumber(sectionNumber)}.4. KPIs de estado:`, {
        bold: true,
        color: NAVI_DOCUMENT_COLORS.operation,
        size: 22,
      }),
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: cards.map(card),
        }),
      ],
    }),
  ];
}

function docxContentTable(
  table: ExportContentTable,
  nested = false,
): Array<Paragraph | Table> {
  const weights =
    table.columnWeights?.length === table.headers.length
      ? table.columnWeights
      : table.headers.map(() => 1);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const cell = (value: string, index: number, header: boolean): TableCell =>
    new TableCell({
      width: {
        size: Math.round(((weights[index] ?? 1) / totalWeight) * 100),
        type: WidthType.PERCENTAGE,
      },
      shading: header
        ? { fill: NAVI_DOCUMENT_COLORS.institutional }
        : undefined,
      // Un salto de línea dentro de la celda es un párrafo propio: un TextRun
      // con "\n" lo colapsaba en un espacio en Word.
      children: (value.split(/\r?\n/u).filter((part) => part.trim()).length > 0
        ? value.split(/\r?\n/u).filter((part) => part.trim())
        : [""]
      ).map(
        (part) =>
          new Paragraph({
            spacing: { after: 40 },
            children: docxRuns(part, {
              bold: header,
              color: header
                ? NAVI_DOCUMENT_COLORS.white
                : NAVI_DOCUMENT_COLORS.text,
              size: header ? 16 : 18,
            }),
          }),
      ),
    });
  return [
    new Paragraph({
      heading: nested ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_2,
      keepNext: true,
      spacing: nested ? { before: 120, after: 70 } : { before: 180, after: 90 },
      children: docxRuns(table.title, {
        bold: true,
        color: NAVI_DOCUMENT_COLORS.operation,
        size: nested ? 20 : 22,
      }),
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          tableHeader: true,
          children: table.headers.map((value, index) =>
            cell(value, index, true),
          ),
        }),
        ...table.rows.map(
          (row) =>
            new TableRow({
              children: row.map((value, index) => cell(value, index, false)),
            }),
        ),
      ],
    }),
  ];
}

const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

// RQ_EXPORT_BRAND_AND_ER_V2
interface RasterDimensions {
  width: number;
  height: number;
}

function templateLogoDimensions(
  data: Buffer,
  mediaType: DocumentTemplateLogo["mediaType"],
): RasterDimensions {
  if (
    mediaType === "image/png" &&
    data.length >= 24 &&
    data.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
  ) {
    const width = data.readUInt32BE(16);
    const height = data.readUInt32BE(20);

    if (width > 0 && height > 0) {
      return { width, height };
    }
  }

  if (
    mediaType === "image/jpeg" &&
    data.length >= 4 &&
    data[0] === 0xff &&
    data[1] === 0xd8
  ) {
    let offset = 2;

    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) {
        offset += 1;
        continue;
      }

      const marker = data[offset + 1] ?? 0;

      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }

      const blockLength = data.readUInt16BE(offset + 2);

      if (blockLength < 2 || offset + 2 + blockLength > data.length) {
        break;
      }

      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      ) {
        const height = data.readUInt16BE(offset + 5);
        const width = data.readUInt16BE(offset + 7);

        if (width > 0 && height > 0) {
          return { width, height };
        }
      }

      offset += 2 + blockLength;
    }
  }

  return {
    width: 320,
    height: 120,
  };
}

function fitTemplateLogo(
  data: Buffer,
  mediaType: DocumentTemplateLogo["mediaType"],
  maxWidth: number,
  maxHeight: number,
): RasterDimensions {
  const sourceSize = templateLogoDimensions(data, mediaType);

  const scale = Math.min(
    maxWidth / sourceSize.width,
    maxHeight / sourceSize.height,
  );

  return {
    width: Math.max(1, Math.round(sourceSize.width * scale)),
    height: Math.max(1, Math.round(sourceSize.height * scale)),
  };
}

function exportXmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function erSvgText(value: string, maximumCharacters: number): string {
  const normalized = value.trim();

  if (normalized.length <= maximumCharacters) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(1, maximumCharacters - 1))}…`;
}

function svgTextLines(
  value: string,
  maximumCharacters: number,
  maximumLines: number,
): readonly string[] {
  const words = value.trim().split(/\s+/u).filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const current = lines.at(-1);
    if (!current || current.length + word.length + 1 > maximumCharacters) {
      if (lines.length >= maximumLines) {
        const last = lines.at(-1) ?? "";
        lines[lines.length - 1] =
          `${last.slice(0, Math.max(1, maximumCharacters - 1))}…`;
        break;
      }
      lines.push(word);
    } else {
      lines[lines.length - 1] = `${current} ${word}`;
    }
  }
  return lines.length > 0 ? lines : [value.trim()];
}

function flowDiagramDepths(diagram: ExportFlowDiagram): Map<string, number> {
  const ids = diagram.nodes.map((node) => node.id);
  const indegree = new Map(ids.map((id) => [id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of diagram.edges) {
    if (!indegree.has(edge.from) || !indegree.has(edge.to)) continue;
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  }
  const queue = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  const depths = new Map(ids.map((id) => [id, 0]));
  const visited = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) break;
    visited.add(id);
    for (const to of outgoing.get(id) ?? []) {
      depths.set(to, Math.max(depths.get(to) ?? 0, (depths.get(id) ?? 0) + 1));
      indegree.set(to, (indegree.get(to) ?? 1) - 1);
      if (indegree.get(to) === 0) queue.push(to);
    }
  }
  ids.forEach((id, index) => {
    if (!visited.has(id)) depths.set(id, Math.max(depths.get(id) ?? 0, index));
  });
  return depths;
}

function renderSwimlaneFlowSvg(diagram: ExportFlowDiagram): {
  svg: string;
  width: number;
  height: number;
} {
  const lanes =
    diagram.lanes && diagram.lanes.length > 0
      ? diagram.lanes
      : [{ id: "flow", name: "Flujo del proceso", kind: "ACTOR" as const }];
  const laneHeight = 112;
  const laneLabelWidth = 190;
  const nodeWidth = 184;
  const nodeHeight = 82;
  const stageWidth = 224;
  const padding = 30;
  const depths = flowDiagramDepths(diagram);
  const laneIndexById = new Map(lanes.map((lane, index) => [lane.id, index]));
  const positions = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();
  let maximumDepth = 0;
  for (const node of diagram.nodes) {
    const depth = depths.get(node.id) ?? 0;
    maximumDepth = Math.max(maximumDepth, depth);
    const laneIndex = laneIndexById.get(node.laneId ?? "") ?? 0;
    positions.set(node.id, {
      x: laneLabelWidth + padding + nodeWidth / 2 + depth * stageWidth,
      y: laneIndex * laneHeight + laneHeight / 2,
      width: nodeWidth,
      height: node.kind === "DECISION" ? 90 : nodeHeight,
    });
  }
  const width = Math.max(
    760,
    laneLabelWidth + padding * 2 + nodeWidth + maximumDepth * stageWidth,
  );
  const height = Math.max(260, lanes.length * laneHeight);
  const markerId = "rq-docx-swimlane-arrow";
  const laneColors = ["#356f98", "#566c7e", "#927649", "#527779", "#3e5d72"];
  const kindLabels: Readonly<Record<ExportFlowNode["kind"], string>> = {
    START: "Inicio",
    ACTOR: "Actor",
    PROCESS: "Proceso",
    DECISION: "Decisión",
    SYSTEM: "Sistema",
    END: "Fin",
  };
  const nodeColors: Readonly<
    Record<ExportFlowNode["kind"], { fill: string; stroke: string }>
  > = {
    START: { fill: "#eef4eb", stroke: "#66784c" },
    ACTOR: { fill: "#f1f6fa", stroke: "#2f6fa3" },
    PROCESS: { fill: "#ffffff", stroke: "#4f6675" },
    DECISION: { fill: "#fff7e8", stroke: "#c97828" },
    SYSTEM: { fill: "#f4f1f7", stroke: "#675579" },
    END: { fill: "#eef4eb", stroke: "#66784c" },
  };
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${exportXmlEscape(diagram.title)}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<title>${exportXmlEscape(diagram.title)}</title>`,
    `<defs><marker id="${markerId}" markerWidth="12" markerHeight="12" refX="10.5" refY="6" orient="auto" markerUnits="userSpaceOnUse" viewBox="0 0 12 12"><path d="M 0 0 L 12 6 L 0 12 L 3 6 z" fill="#415d6b"/></marker></defs>`,
  ];
  lanes.forEach((lane, index) => {
    const y = index * laneHeight;
    const center = y + laneHeight / 2;
    const lines = svgTextLines(lane.name, 23, 3);
    const startY = center - (lines.length - 1) * 7 - 8;
    const laneColor = laneColors[index % laneColors.length] ?? laneColors[0];
    parts.push(
      `<rect x="0" y="${y}" width="${width}" height="${laneHeight}" fill="${lane.kind === "SYSTEM" ? "#f5f3ef" : "#edf3f6"}" stroke="#c3cac8" stroke-width="1"/>`,
      `<rect x="0" y="${y}" width="${laneLabelWidth}" height="${laneHeight}" fill="${laneColor}"/>`,
      `<text x="${laneLabelWidth / 2}" y="${startY}" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#ffffff">${lines.map((line, lineIndex) => `<tspan x="${laneLabelWidth / 2}" y="${startY + lineIndex * 14}">${exportXmlEscape(line)}</tspan>`).join("")}</text>`,
      `<text x="${laneLabelWidth / 2}" y="${center + 27}" text-anchor="middle" font-family="Arial, sans-serif" font-size="9" font-weight="600" fill="#eaf0f3">${lane.kind === "SYSTEM" ? "Sistema" : "Actor"}</text>`,
    );
  });
  for (const edge of diagram.edges) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) continue;
    const x1 = from.x + from.width / 2;
    const y1 = from.y;
    const x2 = to.x - to.width / 2;
    const y2 = to.y;
    const middle = x2 > x1 ? (x1 + x2) / 2 : Math.max(x1, x2) + 45;
    parts.push(
      `<path d="M ${x1} ${y1} L ${middle} ${y1} L ${middle} ${y2} L ${x2} ${y2}" fill="none" stroke="#415d6b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#${markerId})"/>`,
    );
    if (edge.label) {
      const label =
        edge.label.length > 26 ? `${edge.label.slice(0, 25)}…` : edge.label;
      const labelWidth = Math.min(170, Math.max(48, label.length * 6 + 18));
      parts.push(
        `<g transform="translate(${middle} ${(y1 + y2) / 2})"><rect x="${-labelWidth / 2}" y="-11" width="${labelWidth}" height="22" rx="11" fill="#ffffff" stroke="#d6dcda"/><text y="1" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="9" font-weight="700" fill="#415d6b">${exportXmlEscape(label)}</text></g>`,
      );
    }
  }
  for (const node of diagram.nodes) {
    const position = positions.get(node.id);
    if (!position) continue;
    const colors = nodeColors[node.kind];
    const lines = svgTextLines(node.label, 28, 4);
    const labelStartY = 9 - (lines.length - 1) * 7;
    const transform = `translate(${position.x} ${position.y})`;
    parts.push(`<g transform="${transform}">`);
    if (node.kind === "DECISION") {
      parts.push(
        `<polygon points="0,${-position.height / 2} ${position.width / 2},0 0,${position.height / 2} ${-position.width / 2},0" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="1.4"/>`,
      );
    } else {
      parts.push(
        `<rect x="${-position.width / 2}" y="${-position.height / 2}" width="${position.width}" height="${position.height}" rx="${node.kind === "START" || node.kind === "END" ? position.height / 2 : 10}" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="1.4"/>`,
      );
    }
    parts.push(
      `<text x="0" y="${-position.height / 2 + 17}" text-anchor="middle" font-family="Arial, sans-serif" font-size="8" font-weight="700" fill="#637077">${kindLabels[node.kind]}</text>`,
      `<text x="0" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="#363534">${lines.map((line, lineIndex) => `<tspan x="0" y="${labelStartY + lineIndex * 14}">${exportXmlEscape(line)}</tspan>`).join("")}</text>`,
      `</g>`,
    );
  }
  parts.push("</svg>");
  return { svg: parts.join(""), width, height };
}

function fitDiagramDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maximumWidth: number,
  maximumHeight: number,
): { width: number; height: number } {
  const scale = Math.min(
    maximumWidth / Math.max(sourceWidth, 1),
    maximumHeight / Math.max(sourceHeight, 1),
  );
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

function renderEntityRelationshipSvg(
  diagram: ExportEntityRelationshipDiagram,
): {
  svg: string;
  width: number;
  height: number;
} {
  const columns = Math.min(
    3,
    Math.max(1, Math.ceil(Math.sqrt(diagram.entities.length))),
  );

  const rows = Math.ceil(diagram.entities.length / columns);

  const boxWidth = 260;
  const gapX = 90;
  const gapY = 85;
  const padding = 34;
  const titleHeight = 58;

  const visibleAttributeCount = Math.max(
    1,
    ...diagram.entities.map((entity) => Math.min(entity.attributes.length, 8)),
  );

  const boxHeight = 78 + visibleAttributeCount * 24;

  const width =
    padding * 2 + columns * boxWidth + Math.max(0, columns - 1) * gapX;

  const height =
    titleHeight +
    padding +
    rows * boxHeight +
    Math.max(0, rows - 1) * gapY +
    padding;

  const positions = new Map<
    string,
    {
      x: number;
      y: number;
      width: number;
      height: number;
    }
  >();

  diagram.entities.forEach((entity, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);

    positions.set(entity.id, {
      x: padding + column * (boxWidth + gapX),
      y: titleHeight + padding + row * (boxHeight + gapY),
      width: boxWidth,
      height: boxHeight,
    });
  });

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="#FFFFFF"/>`,
    `<text x="${padding}" y="34" font-family="Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="20" font-weight="700" fill="#354550">${exportXmlEscape(diagram.title)}</text>`,
  ];

  for (const relationship of diagram.relationships) {
    const from = positions.get(relationship.from);

    const to = positions.get(relationship.to);

    if (!from || !to) {
      continue;
    }

    const fromCenterX = from.x + from.width / 2;

    const fromCenterY = from.y + from.height / 2;

    const toCenterX = to.x + to.width / 2;

    const toCenterY = to.y + to.height / 2;

    const horizontal =
      Math.abs(toCenterX - fromCenterX) >= Math.abs(toCenterY - fromCenterY);

    const startX = horizontal
      ? toCenterX >= fromCenterX
        ? from.x + from.width
        : from.x
      : fromCenterX;

    const startY = horizontal
      ? fromCenterY
      : toCenterY >= fromCenterY
        ? from.y + from.height
        : from.y;

    const endX = horizontal
      ? toCenterX >= fromCenterX
        ? to.x
        : to.x + to.width
      : toCenterX;

    const endY = horizontal
      ? toCenterY
      : toCenterY >= fromCenterY
        ? to.y
        : to.y + to.height;

    parts.push(
      `<line x1="${startX}" y1="${startY}" x2="${endX}" y2="${endY}" stroke="#4F6675" stroke-width="1.8"/>`,
    );

    const relationshipText =
      `${relationship.cardinality} · ${relationship.label}`.slice(0, 52);

    const relationshipWidth = Math.max(58, relationshipText.length * 6.2 + 14);

    const middleX = (startX + endX) / 2;

    const middleY = (startY + endY) / 2;

    parts.push(
      `<rect x="${middleX - relationshipWidth / 2}" y="${middleY - 10}" rx="8" width="${relationshipWidth}" height="20" fill="#FFFFFF" stroke="#C3CAC8"/>`,
      `<text x="${middleX}" y="${middleY + 4}" text-anchor="middle" font-family="Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="10" font-weight="700" fill="#675579">${exportXmlEscape(relationshipText)}</text>`,
    );
  }

  for (const entity of diagram.entities) {
    const position = positions.get(entity.id);

    if (!position) {
      continue;
    }

    parts.push(
      `<rect x="${position.x}" y="${position.y}" width="${position.width}" height="${position.height}" rx="12" fill="#FFFFFF" stroke="#675579" stroke-width="1.8"/>`,
      `<rect x="${position.x}" y="${position.y}" width="${position.width}" height="48" rx="12" fill="#F7F8F8"/>`,
      `<line x1="${position.x}" y1="${position.y + 48}" x2="${position.x + position.width}" y2="${position.y + 48}" stroke="#675579" stroke-width="1.2"/>`,
      `<text x="${position.x + 16}" y="${position.y + 31}" font-family="Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="16" font-weight="700" fill="#354550">${exportXmlEscape(entity.name)}</text>`,
    );

    const attributes = entity.attributes.slice(0, 8);

    attributes.forEach((attribute, index) => {
      const y = position.y + 74 + index * 24;

      const key = [
        attribute.primaryKey ? "PK" : "",
        attribute.foreignKey ? "FK" : "",
      ]
        .filter(Boolean)
        .join("/");

      const prefix = key ? `${key} · ` : attribute.required ? "* " : "";

      const attributeName = erSvgText(`${prefix}${attribute.name}`, 25);

      const dataType = erSvgText(attribute.dataType || "string", 16);

      parts.push(
        `<text x="${position.x + 16}" y="${y}" font-family="Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="11" font-weight="${key ? "700" : "400"}" fill="#363534">${exportXmlEscape(attributeName)}</text>`,
        `<text x="${position.x + position.width - 16}" y="${y}" text-anchor="end" font-family="Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="10" fill="#637077">${exportXmlEscape(dataType)}</text>`,
      );
    });

    if (entity.attributes.length > attributes.length) {
      const additional = entity.attributes.length - attributes.length;

      parts.push(
        `<text x="${position.x + 16}" y="${position.y + position.height - 12}" font-family="Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="9" fill="#637077">+ ${additional} atributos en la tabla detallada</text>`,
      );
    }
  }

  parts.push("</svg>");

  return {
    svg: parts.join(""),
    width,
    height,
  };
}

function docxHeader(input: RenderApprovedDocumentInput): Header {
  const logoBytes = input.templateLogo?.dataBase64
    ? Buffer.from(input.templateLogo.dataBase64, "base64")
    : null;

  const logoSize =
    logoBytes && input.templateLogo
      ? fitTemplateLogo(logoBytes, input.templateLogo.mediaType, 132, 46)
      : null;

  const noBorder = {
    style: BorderStyle.NONE,
    size: 0,
    color: "FFFFFF",
  };

  const tableBorders = {
    top: noBorder,
    bottom: noBorder,
    left: noBorder,
    right: noBorder,
    insideHorizontal: noBorder,
    insideVertical: noBorder,
  };

  const cellBorders = {
    top: noBorder,
    bottom: noBorder,
    left: noBorder,
    right: noBorder,
  };

  return new Header({
    children: [
      new Table({
        width: {
          size: 10800,
          type: WidthType.DXA,
        },
        columnWidths: [2600, 8200],
        borders: tableBorders,
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: {
                  size: 2600,
                  type: WidthType.DXA,
                },
                borders: cellBorders,
                children: [
                  new Paragraph({
                    spacing: {
                      before: 0,
                      after: 0,
                    },
                    children:
                      logoBytes && logoSize && input.templateLogo
                        ? [
                            new ImageRun({
                              type:
                                input.templateLogo.mediaType === "image/png"
                                  ? "png"
                                  : "jpg",
                              data: logoBytes,
                              transformation: logoSize,
                              altText: {
                                title: "Logo de plantilla",
                                description: input.templateLogo.fileName,
                                name: "Logo",
                              },
                            }),
                          ]
                        : [
                            new TextRun({
                              text: "",
                              font: NAVI_DOCUMENT_FONT,
                            }),
                          ],
                  }),
                ],
              }),

              new TableCell({
                width: {
                  size: 8200,
                  type: WidthType.DXA,
                },
                borders: cellBorders,
                children: [
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    spacing: {
                      before: 0,
                      after: 0,
                    },
                    children: [
                      new TextRun({
                        text: "LEVANTAMIENTO DE REQUERIMIENTOS SOLUCIONES TIC",
                        bold: true,
                        color: NAVI_DOCUMENT_COLORS.institutional,
                        font: NAVI_DOCUMENT_FONT,
                        size: 16,
                      }),
                    ],
                  }),

                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    spacing: {
                      before: 20,
                      after: 0,
                    },
                    children: [
                      new TextRun({
                        text: input.project.code,
                        color: NAVI_DOCUMENT_COLORS.muted,
                        font: NAVI_DOCUMENT_FONT,
                        size: 14,
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),

      new Paragraph({
        border: {
          bottom: {
            color: NAVI_DOCUMENT_COLORS.border,
            size: 8,
            style: BorderStyle.SINGLE,
            space: 4,
          },
        },
        spacing: {
          before: 20,
          after: 0,
        },
        children: [],
      }),
    ],
  });
}

async function exportFlowLayout(
  diagram: ExportFlowDiagram,
): Promise<ProcessFlowLayoutResult | null> {
  try {
    return await layoutProcessFlow(diagram);
  } catch (error: unknown) {
    globalThis.console.warn(
      "[process-flow] ELK no pudo organizar la exportación; se conserva el formato anterior.",
      error instanceof Error ? error.message : "Error desconocido",
    );
    return null;
  }
}

async function docxSectionContent(
  input: RenderApprovedDocumentInput,
): Promise<Array<Paragraph | Table>> {
  const children: Array<Paragraph | Table> = [];
  const profile = presentationProfile(input);
  for (const section of buildExportDocumentSections(input)) {
    const headingKind: ExportHeadingKind = section.headingNumber
      ? "subsection"
      : "section";
    const isSubsection = headingKind === "subsection";
    const headingNumber = exportNumber(
      section.headingNumber ?? section.displayNumber ?? section.number,
    );
    const headingTitle = exportSectionTitle(section);

    children.push(
      new Paragraph({
        heading: isSubsection ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_1,
        pageBreakBefore:
          profile !== "COMPACT" &&
          !isSubsection &&
          [5, 12].includes(section.number),
        border: {
          bottom: {
            color: NAVI_DOCUMENT_COLORS.border,
            size: isSubsection ? 3 : 5,
            style: BorderStyle.SINGLE,
            space: 3,
          },
        },
        spacing: isSubsection
          ? { before: 140, after: 70 }
          : { before: 260, after: 110 },
        children: [
          new TextRun({
            text: isSubsection
              ? `${headingNumber}. ${headingTitle}`
              : `${headingNumber} ${headingTitle.toUpperCase()}`,
            bold: true,
            color: isSubsection
              ? NAVI_DOCUMENT_COLORS.operation
              : NAVI_DOCUMENT_COLORS.institutional,
            font: NAVI_DOCUMENT_FONT,
            size: isSubsection ? 24 : 27,
          }),
        ],
      }),
    );

    if (section.objectivesLayout) {
      children.push(...docxObjectivesLayout(section.objectivesLayout));
    } else {
      for (const line of numberedSectionLines(section)) {
        const lineHeadingDepth = exportLineHeadingDepth(line);
        const isLineHeading = lineHeadingDepth !== null;
        const treeNodeKind = exportTreeNodeKind(line);
        const isTreeParent = treeNodeKind !== null && treeNodeKind !== "TAREA";
        children.push(
          new Paragraph({
            keepNext: isTreeParent,
            keepLines: treeNodeKind !== null,
            indent: { left: line.level * 240 },
            bullet:
              line.bullet && !treeNodeKind
                ? { level: Math.min(line.level, 2) }
                : undefined,
            spacing: isLineHeading
              ? { before: 100, after: 60 }
              : treeNodeKind
                ? { before: treeNodeKind === "EPIC" ? 90 : 20, after: 45 }
                : { after: 70 },
            children: treeNodeKind
              ? [
                  new TextRun({
                    text: ` ${treeNodeKind} `,
                    bold: true,
                    color: NAVI_DOCUMENT_COLORS.white,
                    shading: {
                      fill:
                        treeNodeKind === "EPIC"
                          ? NAVI_DOCUMENT_COLORS.institutional
                          : treeNodeKind === "FEATURE"
                            ? NAVI_DOCUMENT_COLORS.operation
                            : NAVI_DOCUMENT_COLORS.muted,
                    },
                    font: NAVI_DOCUMENT_FONT,
                    size: treeNodeKind === "TAREA" ? 15 : 16,
                  }),
                  ...docxRuns(`  ${exportTreeNodeBody(line)}`, {
                    bold: isTreeParent,
                    color: NAVI_DOCUMENT_COLORS.text,
                    size:
                      treeNodeKind === "EPIC"
                        ? 20
                        : treeNodeKind === "FEATURE"
                          ? 19
                          : treeNodeKind === "TAREA"
                            ? 17
                            : 18,
                  }),
                ]
              : docxRuns(line.text, {
                  bold: isLineHeading,
                  color: isLineHeading
                    ? NAVI_DOCUMENT_COLORS.operation
                    : NAVI_DOCUMENT_COLORS.text,
                  size: isLineHeading ? (lineHeadingDepth === 2 ? 22 : 20) : 18,
                }),
          }),
        );
      }
    }

    if (section.kpiCards?.length) {
      children.push(
        ...docxKpiCards(
          section.kpiCards,
          section.displayNumber ?? section.number,
        ),
      );
    }

    if (section.flowDiagram) {
      const rendered = renderSwimlaneFlowSvg(section.flowDiagram);
      if (rendered.width > 0 && rendered.height > 0) {
        const { width, height } = fitDiagramDimensions(
          rendered.width,
          rendered.height,
          690,
          360,
        );
        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 36, after: 12 },
            children: [
              new ImageRun({
                type: "svg",
                data: Buffer.from(rendered.svg, "utf8"),
                transformation: { width, height },
                fallback: {
                  type: "png",
                  data: TRANSPARENT_PNG,
                },
                altText: {
                  title: section.flowDiagram.title,
                  description: `${section.flowDiagram.nodes.length} pasos y ${section.flowDiagram.edges.length} conexiones`,
                  name: "Diagrama de flujo",
                },
              }),
            ],
          }),
        );
      } else {
        const nodeLabels = new Map(
          section.flowDiagram.nodes.map((node) => [node.id, node.label]),
        );
        children.push(
          ...docxContentTable(
            {
              title: section.flowDiagram.title,
              headers: ["Origen", "Condición", "Destino"],
              columnWeights: [2.5, 1.4, 2.5],
              rows: section.flowDiagram.edges.map((edge) => [
                nodeLabels.get(edge.from) ?? edge.from,
                edge.label ?? "Continúa",
                nodeLabels.get(edge.to) ?? edge.to,
              ]),
            },
            Boolean(section.headingNumber),
          ),
        );
      }
    }
    if (section.entityRelationshipDiagram) {
      const rendered = renderEntityRelationshipSvg(
        section.entityRelationshipDiagram,
      );
      const { width, height } = fitDiagramDimensions(
        rendered.width,
        rendered.height,
        690,
        470,
      );

      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: {
            before: 36,
            after: 12,
          },
          children: [
            new ImageRun({
              type: "svg",
              data: Buffer.from(rendered.svg, "utf8"),
              transformation: {
                width,
                height,
              },
              fallback: {
                type: "png",
                data: TRANSPARENT_PNG,
              },
              altText: {
                title: section.entityRelationshipDiagram.title,
                description: `${section.entityRelationshipDiagram.entities.length} entidades y ${section.entityRelationshipDiagram.relationships.length} relaciones`,
                name: "Modelo entidad-relación",
              },
            }),
          ],
        }),
      );
    }

    for (const table of section.tables)
      children.push(...docxContentTable(table, Boolean(section.headingNumber)));
  }
  return children;
}

export async function renderDocx(
  input: RenderApprovedDocumentInput,
): Promise<RenderedExportArtifact> {
  const sectionChildren = await docxSectionContent(input);
  const document = new Document({
    creator: "Levantamiento RQ",
    title: input.document.title,
    subject: `Documento de requerimientos ${input.project.code}`,
    description: "Documento estructurado de levantamiento de requerimientos.",
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 900, right: 720, bottom: 900, left: 720 },
          },
        },
        headers: {
          default: docxHeader(input),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: "Documento controlado | Página ",
                    color: NAVI_DOCUMENT_COLORS.muted,
                    font: NAVI_DOCUMENT_FONT,
                    size: 16,
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    color: NAVI_DOCUMENT_COLORS.muted,
                    font: NAVI_DOCUMENT_FONT,
                    size: 16,
                  }),
                  new TextRun({
                    text: " de ",
                    color: NAVI_DOCUMENT_COLORS.muted,
                    font: NAVI_DOCUMENT_FONT,
                    size: 16,
                  }),
                  new TextRun({
                    children: [PageNumber.TOTAL_PAGES],
                    color: NAVI_DOCUMENT_COLORS.muted,
                    font: NAVI_DOCUMENT_FONT,
                    size: 16,
                  }),
                ],
              }),
            ],
          }),
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 90 },
            children: docxRuns(
              corporateMetadata(input)[0]?.[1] ?? input.document.title,
              {
                bold: true,
                color: NAVI_DOCUMENT_COLORS.institutional,
                size: 32,
              },
            ),
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
            children: docxRuns(documentTemplateDescription(input), {
              color: NAVI_DOCUMENT_COLORS.muted,
              size: 18,
              italics: true,
            }),
          }),
          docxMetadata(input),
          ...sectionChildren,
        ],
      },
    ],
  });
  return {
    buffer: await Packer.toBuffer(document),
    mediaType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extension: "docx",
  };
}

// Caracteres fuera de Latin-1 que la codificación WinAnsi de las fuentes
// estándar (Helvetica) sí representa: € ‚ ƒ „ † ‡ ˆ ‰ Š ‹ Œ Ž ™ š › œ ž Ÿ.
const PDF_WINANSI_EXTRAS = new Set(
  Array.from(
    "\u20AC\u201A\u0192\u201E\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2122\u0161\u203A\u0153\u017E\u0178\u02DC",
  ),
);

// Sustituciones explícitas y legibles para símbolos que la fuente estándar no
// puede dibujar. Nunca se descarta un carácter visible sin dejar equivalente.
const PDF_SYMBOL_SUBSTITUTIONS: Readonly<Record<string, string>> = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201C": '"',
  "\u201D": '"',
  "\u2013": "-",
  "\u2014": "-",
  "\u2212": "-",
  "\u2026": "...",
  "\u2022": "-",
  "\u25CF": "-",
  "\u25AA": "-",
  "\u2192": "->",
  "\u2190": "<-",
  "\u2194": "<->",
  "\u21D2": "=>",
  "\u2264": "<=",
  "\u2265": ">=",
  "\u2260": "!=",
  "\u2248": "~=",
  "\u221E": "inf.",
  "\u2211": "suma",
  "\u2713": "OK",
  "\u2714": "OK",
  "\u2717": "X",
  "\u2718": "X",
  "\u2044": "/",
  "\u03BC": "\u00B5",
  "\u2126": "ohm",
  "\u03A9": "ohm",
  "\u2103": "\u00B0C",
  "\u2109": "\u00B0F",
  "\u00AD": "",
  "\t": " ",
};

function pdfSafeCharacter(character: string): string {
  if (
    character === "\n" ||
    (character >= "\u0020" && character <= "\u007E") ||
    (character >= "\u00A0" &&
      character <= "\u00FF" &&
      character !== "\u00AD") ||
    PDF_WINANSI_EXTRAS.has(character)
  ) {
    return character;
  }
  const substitution = PDF_SYMBOL_SUBSTITUTIONS[character];
  if (substitution !== undefined) return substitution;
  // Espacios y controles invisibles (ancho cero, marcas de dirección, BOM).
  if (/^[\p{Cc}\p{Cf}\p{Zs}\p{Zl}\p{Zp}\p{Mn}]$/u.test(character)) {
    return /^[\p{Zs}\p{Zl}\p{Zp}]$/u.test(character) ? " " : "";
  }
  // Equivalente de compatibilidad (①→1, ﬁ→fi, ² →2, ｆ→f) solo si es
  // íntegramente representable.
  const compatible = character.normalize("NFKC");
  if (compatible !== character) {
    const mapped = Array.from(compatible).map(pdfSafeCharacter).join("");
    if (mapped && !mapped.includes("?")) return mapped;
  }
  // Sin equivalente: marcador visible, nunca se pierde en silencio.
  return "?";
}

// Convierte cualquier texto a caracteres que la fuente estándar (WinAnsi) puede
// codificar sin lanzar error. Conserva ½ µ € × ± ° · y demás Latin-1/WinAnsi; no
// aplica NFKC global (convertía ½ en "12" y µs en "s").
export function pdfSafe(text: string): string {
  return Array.from(text.normalize("NFC").replace(/\r\n?/gu, "\n"))
    .map(pdfSafeCharacter)
    .join("");
}

function wrap(
  text: string,
  font: PDFFont,
  size: number,
  width: number,
): string[] {
  const paragraphs = pdfSafe(text).split(/\r?\n/);
  const result: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph
      .split(/\s+/)
      .filter(Boolean)
      .flatMap((word) => {
        if (font.widthOfTextAtSize(word, size) <= width) return [word];
        const segments: string[] = [];
        let segment = "";
        for (const character of word) {
          const candidate = `${segment}${character}`;
          if (font.widthOfTextAtSize(candidate, size) <= width || !segment) {
            segment = candidate;
          } else {
            segments.push(segment);
            segment = character;
          }
        }
        if (segment) segments.push(segment);
        return segments;
      });
    if (words.length === 0) {
      result.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width || !line) {
        line = candidate;
      } else {
        result.push(line);
        line = word;
      }
    }
    if (line) result.push(line);
  }
  return result;
}

const MARKDOWN_SAFE_LINK_SCHEMES = new Set(["https", "http", "mailto", "tel"]);

// Etiquetas HTML sin atributos que se conservan (el resto se neutraliza).
const MARKDOWN_SAFE_HTML_TAG =
  /^<\/?(?:br|b|strong|i|em|u|code|sub|sup|p|ul|ol|li|table|thead|tbody|tr|th|td)\s?\/?>/iu;

function markdownUrlScheme(target: string): string | null {
  // Se decodifican entidades numéricas y se quitan controles/espacios antes de
  // evaluar el esquema, para vencer "java&#9;script:" o "JaVa\nScript:".
  const normalized = target
    .replace(/&#x([0-9a-f]+);?/giu, (_, hex: string) =>
      String.fromCodePoint(Math.min(0x10ffff, Number.parseInt(hex, 16))),
    )
    .replace(/&#(\d+);?/gu, (_, digits: string) =>
      String.fromCodePoint(Math.min(0x10ffff, Number.parseInt(digits, 10))),
    )
    .replace(/&(?:tab|newline|colon);?/giu, (entity) =>
      /colon/iu.test(entity) ? ":" : "",
    )
    .replace(/[\p{Cc}\p{Zs}\u200B-\u200F\u2028\u2029\uFEFF]/gu, "")
    .toLowerCase();
  return /^([a-z][a-z0-9+.-]*):/u.exec(normalized)?.[1] ?? null;
}

function markdownSafeLinkTarget(target: string, image: boolean): boolean {
  const scheme = markdownUrlScheme(target);
  if (scheme === null) return true;
  // Una imagen remota (http/https) se bloquea: filtra datos y rastrea al lector.
  if (image) return false;
  return MARKDOWN_SAFE_LINK_SCHEMES.has(scheme);
}

function sanitizeMarkdownInline(value: string): string {
  return (
    value
      // Imágenes: solo se conservan las locales/relativas; el resto queda como texto.
      .replace(
        /!\[([^\]]*)\]\(\s*<?((?:[^()\s]|\([^()\s]*\))+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/gu,
        (match, alt: string, target: string) =>
          markdownSafeLinkTarget(target, true)
            ? match
            : alt.trim()
              ? `[Imagen omitida: ${alt.trim()}]`
              : "[Imagen omitida]",
      )
      // Enlaces: un esquema peligroso (javascript:, data:, vbscript:, file:...)
      // deja solo el texto visible.
      .replace(
        /\[([^\]]*)\]\(\s*<?((?:[^()\s]|\([^()\s]*\))+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/gu,
        (match, text: string, target: string) =>
          markdownSafeLinkTarget(target, false) ? match : text,
      )
      // Definiciones de referencia: [id]: javascript:...
      .replace(
        /^(\s{0,3})\[([^\]]+)\]:\s*<?(\S+?)>?(\s+(?:"[^"]*"|'[^']*'))?\s*$/gmu,
        (match, indent: string, id: string, target: string) =>
          markdownSafeLinkTarget(target, false)
            ? match
            : `${indent}[${id}]: (enlace omitido)`,
      )
      // HTML crudo: se escapa todo lo que no sea una etiqueta simple permitida
      // o un autoenlace http/https/mailto (script, iframe, on*=, style, etc.).
      .replace(/<(?=[A-Za-z/!?])/gu, (_, offset: number, source: string) => {
        const rest = source.slice(offset);
        return MARKDOWN_SAFE_HTML_TAG.test(rest) ||
          /^<(?:https?:\/\/|mailto:)[^>\s]+>/iu.test(rest)
          ? "<"
          : "&lt;";
      })
  );
}

// Neutraliza HTML peligroso y enlaces/imágenes con esquemas no permitidos,
// conservando Markdown legítimo. Los fragmentos `código` y los bloques con
// vallas ``` se dejan intactos porque Markdown no los interpreta.
function sanitizeMarkdown(value: string): string {
  let fenced = false;
  return value
    .split("\n")
    .map((line) => {
      if (/^\s{0,3}(?:`{3,}|~{3,})/u.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      return line
        .split(/(`[^`\n]*`)/u)
        .map((part, index) =>
          index % 2 === 1 ? part : sanitizeMarkdownInline(part),
        )
        .join("");
    })
    .join("\n");
}

function markdownText(value: string): string {
  return sanitizeMarkdown(businessText(value)).replace(
    /\bPendiente\b/giu,
    "<u>Pendiente</u>",
  );
}

function markdownCell(value: string): string {
  return markdownText(value).replaceAll("|", "\\|").replace(/\r?\n/gu, "<br>");
}

export async function renderMarkdown(
  input: RenderApprovedDocumentInput,
): Promise<RenderedExportArtifact> {
  const output: string[] = [
    `# ${markdownText(corporateMetadata(input)[0]?.[1] ?? input.document.title)}`,
    "",
    `> ${markdownText(documentTemplateDescription(input))}`,
    "",
    "## Información del documento",
    "",
    "| Campo | Valor |",
    "| --- | --- |",
    ...corporateMetadata(input).map(
      ([key, value]) => `| ${markdownCell(key)} | ${markdownCell(value)} |`,
    ),
    "",
  ];

  for (const section of buildExportDocumentSections(input)) {
    const sectionHeadingPrefix = section.headingNumber ? "###" : "##";
    const sectionHeadingTitle = exportSectionTitle(section);
    output.push(
      `${sectionHeadingPrefix} ${exportNumber(section.headingNumber ?? section.displayNumber ?? section.number)}. ${markdownText(sectionHeadingTitle)}`,
      "",
    );

    if (section.objectivesLayout) {
      output.push(
        "### 1.1. Objetivo general:",
        "",
        markdownText(section.objectivesLayout.general),
        "",
        "#### 1.1.1. Objetivos específicos:",
        "",
        "| Cualitativos | Cuantitativos |",
        "| --- | --- |",
      );

      const maximumObjectives = Math.max(
        section.objectivesLayout.qualitative.length,
        section.objectivesLayout.quantitative.length,
      );

      for (let index = 0; index < maximumObjectives; index += 1) {
        const qualitative = section.objectivesLayout.qualitative[index] ?? "";
        const quantitative = section.objectivesLayout.quantitative[index] ?? "";

        output.push(
          `| ${qualitative ? `${index + 1}. ${markdownCell(qualitative)}` : ""} | ${quantitative ? `${index + 1}. ${markdownCell(quantitative)}` : ""} |`,
        );
      }

      output.push("");
    } else {
      const lines = numberedSectionLines(section);
      for (const line of lines) {
        const treeNodeKind = exportTreeNodeKind(line);
        const plainValue = markdownText(line.text);
        const value =
          treeNodeKind && treeNodeKind !== "TAREA"
            ? `**${plainValue}**`
            : plainValue;
        if (!value) continue;
        const indent = "  ".repeat(Math.min(line.level, 3));
        const lineHeadingDepth = exportLineHeadingDepth(line);
        const headingPrefix = lineHeadingDepth
          ? "#".repeat(Math.min(6, lineHeadingDepth + 1))
          : null;
        if (headingPrefix) {
          if (output.at(-1) !== "") output.push("");
          output.push(`${headingPrefix} ${value}`, "");
        } else {
          output.push(
            line.bullet ? `${indent}- ${value}` : `${indent}${value}`,
          );
        }
      }
      if (lines.length > 0) output.push("");
    }

    if (section.kpiCards?.length) {
      output.push(
        `### ${exportNumber(section.displayNumber ?? section.number)}.4. KPIs de estado:`,
        "",
        `| ${section.kpiCards.map((card) => markdownCell(card.name)).join(" | ")} |`,
        `| ${section.kpiCards.map(() => "---").join(" | ")} |`,
        `| ${section.kpiCards
          .map(
            (card) =>
              `**Objetivo:** ${markdownCell(card.relatedObjective)}<br>**Medición:** ${markdownCell(card.measurement)}<br>**Meta:** ${markdownCell(card.target)}`,
          )
          .join(" | ")} |`,
        "",
      );
    }

    if (section.flowDiagram) {
      output.push(
        `${section.headingNumber ? "####" : "###"} ${markdownText(section.flowDiagram.title)}`,
        "",
      );
      for (const node of section.flowDiagram.nodes) {
        output.push(`- **${node.kind}:** ${markdownText(node.label)}`);
      }
      output.push("", "**Conexiones**", "");
      const labels = new Map(
        section.flowDiagram.nodes.map((node) => [node.id, node.label]),
      );
      for (const edge of section.flowDiagram.edges) {
        const from = markdownText(labels.get(edge.from) ?? edge.from);
        const to = markdownText(labels.get(edge.to) ?? edge.to);
        output.push(
          `- ${from} → ${edge.label ? `${markdownText(edge.label)} → ` : ""}${to}`,
        );
      }
      output.push("");
    }

    for (const table of section.tables) {
      output.push(
        `${section.headingNumber ? "####" : "###"} ${markdownText(table.title)}`,
        "",
      );
      output.push(
        `| ${table.headers.map(markdownCell).join(" | ")} |`,
        `| ${table.headers.map(() => "---").join(" | ")} |`,
      );
      for (const row of table.rows) {
        output.push(`| ${row.map(markdownCell).join(" | ")} |`);
      }
      output.push("");
    }
  }

  const prototypeMarkdown = jsonRecord(
    versionSection(input, "solutionProposal")?.content,
  )?.prototypeMarkdown;
  if (typeof prototypeMarkdown === "string" && prototypeMarkdown.trim()) {
    const specification = sanitizeMarkdown(
      prototypeMarkdown
        .trim()
        .replace(/^#\s+[^\n]+\n+/u, "")
        .replace(/^(#{1,5})(?=\s)/gmu, "#$1"),
    );
    output.push(
      "---",
      "",
      "## Anexo · Especificaciones del prototipo",
      "",
      specification,
      "",
    );
  }

  output.push(
    "---",
    "",
    `Documento controlado · ${markdownText(input.project.code)} · Generado el ${date(input.generatedAt)}`,
    "",
  );

  return {
    buffer: Buffer.from(output.join("\n"), "utf8"),
    mediaType: "text/markdown; charset=utf-8",
    extension: "md",
  };
}

class PdfLayout {
  readonly pages: PDFPage[] = [];
  private page!: PDFPage;
  private y = 0;
  private width = PageSizes.Letter[0];
  private height = PageSizes.Letter[1];
  private readonly left = 38;
  private readonly right = 38;

  constructor(
    private readonly pdf: PDFDocument,
    private readonly regular: PDFFont,
    private readonly bold: PDFFont,
    private readonly projectCode: string,
    private readonly templateLogo: PDFImage | null,
  ) {
    this.newPage();
  }

  newPage(orientation: "portrait" | "landscape" = "portrait"): void {
    const size: [number, number] =
      orientation === "landscape"
        ? [PageSizes.Letter[1], PageSizes.Letter[0]]
        : [PageSizes.Letter[0], PageSizes.Letter[1]];
    this.width = size[0];
    this.height = size[1];
    this.page = this.pdf.addPage(size);
    // Todo texto dibujado pasa por pdfSafe: un carácter fuera de WinAnsi no debe
    // abortar la exportación completa.
    const drawText = this.page.drawText.bind(this.page);
    this.page.drawText = (text, options) => drawText(pdfSafe(text), options);
    this.pages.push(this.page);
    if (this.templateLogo) {
      const scale = Math.min(
        118 / this.templateLogo.width,
        42 / this.templateLogo.height,
      );

      const logoWidth = this.templateLogo.width * scale;

      const logoHeight = this.templateLogo.height * scale;

      this.page.drawImage(this.templateLogo, {
        x: this.left,
        y: this.height - 14 - logoHeight,
        width: logoWidth,
        height: logoHeight,
      });
    }

    const headerTitle = "LEVANTAMIENTO DE REQUERIMIENTOS SOLUCIONES TIC";

    this.page.drawText(headerTitle, {
      x:
        this.width - this.right - this.bold.widthOfTextAtSize(headerTitle, 8.2),
      y: this.height - 28,
      size: 8.2,
      font: this.bold,
      color: rgb(...NAVI_DOCUMENT_PDF_COLORS.institutional),
    });

    const headerProjectCode = pdfSafe(this.projectCode);

    this.page.drawText(headerProjectCode, {
      x:
        this.width -
        this.right -
        this.regular.widthOfTextAtSize(headerProjectCode, 7),
      y: this.height - 42,
      size: 7,
      font: this.regular,
      color: rgb(...NAVI_DOCUMENT_PDF_COLORS.muted),
    });

    this.page.drawLine({
      start: {
        x: this.left,
        y: this.height - 60,
      },
      end: {
        x: this.width - this.right,
        y: this.height - 60,
      },
      thickness: 0.8,
      color: rgb(...NAVI_DOCUMENT_PDF_COLORS.border),
    });

    this.y = this.height - 82;
  }

  ensure(height: number): void {
    if (this.y - height < 46) this.newPage();
  }

  private drawTextWithPendingUnderline(
    value: string,
    x: number,
    y: number,
    size: number,
    font: PDFFont,
    color: ReturnType<typeof rgb>,
  ): void {
    const parts = pdfSafe(value)
      .split(/(\bPendiente\b)/giu)
      .filter(Boolean);
    let cursor = x;

    for (const part of parts) {
      this.page.drawText(part, {
        x: cursor,
        y,
        size,
        font,
        color,
      });
      const width = font.widthOfTextAtSize(part, size);
      if (/^Pendiente$/iu.test(part)) {
        this.page.drawLine({
          start: { x: cursor, y: y - 1.1 },
          end: { x: cursor + width, y: y - 1.1 },
          thickness: 0.55,
          color,
        });
      }
      cursor += width;
    }
  }

  text(
    text: string,
    options: {
      size?: number;
      bold?: boolean;
      color?: readonly [number, number, number];
      indent?: number;
      before?: number;
      after?: number;
      bullet?: boolean;
    } = {},
  ): void {
    const size = options.size ?? 8.6;
    const font = options.bold ? this.bold : this.regular;
    const indent = options.indent ?? 0;
    const before = options.before ?? 0;
    const after = options.after ?? 3.5;
    const prefix = options.bullet ? "- " : "";
    const lines = wrap(
      `${prefix}${text}`,
      font,
      size,
      this.width - this.left - this.right - indent,
    );
    const lineHeight = size * 1.24;
    this.ensure(before + lineHeight);
    this.y -= before;
    const color = options.color ?? NAVI_DOCUMENT_PDF_COLORS.text;
    for (const line of lines) {
      this.ensure(lineHeight);
      this.drawTextWithPendingUnderline(
        line,
        this.left + indent,
        this.y,
        size,
        font,
        rgb(color[0], color[1], color[2]),
      );
      this.y -= lineHeight;
    }
    this.y -= after;
  }

  backlogTree(
    lines: readonly ExportContentLine[],
    sectionNumber: number | string,
  ): void {
    const ancestors: string[] = [];
    let anchors: { x: number; y: number }[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const kind = exportTreeNodeKind(line);
      if (!kind) {
        this.text(line.text, { size: 8.1, after: 5 });
        continue;
      }
      const level = Math.min(line.level, 3);
      const title = exportTreeNodeBody(line);
      const detail: string[] = [];
      while (index + 1 < lines.length && !exportTreeNodeKind(lines[index + 1]))
        detail.push(lines[++index].text);
      ancestors.length = level;
      anchors.length = level;
      const x = this.left + 12 + level * 16;
      const width = this.width - this.right - x;
      const label = kind === "EPIC" ? "ÉPICA" : kind;
      const textLines = [
        ...wrap(`${label} · ${title}`, this.bold, 8.6, width - 14).map(
          (text) => ({ text, bold: true }),
        ),
        ...detail.flatMap((value) =>
          wrap(value, this.regular, 8.1, width - 14).map((text) => ({
            text,
            bold: false,
          })),
        ),
      ];
      const lineHeight = 9.5;
      const capacity = Math.max(
        1,
        Math.floor((this.height - 190) / lineHeight),
      );
      for (let offset = 0; offset < textLines.length; offset += capacity) {
        const chunk = textLines.slice(offset, offset + capacity);
        const height = chunk.length * lineHeight + 4;
        if (
          this.y -
            height -
            (index + 1 < lines.length && lines[index + 1].level > level
              ? 24
              : 3) <
          46
        ) {
          this.newPage();
          this.text(`${exportNumber(sectionNumber)} ESQUEMA · Continuación`, {
            bold: true,
            size: 9,
            after: 5,
          });
          if (ancestors.length)
            this.text(`Rama: ${ancestors.join(" > ")}`, {
              size: 7.8,
              after: 5,
            });
          anchors = ancestors.map((_, depth) => ({
            x: this.left + 4 + depth * 16,
            y: this.y,
          }));
        }
        if (offset > 0)
          this.text(`${label} · ${title.split(" · ")[0]} (continuación)`, {
            size: 8,
            indent: level * 16,
            after: 4,
          });
        const middle = this.y - 10;
        const parent = anchors[level - 1];
        // Tipo explícito: una unión de tuplas literales no admite spread en rgb().
        const color: readonly [number, number, number] =
          kind === "EPIC"
            ? NAVI_DOCUMENT_PDF_COLORS.institutional
            : kind === "FEATURE"
              ? NAVI_DOCUMENT_PDF_COLORS.operation
              : NAVI_DOCUMENT_PDF_COLORS.muted;
        if (parent) {
          this.page.drawLine({
            start: { x: parent.x, y: parent.y },
            end: { x: parent.x, y: middle },
            thickness: 1,
            color: rgb(...NAVI_DOCUMENT_PDF_COLORS.border),
          });
          this.page.drawLine({
            start: { x: parent.x, y: middle },
            end: { x, y: middle },
            thickness: 1,
            color: rgb(...NAVI_DOCUMENT_PDF_COLORS.border),
          });
          parent.y = middle;
        }
        this.page.drawRectangle({
          x,
          y: this.y - height,
          width,
          height,
          color: rgb(0.975, 0.978, 0.982),
          borderWidth: 0.5,
          borderColor: rgb(...NAVI_DOCUMENT_PDF_COLORS.border),
        });
        this.page.drawRectangle({
          x,
          y: this.y - height,
          width: 3,
          height,
          color: rgb(...color),
        });
        const regularTextColor: readonly [number, number, number] =
          NAVI_DOCUMENT_PDF_COLORS.text;
        chunk.forEach((value, row) =>
          this.drawTextWithPendingUnderline(
            value.text,
            x + 7,
            this.y - 10 - row * lineHeight,
            value.bold ? 8.6 : 8.1,
            value.bold ? this.bold : this.regular,
            rgb(...(value.bold ? color : regularTextColor)),
          ),
        );
        // The branch junction sits outside the card so connectors never cross its text.
        this.page.drawLine({
          start: { x: x - 8, y: middle },
          end: { x, y: middle },
          thickness: 1,
          color: rgb(...NAVI_DOCUMENT_PDF_COLORS.border),
        });
        anchors[level] = { x: x - 8, y: middle };
        this.y -= height + 2;
      }
      ancestors[level] = title.split(" · ")[0];
    }
    this.y -= 4;
  }

  epicTimeline(
    timeline: ExportEpicTimeline,
    sectionNumber: number | string,
  ): void {
    const width = this.width - this.left - this.right;
    const labelWidth = Math.min(240, width * 0.34);
    const graphX = this.left + labelWidth;
    const graphWidth = width - labelWidth;
    const span = Math.max(1, timeline.end - timeline.start + 1);
    const label = (value: number): string =>
      timeline.calendar
        ? new Intl.DateTimeFormat("es-CO", {
            day: "2-digit",
            month: "short",
            timeZone: "UTC",
          }).format(new Date(value * 86400000))
        : `Día ${value}`;
    const colors: readonly (readonly [number, number, number])[] = [
      [0.18, 0.43, 0.64],
      NAVI_DOCUMENT_PDF_COLORS.operation,
      [0.39, 0.46, 0.28],
    ];
    const header = () => {
      this.text("Programación según las tareas · Épicas", {
        before: 8,
        size: 11,
        bold: true,
        after: 7,
      });
      this.text(
        "El inicio y el cierre se calculan con las tareas asignadas; si no tienen fechas, se usa el rango del Sprint.",
        { size: 8, after: 12 },
      );
      this.page.drawRectangle({
        x: this.left,
        y: this.y - 28,
        width,
        height: 28,
        color: rgb(0.96, 0.97, 0.98),
        borderWidth: 0.5,
        borderColor: rgb(...NAVI_DOCUMENT_PDF_COLORS.border),
      });
      this.page.drawText("Elemento", {
        x: this.left + 8,
        y: this.y - 17,
        size: 8.5,
        font: this.bold,
      });
      const ticks = [
        ...new Set([
          timeline.start,
          ...[0.25, 0.5, 0.75].map((f) =>
            Math.round(timeline.start + (span - 1) * f),
          ),
          timeline.end,
        ]),
      ];
      for (const [index, tick] of ticks.entries()) {
        const text = label(tick),
          textWidth = this.bold.widthOfTextAtSize(pdfSafe(text), 7);
        const fraction = span <= 1 ? 0 : (tick - timeline.start) / (span - 1);
        const x = graphX + fraction * graphWidth;
        this.page.drawText(pdfSafe(text), {
          x:
            index === 0
              ? x + 6
              : index === ticks.length - 1
                ? x - textWidth - 6
                : x - textWidth / 2,
          y: this.y - 17,
          size: 7,
          font: this.bold,
          color: rgb(...NAVI_DOCUMENT_PDF_COLORS.muted),
        });
      }
      this.y -= 28;
    };
    header();
    for (const [index, row] of timeline.rows.entries()) {
      const titleLines = wrap(row.title, this.regular, 8.5, labelWidth - 16);
      const height = Math.max(64, 28 + titleLines.length * 11);
      if (this.y - height < 46) {
        this.newPage("landscape");
        this.text(`${exportNumber(sectionNumber)} PLAN SCRUM · Continuación`, {
          bold: true,
          size: 10,
          after: 10,
        });
        header();
      }
      this.page.drawRectangle({
        x: this.left,
        y: this.y - height,
        width,
        height,
        borderWidth: 0.5,
        borderColor: rgb(...NAVI_DOCUMENT_PDF_COLORS.border),
      });
      for (let tick = 0; tick <= 4; tick++) {
        const x = graphX + (graphWidth * tick) / 4;
        this.page.drawLine({
          start: { x, y: this.y },
          end: { x, y: this.y - height },
          thickness: 0.4,
          color: rgb(...NAVI_DOCUMENT_PDF_COLORS.border),
        });
      }
      this.page.drawText(pdfSafe(row.code), {
        x: this.left + 8,
        y: this.y - 16,
        size: 8,
        font: this.bold,
        color: rgb(...NAVI_DOCUMENT_PDF_COLORS.operation),
      });
      titleLines.forEach((text, n) =>
        this.page.drawText(pdfSafe(text), {
          x: this.left + 8,
          y: this.y - 30 - n * 11,
          size: 8.5,
          font: this.regular,
        }),
      );
      if (row.start !== null && row.end !== null) {
        const x = graphX + ((row.start - timeline.start) / span) * graphWidth;
        const barWidth = ((row.end - row.start + 1) / span) * graphWidth;
        const y = this.y - height / 2 - 10;
        const color = colors[index % colors.length];
        this.page.drawRectangle({
          x,
          y,
          width: barWidth,
          height: 22,
          color: rgb(...color),
        });
        const startText = pdfSafe(label(row.start)),
          endText = pdfSafe(label(row.end));
        const requiredWidth =
          this.bold.widthOfTextAtSize(startText + endText, 7) + 20;
        if (barWidth >= requiredWidth) {
          this.page.drawText(startText, {
            x: x + 5,
            y: y + 8,
            size: 7,
            font: this.bold,
            color: rgb(1, 1, 1),
          });
          this.page.drawText(endText, {
            x: x + barWidth - this.bold.widthOfTextAtSize(endText, 7) - 5,
            y: y + 8,
            size: 7,
            font: this.bold,
            color: rgb(1, 1, 1),
          });
        } else {
          const text =
            row.start === row.end ? startText : `${startText} - ${endText}`;
          const xLabel = Math.min(
            Math.max(graphX + 4, x),
            this.width - this.right - this.bold.widthOfTextAtSize(text, 7) - 4,
          );
          this.page.drawText(text, {
            x: xLabel,
            y: y + 27,
            size: 7,
            font: this.bold,
            color: rgb(...color),
          });
        }
      } else
        this.page.drawText("Sin tareas programadas", {
          x: graphX + 10,
          y: this.y - height / 2,
          size: 8,
          font: this.regular,
          color: rgb(...NAVI_DOCUMENT_PDF_COLORS.muted),
        });
      this.y -= height;
    }
    this.y -= 18;
  }

  treeNode(line: ExportContentLine, kind: ExportTreeNodeKind): void {
    const indent = Math.min(line.level, 3) * 14;
    const x = this.left + indent;
    const badgeWidth = kind === "FEATURE" ? 46 : kind === "TAREA" ? 40 : 34;
    const badgeHeight = 12;
    const bodySize = kind === "EPIC" ? 9.5 : kind === "FEATURE" ? 9.1 : 8.7;
    const bodyX = x + badgeWidth + 7;
    const bodyLines = wrap(
      exportTreeNodeBody(line),
      kind === "TAREA" ? this.regular : this.bold,
      bodySize,
      this.width - this.right - bodyX,
    );
    const lineHeight = bodySize * 1.24;
    const height = Math.max(badgeHeight, bodyLines.length * lineHeight);
    const before = kind === "EPIC" ? 7 : 2;
    this.ensure(before + height + 4);
    this.y -= before;

    if (line.level > 0) {
      this.page.drawLine({
        start: { x: x - 8, y: this.y - badgeHeight / 2 },
        end: { x: x - 2, y: this.y - badgeHeight / 2 },
        thickness: 0.7,
        color: rgb(...NAVI_DOCUMENT_PDF_COLORS.border),
      });
    }

    const badgeColor: readonly [number, number, number] =
      kind === "EPIC"
        ? NAVI_DOCUMENT_PDF_COLORS.institutional
        : kind === "FEATURE"
          ? NAVI_DOCUMENT_PDF_COLORS.operation
          : NAVI_DOCUMENT_PDF_COLORS.muted;
    this.page.drawRectangle({
      x,
      y: this.y - badgeHeight,
      width: badgeWidth,
      height: badgeHeight,
      color: rgb(...badgeColor),
    });
    const labelSize = kind === "FEATURE" ? 5.7 : 6;
    const labelWidth = this.bold.widthOfTextAtSize(kind, labelSize);
    this.page.drawText(kind, {
      x: x + (badgeWidth - labelWidth) / 2,
      y: this.y - 8.4,
      size: labelSize,
      font: this.bold,
      color: rgb(...NAVI_DOCUMENT_PDF_COLORS.white),
    });
    bodyLines.forEach((bodyLine, index) => {
      this.drawTextWithPendingUnderline(
        bodyLine,
        bodyX,
        this.y - 9 - index * lineHeight,
        bodySize,
        kind === "TAREA" ? this.regular : this.bold,
        rgb(...NAVI_DOCUMENT_PDF_COLORS.text),
      );
    });
    this.y -= height + 4;
  }

  sectionHeading(
    number: number | string,
    title: string,
    kind: ExportHeadingKind,
  ): void {
    const isSubsection = kind === "subsection";
    const numberText = exportNumber(number);
    const titleText = isSubsection ? title : title.toUpperCase();
    const size = isSubsection ? 12 : 13.5;
    const before = isSubsection ? 5 : 14;
    const after = isSubsection ? 5 : 9;
    const color: readonly [number, number, number] = isSubsection
      ? NAVI_DOCUMENT_PDF_COLORS.operation
      : NAVI_DOCUMENT_PDF_COLORS.institutional;
    const heading = isSubsection
      ? `${numberText}. ${titleText}`
      : `${numberText} ${titleText}`;

    this.ensure(before + size * 1.3 + after);
    this.y -= before;
    this.page.drawText(pdfSafe(heading), {
      x: this.left,
      y: this.y - size,
      size,
      font: this.bold,
      color: rgb(...color),
    });
    this.page.drawLine({
      start: { x: this.left, y: this.y - size - 5 },
      end: { x: this.width - this.right, y: this.y - size - 5 },
      thickness: isSubsection ? 0.45 : 0.8,
      color: rgb(...NAVI_DOCUMENT_PDF_COLORS.border),
    });
    this.y -= size + after + 5;
  }

  metadata(rows: readonly (readonly [string, string])[]): void {
    const width = this.width - this.left - this.right;
    const columns = 2;
    const gap = 9;
    const cellWidth = (width - gap) / columns;
    const rowHeight = 34;
    const rowCount = Math.ceil(rows.length / columns);
    this.ensure(rowCount * rowHeight + 10);

    rows.forEach(([key, value], index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = this.left + column * (cellWidth + gap);
      const top = this.y - row * rowHeight;
      const bottom = top - rowHeight + 3;

      this.page.drawRectangle({
        x,
        y: bottom,
        width: cellWidth,
        height: rowHeight - 3,
        color: rgb(...NAVI_DOCUMENT_PDF_COLORS.surfaceSoft),
        borderColor: rgb(...NAVI_DOCUMENT_PDF_COLORS.border),
        borderWidth: 0.45,
      });
      this.page.drawRectangle({
        x,
        y: top - 3,
        width: cellWidth,
        height: 2,
        color: rgb(...NAVI_DOCUMENT_PDF_COLORS.institutional),
      });

      this.page.drawText(pdfSafe(key.toUpperCase()), {
        x: x + 7,
        y: top - 11,
        size: 6,
        font: this.bold,
        color: rgb(...NAVI_DOCUMENT_PDF_COLORS.muted),
      });

      const valueLines = wrap(
        businessText(value),
        this.bold,
        7.5,
        cellWidth - 14,
      ).slice(0, 2);

      valueLines.forEach((line, lineIndex) => {
        this.drawTextWithPendingUnderline(
          line,
          x + 7,
          top - 22 - lineIndex * 8.3,
          7.5,
          this.bold,
          rgb(...NAVI_DOCUMENT_PDF_COLORS.text),
        );
      });
    });

    this.y -= rowCount * rowHeight + 5;
  }

  objectives(layout: ExportObjectivesLayout): void {
    this.text("1.1. Objetivo general:", {
      size: 11,
      bold: true,
      color: NAVI_DOCUMENT_PDF_COLORS.operation,
      after: 3,
    });
    this.text(layout.general, {
      size: 9,
      color: NAVI_DOCUMENT_PDF_COLORS.text,
      after: 7,
    });
    this.text("1.1.1. Objetivos específicos:", {
      size: 10.5,
      bold: true,
      color: NAVI_DOCUMENT_PDF_COLORS.operation,
      after: 5,
    });

    const gap = 10;
    const totalWidth = this.width - this.left - this.right;
    const columnWidth = (totalWidth - gap) / 2;
    const padding = 8;
    const headerSize = 8.25;
    const bodySize = 7.5;
    const bodyLineHeight = 8.6;

    const prepared = (
      title: string,
      values: readonly string[],
    ): {
      title: string;
      items: readonly (readonly string[])[];
      height: number;
    } => {
      const items = values.map((value, index) =>
        wrap(
          `${index + 1}. ${value}`,
          this.regular,
          bodySize,
          columnWidth - padding * 2,
        ),
      );

      const bodyHeight = items.reduce(
        (sum, lines) => sum + Math.max(1, lines.length) * bodyLineHeight + 3,
        0,
      );

      return {
        title,
        items,
        height: 24 + bodyHeight + padding,
      };
    };

    const columns = [
      prepared("Cualitativos", layout.qualitative),
      prepared("Cuantitativos", layout.quantitative),
    ] as const;
    const cardHeight = Math.max(...columns.map((column) => column.height));

    this.ensure(cardHeight + 8);

    columns.forEach((column, columnIndex) => {
      const x = this.left + columnIndex * (columnWidth + gap);
      const bottom = this.y - cardHeight;

      this.page.drawRectangle({
        x,
        y: bottom,
        width: columnWidth,
        height: cardHeight,
        color: rgb(...NAVI_DOCUMENT_PDF_COLORS.surfaceSoft),
        borderColor: rgb(...NAVI_DOCUMENT_PDF_COLORS.border),
        borderWidth: 0.55,
      });

      this.page.drawRectangle({
        x,
        y: this.y - 3,
        width: columnWidth,
        height: 3,
        color: rgb(...NAVI_DOCUMENT_PDF_COLORS.institutional),
      });

      this.page.drawText(column.title, {
        x: x + padding,
        y: this.y - 16,
        size: headerSize,
        font: this.bold,
        color: rgb(...NAVI_DOCUMENT_PDF_COLORS.institutional),
      });

      let cursorY = this.y - 30;

      for (const lines of column.items) {
        for (const line of lines) {
          this.drawTextWithPendingUnderline(
            line,
            x + padding,
            cursorY,
            bodySize,
            this.regular,
            rgb(...NAVI_DOCUMENT_PDF_COLORS.text),
          );
          cursorY -= bodyLineHeight;
        }
        cursorY -= 3;
      }
    });

    this.y -= cardHeight + 7;
  }

  kpiCards(cards: readonly ExportKpiCard[], sectionNumber: number): void {
    if (cards.length === 0) return;

    this.text(`${exportNumber(sectionNumber)}.4. KPIs de estado:`, {
      size: 10.5,
      bold: true,
      color: NAVI_DOCUMENT_PDF_COLORS.operation,
      after: 5,
    });

    const gap = 8;
    const totalWidth = this.width - this.left - this.right;
    const cardWidth =
      (totalWidth - gap * Math.max(0, cards.length - 1)) / cards.length;
    const padding = 7;
    const nameSize = 7.5;
    const bodySize = 6.8;
    const lineHeight = 7.8;

    const prepared = cards.map((card) => {
      const nameLines = wrap(
        card.name,
        this.bold,
        nameSize,
        cardWidth - padding * 2,
      ).slice(0, 3);
      const rows = [
        ["Cálculo", card.measurement],
        ["Meta", card.target],
      ] as const;

      const rowLines = rows.map(([labelText, value]) => ({
        label: labelText,
        lines: wrap(
          value,
          this.regular,
          bodySize,
          cardWidth - padding * 2,
        ).slice(0, 5),
      }));

      const height =
        padding +
        Math.max(1, nameLines.length) * 8.4 +
        25 +
        rowLines.reduce(
          (sum, row) =>
            sum + 8 + Math.max(1, row.lines.length) * lineHeight + 2,
          0,
        ) +
        padding;

      return {
        card,
        nameLines,
        rowLines,
        height,
      };
    });

    const cardHeight = Math.max(...prepared.map((item) => item.height));
    this.ensure(cardHeight + 8);

    prepared.forEach((item, index) => {
      const x = this.left + index * (cardWidth + gap);
      const bottom = this.y - cardHeight;

      this.page.drawRectangle({
        x,
        y: bottom,
        width: cardWidth,
        height: cardHeight,
        color: rgb(...NAVI_DOCUMENT_PDF_COLORS.surfaceSoft),
        borderColor: rgb(...NAVI_DOCUMENT_PDF_COLORS.border),
        borderWidth: 0.55,
      });

      this.page.drawRectangle({
        x,
        y: this.y - 3,
        width: cardWidth,
        height: 3,
        color: rgb(...NAVI_DOCUMENT_PDF_COLORS.institutional),
      });

      let cursorY = this.y - 15;

      for (const line of item.nameLines) {
        this.page.drawText(pdfSafe(line), {
          x: x + padding,
          y: cursorY,
          size: nameSize,
          font: this.bold,
          color: rgb(...NAVI_DOCUMENT_PDF_COLORS.institutional),
        });
        cursorY -= 8.4;
      }

      cursorY -= 4;

      const chartX = x + padding;
      const chartWidth = cardWidth - padding * 2;
      this.page.drawRectangle({
        x: chartX,
        y: cursorY - 4,
        width: chartWidth,
        height: 5,
        color: rgb(...NAVI_DOCUMENT_PDF_COLORS.surfaceSoft),
        borderColor: rgb(...NAVI_DOCUMENT_PDF_COLORS.border),
        borderWidth: 0.45,
      });
      this.page.drawCircle({
        x: chartX + 2.5,
        y: cursorY - 1.5,
        size: 3.2,
        color: rgb(...NAVI_DOCUMENT_PDF_COLORS.institutional),
      });
      this.page.drawText("0%", {
        x: chartX,
        y: cursorY - 13,
        size: 6.3,
        font: this.bold,
        color: rgb(...NAVI_DOCUMENT_PDF_COLORS.muted),
      });
      this.page.drawText(`Meta ${pdfSafe(item.card.target)}`, {
        x: chartX + chartWidth - 34,
        y: cursorY - 13,
        size: 6.3,
        font: this.bold,
        color: rgb(...NAVI_DOCUMENT_PDF_COLORS.institutional),
      });
      cursorY -= 20;

      for (const row of item.rowLines) {
        this.page.drawText(`${row.label}:`, {
          x: x + padding,
          y: cursorY,
          size: bodySize,
          font: this.bold,
          color: rgb(...NAVI_DOCUMENT_PDF_COLORS.muted),
        });
        cursorY -= 8;

        for (const line of row.lines) {
          this.drawTextWithPendingUnderline(
            line,
            x + padding,
            cursorY,
            bodySize,
            this.regular,
            rgb(...NAVI_DOCUMENT_PDF_COLORS.text),
          );
          cursorY -= lineHeight;
        }

        cursorY -= 2;
      }
    });

    this.y -= cardHeight + 7;
  }

  private flowDepths(diagram: ExportFlowDiagram): Map<string, number> {
    const ids = diagram.nodes.map((node) => node.id);
    const indegree = new Map(ids.map((id) => [id, 0]));
    const outgoing = new Map<string, string[]>();
    for (const edge of diagram.edges) {
      if (!indegree.has(edge.from) || !indegree.has(edge.to)) continue;
      indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
      outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
    }
    const queue = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
    const depths = new Map(ids.map((id) => [id, 0]));
    const visited = new Set<string>();
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id) break;
      visited.add(id);
      for (const to of outgoing.get(id) ?? []) {
        depths.set(
          to,
          Math.max(depths.get(to) ?? 0, (depths.get(id) ?? 0) + 1),
        );
        indegree.set(to, (indegree.get(to) ?? 1) - 1);
        if (indegree.get(to) === 0) queue.push(to);
      }
    }
    ids.forEach((id, index) => {
      if (!visited.has(id))
        depths.set(id, Math.max(depths.get(id) ?? 0, index));
    });
    return depths;
  }

  private swimlaneFlowDiagram(diagram: ExportFlowDiagram): void {
    const lanes = diagram.lanes ?? [];
    if (lanes.length === 0) return;
    this.newPage("landscape");
    this.text(diagram.title, {
      size: 12,
      bold: true,
      color: [0.19, 0.25, 0.29],
      after: 4,
    });
    if (diagram.objective) {
      this.text(`Objetivo: ${diagram.objective}`, {
        size: 7.6,
        color: [0.33, 0.39, 0.42],
        after: 7,
      });
    }
    const contentWidth = this.width - this.left - this.right;
    const labelWidth = 104;
    const availableHeight = Math.max(250, this.y - 48);
    const laneHeight = Math.max(
      34,
      Math.min(58, availableHeight / Math.max(1, lanes.length)),
    );
    const totalHeight = laneHeight * lanes.length;
    const top = this.y;
    const depths = this.flowDepths(diagram);
    const maximumDepth = Math.max(0, ...depths.values());
    const stageCount = maximumDepth + 1;
    const diagramWidth = contentWidth - labelWidth;
    const stageWidth = diagramWidth / Math.max(1, stageCount);
    const nodeWidth = Math.max(52, Math.min(92, stageWidth - 14));
    const nodeHeight = Math.max(24, Math.min(36, laneHeight - 12));
    const laneIndex = new Map(lanes.map((lane, index) => [lane.id, index]));
    const positions = new Map<
      string,
      { x: number; y: number; width: number; height: number }
    >();
    diagram.nodes.forEach((node) => {
      const lane = laneIndex.get(node.laneId ?? "") ?? 0;
      const depth = depths.get(node.id) ?? 0;
      positions.set(node.id, {
        x:
          this.left +
          labelWidth +
          depth * stageWidth +
          (stageWidth - nodeWidth) / 2,
        y: top - (lane + 0.5) * laneHeight - nodeHeight / 2,
        width: nodeWidth,
        height: nodeHeight,
      });
    });
    const laneColors = [
      [0.18, 0.39, 0.55],
      [0.34, 0.29, 0.43],
      [0.63, 0.39, 0.16],
      [0.31, 0.42, 0.27],
      [0.27, 0.36, 0.41],
      [0.71, 0.15, 0.18],
    ] as const;
    lanes.forEach((lane, index) => {
      const y = top - (index + 1) * laneHeight;
      const laneColor = laneColors[index % laneColors.length] ?? laneColors[0];
      this.page.drawRectangle({
        x: this.left,
        y,
        width: contentWidth,
        height: laneHeight,
        color:
          lane.kind === "SYSTEM"
            ? rgb(0.96, 0.965, 0.97)
            : rgb(0.965, 0.975, 0.98),
        borderColor: rgb(0.76, 0.79, 0.8),
        borderWidth: 0.45,
      });
      this.page.drawRectangle({
        x: this.left,
        y,
        width: labelWidth,
        height: laneHeight,
        color: rgb(laneColor[0], laneColor[1], laneColor[2]),
      });
      const nameLines = wrap(lane.name, this.bold, 6.2, labelWidth - 12).slice(
        0,
        3,
      );
      const lineHeight = 7.2;
      const nameTop = y + laneHeight / 2 + (nameLines.length * lineHeight) / 2;
      nameLines.forEach((line, lineIndex) => {
        this.page.drawText(line, {
          x:
            this.left +
            (labelWidth - this.bold.widthOfTextAtSize(line, 6.2)) / 2,
          y: nameTop - (lineIndex + 1) * lineHeight + 4,
          size: 6.2,
          font: this.bold,
          color: rgb(1, 1, 1),
        });
      });
      this.page.drawText(lane.kind === "SYSTEM" ? "Sistema" : "Actor", {
        x: this.left + 6,
        y: y + 5,
        size: 4.8,
        font: this.regular,
        color: rgb(1, 1, 1),
      });
    });
    const edgeColor = rgb(0.22, 0.32, 0.38);
    for (const edge of diagram.edges) {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) continue;
      const start = { x: from.x + from.width, y: from.y + from.height / 2 };
      const end = { x: to.x, y: to.y + to.height / 2 };
      const middle =
        end.x > start.x ? (start.x + end.x) / 2 : Math.max(start.x, end.x) + 10;
      const points = [
        start,
        { x: middle, y: start.y },
        { x: middle, y: end.y },
        end,
      ];
      for (let index = 0; index < points.length - 1; index += 1) {
        const segmentStart = points[index];
        const segmentEnd = points[index + 1];
        if (!segmentStart || !segmentEnd) {
          continue;
        }
        this.page.drawLine({
          start: segmentStart,
          end: segmentEnd,
          thickness: 0.7,
          color: edgeColor,
        });
      }
      this.page.drawLine({
        start: end,
        end: { x: end.x - 4, y: end.y + 2.5 },
        thickness: 0.7,
        color: edgeColor,
      });
      this.page.drawLine({
        start: end,
        end: { x: end.x - 4, y: end.y - 2.5 },
        thickness: 0.7,
        color: edgeColor,
      });
      if (edge.label) {
        const value = pdfSafe(edge.label).slice(0, 30);
        const width = Math.min(
          96,
          this.regular.widthOfTextAtSize(value, 4.7) + 7,
        );
        const x = middle - width / 2;
        const y = (start.y + end.y) / 2 - 4;
        this.page.drawRectangle({
          x,
          y,
          width,
          height: 9,
          color: rgb(1, 1, 1),
        });
        this.page.drawText(value, {
          x: x + 3.5,
          y: y + 2.5,
          size: 4.7,
          font: this.regular,
          color: edgeColor,
        });
      }
    }
    for (const node of diagram.nodes) {
      const position = positions.get(node.id);
      if (!position) continue;
      const fill =
        node.kind === "START" || node.kind === "END"
          ? rgb(0.91, 0.95, 0.9)
          : node.kind === "DECISION"
            ? rgb(0.99, 0.95, 0.84)
            : node.kind === "SYSTEM"
              ? rgb(0.94, 0.92, 0.96)
              : rgb(0.985, 0.988, 0.99);
      const border =
        node.kind === "DECISION"
          ? rgb(0.78, 0.43, 0.08)
          : node.kind === "START" || node.kind === "END"
            ? rgb(0.35, 0.49, 0.27)
            : rgb(0.27, 0.39, 0.47);
      this.page.drawRectangle({
        ...position,
        color: fill,
        borderColor: border,
        borderWidth: 0.85,
      });
      const lines = wrap(node.label, this.bold, 5.5, position.width - 8).slice(
        0,
        3,
      );
      const lineHeight = 6.3;
      lines.forEach((line, index) => {
        this.page.drawText(line, {
          x:
            position.x +
            (position.width - this.bold.widthOfTextAtSize(line, 5.5)) / 2,
          y:
            position.y +
            position.height / 2 +
            ((lines.length - 1) * lineHeight) / 2 -
            index * lineHeight -
            2,
          size: 5.5,
          font: this.bold,
          color: rgb(0.15, 0.19, 0.22),
        });
      });
    }
    this.y = top - totalHeight;
    this.newPage();
  }

  entityRelationshipDiagram(
    diagram: ExportEntityRelationshipDiagram,
    alreadyOnLandscapePage = false,
  ): void {
    if (diagram.entities.length === 0) return;
    if (!alreadyOnLandscapePage) this.newPage("landscape");
    this.text(diagram.title, {
      size: 12,
      bold: true,
      color: [0.19, 0.25, 0.29],
      before: alreadyOnLandscapePage ? 14 : 0,
      after: 8,
    });
    const columns = Math.min(
      3,
      Math.max(1, Math.ceil(Math.sqrt(diagram.entities.length))),
    );
    const rows = Math.ceil(diagram.entities.length / columns);
    const gapX = 34;
    const gapY = 44;
    const contentWidth = this.width - this.left - this.right;
    const availableHeight = this.y - 50;
    const boxWidth = (contentWidth - gapX * (columns - 1)) / columns;
    // AI_EXPORT_ER_FIT_BOX_HEIGHT_V1
    // Cada fila de entidades mide lo que necesitan sus atributos (encabezado 27
    // + 15 por atributo) en lugar de una altura fija de 180 con espacio vacío.
    const maximumBoxHeight = Math.min(
      180,
      (availableHeight - gapY * (rows - 1)) / rows,
    );
    const rowHeights = Array.from({ length: rows }, (_, row) => {
      const attributeCount = Math.max(
        1,
        ...diagram.entities
          .slice(row * columns, (row + 1) * columns)
          .map((entity) => entity.attributes.length),
      );
      return Math.min(maximumBoxHeight, 38 + attributeCount * 15 + 6);
    });
    const top = this.y;
    const positions = new Map<
      string,
      { x: number; y: number; width: number; height: number }
    >();
    diagram.entities.forEach((entity, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const offset = rowHeights
        .slice(0, row)
        .reduce((sum, height) => sum + height + gapY, 0);
      positions.set(entity.id, {
        x: this.left + column * (boxWidth + gapX),
        y: top - offset - rowHeights[row]!,
        width: boxWidth,
        height: rowHeights[row]!,
      });
    });
    for (const relationship of diagram.relationships) {
      const from = positions.get(relationship.from);
      const to = positions.get(relationship.to);
      if (!from || !to) continue;
      const fromCenter = {
        x: from.x + from.width / 2,
        y: from.y + from.height / 2,
      };
      const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
      const horizontal =
        Math.abs(toCenter.x - fromCenter.x) >=
        Math.abs(toCenter.y - fromCenter.y);
      const start = horizontal
        ? {
            x: toCenter.x >= fromCenter.x ? from.x + from.width : from.x,
            y: fromCenter.y,
          }
        : {
            x: fromCenter.x,
            y: toCenter.y >= fromCenter.y ? from.y + from.height : from.y,
          };
      const end = horizontal
        ? {
            x: toCenter.x >= fromCenter.x ? to.x : to.x + to.width,
            y: toCenter.y,
          }
        : {
            x: toCenter.x,
            y: toCenter.y >= fromCenter.y ? to.y : to.y + to.height,
          };
      this.page.drawLine({
        start,
        end,
        thickness: 0.8,
        color: rgb(0.33, 0.42, 0.47),
      });
      // El texto largo se recorta en una palabra completa, no a mitad de palabra.
      const labelText = pdfSafe(relationship.label);
      const relationLabel =
        labelText.length > 26
          ? `${labelText.slice(0, 26).replace(/\s+\S*$/u, "")}...`
          : labelText;
      const relation = pdfSafe(
        `${relationship.cardinality} · ${relationLabel}`,
      );
      const width = this.bold.widthOfTextAtSize(relation, 5.8) + 8;
      const x = (start.x + end.x - width) / 2;
      const y = (start.y + end.y) / 2 - 4;
      this.page.drawRectangle({ x, y, width, height: 10, color: rgb(1, 1, 1) });
      this.page.drawText(relation, {
        x: x + 4,
        y: y + 2.7,
        size: 5.8,
        font: this.bold,
        color: rgb(0.31, 0.26, 0.38),
      });
    }
    for (const entity of diagram.entities) {
      const position = positions.get(entity.id);
      if (!position) continue;
      this.page.drawRectangle({
        ...position,
        color: rgb(1, 1, 1),
        borderColor: rgb(0.42, 0.35, 0.49),
        borderWidth: 0.9,
      });
      this.page.drawRectangle({
        x: position.x,
        y: position.y + position.height - 27,
        width: position.width,
        height: 27,
        color: rgb(0.94, 0.92, 0.96),
        borderColor: rgb(0.42, 0.35, 0.49),
        borderWidth: 0.9,
      });
      const title =
        wrap(entity.name, this.bold, 9, position.width - 14)[0] ?? entity.name;
      this.page.drawText(title, {
        x: position.x + 7,
        y: position.y + position.height - 18,
        size: 9,
        font: this.bold,
        color: rgb(0.19, 0.18, 0.22),
      });
      const maxAttributes = Math.max(
        1,
        Math.floor((position.height - 35) / 15),
      );
      entity.attributes.slice(0, maxAttributes).forEach((attribute, index) => {
        const key = [
          attribute.primaryKey ? "PK" : "",
          attribute.foreignKey ? "FK" : "",
        ]
          .filter(Boolean)
          .join("/");
        const prefix = key ? `${key} · ` : attribute.required ? "* " : "";
        const name = `${prefix}${attribute.name}`;
        const type = attribute.dataType;
        const y = position.y + position.height - 43 - index * 15;
        this.page.drawText(pdfSafe(name).slice(0, 31), {
          x: position.x + 8,
          y,
          size: 6.7,
          font:
            attribute.primaryKey || attribute.foreignKey
              ? this.bold
              : this.regular,
          color: rgb(0.24, 0.2, 0.29),
        });
        this.page.drawText(pdfSafe(type).slice(0, 17), {
          x:
            position.x +
            position.width -
            8 -
            this.regular.widthOfTextAtSize(pdfSafe(type).slice(0, 17), 6.2),
          y,
          size: 6.2,
          font: this.regular,
          color: rgb(0.38, 0.44, 0.47),
        });
      });
    }
    this.newPage();
  }

  private elkFlowDiagram(
    diagram: ExportFlowDiagram,
    flowLayout: ProcessFlowLayoutResult,
  ): void {
    this.newPage("landscape");
    this.text(diagram.title, {
      size: 12,
      bold: true,
      color: [0.19, 0.25, 0.29],
      after: 4,
    });
    if (diagram.objective) {
      this.text(`Objetivo: ${diagram.objective}`, {
        size: 7.6,
        color: [0.33, 0.39, 0.42],
        after: 7,
      });
    }

    const contentWidth = this.width - this.left - this.right;
    const availableHeight = Math.max(260, this.y - 52);
    const scale = Math.min(
      1,
      contentWidth / Math.max(flowLayout.width, 1),
      availableHeight / Math.max(flowLayout.height, 1),
    );
    const renderedWidth = flowLayout.width * scale;
    const originX = this.left + (contentWidth - renderedWidth) / 2;
    const originY = this.y;

    const point = (x: number, y: number) => ({
      x: originX + x * scale,
      y: originY - y * scale,
    });

    for (const edge of flowLayout.edges) {
      const color =
        edge.kind === "return" ? rgb(0.76, 0.48, 0.08) : rgb(0.31, 0.4, 0.46);
      const commands = [
        ...edge.path.matchAll(
          /([ML])\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/gu,
        ),
      ];
      let previous: { x: number; y: number } | null = null;
      let finalSegment: {
        start: { x: number; y: number };
        end: { x: number; y: number };
      } | null = null;
      for (const command of commands) {
        const current = point(Number(command[2]), Number(command[3]));
        if (command[1] === "L" && previous) {
          this.page.drawLine({
            start: previous,
            end: current,
            thickness: 0.85,
            color,
            dashArray: edge.kind === "return" ? [4, 3] : undefined,
          });
          finalSegment = { start: previous, end: current };
        }
        previous = current;
      }
      if (finalSegment) {
        const angle = Math.atan2(
          finalSegment.end.y - finalSegment.start.y,
          finalSegment.end.x - finalSegment.start.x,
        );
        for (const delta of [Math.PI * 0.78, -Math.PI * 0.78]) {
          this.page.drawLine({
            start: finalSegment.end,
            end: {
              x: finalSegment.end.x + Math.cos(angle + delta) * 4,
              y: finalSegment.end.y + Math.sin(angle + delta) * 4,
            },
            thickness: 0.85,
            color,
          });
        }
      }
      if (edge.label) {
        const label = pdfSafe(edge.label).slice(0, 34);
        const size = Math.max(5.4, Math.min(7, 6.2 * Math.sqrt(scale)));
        const labelWidth = this.regular.widthOfTextAtSize(label, size) + 7;
        const labelPoint = point(edge.labelX, edge.labelY);
        this.page.drawRectangle({
          x: labelPoint.x - labelWidth / 2,
          y: labelPoint.y - 4,
          width: labelWidth,
          height: 10,
          color: rgb(1, 1, 1),
          borderColor: color,
          borderWidth: 0.35,
        });
        this.page.drawText(label, {
          x: labelPoint.x - labelWidth / 2 + 3.5,
          y: labelPoint.y - 1,
          size,
          font: this.bold,
          color,
        });
      }
    }

    for (const node of flowLayout.nodes) {
      const position = {
        x: originX + node.x * scale,
        y: originY - (node.y + node.height) * scale,
        width: node.width * scale,
        height: node.height * scale,
      };
      const fill =
        node.kind === "START" || node.kind === "END"
          ? rgb(0.91, 0.95, 0.9)
          : node.kind === "DECISION"
            ? rgb(0.99, 0.95, 0.84)
            : node.kind === "SYSTEM"
              ? rgb(0.94, 0.92, 0.96)
              : node.kind === "ACTOR"
                ? rgb(0.91, 0.95, 0.98)
                : rgb(0.975, 0.978, 0.98);
      const border =
        node.kind === "DECISION"
          ? rgb(0.76, 0.48, 0.08)
          : node.kind === "START" || node.kind === "END"
            ? rgb(0.35, 0.49, 0.27)
            : node.kind === "SYSTEM"
              ? rgb(0.4, 0.33, 0.47)
              : rgb(0.31, 0.4, 0.46);
      this.page.drawRectangle({
        ...position,
        color: fill,
        borderColor: border,
        borderWidth: 0.8,
      });
      const fontSize = Math.max(5.2, Math.min(7.2, 7 * Math.sqrt(scale)));
      const lines = wrap(
        node.label,
        this.bold,
        fontSize,
        Math.max(24, position.width - 10),
      ).slice(0, 3);
      const lineHeight = fontSize * 1.18;
      const textHeight = lines.length * lineHeight;
      lines.forEach((line, lineIndex) => {
        this.page.drawText(line, {
          x:
            position.x +
            (position.width - this.bold.widthOfTextAtSize(line, fontSize)) / 2,
          y:
            position.y +
            (position.height + textHeight) / 2 -
            (lineIndex + 1) * lineHeight +
            1,
          size: fontSize,
          font: this.bold,
          color: rgb(0.15, 0.19, 0.22),
        });
      });
    }

    this.y = 44;
    this.newPage();
  }

  flowDiagram(
    diagram: ExportFlowDiagram,
    flowLayout: ProcessFlowLayoutResult | null = null,
  ): void {
    if (diagram.nodes.length === 0 || diagram.edges.length === 0) return;
    if ((diagram.lanes?.length ?? 0) > 0) {
      this.swimlaneFlowDiagram(diagram);
      return;
    }
    if (flowLayout) {
      this.elkFlowDiagram(diagram, flowLayout);
      return;
    }
    this.text(diagram.title, {
      size: 9.5,
      bold: true,
      color: [0.19, 0.25, 0.29],
      before: 2,
      after: 6,
    });
    const columns = Math.min(3, Math.max(1, diagram.nodes.length));
    const gapX = 20;
    const gapY = 26;
    const contentWidth = this.width - this.left - this.right;
    const boxWidth = (contentWidth - gapX * (columns - 1)) / columns;
    const boxHeight = 39;
    const rows = Math.ceil(diagram.nodes.length / columns);
    const totalHeight = rows * boxHeight + (rows - 1) * gapY + 8;
    if (this.y - totalHeight < 48) this.newPage();
    const top = this.y;
    const positions = new Map<
      string,
      { x: number; y: number; width: number; height: number }
    >();
    diagram.nodes.forEach((node, index) => {
      const row = Math.floor(index / columns);
      const offset = index % columns;
      const column = row % 2 === 0 ? offset : columns - 1 - offset;
      positions.set(node.id, {
        x: this.left + column * (boxWidth + gapX),
        y: top - row * (boxHeight + gapY) - boxHeight,
        width: boxWidth,
        height: boxHeight,
      });
    });
    const lineColor = rgb(0.38, 0.43, 0.46);
    for (const edge of diagram.edges) {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) continue;
      const start = { x: from.x + from.width / 2, y: from.y };
      const end = { x: to.x + to.width / 2, y: to.y + to.height };
      if (Math.abs(start.y - end.y) < 4) {
        start.x = from.x < to.x ? from.x + from.width : from.x;
        start.y = from.y + from.height / 2;
        end.x = from.x < to.x ? to.x : to.x + to.width;
        end.y = to.y + to.height / 2;
      }
      this.page.drawLine({ start, end, thickness: 0.8, color: lineColor });
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const arrow = 4;
      for (const delta of [Math.PI * 0.78, -Math.PI * 0.78]) {
        this.page.drawLine({
          start: end,
          end: {
            x: end.x + Math.cos(angle + delta) * arrow,
            y: end.y + Math.sin(angle + delta) * arrow,
          },
          thickness: 0.8,
          color: lineColor,
        });
      }
      if (edge.label) {
        const edgeText = pdfSafe(edge.label).slice(0, 34);
        const edgeWidth = this.regular.widthOfTextAtSize(edgeText, 5.8) + 5;
        const x = (start.x + end.x) / 2 - edgeWidth / 2;
        const y = (start.y + end.y) / 2 - 2;
        this.page.drawRectangle({
          x,
          y: y - 2,
          width: edgeWidth,
          height: 9,
          color: rgb(1, 1, 1),
        });
        this.page.drawText(edgeText, {
          x: x + 2.5,
          y,
          size: 5.8,
          font: this.regular,
          color: lineColor,
        });
      }
    }
    for (const node of diagram.nodes) {
      const position = positions.get(node.id);
      if (!position) continue;
      const fill =
        node.kind === "START" || node.kind === "END"
          ? rgb(0.91, 0.95, 0.9)
          : node.kind === "DECISION"
            ? rgb(0.99, 0.95, 0.84)
            : node.kind === "SYSTEM"
              ? rgb(0.91, 0.94, 0.96)
              : rgb(0.975, 0.978, 0.98);
      const border =
        node.kind === "DECISION"
          ? rgb(0.76, 0.48, 0.08)
          : node.kind === "START" || node.kind === "END"
            ? rgb(0.35, 0.49, 0.27)
            : rgb(0.39, 0.46, 0.49);
      this.page.drawRectangle({
        ...position,
        color: fill,
        borderColor: border,
        borderWidth: 0.8,
      });
      const lines = wrap(node.label, this.bold, 7, position.width - 12).slice(
        0,
        3,
      );
      const lineHeight = 8.2;
      const textHeight = lines.length * lineHeight;
      lines.forEach((line, lineIndex) => {
        this.page.drawText(line, {
          x:
            position.x +
            (position.width - this.bold.widthOfTextAtSize(line, 7)) / 2,
          y:
            position.y +
            (position.height + textHeight) / 2 -
            (lineIndex + 1) * lineHeight +
            2,
          size: 7,
          font: this.bold,
          color: rgb(0.15, 0.19, 0.22),
        });
      });
    }
    this.y -= totalHeight;
  }

  table(table: ExportContentTable): void {
    if (table.headers.length === 0 || table.rows.length === 0) return;
    const width = this.width - this.left - this.right;
    const weights =
      table.columnWeights?.length === table.headers.length
        ? table.columnWeights
        : table.headers.map(() => 1);
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    const columnWidths = weights.map((value) => (value / totalWeight) * width);
    const fontSize = table.headers.length >= 5 ? 6.25 : 6.8;
    const lineHeight = fontSize * 1.25;
    const padding = 3.5;

    const wrapped = (row: readonly string[], bold: boolean): string[][] =>
      table.headers.map((_, index) =>
        wrap(
          row[index] ?? "Sin información",
          bold ? this.bold : this.regular,
          fontSize,
          (columnWidths[index] ?? width / table.headers.length) - padding * 2,
        ),
      );

    const headerLineCount = Math.max(
      1,
      ...wrapped(table.headers, true).map((cell) => cell.length),
    );
    const firstRowLineCount = Math.max(
      1,
      ...wrapped(table.rows[0] ?? [], false).map((cell) => cell.length),
    );
    this.ensure(
      30 +
        headerLineCount * lineHeight +
        Math.min(firstRowLineCount, 4) * lineHeight +
        padding * 4,
    );
    this.text(table.title, {
      size: 10.5,
      bold: true,
      color: NAVI_DOCUMENT_PDF_COLORS.operation,
      before: 5,
      after: 5,
    });

    const drawChunk = (
      cells: readonly (readonly string[])[],
      start: number,
      count: number,
      header: boolean,
    ): void => {
      const height = count * lineHeight + padding * 2;
      let x = this.left;
      for (let column = 0; column < cells.length; column += 1) {
        const columnWidth = columnWidths[column] ?? width / cells.length;
        this.page.drawRectangle({
          x,
          y: this.y - height,
          width: columnWidth,
          height,
          color: header
            ? rgb(...NAVI_DOCUMENT_PDF_COLORS.institutional)
            : rgb(...NAVI_DOCUMENT_PDF_COLORS.surfaceSoft),
          borderColor: rgb(...NAVI_DOCUMENT_PDF_COLORS.border),
          borderWidth: 0.5,
        });
        let lineY = this.y - padding - fontSize;
        for (const line of cells[column]?.slice(start, start + count) ?? []) {
          this.drawTextWithPendingUnderline(
            line,
            x + padding,
            lineY,
            fontSize,
            header ? this.bold : this.regular,
            header
              ? rgb(...NAVI_DOCUMENT_PDF_COLORS.white)
              : rgb(...NAVI_DOCUMENT_PDF_COLORS.text),
          );
          lineY -= lineHeight;
        }
        x += columnWidth;
      }
      this.y -= height;
    };

    const drawHeader = (): void => {
      const cells = wrapped(table.headers, true);
      const count = Math.max(1, ...cells.map((cell) => cell.length));
      this.ensure(count * lineHeight + padding * 2);
      drawChunk(cells, 0, count, true);
    };

    drawHeader();
    for (const row of table.rows) {
      const cells = wrapped(row, false);
      const totalLines = Math.max(1, ...cells.map((cell) => cell.length));
      let start = 0;
      let freshPageAttempted = false;
      while (start < totalLines) {
        const availableLines = Math.max(
          1,
          Math.floor((this.y - 48 - padding * 2) / lineHeight),
        );
        if (
          start === 0 &&
          !freshPageAttempted &&
          totalLines > availableLines &&
          totalLines <= 70
        ) {
          this.newPage();
          drawHeader();
          freshPageAttempted = true;
          continue;
        }
        if (availableLines < 2) {
          this.newPage();
          drawHeader();
          continue;
        }
        const count = Math.min(totalLines - start, availableLines);
        drawChunk(cells, start, count, false);
        start += count;
        if (start < totalLines) {
          this.newPage();
          drawHeader();
        }
      }
    }
    this.y -= 8;
  }

  footer(): void {
    this.pages.forEach((page, index) => {
      const pageWidth = page.getWidth();
      page.drawLine({
        start: { x: this.left, y: 38 },
        end: { x: pageWidth - this.right, y: 38 },
        thickness: 0.5,
        color: rgb(...NAVI_DOCUMENT_PDF_COLORS.border),
      });
      page.drawText(
        `Documento controlado | ${this.projectCode} | Página ${index + 1} de ${this.pages.length}`,
        {
          x: this.left,
          y: 24,
          size: 8,
          font: this.regular,
          color: rgb(...NAVI_DOCUMENT_PDF_COLORS.muted),
        },
      );
    });
  }
}

export async function renderPdf(
  input: RenderApprovedDocumentInput,
): Promise<RenderedExportArtifact> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (const font of [regular, bold]) {
    const widthOfTextAtSize = font.widthOfTextAtSize.bind(font);
    font.widthOfTextAtSize = (text, size) =>
      widthOfTextAtSize(pdfSafe(text), size);
  }
  let templateLogo: PDFImage | null = null;
  if (input.templateLogo?.dataBase64) {
    const imageBytes = Buffer.from(input.templateLogo.dataBase64, "base64");
    templateLogo =
      input.templateLogo.mediaType === "image/png"
        ? await pdf.embedPng(imageBytes)
        : await pdf.embedJpg(imageBytes);
  }
  const layout = new PdfLayout(
    pdf,
    regular,
    bold,
    input.project.code,
    templateLogo,
  );
  layout.text(corporateMetadata(input)[0]?.[1] ?? input.document.title, {
    size: 16,
    bold: true,
    color: NAVI_DOCUMENT_PDF_COLORS.institutional,
    before: 8,
    after: 5,
  });
  layout.text(documentTemplateDescription(input), {
    size: 9,
    color: NAVI_DOCUMENT_PDF_COLORS.muted,
    after: 9,
  });
  layout.metadata(corporateMetadata(input));

  for (const section of buildExportDocumentSections(input)) {
    const isScrumPlan = section.number === 14;
    const isBacklogTree =
      section.number === 7 &&
      section.lines.some((line) => exportTreeNodeKind(line));
    const timeline = isScrumPlan
      ? buildExportEpicTimeline(
          versionSection(input, "scrumPlan")?.content ?? {},
          versionSection(input, "backlogStructure")?.content ?? {},
        )
      : null;
    // El árbol del Esquema ya no fuerza una página nueva: seguía a los
    // Requerimientos dejando media página en blanco.
    if (timeline) layout.newPage("landscape");
    // Un título de subsección sin texto propio quedaba solo al pie de la
    // página anterior; se coloca sobre el diagrama en su página horizontal.
    const diagramOnly =
      Boolean(section.entityRelationshipDiagram) &&
      section.lines.length === 0 &&
      !section.flowDiagram;
    if (diagramOnly) layout.newPage("landscape");
    const firstBlockHeight = section.objectivesLayout
      ? 170
      : section.kpiCards?.length
        ? 150
        : section.tables.length > 0
          ? 145
          : 70;

    const headingAndIntroHeight = section.headingNumber ? 84 : 74;

    layout.ensure(Math.max(firstBlockHeight, headingAndIntroHeight));
    layout.sectionHeading(
      section.headingNumber ?? section.displayNumber ?? section.number,
      exportSectionTitle(section),
      section.headingNumber ? "subsection" : "section",
    );
    if (timeline) {
      layout.epicTimeline(timeline, section.displayNumber ?? section.number);
    }
    if (isBacklogTree) {
      layout.backlogTree(
        section.lines,
        section.displayNumber ?? section.number,
      );
    } else if (section.objectivesLayout) {
      layout.objectives(section.objectivesLayout);
    } else {
      if (timeline) {
        layout.newPage();
        layout.text(
          `${exportNumber(section.displayNumber ?? section.number)} PLAN SCRUM · Detalle de Sprints`,
          { bold: true, size: 12, after: 12 },
        );
      }
      for (const line of numberedSectionLines(section)) {
        const lineHeadingDepth = exportLineHeadingDepth(line);
        const isLineHeading = lineHeadingDepth !== null;
        const treeNodeKind = exportTreeNodeKind(line);
        if (treeNodeKind) {
          layout.treeNode(line, treeNodeKind);
          continue;
        }
        layout.text(line.text, {
          size: isLineHeading
            ? lineHeadingDepth === 2
              ? isScrumPlan
                ? 9.8
                : 10.5
              : 9.5
            : isScrumPlan
              ? 8.3
              : 9,
          bold: isLineHeading,
          color: isLineHeading
            ? NAVI_DOCUMENT_PDF_COLORS.operation
            : NAVI_DOCUMENT_PDF_COLORS.text,
          indent: Math.min(line.level, 3) * 10,
          before: isLineHeading ? (isScrumPlan ? 2.5 : 4) : 0,
          after: isLineHeading
            ? isScrumPlan
              ? 2
              : 4
            : isScrumPlan
              ? 1.25
              : 3.5,
          bullet: line.bullet,
        });
      }
    }
    if (section.kpiCards?.length) {
      layout.kpiCards(
        section.kpiCards,
        section.displayNumber ?? section.number,
      );
    }
    if (section.flowDiagram) {
      layout.flowDiagram(
        section.flowDiagram,
        (section.flowDiagram.lanes?.length ?? 0) > 0
          ? null
          : await exportFlowLayout(section.flowDiagram),
      );
    }
    if (section.entityRelationshipDiagram) {
      layout.entityRelationshipDiagram(
        section.entityRelationshipDiagram,
        diagramOnly,
      );
    }
    for (const table of section.tables) layout.table(table);
  }
  layout.footer();
  return {
    buffer: Buffer.from(await pdf.save()),
    mediaType: "application/pdf",
    extension: "pdf",
  };
}
