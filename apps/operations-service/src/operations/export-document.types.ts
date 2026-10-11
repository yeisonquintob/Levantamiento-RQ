import {
  type DocumentTemplateLogo,
  type DocumentVersionDetail,
  type ProjectDetail,
  type RequirementDocumentDetail,
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

export interface ExportObjectivesLayout {
  general: string;
  qualitative: readonly string[];
  quantitative: readonly string[];
}

export interface ExportKpiCard {
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

export type ExportPresentationProfile =
  "COMPACT" | "BALANCED" | "EXTENDED" | "ERP";

export type ExportHeadingKind = "section" | "subsection";

export type ExportTreeNodeKind = "EPIC" | "FEATURE" | "HU" | "TAREA";
