import { type DocumentSectionKey } from "@levantamiento-rq/shared-contracts";
import { text, stringArraySchema } from "./ai-draft-schema-primitives";
import { PENDING_SUMMARY_LIMIT } from "./ai-draft-constants";

const objectivesSectionContentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["general", "qualitative", "quantitative"],
  properties: {
    general: text(5_000),
    qualitative: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: text(2_000),
    },
    quantitative: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: text(2_000),
    },
  },
} as const;

const scopeKpiSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "relatedObjective", "measurement", "target"],
  properties: {
    name: {
      ...text(300),
      description:
        "Nombre del indicador de ejecución: Avance general del proyecto, Cumplimiento de objetivos o Cumplimiento de entregables.",
    },
    relatedObjective: {
      ...text(2_000),
      description:
        "Copia literal de un objetivo específico presente en qualitative o quantitative.",
    },
    measurement: {
      ...text(2_000),
      description:
        "Fórmula porcentual verificable calculada con tareas, historias o hitos importados desde Azure DevOps.",
    },
    target: {
      ...text(1_000),
      description: "Meta de finalización del indicador, establecida en 100%.",
    },
  },
} as const;

const scopeSectionContentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["included", "excluded", "involvedSystems", "kpis"],
  properties: {
    included: stringArraySchema(100),
    excluded: stringArraySchema(100),
    involvedSystems: stringArraySchema(100),
    kpis: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: scopeKpiSchema,
    },
  },
} as const;

const headerSectionContentSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "projectCode",
    "documentVersion",
    "createdDate",
    "requestingArea",
    "status",
  ],
  properties: {
    title: text(1_000),
    projectCode: text(200),
    documentVersion: text(100),
    createdDate: text(100),
    requestingArea: text(500),
    status: text(100),
  },
} as const;

const solutionProposalSectionContentSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "objective",
    "description",
    "involvedElements",
    "flowAlignment",
    "prototypeMarkdown",
  ],
  properties: {
    objective: text(2_000),
    description: text(3_000),
    involvedElements: stringArraySchema(12, 500),
    flowAlignment: {
      type: "object",
      additionalProperties: false,
      required: ["currentState", "evaluation", "expectedResult"],
      properties: {
        currentState: text(2_000),
        evaluation: text(2_000),
        expectedResult: text(2_000),
      },
    },
    prototypeMarkdown: {
      anyOf: [text(30_000), { type: "null" }],
    },
  },
} as const;

const problemDescriptionSectionContentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["currentState", "operationalImpact"],
  properties: {
    currentState: text(15_000),
    operationalImpact: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: text(2_000),
    },
  },
} as const;

const pendingSectionContentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["assumptions", "dependencies", "pendingItems"],
  properties: {
    assumptions: stringArraySchema(PENDING_SUMMARY_LIMIT),
    dependencies: stringArraySchema(PENDING_SUMMARY_LIMIT),
    pendingItems: stringArraySchema(PENDING_SUMMARY_LIMIT),
  },
} as const;

const approvalSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "position", "responsibility", "approvalMoment", "status"],
  properties: {
    name: text(500),
    position: text(500),
    responsibility: {
      type: "string",
      enum: ["Elaboración", "Revisión", "Aprobación"],
    },
    approvalMoment: text(1_000),
    status: text(200),
  },
} as const;

const changeControlSchema = {
  type: "object",
  additionalProperties: false,
  required: ["version", "date", "description", "approvedBy"],
  properties: {
    version: text(100),
    date: text(100),
    description: text(2_000),
    approvedBy: text(500),
  },
} as const;

const approvalsSectionContentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["approvals", "changeControl"],
  properties: {
    approvals: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: approvalSchema,
    },
    changeControl: {
      type: "array",
      minItems: 0,
      maxItems: 1,
      items: changeControlSchema,
    },
  },
} as const;

export function sectionContentSchema(key: DocumentSectionKey) {
  if (key === "header") return headerSectionContentSchema;
  if (key === "objectives") return objectivesSectionContentSchema;
  if (key === "problemDescription")
    return problemDescriptionSectionContentSchema;
  if (key === "scope") return scopeSectionContentSchema;
  if (key === "solutionProposal") return solutionProposalSectionContentSchema;
  if (key === "assumptionsDependenciesPending")
    return pendingSectionContentSchema;
  if (key === "approvalsAndChangeControl") return approvalsSectionContentSchema;
  return text(30_000);
}
