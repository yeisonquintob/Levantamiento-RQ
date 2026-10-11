import {
  AI_BACKLOG_CODE_PATTERNS,
  AI_FUNCTIONAL_CODE_PATTERNS,
  AI_PLANNING_CODE_PATTERNS,
  AI_ENTITY_CARDINALITIES,
  AI_BACKLOG_TASK_ORIGINS,
  AI_PROCESS_LANE_KINDS,
  AI_PROCESS_NODE_KINDS,
  AI_SCRUM_TASK_TYPES,
  conciseFunctionalStoryDescription,
  DOCUMENT_SCRUM_SECTION_DEFINITION,
  DOCUMENT_SECTION_DEFINITIONS,
  getDocumentSectionDefinitions,
  type AiAnalysisDraft,
  type AiAnalysisDraftRequirement,
  type AiAnalysisDraftSection,
  type AiAnalysisDraftV2,
  type AiAnalysisDraftV3,
  type AiAnalysisDraftV4,
  type AiAnalysisDraftV41,
  type AiBacklogStructure,
  type AiBacklogTask,
  type AiBacklogUserStory,
  type AiFunctionalUserStoryV41,
  type AiPlanningBacklogFeatureV41,
  type AiPlanningBacklogStructureV41,
  type AiPlanningBacklogTaskV41,
  type AiPlanningBacklogUserStoryV41,
  type AiPlanningPendingAssignmentsV41,
  type AiEntityRelationshipModel,
  type AiFeature,
  type AiProcessFlow,
  type AiSwimlaneProcessFlow,
  type AiRequiredField,
  type AiScrumPlan,
  type AiScrumSprint,
  type AiScrumTask,
  type AiStructuredContradiction,
  type AiTestScenario,
  type AiUserStory,
  type DocumentSectionKey,
  type DocumentJsonValue,
  type DocumentTemplateType,
} from "@levantamiento-rq/shared-contracts";

const UUID_PATTERN =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";
const ISO_DATE_PATTERN = "^[0-9]{4}-[0-9]{2}-[0-9]{2}$";
const PENDING_DEFINITION = "[PENDIENTE POR DEFINIR]";
const PENDING_SUMMARY_LIMIT = 3;
const CONTRADICTION_SUMMARY_LIMIT = 2;

const DEPTH_LIMITS: Readonly<
  Record<
    DocumentTemplateType,
    {
      features: number;
      userStories: number;
      tests: number;
      requirements: number;
      sprints: number;
    }
  >
> = {
  SMALL_REQUIREMENT: {
    features: 3,
    userStories: 6,
    tests: 10,
    requirements: 20,
    sprints: 4,
  },
  MEDIUM_REQUIREMENT: {
    features: 10,
    userStories: 30,
    tests: 60,
    requirements: 100,
    sprints: 12,
  },
  LARGE_REQUIREMENT: {
    features: 40,
    userStories: 150,
    tests: 250,
    requirements: 300,
    sprints: 40,
  },
  ERP_FDD: {
    features: 20,
    userStories: 80,
    tests: 150,
    requirements: 250,
    sprints: 30,
  },
};

const text = (maximum = 2_000, minimum = 1) =>
  ({
    type: "string",
    minLength: minimum,
    maxLength: maximum,
  }) as const;

const nullableText = (maximum = 2_000) =>
  ({
    anyOf: [text(maximum), { type: "null" }],
  }) as const;

const sourceIdsSchema = (maximum = 100) =>
  ({
    type: "array",
    maxItems: maximum,
    items: { type: "string", pattern: UUID_PATTERN },
  }) as const;

/*
 * AI_V41_ALLOWED_SOURCE_IDS_SCHEMA
 *
 * El schema estructurado enviado al proveedor debe impedir, no solo detectar,
 * referencias de evidencia que no pertenecen a la solicitud. V4.0 histórico
 * permanece intacto; esta restricción se aplica únicamente al schema V4.1
 * construido para una ejecución concreta.
 */
const AI_SOURCE_REFERENCE_SCHEMA_KEYS = new Set([
  "sourceIds",
  "sourceIdsA",
  "sourceIdsB",
]);

function restrictSchemaSourceIdsToAllowedValues<T>(
  schema: T,
  allowedSourceIds: readonly string[],
): T {
  if (allowedSourceIds.length === 0) {
    return schema;
  }

  const uuidPattern = new RegExp(UUID_PATTERN);
  const canonicalByLowerCase = new Map<string, string>();

  for (const rawSourceId of allowedSourceIds) {
    const sourceId = rawSourceId.trim();
    if (!uuidPattern.test(sourceId)) {
      throw new Error(
        `allowedSourceIds contiene un UUID inválido: ${rawSourceId}`,
      );
    }
    canonicalByLowerCase.set(sourceId.toLowerCase(), sourceId);
  }

  const allowed = [...canonicalByLowerCase.values()];
  if (allowed.length === 0) {
    throw new Error(
      "allowedSourceIds no puede quedar vacío tras normalizarlo.",
    );
  }

  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(visit);
    }
    if (!value || typeof value !== "object") {
      return value;
    }

    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (
        AI_SOURCE_REFERENCE_SCHEMA_KEYS.has(key) &&
        child &&
        typeof child === "object" &&
        !Array.isArray(child)
      ) {
        const sourceArraySchema = visit(child) as Record<string, unknown>;
        next[key] = {
          ...sourceArraySchema,
          items: {
            type: "string",
            enum: allowed,
          },
        };
        continue;
      }
      next[key] = visit(child);
    }
    return next;
  };

  return visit(schema) as T;
}

const stringArraySchema = (maximum = 100, itemMaximum = 2_000) =>
  ({
    type: "array",
    maxItems: maximum,
    items: text(itemMaximum),
  }) as const;

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

function sectionContentSchema(key: DocumentSectionKey) {
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

const requirementSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "sectionKey",
    "code",
    "title",
    "description",
    "requirementType",
    "acceptanceCriteria",
    "sourceIds",
    "milestone",
    "functionality",
    "category",
    "measure",
    "target",
  ],
  properties: {
    sectionKey: {
      type: "string",
      enum: ["milestones", "nonFunctionalRequirements"],
    },
    code: text(50),
    title: text(300),
    description: text(10_000),
    requirementType: text(80),
    acceptanceCriteria: stringArraySchema(30),
    sourceIds: sourceIdsSchema(),
    milestone: nullableText(500),
    functionality: nullableText(500),
    category: nullableText(300),
    measure: nullableText(2_000),
    target: nullableText(2_000),
  },
} as const;

const processFlowSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "nodes", "edges", "sourceIds"],
  properties: {
    title: text(300),
    nodes: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "kind", "label"],
        properties: {
          id: text(80),
          kind: { type: "string", enum: [...AI_PROCESS_NODE_KINDS] },
          label: text(500),
        },
      },
    },
    edges: {
      type: "array",
      maxItems: 200,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to", "label"],
        properties: {
          from: text(80),
          to: text(80),
          label: nullableText(300),
        },
      },
    },
    sourceIds: sourceIdsSchema(),
  },
} as const;

const swimlaneProcessFlowSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "objective",
    "lanes",
    "nodes",
    "edges",
    "problems",
    "improvements",
    "expectedResults",
    "sourceIds",
  ],
  properties: {
    title: text(300),
    objective: nullableText(2_000),
    lanes: {
      type: "array",
      maxItems: 50,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "kind"],
        properties: {
          id: text(80),
          name: text(300),
          kind: { type: "string", enum: [...AI_PROCESS_LANE_KINDS] },
        },
      },
    },
    nodes: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "kind", "label", "laneId"],
        properties: {
          id: text(80),
          kind: { type: "string", enum: [...AI_PROCESS_NODE_KINDS] },
          label: text(500),
          laneId: { anyOf: [text(80), { type: "null" }] },
        },
      },
    },
    edges: processFlowSchema.properties.edges,
    problems: stringArraySchema(100),
    improvements: stringArraySchema(100),
    expectedResults: stringArraySchema(100),
    sourceIds: sourceIdsSchema(),
  },
} as const;

const entityRelationshipSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "entities", "relationships", "sourceIds"],
  properties: {
    title: text(300),
    entities: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "description", "attributes"],
        properties: {
          id: text(80),
          name: text(300),
          description: text(2_000),
          attributes: {
            type: "array",
            maxItems: 100,
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "name",
                "dataType",
                "primaryKey",
                "foreignKey",
                "required",
              ],
              properties: {
                name: text(200),
                dataType: text(120),
                primaryKey: { type: "boolean" },
                foreignKey: { type: "boolean" },
                required: { type: "boolean" },
              },
            },
          },
        },
      },
    },
    relationships: {
      type: "array",
      maxItems: 200,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to", "cardinality", "label"],
        properties: {
          from: text(80),
          to: text(80),
          cardinality: {
            type: "string",
            enum: [...AI_ENTITY_CARDINALITIES],
          },
          label: text(300),
        },
      },
    },
    sourceIds: sourceIdsSchema(),
  },
} as const;

const acceptanceCriterionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "given", "when", "then", "sourceIds"],
  properties: {
    code: text(50),
    given: text(2_000),
    when: text(2_000),
    then: text(2_000),
    sourceIds: sourceIdsSchema(),
  },
} as const;

const requiredFieldSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "dataType", "required", "validation", "sourceIds"],
  properties: {
    name: text(200),
    dataType: text(120),
    required: { type: "boolean" },
    validation: text(2_000),
    sourceIds: sourceIdsSchema(),
  },
} as const;

const userStorySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "code",
    "featureCode",
    "title",
    "role",
    "want",
    "benefit",
    "context",
    "premises",
    "impactedSystems",
    "fields",
    "acceptanceCriteria",
    "sourceIds",
  ],
  properties: {
    code: text(50),
    featureCode: text(50),
    title: text(300),
    role: text(500),
    want: text(2_000),
    benefit: text(2_000),
    context: text(5_000),
    premises: stringArraySchema(50),
    impactedSystems: stringArraySchema(50, 500),
    fields: {
      type: "array",
      maxItems: 100,
      items: requiredFieldSchema,
    },
    acceptanceCriteria: {
      type: "array",
      minItems: 1,
      maxItems: 50,
      items: acceptanceCriterionSchema,
    },
    sourceIds: sourceIdsSchema(),
  },
} as const;

const backlogTaskSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "code",
    "title",
    "description",
    "type",
    "origin",
    "dependencyCodes",
    "sourceIds",
  ],
  properties: {
    code: text(50),
    title: text(300),
    description: text(2_000),
    type: { type: "string", enum: [...AI_SCRUM_TASK_TYPES] },
    origin: { type: "string", enum: [...AI_BACKLOG_TASK_ORIGINS] },
    dependencyCodes: stringArraySchema(30, 50),
    sourceIds: sourceIdsSchema(),
  },
} as const;

const backlogUserStorySchema = {
  ...userStorySchema,
  required: [...userStorySchema.required, "description", "tasks"],
  properties: {
    ...userStorySchema.properties,
    description: text(5_000),
    tasks: { type: "array", maxItems: 200, items: backlogTaskSchema },
  },
} as const;

const backlogStructureSchema = (
  maximumFeatures: number,
  maximumStories: number,
) =>
  ({
    type: "object",
    additionalProperties: false,
    required: ["epics"],
    properties: {
      epics: {
        type: "array",
        maxItems: maximumFeatures,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["code", "title", "description", "sourceIds", "features"],
          properties: {
            code: text(50),
            title: text(300),
            description: text(5_000),
            sourceIds: sourceIdsSchema(),
            features: {
              type: "array",
              maxItems: maximumFeatures,
              items: {
                type: "object",
                additionalProperties: false,
                required: [
                  "code",
                  "title",
                  "description",
                  "sourceIds",
                  "userStories",
                ],
                properties: {
                  code: text(50),
                  title: text(300),
                  description: text(5_000),
                  sourceIds: sourceIdsSchema(),
                  userStories: {
                    type: "array",
                    maxItems: maximumStories,
                    items: backlogUserStorySchema,
                  },
                },
              },
            },
          },
        },
      },
    },
  }) as const;

/*
 * AI_V41_POINT_6_7_DECOUPLED_SCHEMA
 *
 * V4.0.0 se mantiene intacto para resultados históricos. Las nuevas llamadas
 * OpenAI usan 4.1.0: Punto 6 y Punto 7 ya no comparten la misma HU.
 */
const functionalUserStoryV41Schema = {
  type: "object",
  additionalProperties: false,
  required: [
    "code",
    "title",
    "description",
    "assignmentStatus",
    "documentationStatus",
    "documentationObservation",
    "milestone",
    "functionality",
    "milestoneDescription",
    "assignmentObservation",
    "role",
    "want",
    "benefit",
    "context",
    "premises",
    "impactedSystems",
    "fields",
    "acceptanceCriteria",
    "functionalNeedCodes",
    "sourceIds",
  ],
  properties: {
    code: text(50),
    title: text(300),
    description: text(300),
    assignmentStatus: {
      type: "string",
      enum: ["ASSIGNED", "PENDING_ASSIGNMENT"],
    },
    documentationStatus: {
      type: "string",
      enum: ["COMPLETE", "PENDING_DOCUMENTATION"],
    },
    documentationObservation: nullableText(2_000),
    milestone: nullableText(50),
    functionality: nullableText(500),
    milestoneDescription: nullableText(5_000),
    assignmentObservation: nullableText(2_000),
    role: text(500),
    want: text(2_000),
    benefit: text(2_000),
    context: text(5_000),
    premises: stringArraySchema(50),
    impactedSystems: stringArraySchema(50, 500),
    fields: { type: "array", maxItems: 100, items: requiredFieldSchema },
    acceptanceCriteria: {
      type: "array",
      minItems: 0,
      maxItems: 50,
      items: acceptanceCriterionSchema,
    },
    functionalNeedCodes: {
      type: "array",
      minItems: 0,
      maxItems: 100,
      items: { type: "string", pattern: "^FN-[0-9]{3,}$" },
    },
    sourceIds: sourceIdsSchema(),
  },
} as const;

const planningBacklogTaskV41Schema = {
  type: "object",
  additionalProperties: false,
  required: [
    "code",
    "title",
    "description",
    "sourceNumber",
    "type",
    "origin",
    "dependencyCodes",
    "sourceIds",
  ],
  properties: {
    code: text(50),
    title: text(300),
    description: text(2_000),
    sourceNumber: nullableText(120),
    type: { type: "string", enum: [...AI_SCRUM_TASK_TYPES] },
    origin: { type: "string", enum: [...AI_BACKLOG_TASK_ORIGINS] },
    dependencyCodes: stringArraySchema(30, 50),
    sourceIds: sourceIdsSchema(),
  },
} as const;

const planningBacklogUserStoryV41Schema = {
  type: "object",
  additionalProperties: false,
  required: [
    "code",
    "title",
    "description",
    "sourceNumber",
    "functionalRequirementCodes",
    "sourceIds",
    "tasks",
  ],
  properties: {
    code: text(50),
    title: text(300),
    description: text(5_000),
    sourceNumber: nullableText(120),
    functionalRequirementCodes: stringArraySchema(100, 50),
    sourceIds: sourceIdsSchema(),
    tasks: {
      type: "array",
      maxItems: 200,
      items: planningBacklogTaskV41Schema,
    },
  },
} as const;

const planningBacklogFeatureV41Schema = (maximumStories: number) =>
  ({
    type: "object",
    additionalProperties: false,
    required: [
      "code",
      "title",
      "description",
      "sourceNumber",
      "sourceIds",
      "userStories",
    ],
    properties: {
      code: text(50),
      title: text(300),
      description: text(5_000),
      sourceNumber: nullableText(120),
      sourceIds: sourceIdsSchema(),
      userStories: {
        type: "array",
        maxItems: maximumStories,
        items: planningBacklogUserStoryV41Schema,
      },
    },
  }) as const;

const pendingPlanningEnvelopeV41Schema = (
  item: Readonly<Record<string, unknown>>,
) =>
  ({
    type: "object",
    additionalProperties: false,
    required: [
      "assignmentStatus",
      "assignmentObservation",
      "sourceParentPath",
      "item",
    ],
    properties: {
      assignmentStatus: {
        type: "string",
        const: "PENDING_ASSIGNMENT",
      },
      assignmentObservation: text(2_000),
      sourceParentPath: nullableText(500),
      item,
    },
  }) as const;

const planningBacklogStructureV41Schema = (
  maximumFeatures: number,
  maximumStories: number,
) =>
  ({
    type: "object",
    additionalProperties: false,
    required: ["structureStatus", "epics", "pendingAssignments"],
    properties: {
      structureStatus: {
        type: "string",
        enum: ["CONFIRMED", "AI_SUGGESTED"],
      },
      epics: {
        type: "array",
        // Punto 5: una estructura explícita puede contener únicamente work items
        // huérfanos. El guard AI_SUGGESTED sigue exigiendo una Epic propuesta
        // cuando NO existe ninguna estructura explícita.
        minItems: 0,
        maxItems: maximumFeatures,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "code",
            "title",
            "description",
            "sourceNumber",
            "sourceIds",
            "features",
          ],
          properties: {
            code: text(50),
            title: text(300),
            description: text(5_000),
            sourceNumber: nullableText(120),
            sourceIds: sourceIdsSchema(),
            features: {
              type: "array",
              maxItems: maximumFeatures,
              items: planningBacklogFeatureV41Schema(maximumStories),
            },
          },
        },
      },
      pendingAssignments: {
        type: "object",
        additionalProperties: false,
        required: ["features", "userStories", "tasks"],
        properties: {
          features: {
            type: "array",
            maxItems: maximumFeatures,
            items: pendingPlanningEnvelopeV41Schema(
              planningBacklogFeatureV41Schema(maximumStories),
            ),
          },
          userStories: {
            type: "array",
            maxItems: maximumStories,
            items: pendingPlanningEnvelopeV41Schema(
              planningBacklogUserStoryV41Schema,
            ),
          },
          tasks: {
            type: "array",
            maxItems: 200,
            items: pendingPlanningEnvelopeV41Schema(
              planningBacklogTaskV41Schema,
            ),
          },
        },
      },
    },
  }) as const;

/*
 * RNF_STRICT_OUTPUT_SCHEMA_V1
 *
 * En V4.1 `requirements` transporta exclusivamente RNF.
 * OpenAI debe devolver los campos documentales que la UI valida.
 * Si un dato no está definido, el prompt exige el texto
 * [PENDIENTE POR DEFINIR], nunca null.
 */
const nonFunctionalRequirementV41Schema = {
  ...requirementSchema,
  properties: {
    ...requirementSchema.properties,
    sectionKey: { type: "string", const: "nonFunctionalRequirements" },
    acceptanceCriteria: {
      ...requirementSchema.properties.acceptanceCriteria,
      minItems: 1,
    },
    milestone: { type: "null" },
    functionality: { type: "null" },
    category: text(300),
    measure: text(2_000),
    target: text(2_000),
  },
} as const;

const testScenarioSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "code",
    "title",
    "userStoryCodes",
    "acceptanceCriterionCodes",
    "precondition",
    "action",
    "expectedResult",
    "sourceIds",
    "taskCodes",
  ],
  properties: {
    code: text(50),
    title: text(300),
    userStoryCodes: stringArraySchema(30, 50),
    acceptanceCriterionCodes: stringArraySchema(50, 50),
    precondition: text(2_000),
    action: text(2_000),
    expectedResult: text(2_000),
    sourceIds: sourceIdsSchema(),
    taskCodes: stringArraySchema(50, 50),
  },
} as const;

const scrumTaskSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "code",
    "type",
    "description",
    "userStoryCode",
    "suggestedRole",
    "dependencyCodes",
    "expectedResult",
    "estimatedDurationDays",
    "startDay",
    "endDay",
  ],
  properties: {
    code: text(50),
    type: { type: "string", enum: [...AI_SCRUM_TASK_TYPES] },
    description: text(2_000),
    userStoryCode: text(50),
    suggestedRole: text(300),
    dependencyCodes: stringArraySchema(30, 50),
    expectedResult: text(2_000),
    estimatedDurationDays: { type: "integer", minimum: 1, maximum: 15 },
    startDay: { type: "integer", minimum: 1, maximum: 1_500 },
    endDay: { type: "integer", minimum: 1, maximum: 1_500 },
  },
} as const;

const scrumSprintSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "code",
    "number",
    "objective",
    "featureCodes",
    "userStoryCodes",
    "tasks",
    "dependencies",
    "testCodes",
    "deliverables",
    "closingCriterion",
    "risks",
  ],
  properties: {
    code: text(50),
    number: { type: "integer", minimum: 1, maximum: 100 },
    objective: text(2_000),
    featureCodes: stringArraySchema(100, 50),
    userStoryCodes: stringArraySchema(100, 50),
    tasks: { type: "array", maxItems: 200, items: scrumTaskSchema },
    dependencies: stringArraySchema(100),
    testCodes: stringArraySchema(100, 50),
    deliverables: stringArraySchema(100),
    closingCriterion: text(2_000),
    risks: stringArraySchema(100),
  },
} as const;

const scrumPlanSchema = (maximumSprints: number) =>
  ({
    type: "object",
    additionalProperties: false,
    required: [
      "cadenceDays",
      "scheduleBasis",
      "confirmedStartDate",
      "sourceIds",
      "sprints",
    ],
    properties: {
      cadenceDays: { type: "integer", const: 15 },
      scheduleBasis: {
        type: "string",
        enum: ["RELATIVE_DAY", "CONFIRMED_DATE"],
      },
      confirmedStartDate: {
        anyOf: [
          { type: "string", pattern: ISO_DATE_PATTERN },
          { type: "null" },
        ],
      },
      sourceIds: sourceIdsSchema(),
      sprints: {
        type: "array",
        maxItems: maximumSprints,
        items: scrumSprintSchema,
      },
    },
  }) as const;

const contradictionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "statementA",
    "sourceIdsA",
    "statementB",
    "sourceIdsB",
    "decision",
  ],
  properties: {
    statementA: text(2_000),
    sourceIdsA: sourceIdsSchema(),
    statementB: text(2_000),
    sourceIdsB: sourceIdsSchema(),
    decision: { type: "string", const: "[PENDIENTE POR DEFINIR]" },
  },
} as const;

export function buildAiAnalysisOutputSchema(
  includesScrum: boolean,
  templateType: DocumentTemplateType = "MEDIUM_REQUIREMENT",
) {
  const expectedSections = getDocumentSectionDefinitions(includesScrum);
  const limits = DEPTH_LIMITS[templateType];

  return {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "sections",
      "requirements",
      "structuredAnalysis",
      "pendingQuestions",
      "contradictions",
      "warnings",
    ],
    properties: {
      schemaVersion: { type: "string", const: "4.0.0" },
      sections: {
        type: "array",
        minItems: expectedSections.length,
        maxItems: expectedSections.length,
        items: {
          anyOf: expectedSections.map((section) => ({
            type: "object",
            additionalProperties: false,
            required: ["key", "title", "content"],
            properties: {
              key: {
                type: "string",
                const: section.key,
              },
              title: {
                type: "string",
                const: section.title,
              },
              content: sectionContentSchema(section.key),
            },
          })),
        },
      },
      requirements: {
        type: "array",
        maxItems: limits.requirements,
        items: requirementSchema,
      },
      structuredAnalysis: {
        type: "object",
        additionalProperties: false,
        required: [
          "processFlows",
          "entityRelationship",
          "backlogStructure",
          "tests",
          "scrumPlan",
        ],
        properties: {
          processFlows: {
            type: "object",
            additionalProperties: false,
            required: ["asIs", "toBe"],
            properties: {
              asIs: swimlaneProcessFlowSchema,
              toBe: swimlaneProcessFlowSchema,
            },
          },
          entityRelationship: entityRelationshipSchema,
          backlogStructure: backlogStructureSchema(
            limits.features,
            limits.userStories,
          ),
          tests: {
            type: "array",
            maxItems: limits.tests,
            items: testScenarioSchema,
          },
          scrumPlan: includesScrum
            ? scrumPlanSchema(limits.sprints)
            : { type: "null" },
        },
      },
      pendingQuestions: stringArraySchema(PENDING_SUMMARY_LIMIT),
      contradictions: {
        type: "array",
        maxItems: CONTRADICTION_SUMMARY_LIMIT,
        items: contradictionSchema,
      },
      warnings: stringArraySchema(PENDING_SUMMARY_LIMIT),
    },
  } as const;
}

/**
 * Esquema de salida para nuevas generaciones. No se reutiliza para parsear
 * resultados 4.0.0 históricos.
 */
export function buildAiAnalysisOutputSchemaV41(
  includesScrum: boolean,
  templateType: DocumentTemplateType = "MEDIUM_REQUIREMENT",
  allowedSourceIds: readonly string[] = [],
) {
  const expectedSections = getDocumentSectionDefinitions(includesScrum);
  const limits = DEPTH_LIMITS[templateType];

  const schema = {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "sections",
      "requirements",
      "structuredAnalysis",
      "pendingQuestions",
      "contradictions",
      "warnings",
    ],
    properties: {
      schemaVersion: { type: "string", const: "4.1.0" },
      sections: {
        type: "array",
        minItems: expectedSections.length,
        maxItems: expectedSections.length,
        items: {
          anyOf: expectedSections.map((section) => ({
            type: "object",
            additionalProperties: false,
            required: ["key", "title", "content"],
            properties: {
              key: { type: "string", const: section.key },
              title: { type: "string", const: section.title },
              content: sectionContentSchema(section.key),
            },
          })),
        },
      },
      requirements: {
        type: "array",
        maxItems: limits.requirements,
        items: nonFunctionalRequirementV41Schema,
      },
      structuredAnalysis: {
        type: "object",
        additionalProperties: false,
        required: [
          "processFlows",
          "entityRelationship",
          "functionalUserStories",
          "backlogStructure",
          "tests",
          "scrumPlan",
        ],
        properties: {
          processFlows: {
            type: "object",
            additionalProperties: false,
            required: ["asIs", "toBe"],
            properties: {
              asIs: swimlaneProcessFlowSchema,
              toBe: swimlaneProcessFlowSchema,
            },
          },
          entityRelationship: entityRelationshipSchema,
          functionalUserStories: {
            type: "array",
            minItems: 0,
            maxItems: limits.userStories,
            items: functionalUserStoryV41Schema,
          },
          backlogStructure: planningBacklogStructureV41Schema(
            limits.features,
            limits.userStories,
          ),
          tests: {
            type: "array",
            maxItems: limits.tests,
            items: testScenarioSchema,
          },
          scrumPlan: includesScrum
            ? scrumPlanSchema(limits.sprints)
            : { type: "null" },
        },
      },
      pendingQuestions: stringArraySchema(PENDING_SUMMARY_LIMIT),
      contradictions: {
        type: "array",
        maxItems: CONTRADICTION_SUMMARY_LIMIT,
        items: contradictionSchema,
      },
      warnings: stringArraySchema(PENDING_SUMMARY_LIMIT),
    },
  } as const;

  return restrictSchemaSourceIdsToAllowedValues(schema, allowedSourceIds);
}

/** Esquema por defecto para documentos históricos/no Scrum en pruebas. */
export const AI_ANALYSIS_OUTPUT_SCHEMA = buildAiAnalysisOutputSchema(false);

function object(
  value: unknown,
  name: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} no es un objeto válido.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function string(value: unknown, name: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new Error(`${name} no es texto válido.`);
  }
  return value.trim();
}

type BacklogCodeKind = keyof typeof AI_BACKLOG_CODE_PATTERNS;

function normalizeBacklogCodeAlias(
  value: string,
  kind: BacklogCodeKind,
): string {
  let normalized = value
    .trim()
    .toUpperCase()
    .replace(/^\[|\]$/gu, "")
    .replaceAll(/\s+/gu, "-");

  const replacePrefix = (
    aliases: readonly string[],
    canonical: string,
  ): void => {
    for (const alias of aliases) {
      if (normalized.startsWith(`${alias}-`)) {
        normalized = `${canonical}-${normalized.slice(alias.length + 1)}`;
        return;
      }
    }
  };

  if (kind === "EPIC") replacePrefix(["EPIC", "E"], "EP");
  if (kind === "FEATURE") replacePrefix(["FEATURE", "F"], "FE");
  if (kind === "USER_STORY")
    replacePrefix(["USER-STORY", "USERSTORY", "STORY", "US"], "HU");
  if (kind === "ACCEPTANCE_CRITERION")
    replacePrefix(["ACCEPTANCE-CRITERION", "CRITERION", "AC"], "CA");
  if (kind === "TASK") replacePrefix(["TASK"], "T");

  // Models occasionally copy the human outline number into `code` or omit
  // the separator (EPIC1, F1, US1, T1). Keep sourceNumber independent while
  // recovering a deterministic technical identifier before graph validation.
  const compactAliases: Record<BacklogCodeKind, RegExp> = {
    EPIC: /^(?:EPIC|E)?-?(\d+(?:[.-]\d+)*)$/u,
    FEATURE: /^(?:FEATURE|FE|F)?-?(\d+(?:[.-]\d+)*)$/u,
    USER_STORY: /^(?:USER-?STORY|US|HU)?-?(\d+(?:[.-]\d+)*)$/u,
    ACCEPTANCE_CRITERION:
      /^(?:ACCEPTANCE-?CRITERION|AC|CA)?-?(\d+(?:[.-]\d+)*)$/u,
    TASK: /^(?:TASK|T)?-?(\d+(?:[.-]\d+)*)$/u,
  };
  const compactMatch = normalized.match(compactAliases[kind]);
  if (compactMatch?.[1]) {
    const suffix = compactMatch[1].replaceAll(".", "-");
    const prefixes: Record<BacklogCodeKind, string> = {
      EPIC: "EP",
      FEATURE: "FE",
      USER_STORY: "HU",
      ACCEPTANCE_CRITERION: "CA",
      TASK: "T",
    };
    normalized = `${prefixes[kind]}-${suffix}`;
  }

  // Drafts created before canonical code enforcement may contain a readable
  // placeholder such as "[PENDIENTE POR DEFINIR]". Preserve its meaning while
  // turning it into a stable code that historical results can still expose.
  if (!new RegExp(AI_BACKLOG_CODE_PATTERNS[kind], "u").test(normalized)) {
    const prefixes: Record<BacklogCodeKind, string> = {
      EPIC: "EP",
      FEATURE: "FE",
      USER_STORY: "HU",
      ACCEPTANCE_CRITERION: "CA",
      TASK: "T",
    };
    const safeSuffix = normalized
      .normalize("NFD")
      .replaceAll(/[\u0300-\u036f]/gu, "")
      .replaceAll(/[^A-Z0-9-]+/gu, "-")
      .replaceAll(/-+/gu, "-")
      .replace(/^-|-$/gu, "");
    if (safeSuffix) normalized = `${prefixes[kind]}-${safeSuffix}`;
  }

  return normalized;
}

function canonicalBacklogCode(
  value: unknown,
  name: string,
  kind: BacklogCodeKind,
): string {
  const normalized = normalizeBacklogCodeAlias(string(value, name, 50), kind);
  if (!new RegExp(AI_BACKLOG_CODE_PATTERNS[kind], "u").test(normalized)) {
    throw new Error(
      `${name} no respeta el formato canónico ${AI_BACKLOG_CODE_PATTERNS[kind]}.`,
    );
  }
  return normalized;
}

function canonicalReferenceCode(value: string, kind: BacklogCodeKind): string {
  return normalizeBacklogCodeAlias(value, kind);
}

function canonicalFunctionalStoryCode(value: unknown, name: string): string {
  let normalized = string(value, name, 50)
    .trim()
    .toUpperCase()
    .replaceAll(/\s+/gu, "-");
  if (/^HU-(?!F-)/u.test(normalized))
    normalized = `HU-F-${normalized.slice(3)}`;
  if (
    !new RegExp(AI_FUNCTIONAL_CODE_PATTERNS.USER_STORY, "u").test(normalized)
  ) {
    throw new Error(`${name} no respeta el formato funcional HU-F-...`);
  }
  return normalized;
}

function canonicalFunctionalCriterionCode(
  value: unknown,
  name: string,
): string {
  let normalized = string(value, name, 50)
    .trim()
    .toUpperCase()
    .replaceAll(/\s+/gu, "-");
  if (/^CA-(?!F-)/u.test(normalized))
    normalized = `CA-F-${normalized.slice(3)}`;
  if (
    !new RegExp(AI_FUNCTIONAL_CODE_PATTERNS.ACCEPTANCE_CRITERION, "u").test(
      normalized,
    )
  ) {
    throw new Error(`${name} no respeta el formato funcional CA-F-...`);
  }
  return normalized;
}

function canonicalFunctionalNeedCode(value: unknown, name: string): string {
  const normalized = string(value, name, 50)
    .trim()
    .toUpperCase()
    .replaceAll(/\s+/gu, "-");
  if (!/^FN-[0-9]{3,}$/u.test(normalized)) {
    throw new Error(`${name} no respeta el formato funcional FN-###`);
  }
  return normalized;
}

function canonicalPlanningStoryCode(value: unknown, name: string): string {
  let normalized = string(value, name, 50)
    .trim()
    .toUpperCase()
    .replaceAll(/\s+/gu, "-");
  if (/^HU-(?!P-)/u.test(normalized))
    normalized = `HU-P-${normalized.slice(3)}`;
  const compactMatch = normalized.match(
    /^(?:USER-?STORY|US|HU)?-?(\d+(?:[.-]\d+)*)$/u,
  );
  if (compactMatch?.[1]) {
    normalized = `HU-P-${compactMatch[1].replaceAll(".", "-")}`;
  }
  if (!new RegExp(AI_PLANNING_CODE_PATTERNS.USER_STORY, "u").test(normalized)) {
    throw new Error(`${name} no respeta el formato de planificación HU-P-...`);
  }
  return normalized;
}

function canonicalFunctionalStoryReference(value: string): string {
  return canonicalFunctionalStoryCode(value, "referencia HU funcional");
}

function canonicalFunctionalCriterionReference(value: string): string {
  return canonicalFunctionalCriterionCode(
    value,
    "referencia criterio funcional",
  );
}

function canonicalPlanningStoryReference(value: string): string {
  return canonicalPlanningStoryCode(value, "referencia HU planificación");
}

function normalizedTextReference(value: string): string {
  return value.trim().replaceAll(/\s+/gu, " ").toLocaleLowerCase("es");
}

function normalizedObjectiveReference(value: string): string {
  return normalizedTextReference(value)
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/gu, "")
    .replaceAll(/[^a-z0-9]+/gu, " ")
    .trim();
}

const OBJECTIVE_REFERENCE_STOP_WORDS = new Set([
  "como",
  "con",
  "del",
  "desde",
  "el",
  "en",
  "la",
  "las",
  "los",
  "para",
  "por",
  "que",
  "una",
  "uno",
]);

/*
 * KPI_SAFE_CANONICALIZATION_V7_4_3
 *
 * `relatedObjective` debe terminar apuntando al texto canónico de uno de los
 * objetivos específicos generados. Structured Outputs no puede expresar un
 * enum dinámico basado en otro campo de la misma respuesta, por lo que el
 * proveedor puede devolver una paráfrasis mínima.
 *
 * Esta reconciliación es deliberadamente conservadora:
 * - exacto / normalizado: se acepta;
 * - variaciones morfológicas simples y expansión textual: solo si existe UN
 *   candidato claramente superior;
 * - cero candidatos o empate/ambigüedad: fail-closed.
 *
 * No se usan sinónimos, embeddings ni inferencia semántica para evitar que el
 * backend invente relaciones entre KPI y objetivos.
 */
function objectiveReferenceTokenKey(token: string): string {
  if (token.length < 4) return token;

  if (token.endsWith("ciones") && token.length > 7) {
    return `${token.slice(0, -6)}cion`;
  }
  if (token.endsWith("siones") && token.length > 7) {
    return `${token.slice(0, -6)}sion`;
  }
  if (token.endsWith("udes") && token.length > 5) {
    return `${token.slice(0, -4)}ud`;
  }
  if (token.endsWith("ades") && token.length > 5) {
    return `${token.slice(0, -4)}ad`;
  }
  if (token.endsWith("ores") && token.length > 5) {
    return `${token.slice(0, -4)}or`;
  }
  if (token.endsWith("ales") && token.length > 5) {
    return `${token.slice(0, -4)}al`;
  }
  if (token.endsWith("es") && token.length > 5) {
    const beforeEnding = token.at(-3) ?? "";
    if (!/[aeiou]/u.test(beforeEnding)) {
      return token.slice(0, -2);
    }
  }
  if (token.endsWith("s") && token.length > 4) {
    return token.slice(0, -1);
  }
  return token;
}

function objectiveReferenceTokens(value: string): Set<string> {
  return new Set(
    normalizedObjectiveReference(value)
      .split(" ")
      .filter(
        (token) =>
          token.length >= 3 && !OBJECTIVE_REFERENCE_STOP_WORDS.has(token),
      )
      .map(objectiveReferenceTokenKey)
      .filter((token) => token.length >= 3),
  );
}

/*
 * AI_KPI_OBJECTIVE_THREE_WAY_CLASSIFICATION_V1
 *
 * Distingue tres resultados que antes se mezclaban en una lista vacía:
 * - NONE: ningún objetivo comparte lo suficiente (se puede pedir un reintento
 *   localizado porque no hay una elección que el modelo vaya a "desempatar").
 * - SINGLE: exactamente una coincidencia segura (se canonicaliza sin llamar al
 *   proveedor).
 * - AMBIGUOUS: dos o más objetivos igualmente plausibles (falla cerrado y NO se
 *   reintenta: cualquier valor que el modelo escogiera sería arbitrario).
 */
type ObjectiveReferenceMatch =
  | { readonly status: "NONE" }
  | { readonly status: "AMBIGUOUS" }
  | { readonly status: "SINGLE"; readonly objective: string };

function classifyFuzzyObjectiveReference(
  value: string,
  objectives: readonly string[],
): ObjectiveReferenceMatch {
  const referenceTokens = objectiveReferenceTokens(value);
  if (referenceTokens.size < 2) return { status: "NONE" };

  const ranked = objectives
    .map((objective) => {
      const objectiveTokens = objectiveReferenceTokens(objective);
      const commonTokens = [...referenceTokens].filter((token) =>
        objectiveTokens.has(token),
      ).length;
      const smallerSetSize = Math.min(
        referenceTokens.size,
        objectiveTokens.size,
      );
      const unionSize = new Set([...referenceTokens, ...objectiveTokens]).size;
      const coverage = smallerSetSize === 0 ? 0 : commonTokens / smallerSetSize;
      const jaccard = unionSize === 0 ? 0 : commonTokens / unionSize;
      const score = coverage * 0.65 + jaccard * 0.35;

      return {
        objective,
        commonTokens,
        coverage,
        jaccard,
        score,
      };
    })
    .filter(
      (candidate) =>
        candidate.commonTokens >= 2 &&
        candidate.coverage >= 0.75 &&
        (candidate.jaccard >= 0.35 || candidate.coverage === 1),
    )
    .sort((left, right) => right.score - left.score);

  if (ranked.length === 0) return { status: "NONE" };

  const best = ranked[0]!;
  const second = ranked[1];

  /*
   * Un candidato debe ser inequívoco. Si hay otro objetivo casi igual de
   * plausible, no se adivina: el parser conserva el comportamiento fail-closed.
   */
  if (second && best.score - second.score < 0.18) {
    return { status: "AMBIGUOUS" };
  }

  return { status: "SINGLE", objective: best.objective };
}

export type KpiObjectiveFailureReason = "NO_MATCH" | "AMBIGUOUS";

export interface KpiObjectiveFailure {
  readonly kpiIndex: number;
  readonly reason: KpiObjectiveFailureReason;
}

/**
 * Error tipado del parser: un KPI no referencia de forma inequívoca un objetivo
 * específico. `failures` conserva, KPI por KPI, si no hubo coincidencia segura
 * o si hubo varias plausibles, para que el proveedor decida SIN depender del
 * texto del mensaje. El mensaje conserva el formato histórico.
 */
export class KpiObjectiveReferenceError extends Error {
  constructor(readonly failures: readonly KpiObjectiveFailure[]) {
    const first = failures[0];
    super(
      `scope.kpis[${first?.kpiIndex ?? 0}].relatedObjective no referencia de forma inequívoca un objetivo específico cualitativo o cuantitativo generado.`,
    );
    this.name = "KpiObjectiveReferenceError";
  }

  /** Solo es reparable si NINGÚN KPI es ambiguo. */
  get repairable(): boolean {
    return (
      this.failures.length > 0 &&
      this.failures.every((failure) => failure.reason === "NO_MATCH")
    );
  }

  get noMatchIndexes(): number[] {
    return this.failures
      .filter((failure) => failure.reason === "NO_MATCH")
      .map((failure) => failure.kpiIndex);
  }
}

function pushReconciliationWarning(warnings: string[], message: string): void {
  const normalized = message.replaceAll(/\s+/gu, " ").trim().slice(0, 2_000);
  if (normalized && !warnings.includes(normalized) && warnings.length < 100) {
    warnings.push(normalized);
  }
}

function nullableString(
  value: unknown,
  name: string,
  maximum: number,
): string | null {
  return value === null ? null : string(value, name, maximum);
}

function integer(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`${name} no es un entero válido.`);
  }
  return value;
}

function strings(value: unknown, name: string, maximumItems: number): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new Error(`${name} no es una lista válida.`);
  }
  return value.map((item, index) => string(item, `${name}[${index}]`, 2_000));
}

function pendingSummaryStrings(value: unknown, name: string): string[] {
  return strings(value, name, 100).slice(0, PENDING_SUMMARY_LIMIT);
}

function array(value: unknown, name: string, maximumItems: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new Error(`${name} no es una lista válida.`);
  }
  return value;
}

function uuid(value: unknown, name: string): string {
  const parsed = string(value, name, 36).toLowerCase();
  if (!new RegExp(UUID_PATTERN, "u").test(parsed)) {
    throw new Error(`${name} no es un UUID válido.`);
  }
  return parsed;
}

function sourceIds(value: unknown, name: string): string[] {
  return array(value, name, 100).map((item, index) =>
    uuid(item, `${name}[${index}]`),
  );
}

function unique(values: readonly string[], name: string): void {
  const normalized = values.map((item) => item.toUpperCase());
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${name} contiene códigos duplicados.`);
  }
}

function parseSectionContent(
  value: unknown,
  key: DocumentSectionKey,
  name: string,
  requireStructuredKpis = false,
): DocumentJsonValue {
  /*
   * Compatibilidad de lectura para resultados V1/V2 y trazas V3 anteriores
   * a la estructura de objetivos/KPIs. El esquema de salida actual obliga
   * objetos para nuevas generaciones.
   */
  if (typeof value === "string") {
    if (key === "scope" && requireStructuredKpis) {
      throw new Error(
        `${name} debe usar el objeto canónico de Alcance con exactamente 3 KPI estructurados.`,
      );
    }
    return string(value, name, 30_000);
  }

  /*
   * V4_PERSISTED_SECTION_COMPATIBILITY
   *
   * El proveedor devuelve estas secciones como texto porque ese es el
   * contrato externo de Structured Outputs. Después de validar V4,
   * parseV4 deriva representaciones estructuradas para Requerimientos,
   * Esquema y Pruebas.
   *
   * Ese draft normalizado se persiste en AnalysisResult.ContentJson.
   * Cuando se reintenta aplicar el resultado, vuelve a pasar por
   * parseAiAnalysisDraft().
   *
   * Por eso esta segunda lectura debe aceptar EXCLUSIVAMENTE las
   * representaciones internas canónicas que el propio parser produjo.
   *
   * No se relaja el contrato que OpenAI debe cumplir.
   */

  if (
    key === "milestones" &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    const persisted = object(value, name);

    const rawFunctionalRequirements = array(
      persisted.functionalRequirements,
      `${name}.functionalRequirements`,
      300,
    );
    const usesV41FunctionalStories = rawFunctionalRequirements.some((item) => {
      const candidate = object(item, `${name}.functionalRequirements[]`);
      return (
        Object.hasOwn(candidate, "role") ||
        (typeof candidate.code === "string" &&
          candidate.code.trim().toUpperCase().startsWith("HU-F-"))
      );
    });
    const functionalRequirements = usesV41FunctionalStories
      ? parseFunctionalUserStoriesV41(rawFunctionalRequirements)
      : parseRequirements(rawFunctionalRequirements);
    const nonFunctionalRequirements = parseRequirements(
      persisted.nonFunctionalRequirements,
    );

    if (
      !usesV41FunctionalStories &&
      functionalRequirements.some(
        (requirement) =>
          "sectionKey" in requirement &&
          requirement.sectionKey !== "milestones",
      )
    ) {
      throw new Error(
        `${name}.functionalRequirements contiene un requerimiento de tipo incorrecto.`,
      );
    }

    if (
      nonFunctionalRequirements.some(
        (requirement) => requirement.sectionKey !== "nonFunctionalRequirements",
      )
    ) {
      throw new Error(
        `${name}.nonFunctionalRequirements contiene un requerimiento de tipo incorrecto.`,
      );
    }

    return {
      functionalRequirements,
      nonFunctionalRequirements,
    } as unknown as DocumentJsonValue;
  }

  if (
    key === "backlogStructure" &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    const backlog = object(value, name);
    const firstEpic =
      Array.isArray(backlog.epics) && backlog.epics.length > 0
        ? object(backlog.epics[0], `${name}.epics[0]`)
        : null;
    const firstFeature =
      firstEpic &&
      Array.isArray(firstEpic.features) &&
      firstEpic.features.length > 0
        ? object(firstEpic.features[0], `${name}.epics[0].features[0]`)
        : null;
    const firstStory =
      firstFeature &&
      Array.isArray(firstFeature.userStories) &&
      firstFeature.userStories.length > 0
        ? object(
            firstFeature.userStories[0],
            `${name}.epics[0].features[0].userStories[0]`,
          )
        : null;
    const usesV41Planning = Boolean(
      firstStory &&
      (Array.isArray(firstStory.functionalRequirementCodes) ||
        (typeof firstStory.code === "string" &&
          firstStory.code.trim().toUpperCase().startsWith("HU-P-"))),
    );
    return (usesV41Planning
      ? parsePlanningBacklogStructureV41(value)
      : parseBacklogStructure(value)) as unknown as DocumentJsonValue;
  }

  if (key === "tests" && Array.isArray(value)) {
    return parseTests(value) as unknown as DocumentJsonValue;
  }
  if (key === "header") {
    const content = object(value, name);
    return {
      title: string(content.title, `${name}.title`, 1_000),
      projectCode: string(content.projectCode, `${name}.projectCode`, 200),
      documentVersion: string(
        content.documentVersion,
        `${name}.documentVersion`,
        100,
      ),
      createdDate: string(content.createdDate, `${name}.createdDate`, 100),
      requestingArea: string(
        content.requestingArea,
        `${name}.requestingArea`,
        500,
      ),
      status: string(content.status, `${name}.status`, 100),
    };
  }

  if (key === "objectives") {
    const content = object(value, name);
    const qualitative = strings(content.qualitative, `${name}.qualitative`, 20);
    const quantitative = strings(
      content.quantitative,
      `${name}.quantitative`,
      20,
    );
    if (qualitative.length === 0 || quantitative.length === 0) {
      throw new Error(
        `${name} debe incluir objetivos cualitativos y cuantitativos.`,
      );
    }
    return {
      general: string(content.general, `${name}.general`, 5_000),
      qualitative,
      quantitative,
    };
  }

  if (key === "scope") {
    const content = object(value, name);
    const kpis = array(content.kpis, `${name}.kpis`, 3);
    if (kpis.length !== 3) {
      throw new Error(`${name}.kpis debe contener exactamente 3 indicadores.`);
    }
    return {
      included: strings(content.included, `${name}.included`, 100),
      excluded: strings(content.excluded, `${name}.excluded`, 100),
      involvedSystems: strings(
        content.involvedSystems,
        `${name}.involvedSystems`,
        100,
      ),
      kpis: kpis.map((item, index) => {
        const kpi = object(item, `${name}.kpis[${index}]`);
        const parsed = {
          name: string(kpi.name, `${name}.kpis[${index}].name`, 300),
          relatedObjective: string(
            kpi.relatedObjective,
            `${name}.kpis[${index}].relatedObjective`,
            2_000,
          ),
          measurement: string(
            kpi.measurement,
            `${name}.kpis[${index}].measurement`,
            2_000,
          ),
          target: string(kpi.target, `${name}.kpis[${index}].target`, 1_000),
        };
        if (
          parsed.name === PENDING_DEFINITION ||
          parsed.relatedObjective === PENDING_DEFINITION ||
          parsed.measurement === PENDING_DEFINITION
        ) {
          throw new Error(
            `${name}.kpis[${index}] debe definir nombre, objetivo relacionado y medición; solo target puede quedar pendiente.`,
          );
        }
        if (/^KPI\s*(?:#|N[ÚU]MERO|NO\.?|0*)?\s*\d+$/iu.test(parsed.name)) {
          throw new Error(
            `${name}.kpis[${index}].name debe describir el indicador y no usar un nombre genérico.`,
          );
        }
        return {
          ...parsed,
        };
      }),
    };
  }

  if (key === "solutionProposal") {
    const content = object(value, name);
    const alignment = object(content.flowAlignment, `${name}.flowAlignment`);
    return {
      objective: string(content.objective, `${name}.objective`, 2_000),
      description: string(content.description, `${name}.description`, 3_000),
      involvedElements: strings(
        content.involvedElements,
        `${name}.involvedElements`,
        12,
      ),
      flowAlignment: {
        currentState: string(
          alignment.currentState,
          `${name}.flowAlignment.currentState`,
          2_000,
        ),
        evaluation: string(
          alignment.evaluation,
          `${name}.flowAlignment.evaluation`,
          2_000,
        ),
        expectedResult: string(
          alignment.expectedResult,
          `${name}.flowAlignment.expectedResult`,
          2_000,
        ),
      },
      prototypeMarkdown:
        content.prototypeMarkdown === undefined
          ? null
          : nullableString(
              content.prototypeMarkdown,
              `${name}.prototypeMarkdown`,
              30_000,
            ),
    };
  }

  if (key === "problemDescription") {
    const content = object(value, name);
    const operationalImpact = strings(
      content.operationalImpact,
      `${name}.operationalImpact`,
      100,
    );
    if (operationalImpact.length === 0) {
      throw new Error(
        `${name}.operationalImpact debe contener al menos un impacto o pendiente explícito.`,
      );
    }
    return {
      currentState: string(
        content.currentState,
        `${name}.currentState`,
        15_000,
      ),
      operationalImpact,
    };
  }

  if (key === "assumptionsDependenciesPending") {
    const content = object(value, name);
    return {
      assumptions: pendingSummaryStrings(
        content.assumptions,
        `${name}.assumptions`,
      ),
      dependencies: pendingSummaryStrings(
        content.dependencies,
        `${name}.dependencies`,
      ),
      pendingItems: pendingSummaryStrings(
        content.pendingItems,
        `${name}.pendingItems`,
      ),
    };
  }

  if (key === "approvalsAndChangeControl") {
    const content = object(value, name);
    const approvals = array(content.approvals, `${name}.approvals`, 3);
    if (approvals.length !== 3) {
      throw new Error(
        `${name}.approvals debe incluir elaboración, revisión y aprobación.`,
      );
    }
    const changeControl = array(
      content.changeControl,
      `${name}.changeControl`,
      1,
    );
    const parsedApprovals = approvals.map((item, index) => {
      const approval = object(item, `${name}.approvals[${index}]`);
      return {
        name: string(approval.name, `${name}.approvals[${index}].name`, 500),
        position: string(
          approval.position,
          `${name}.approvals[${index}].position`,
          500,
        ),
        responsibility: string(
          approval.responsibility,
          `${name}.approvals[${index}].responsibility`,
          200,
        ),
        approvalMoment: string(
          approval.approvalMoment,
          `${name}.approvals[${index}].approvalMoment`,
          1_000,
        ),
        status: string(
          approval.status,
          `${name}.approvals[${index}].status`,
          200,
        ),
      };
    });
    const expectedResponsibilities = ["Elaboración", "Revisión", "Aprobación"];
    if (
      parsedApprovals.some(
        (approval, index) =>
          approval.responsibility !== expectedResponsibilities[index],
      )
    ) {
      throw new Error(
        `${name}.approvals debe conservar el orden Elaboración, Revisión y Aprobación.`,
      );
    }
    return {
      approvals: parsedApprovals,
      changeControl: changeControl.map((item, index) => {
        const change = object(item, `${name}.changeControl[${index}]`);
        return {
          version: string(
            change.version,
            `${name}.changeControl[${index}].version`,
            100,
          ),
          date: string(
            change.date,
            `${name}.changeControl[${index}].date`,
            100,
          ),
          description: string(
            change.description,
            `${name}.changeControl[${index}].description`,
            2_000,
          ),
          approvedBy: string(
            change.approvedBy,
            `${name}.changeControl[${index}].approvedBy`,
            500,
          ),
        };
      }),
    };
  }

  return string(value, name, 30_000);
}

function parseSections(
  value: unknown,
  requireStructuredKpis = false,
  warnings?: string[],
): AiAnalysisDraftSection[] {
  const legacyDefinitions = DOCUMENT_SECTION_DEFINITIONS.filter(
    (section) => section.key !== "solutionProposal",
  );
  const allowedLengths = new Set([
    legacyDefinitions.length,
    legacyDefinitions.length + 1,
    DOCUMENT_SECTION_DEFINITIONS.length,
    DOCUMENT_SECTION_DEFINITIONS.length + 1,
  ]);
  if (!Array.isArray(value) || !allowedLengths.has(value.length)) {
    throw new Error(
      `El resultado debe contener ${DOCUMENT_SECTION_DEFINITIONS.length} secciones base o ${DOCUMENT_SECTION_DEFINITIONS.length + 1} cuando incluye Plan Scrum.`,
    );
  }

  const includesScrum = value.some(
    (item) =>
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      (item as { key?: unknown }).key === "scrumPlan",
  );
  const hasSolutionProposal = value.some(
    (item) =>
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      (item as { key?: unknown }).key === "solutionProposal",
  );
  const baseExpectedSections = hasSolutionProposal
    ? DOCUMENT_SECTION_DEFINITIONS
    : legacyDefinitions;
  const expectedSections = includesScrum
    ? [...baseExpectedSections, DOCUMENT_SCRUM_SECTION_DEFINITION]
    : [...baseExpectedSections];

  /*
   * CANONICAL_SECTION_NORMALIZATION
   *
   * Structured Outputs garantiza que cada elemento de sections cumpla
   * uno de los esquemas permitidos, pero items.anyOf no representa una
   * posición diferente para cada elemento del array.
   *
   * Por ello el proveedor puede devolver las secciones válidas en un
   * orden distinto.
   *
   * El sistema acepta solamente un conjunto COMPLETO y SIN DUPLICADOS
   * y posteriormente lo normaliza al orden canónico.
   *
   * No se aceptan claves desconocidas, faltantes ni duplicadas.
   */

  const historicalBaseSections = [
    ...legacyDefinitions.slice(0, 4),
    ...(hasSolutionProposal
      ? [
          {
            key: "solutionProposal" as const,
            title: "Solución propuesta del profesional de soluciones",
          },
        ]
      : []),
    ...legacyDefinitions.slice(4, 5),
    {
      key: "milestones" as const,
      title: "Requerimientos por hito o funcionalidad",
    },
    {
      key: "nonFunctionalRequirements" as const,
      title: "Requerimientos no funcionales",
    },
    ...legacyDefinitions.slice(7),
  ];
  const historicalSections = includesScrum
    ? [...historicalBaseSections, DOCUMENT_SCRUM_SECTION_DEFINITION]
    : historicalBaseSections;

  const rawSections = value.map((item, index) =>
    object(item, `sections[${index}]`),
  );

  const matchesLayout = (
    layout: readonly {
      readonly key: DocumentSectionKey;
      readonly title: string;
    }[],
  ): boolean => {
    const expectedKeys = new Set(layout.map((section) => section.key));

    const actualKeys = rawSections.map((section) => section.key);

    return (
      actualKeys.length === layout.length &&
      new Set(actualKeys).size === layout.length &&
      actualKeys.every(
        (key) =>
          typeof key === "string" &&
          expectedKeys.has(key as DocumentSectionKey),
      )
    );
  };

  const compatibleSections = matchesLayout(expectedSections)
    ? expectedSections
    : matchesLayout(historicalSections)
      ? historicalSections
      : null;

  if (!compatibleSections) {
    const receivedKeys = rawSections.map((section) =>
      typeof section.key === "string" ? section.key : "<sin-key>",
    );

    throw new Error(
      `Las secciones deben contener exactamente una vez cada clave canónica. Recibidas: ${receivedKeys.join(", ")}.`,
    );
  }

  const sectionsByKey = new Map(
    rawSections.map((section) => [section.key, section] as const),
  );

  /*
   * Importante:
   *
   * iteramos compatibleSections y NO rawSections.
   *
   * Así el resultado interno siempre queda en el orden canónico aunque
   * OpenAI haya enviado una permutación válida.
   */
  const sections = compatibleSections.map((expected, index) => {
    const section = sectionsByKey.get(expected.key);

    if (!section) {
      throw new Error(`Falta la sección canónica ${expected.key}.`);
    }

    if (section.title !== expected.title) {
      throw new Error(
        `El título de ${expected.key} no respeta la plantilla canónica.`,
      );
    }

    return {
      key: expected.key,
      title: expected.title,
      content: parseSectionContent(
        section.content,
        expected.key,
        `sections[${index}].content`,
        requireStructuredKpis,
      ),
    };
  });

  const objectives = sections.find((section) => section.key === "objectives");
  const scope = sections.find((section) => section.key === "scope");
  if (
    objectives &&
    typeof objectives.content === "object" &&
    !Array.isArray(objectives.content) &&
    objectives.content !== null &&
    scope &&
    typeof scope.content === "object" &&
    !Array.isArray(scope.content) &&
    scope.content !== null
  ) {
    const objectiveContent = objectives.content as Readonly<
      Record<string, DocumentJsonValue>
    >;
    const scopeContent = scope.content as Readonly<
      Record<string, DocumentJsonValue>
    >;
    const specificObjectives = [
      ...strings(objectiveContent.qualitative, "objectives.qualitative", 20),
      ...strings(objectiveContent.quantitative, "objectives.quantitative", 20),
    ];
    const knownSpecificObjectives = new Set(specificObjectives);
    const normalizedSpecificObjectives = new Map<string, string[]>();
    for (const objective of specificObjectives) {
      const normalized = normalizedObjectiveReference(objective);
      const candidates = normalizedSpecificObjectives.get(normalized) ?? [];
      normalizedSpecificObjectives.set(normalized, [...candidates, objective]);
    }
    const kpiFailures: KpiObjectiveFailure[] = [];
    for (const [index, item] of array(
      scopeContent.kpis,
      "scope.kpis",
      3,
    ).entries()) {
      const kpi = object(item, `scope.kpis[${index}]`);
      const relatedObjective = string(
        kpi.relatedObjective,
        `scope.kpis[${index}].relatedObjective`,
        2_000,
      );
      if (knownSpecificObjectives.has(relatedObjective)) continue;

      const normalizedCandidates =
        normalizedSpecificObjectives.get(
          normalizedObjectiveReference(relatedObjective),
        ) ?? [];
      let canonicalObjective: string | null = null;
      let repairMethod = "";
      if (normalizedCandidates.length === 1) {
        canonicalObjective = normalizedCandidates[0]!;
        repairMethod = "normalización textual";
      } else if (normalizedCandidates.length > 1) {
        kpiFailures.push({ kpiIndex: index, reason: "AMBIGUOUS" });
        continue;
      } else {
        const fuzzy = classifyFuzzyObjectiveReference(
          relatedObjective,
          specificObjectives,
        );
        if (fuzzy.status === "SINGLE") {
          canonicalObjective = fuzzy.objective;
          repairMethod = "coincidencia léxica inequívoca";
        } else {
          kpiFailures.push({
            kpiIndex: index,
            reason: fuzzy.status === "AMBIGUOUS" ? "AMBIGUOUS" : "NO_MATCH",
          });
          continue;
        }
      }

      // Keep the stored relation canonical even when the provider only
      // changed casing, accents, punctuation or made a safe lexical
      // paraphrase. The provider text is never persisted as the relation:
      // the exact objective generated in section 2 is restored.
      (kpi as Record<string, unknown>).relatedObjective = canonicalObjective;
      if (warnings) {
        pushReconciliationWarning(
          warnings,
          `KPI ${index + 1}: relatedObjective se canonicalizó automáticamente mediante ${repairMethod} al objetivo específico "${canonicalObjective}".`,
        );
      }
    }

    /*
     * Fail-closed: si algún KPI no tiene exactamente un candidato seguro, no
     * seleccionamos objetivos por proximidad ni por posición. El error tipado
     * conserva por KPI si fue "sin coincidencia" o "ambiguo".
     */
    if (kpiFailures.length > 0) {
      throw new KpiObjectiveReferenceError(kpiFailures);
    }
  }

  return sections;
}

function parseRequirements(value: unknown): AiAnalysisDraftRequirement[] {
  return array(value, "requirements", 300).map((item, index) => {
    const requirement = object(item, `requirements[${index}]`);
    const sectionKey = requirement.sectionKey;
    if (
      sectionKey !== "milestones" &&
      sectionKey !== "nonFunctionalRequirements"
    ) {
      throw new Error(`requirements[${index}].sectionKey no es válido.`);
    }
    return {
      clientId: `REQ-${String(index + 1).padStart(3, "0")}`,
      sectionKey: sectionKey as DocumentSectionKey,
      code: string(requirement.code, `requirements[${index}].code`, 50),
      title: string(requirement.title, `requirements[${index}].title`, 300),
      description: string(
        requirement.description,
        `requirements[${index}].description`,
        10_000,
      ),
      requirementType: string(
        requirement.requirementType,
        `requirements[${index}].requirementType`,
        80,
      ),
      acceptanceCriteria: strings(
        requirement.acceptanceCriteria,
        `requirements[${index}].acceptanceCriteria`,
        30,
      ),
      sourceIds: sourceIds(
        requirement.sourceIds,
        `requirements[${index}].sourceIds`,
      ),
      milestone: Object.hasOwn(requirement, "milestone")
        ? nullableString(
            requirement.milestone,
            `requirements[${index}].milestone`,
            500,
          )
        : null,
      functionality: Object.hasOwn(requirement, "functionality")
        ? nullableString(
            requirement.functionality,
            `requirements[${index}].functionality`,
            500,
          )
        : null,
      category: Object.hasOwn(requirement, "category")
        ? nullableString(
            requirement.category,
            `requirements[${index}].category`,
            300,
          )
        : null,
      measure: Object.hasOwn(requirement, "measure")
        ? nullableString(
            requirement.measure,
            `requirements[${index}].measure`,
            2_000,
          )
        : null,
      target: Object.hasOwn(requirement, "target")
        ? nullableString(
            requirement.target,
            `requirements[${index}].target`,
            2_000,
          )
        : null,
    };
  });
}

function parseProcessFlow(
  value: unknown,
  name = "structuredAnalysis.processFlow",
  warnings?: string[],
): AiProcessFlow {
  const record = object(value, name);
  const nodes = array(record.nodes, `${name}.nodes`, 100).map((item, index) => {
    const nodeName = `${name}.nodes[${index}]`;
    const node = object(item, nodeName);
    const kind = string(node.kind, `${nodeName}.kind`, 20);
    if (!AI_PROCESS_NODE_KINDS.includes(kind as never)) {
      throw new Error("El flujo contiene un tipo de nodo no permitido.");
    }
    return {
      id: string(node.id, `${nodeName}.id`, 80),
      kind: kind as AiProcessFlow["nodes"][number]["kind"],
      label: string(node.label, `${nodeName}.label`, 500),
      ...(Object.hasOwn(node, "laneId")
        ? { laneId: nullableString(node.laneId, `${nodeName}.laneId`, 80) }
        : {}),
    };
  });
  unique(
    nodes.map((node) => node.id),
    "processFlow.nodes",
  );
  const nodeByKey = new Map(
    nodes.map((node) => [node.id.trim().toLowerCase(), node.id] as const),
  );
  const edges = array(record.edges, `${name}.edges`, 200).flatMap(
    (item, index): { from: string; to: string; label: string | null }[] => {
      const edgeName = `${name}.edges[${index}]`;
      const edge = object(item, edgeName);
      const rawFrom = string(edge.from, `${edgeName}.from`, 80);
      const rawTo = string(edge.to, `${edgeName}.to`, 80);
      const from = nodeByKey.get(rawFrom.trim().toLowerCase());
      const to = nodeByKey.get(rawTo.trim().toLowerCase());

      if (!from || !to) {
        if (warnings) {
          pushReconciliationWarning(
            warnings,
            `${edgeName} se omitió porque referencia un nodo inexistente.`,
          );
          return [];
        }
        throw new Error("El flujo referencia un nodo inexistente.");
      }

      return [
        {
          from,
          to,
          label: nullableString(edge.label, `${edgeName}.label`, 300),
        },
      ];
    },
  );
  return {
    title: string(record.title, `${name}.title`, 300),
    nodes,
    edges,
    sourceIds: sourceIds(record.sourceIds, `${name}.sourceIds`),
  };
}

function parseSwimlaneProcessFlow(
  value: unknown,
  name: string,
  warnings?: string[],
): AiSwimlaneProcessFlow {
  const record = object(value, name);
  const flow = parseProcessFlow(record, name, warnings);
  const lanes = array(record.lanes, `${name}.lanes`, 50).map((item, index) => {
    const laneName = `${name}.lanes[${index}]`;
    const lane = object(item, laneName);
    const kind = string(lane.kind, `${laneName}.kind`, 20);
    if (!AI_PROCESS_LANE_KINDS.includes(kind as never)) {
      throw new Error(`${laneName}.kind no está permitido.`);
    }
    return {
      id: string(lane.id, `${laneName}.id`, 80),
      name: string(lane.name, `${laneName}.name`, 300),
      kind: kind as AiSwimlaneProcessFlow["lanes"][number]["kind"],
    };
  });
  unique(
    lanes.map((lane) => lane.id),
    `${name}.lanes`,
  );
  const laneByKey = new Map(
    lanes.map((lane) => [lane.id.trim().toLowerCase(), lane.id] as const),
  );
  const nodes = flow.nodes.map((node) => {
    if (!node.laneId) return node;
    const laneId = laneByKey.get(node.laneId.trim().toLowerCase());
    if (laneId) return { ...node, laneId };

    if (warnings) {
      pushReconciliationWarning(
        warnings,
        `${name}: el nodo ${node.id} perdió un laneId inexistente y requiere revisión.`,
      );
      return { ...node, laneId: null };
    }

    throw new Error(`${name} referencia un carril inexistente.`);
  });
  return {
    ...flow,
    nodes,
    objective: nullableString(record.objective, `${name}.objective`, 2_000),
    lanes,
    problems: strings(record.problems, `${name}.problems`, 100),
    improvements: strings(record.improvements, `${name}.improvements`, 100),
    expectedResults: strings(
      record.expectedResults,
      `${name}.expectedResults`,
      100,
    ),
  };
}

function parseEntityRelationship(
  value: unknown,
  name = "structuredAnalysis.entityRelationship",
  warnings?: string[],
): AiEntityRelationshipModel {
  const record = object(value, name);
  const entities = array(record.entities, `${name}.entities`, 100).map(
    (item, index) => {
      const entityName = `${name}.entities[${index}]`;
      const entity = object(item, entityName);
      const attributes = array(
        entity.attributes,
        `${entityName}.attributes`,
        100,
      ).map((attributeItem, attributeIndex) => {
        const attributeName = `${entityName}.attributes[${attributeIndex}]`;
        const attribute = object(attributeItem, attributeName);
        for (const flag of ["primaryKey", "foreignKey", "required"] as const) {
          if (typeof attribute[flag] !== "boolean") {
            throw new Error(`${attributeName}.${flag} no es booleano.`);
          }
        }
        return {
          name: string(attribute.name, `${attributeName}.name`, 200),
          dataType: string(
            attribute.dataType,
            `${attributeName}.dataType`,
            120,
          ),
          primaryKey: attribute.primaryKey as boolean,
          foreignKey: attribute.foreignKey as boolean,
          required: attribute.required as boolean,
        };
      });
      unique(
        attributes.map((attribute) => attribute.name),
        `${entityName}.attributes`,
      );
      return {
        id: string(entity.id, `${entityName}.id`, 80),
        name: string(entity.name, `${entityName}.name`, 300),
        description: string(
          entity.description,
          `${entityName}.description`,
          2_000,
        ),
        attributes,
      };
    },
  );
  unique(
    entities.map((entity) => entity.id),
    `${name}.entities`,
  );
  const entityByKey = new Map(
    entities.map(
      (entity) => [entity.id.trim().toLowerCase(), entity.id] as const,
    ),
  );
  const relationships = array(
    record.relationships,
    `${name}.relationships`,
    200,
  ).flatMap(
    (item, index): AiEntityRelationshipModel["relationships"][number][] => {
      const relationshipName = `${name}.relationships[${index}]`;
      const relationship = object(item, relationshipName);
      const rawFrom = string(relationship.from, `${relationshipName}.from`, 80);
      const rawTo = string(relationship.to, `${relationshipName}.to`, 80);
      const from = entityByKey.get(rawFrom.trim().toLowerCase());
      const to = entityByKey.get(rawTo.trim().toLowerCase());

      if (!from || !to) {
        if (warnings) {
          pushReconciliationWarning(
            warnings,
            `${relationshipName} se omitió porque referencia una entidad inexistente.`,
          );
          return [];
        }
        throw new Error(
          `${relationshipName} referencia una entidad inexistente.`,
        );
      }

      const cardinality = string(
        relationship.cardinality,
        `${relationshipName}.cardinality`,
        10,
      );
      if (!AI_ENTITY_CARDINALITIES.includes(cardinality as never)) {
        throw new Error(`${relationshipName}.cardinality no está permitida.`);
      }
      return [
        {
          from,
          to,
          cardinality:
            cardinality as AiEntityRelationshipModel["relationships"][number]["cardinality"],
          label: string(relationship.label, `${relationshipName}.label`, 300),
        },
      ];
    },
  );
  return {
    title: string(record.title, `${name}.title`, 300),
    entities,
    relationships,
    sourceIds: sourceIds(record.sourceIds, `${name}.sourceIds`),
  };
}

function parseFeatures(value: unknown): AiFeature[] {
  return array(value, "structuredAnalysis.features", 40).map((item, index) => {
    const feature = object(item, `structuredAnalysis.features[${index}]`);
    return {
      code: string(
        feature.code,
        `structuredAnalysis.features[${index}].code`,
        50,
      ),
      title: string(
        feature.title,
        `structuredAnalysis.features[${index}].title`,
        300,
      ),
      objective: string(
        feature.objective,
        `structuredAnalysis.features[${index}].objective`,
        2_000,
      ),
      description: string(
        feature.description,
        `structuredAnalysis.features[${index}].description`,
        5_000,
      ),
      inScope: strings(
        feature.inScope,
        `structuredAnalysis.features[${index}].inScope`,
        50,
      ),
      outOfScope: strings(
        feature.outOfScope,
        `structuredAnalysis.features[${index}].outOfScope`,
        50,
      ),
      userStoryCodes: strings(
        feature.userStoryCodes,
        `structuredAnalysis.features[${index}].userStoryCodes`,
        100,
      ),
      sourceIds: sourceIds(
        feature.sourceIds,
        `structuredAnalysis.features[${index}].sourceIds`,
      ),
    };
  });
}

function reconcileFeatureStoryCodes(
  features: readonly AiFeature[],
  userStories: readonly AiUserStory[],
): AiFeature[] {
  const storyCodesByFeature = new Map<string, string[]>();
  for (const story of userStories) {
    const codes = storyCodesByFeature.get(story.featureCode) ?? [];
    codes.push(story.code);
    storyCodesByFeature.set(story.featureCode, codes);
  }
  return features.map((feature) => ({
    ...feature,
    // featureCode en la HU es la relación propietaria. La lista inversa es
    // redundante y se reconstruye para tolerar duplicados cruzados del modelo.
    userStoryCodes: storyCodesByFeature.get(feature.code) ?? [],
  }));
}

function parseField(value: unknown, name: string): AiRequiredField {
  const field = object(value, name);
  if (typeof field.required !== "boolean") {
    throw new Error(`${name}.required no es booleano.`);
  }
  return {
    name: string(field.name, `${name}.name`, 200),
    dataType: string(field.dataType, `${name}.dataType`, 120),
    required: field.required,
    validation: string(field.validation, `${name}.validation`, 2_000),
    sourceIds: sourceIds(field.sourceIds, `${name}.sourceIds`),
  };
}

function parseUserStories(value: unknown): AiUserStory[] {
  return array(value, "structuredAnalysis.userStories", 150).map(
    (item, index) => {
      const name = `structuredAnalysis.userStories[${index}]`;
      const story = object(item, name);
      const criteria = array(
        story.acceptanceCriteria,
        `${name}.acceptanceCriteria`,
        50,
      ).map((criterionItem, criterionIndex) => {
        const criterionName = `${name}.acceptanceCriteria[${criterionIndex}]`;
        const criterion = object(criterionItem, criterionName);
        return {
          code: string(criterion.code, `${criterionName}.code`, 50),
          given: string(criterion.given, `${criterionName}.given`, 2_000),
          when: string(criterion.when, `${criterionName}.when`, 2_000),
          then: string(criterion.then, `${criterionName}.then`, 2_000),
          sourceIds: sourceIds(
            criterion.sourceIds,
            `${criterionName}.sourceIds`,
          ),
        };
      });
      if (criteria.length === 0) {
        throw new Error(
          `${name} debe tener al menos un criterio de aceptación.`,
        );
      }
      return {
        code: string(story.code, `${name}.code`, 50),
        featureCode: string(story.featureCode, `${name}.featureCode`, 50),
        title: string(story.title, `${name}.title`, 300),
        role: string(story.role, `${name}.role`, 500),
        want: string(story.want, `${name}.want`, 2_000),
        benefit: string(story.benefit, `${name}.benefit`, 2_000),
        context: string(story.context, `${name}.context`, 5_000),
        premises: strings(story.premises, `${name}.premises`, 50),
        impactedSystems: strings(
          story.impactedSystems,
          `${name}.impactedSystems`,
          50,
        ),
        fields: array(story.fields, `${name}.fields`, 100).map(
          (field, fieldIndex) =>
            parseField(field, `${name}.fields[${fieldIndex}]`),
        ),
        acceptanceCriteria: criteria,
        sourceIds: sourceIds(story.sourceIds, `${name}.sourceIds`),
      };
    },
  );
}

function parseBacklogTask(value: unknown, name: string): AiBacklogTask {
  const task = object(value, name);
  const type = string(task.type, `${name}.type`, 30);
  const origin = string(task.origin, `${name}.origin`, 40);
  if (!AI_SCRUM_TASK_TYPES.includes(type as never)) {
    throw new Error(`${name}.type no está permitido.`);
  }
  if (!AI_BACKLOG_TASK_ORIGINS.includes(origin as never)) {
    throw new Error(`${name}.origin no está permitido.`);
  }
  return {
    code: canonicalBacklogCode(task.code, `${name}.code`, "TASK"),
    title: string(task.title, `${name}.title`, 300),
    description: string(task.description, `${name}.description`, 2_000),
    type: type as AiBacklogTask["type"],
    origin: origin as AiBacklogTask["origin"],
    dependencyCodes: strings(
      task.dependencyCodes,
      `${name}.dependencyCodes`,
      30,
    ).map((code) => canonicalReferenceCode(code, "TASK")),
    sourceIds: sourceIds(task.sourceIds, `${name}.sourceIds`),
  };
}

function parseBacklogStructure(value: unknown): AiBacklogStructure {
  const backlog = object(value, "structuredAnalysis.backlogStructure");
  return {
    epics: array(
      backlog.epics,
      "structuredAnalysis.backlogStructure.epics",
      40,
    ).map((epicValue, epicIndex) => {
      const epicName = `structuredAnalysis.backlogStructure.epics[${epicIndex}]`;
      const epic = object(epicValue, epicName);
      return {
        code: canonicalBacklogCode(epic.code, `${epicName}.code`, "EPIC"),
        title: string(epic.title, `${epicName}.title`, 300),
        description: string(epic.description, `${epicName}.description`, 5_000),
        sourceIds: sourceIds(epic.sourceIds, `${epicName}.sourceIds`),
        features: array(epic.features, `${epicName}.features`, 40).map(
          (featureValue, featureIndex) => {
            const featureName = `${epicName}.features[${featureIndex}]`;
            const feature = object(featureValue, featureName);
            const featureCode = canonicalBacklogCode(
              feature.code,
              `${featureName}.code`,
              "FEATURE",
            );
            return {
              code: featureCode,
              title: string(feature.title, `${featureName}.title`, 300),
              description: string(
                feature.description,
                `${featureName}.description`,
                5_000,
              ),
              sourceIds: sourceIds(
                feature.sourceIds,
                `${featureName}.sourceIds`,
              ),
              userStories: array(
                feature.userStories,
                `${featureName}.userStories`,
                150,
              ).map((storyValue, storyIndex): AiBacklogUserStory => {
                const storyName = `${featureName}.userStories[${storyIndex}]`;
                const story = object(storyValue, storyName);
                const criteria = array(
                  story.acceptanceCriteria,
                  `${storyName}.acceptanceCriteria`,
                  50,
                ).map((criterionValue, criterionIndex) => {
                  const criterion = object(
                    criterionValue,
                    `${storyName}.acceptanceCriteria[${criterionIndex}]`,
                  );
                  return {
                    ...criterion,
                    code: canonicalBacklogCode(
                      criterion.code,
                      `${storyName}.acceptanceCriteria[${criterionIndex}].code`,
                      "ACCEPTANCE_CRITERION",
                    ),
                  };
                });
                const parsed = parseUserStories([
                  {
                    ...story,
                    code: canonicalBacklogCode(
                      story.code,
                      `${storyName}.code`,
                      "USER_STORY",
                    ),
                    featureCode,
                    acceptanceCriteria: criteria,
                  },
                ])[0];
                return {
                  ...parsed,
                  description: string(
                    story.description,
                    `${storyName}.description`,
                    5_000,
                  ),
                  tasks: array(story.tasks, `${storyName}.tasks`, 200).map(
                    (task, taskIndex) =>
                      parseBacklogTask(
                        task,
                        `${storyName}.tasks[${taskIndex}]`,
                      ),
                  ),
                };
              }),
            };
          },
        ),
      };
    }),
  };
}

function parseFunctionalUserStoriesV41(
  value: unknown,
  warnings: string[] = [],
): AiFunctionalUserStoryV41[] {
  const functionalUserStories = array(
    value,
    "structuredAnalysis.functionalUserStories",
    300,
  );
  return functionalUserStories.map((storyValue, storyIndex) => {
    const name = `structuredAnalysis.functionalUserStories[${storyIndex}]`;
    const story = object(storyValue, name);
    const criteria = array(
      story.acceptanceCriteria,
      `${name}.acceptanceCriteria`,
      50,
    );
    const parsedCriteria = criteria.map((criterionValue, criterionIndex) => {
      const criterionName = `${name}.acceptanceCriteria[${criterionIndex}]`;
      const criterion = object(criterionValue, criterionName);
      return {
        code: canonicalFunctionalCriterionCode(
          criterion.code,
          `${criterionName}.code`,
        ),
        given: string(criterion.given, `${criterionName}.given`, 2_000),
        when: string(criterion.when, `${criterionName}.when`, 2_000),
        then: string(criterion.then, `${criterionName}.then`, 2_000),
        sourceIds: sourceIds(criterion.sourceIds, `${criterionName}.sourceIds`),
      };
    });

    const functionalNeedCodes = Object.hasOwn(story, "functionalNeedCodes")
      ? strings(
          story.functionalNeedCodes,
          `${name}.functionalNeedCodes`,
          100,
        ).map((code, index) =>
          canonicalFunctionalNeedCode(
            code,
            `${name}.functionalNeedCodes[${index}]`,
          ),
        )
      : [];

    if (new Set(functionalNeedCodes).size !== functionalNeedCodes.length) {
      throw new Error(
        `${name}.functionalNeedCodes contiene códigos repetidos.`,
      );
    }

    /*
     * COMPATIBILIDAD_V41_PRE_V4_7_9
     * Los resultados históricos no incluyen estado documental. Se interpretan
     * como COMPLETE salvo que un marcador esencial o la ausencia de CA-F haga
     * inequívoca la documentación pendiente. El JSON persistido no se modifica.
     */
    const pendingMarker = "[PENDIENTE POR DEFINIR]";
    const historicalDocumentationPending =
      criteria.length === 0 ||
      [story.role, story.want, story.benefit, story.context].some(
        (value) =>
          typeof value !== "string" ||
          !value.trim() ||
          value.trim() === pendingMarker,
      );
    let documentationStatus = Object.hasOwn(story, "documentationStatus")
      ? string(story.documentationStatus, `${name}.documentationStatus`, 40)
          .trim()
          .toUpperCase()
      : historicalDocumentationPending
        ? "PENDING_DOCUMENTATION"
        : "COMPLETE";
    let documentationObservation = Object.hasOwn(
      story,
      "documentationObservation",
    )
      ? nullableString(
          story.documentationObservation,
          `${name}.documentationObservation`,
          2_000,
        )
      : historicalDocumentationPending
        ? "El resultado histórico contiene información funcional esencial pendiente de documentar."
        : null;

    if (
      documentationStatus !== "COMPLETE" &&
      documentationStatus !== "PENDING_DOCUMENTATION"
    ) {
      throw new Error(
        `${name}.documentationStatus debe ser COMPLETE o PENDING_DOCUMENTATION.`,
      );
    }

    const missingDocumentation = [
      ["role", story.role],
      ["want", story.want],
      ["benefit", story.benefit],
      ["context", story.context],
    ]
      .filter(
        ([, fieldValue]) =>
          typeof fieldValue !== "string" ||
          !fieldValue.trim() ||
          fieldValue.trim() === pendingMarker,
      )
      .flatMap(([field]) => (typeof field === "string" ? [field] : []));
    if (criteria.length === 0) missingDocumentation.push("acceptanceCriteria");

    /*
     * AI_DERIVED_STATUS_RECONCILIATION_V1
     *
     * Structured Outputs garantiza forma y tipos, no invariantes entre campos.
     * Los estados COMPLETE/PENDING y sus observaciones son metadatos derivados:
     * una contradicción reparable no debe descartar un documento completo ni
     * obligar a pagar otra generación. Se conserva fail-closed degradando a
     * pendiente cuando falta contenido; nunca se inventa información funcional.
     */
    if (documentationStatus === "COMPLETE" && missingDocumentation.length > 0) {
      documentationStatus = "PENDING_DOCUMENTATION";
      documentationObservation =
        documentationObservation?.trim() ||
        `Falta documentar información funcional obligatoria: ${missingDocumentation.join(", ")}.`;
      pushReconciliationWarning(
        warnings,
        `${name}: documentationStatus se corrigió de COMPLETE a PENDING_DOCUMENTATION porque faltan ${missingDocumentation.join(", ")}.`,
      );
    } else if (
      documentationStatus === "COMPLETE" &&
      documentationObservation?.trim()
    ) {
      documentationObservation = null;
      pushReconciliationWarning(
        warnings,
        `${name}: documentationObservation se normalizó a null porque la historia está COMPLETE.`,
      );
    } else if (
      documentationStatus === "PENDING_DOCUMENTATION" &&
      !documentationObservation?.trim()
    ) {
      documentationObservation =
        missingDocumentation.length > 0
          ? `Falta documentar información funcional obligatoria: ${missingDocumentation.join(", ")}.`
          : "La historia requiere validación documental antes de considerarse completa.";
      pushReconciliationWarning(
        warnings,
        `${name}: se agregó una documentationObservation segura para conservar el estado PENDING_DOCUMENTATION.`,
      );
    }

    /*
     * COMPATIBILIDAD_V41_PRE_V7_1_1
     *
     * Resultados V4.1 históricos no tienen assignmentStatus ni
     * assignmentObservation. Al leerlos se consideran ASSIGNED si ya poseen
     * Hito. El schema nuevo sí exige los campos en nuevas generaciones.
     */
    let milestone = Object.hasOwn(story, "milestone")
      ? nullableString(story.milestone, `${name}.milestone`, 50)
      : null;
    let functionality = Object.hasOwn(story, "functionality")
      ? nullableString(story.functionality, `${name}.functionality`, 500)
      : null;
    let milestoneDescription = Object.hasOwn(story, "milestoneDescription")
      ? nullableString(
          story.milestoneDescription,
          `${name}.milestoneDescription`,
          5_000,
        )
      : null;
    let assignmentObservation = Object.hasOwn(story, "assignmentObservation")
      ? nullableString(
          story.assignmentObservation,
          `${name}.assignmentObservation`,
          2_000,
        )
      : null;

    let assignmentStatus = Object.hasOwn(story, "assignmentStatus")
      ? string(story.assignmentStatus, `${name}.assignmentStatus`, 40)
          .trim()
          .toUpperCase()
      : milestone
        ? "ASSIGNED"
        : "PENDING_ASSIGNMENT";

    if (
      assignmentStatus !== "ASSIGNED" &&
      assignmentStatus !== "PENDING_ASSIGNMENT"
    ) {
      throw new Error(
        `${name}.assignmentStatus debe ser ASSIGNED o PENDING_ASSIGNMENT.`,
      );
    }

    const missingAssignment = [
      ["milestone", milestone],
      ["functionality", functionality],
      ["milestoneDescription", milestoneDescription],
    ]
      .filter(([, fieldValue]) => !fieldValue?.trim())
      .flatMap(([field]) => (typeof field === "string" ? [field] : []));

    if (assignmentStatus === "ASSIGNED" && missingAssignment.length > 0) {
      assignmentStatus = "PENDING_ASSIGNMENT";
      milestone = null;
      functionality = null;
      milestoneDescription = null;
      assignmentObservation =
        assignmentObservation?.trim() ||
        `No se pudo confirmar la asignación porque faltan: ${missingAssignment.join(", ")}.`;
      pushReconciliationWarning(
        warnings,
        `${name}: assignmentStatus se corrigió de ASSIGNED a PENDING_ASSIGNMENT porque faltan ${missingAssignment.join(", ")}.`,
      );
    } else if (assignmentStatus === "ASSIGNED") {
      if (assignmentObservation?.trim()) {
        assignmentObservation = null;
        pushReconciliationWarning(
          warnings,
          `${name}: assignmentObservation se normalizó a null porque la historia está ASSIGNED.`,
        );
      }
    } else {
      if (
        milestone !== null ||
        functionality !== null ||
        milestoneDescription !== null
      ) {
        milestone = null;
        functionality = null;
        milestoneDescription = null;
        pushReconciliationWarning(
          warnings,
          `${name}: los datos de Hito se descartaron porque assignmentStatus es PENDING_ASSIGNMENT.`,
        );
      }
      if (!assignmentObservation?.trim()) {
        assignmentObservation =
          "La ubicación estructural de la historia requiere validación antes de asignarla a un Hito.";
        pushReconciliationWarning(
          warnings,
          `${name}: se agregó una assignmentObservation segura para conservar el estado PENDING_ASSIGNMENT.`,
        );
      }
    }

    const title = string(story.title, `${name}.title`, 300);
    const role = string(story.role, `${name}.role`, 500);
    const want = string(story.want, `${name}.want`, 2_000);
    const benefit = string(story.benefit, `${name}.benefit`, 2_000);
    const context = string(story.context, `${name}.context`, 5_000);
    const description = conciseFunctionalStoryDescription({
      description: string(story.description, `${name}.description`, 5_000),
      title,
      want,
    });

    return {
      code: canonicalFunctionalStoryCode(story.code, `${name}.code`),
      title,
      description,
      assignmentStatus:
        assignmentStatus as AiFunctionalUserStoryV41["assignmentStatus"],
      documentationStatus:
        documentationStatus as AiFunctionalUserStoryV41["documentationStatus"],
      documentationObservation,
      milestone: milestone?.trim().toUpperCase() ?? null,
      functionality,
      milestoneDescription,
      assignmentObservation,
      role,
      want,
      benefit,
      context,
      premises: strings(story.premises, `${name}.premises`, 50),
      impactedSystems: strings(
        story.impactedSystems,
        `${name}.impactedSystems`,
        50,
      ),
      fields: array(story.fields, `${name}.fields`, 100).map((field, index) =>
        parseField(field, `${name}.fields[${index}]`),
      ),
      acceptanceCriteria: parsedCriteria,
      functionalNeedCodes,
      sourceIds: sourceIds(story.sourceIds, `${name}.sourceIds`),
    };
  });
}

function parsePlanningBacklogTaskV41(
  value: unknown,
  name: string,
): AiPlanningBacklogTaskV41 {
  const task = object(value, name);
  const type = string(task.type, `${name}.type`, 30);
  const rawOrigin = string(task.origin, `${name}.origin`, 40);
  if (!AI_SCRUM_TASK_TYPES.includes(type as never)) {
    throw new Error(`${name}.type no está permitido.`);
  }
  if (!AI_BACKLOG_TASK_ORIGINS.includes(rawOrigin as never)) {
    throw new Error(`${name}.origin no está permitido.`);
  }
  const sourceNumber = Object.hasOwn(task, "sourceNumber")
    ? nullableString(task.sourceNumber, `${name}.sourceNumber`, 120)
    : null;
  return {
    code: canonicalBacklogCode(task.code, `${name}.code`, "TASK"),
    title: string(task.title, `${name}.title`, 300),
    description: string(task.description, `${name}.description`, 2_000),
    sourceNumber,
    type: type as AiPlanningBacklogTaskV41["type"],
    origin: (sourceNumber
      ? "EVIDENCE"
      : rawOrigin) as AiPlanningBacklogTaskV41["origin"],
    dependencyCodes: strings(
      task.dependencyCodes,
      `${name}.dependencyCodes`,
      30,
    ).map((code) => canonicalReferenceCode(code, "TASK")),
    sourceIds: sourceIds(task.sourceIds, `${name}.sourceIds`),
  };
}

function parsePlanningBacklogUserStoryValueV41(
  value: unknown,
  name: string,
): AiPlanningBacklogUserStoryV41 {
  const story = object(value, name);
  return {
    code: canonicalPlanningStoryCode(story.code, `${name}.code`),
    title: string(story.title, `${name}.title`, 300),
    description: string(story.description, `${name}.description`, 5_000),
    sourceNumber: Object.hasOwn(story, "sourceNumber")
      ? nullableString(story.sourceNumber, `${name}.sourceNumber`, 120)
      : null,
    functionalRequirementCodes: strings(
      story.functionalRequirementCodes,
      `${name}.functionalRequirementCodes`,
      100,
    ).map(canonicalFunctionalStoryReference),
    sourceIds: sourceIds(story.sourceIds, `${name}.sourceIds`),
    tasks: array(story.tasks, `${name}.tasks`, 200).map((task, taskIndex) =>
      parsePlanningBacklogTaskV41(task, `${name}.tasks[${taskIndex}]`),
    ),
  };
}

function parsePlanningBacklogFeatureValueV41(
  value: unknown,
  name: string,
): AiPlanningBacklogFeatureV41 {
  const feature = object(value, name);
  return {
    code: canonicalBacklogCode(feature.code, `${name}.code`, "FEATURE"),
    title: string(feature.title, `${name}.title`, 300),
    description: string(feature.description, `${name}.description`, 5_000),
    sourceNumber: Object.hasOwn(feature, "sourceNumber")
      ? nullableString(feature.sourceNumber, `${name}.sourceNumber`, 120)
      : null,
    sourceIds: sourceIds(feature.sourceIds, `${name}.sourceIds`),
    userStories: array(feature.userStories, `${name}.userStories`, 150).map(
      (story, storyIndex) =>
        parsePlanningBacklogUserStoryValueV41(
          story,
          `${name}.userStories[${storyIndex}]`,
        ),
    ),
  };
}

function parsePlanningPendingAssignmentsV41(
  backlog: Readonly<Record<string, unknown>>,
): AiPlanningPendingAssignmentsV41 {
  if (!Object.hasOwn(backlog, "pendingAssignments")) {
    return { features: [], userStories: [], tasks: [] };
  }

  const pending = object(
    backlog.pendingAssignments,
    "structuredAnalysis.backlogStructure.pendingAssignments",
  );

  const parseEnvelope = <T>(
    value: unknown,
    name: string,
    parseItem: (item: unknown, itemName: string) => T,
  ): {
    assignmentStatus: "PENDING_ASSIGNMENT";
    assignmentObservation: string;
    sourceParentPath: string | null;
    item: T;
  } => {
    const envelope = object(value, name);
    const assignmentStatus = string(
      envelope.assignmentStatus,
      `${name}.assignmentStatus`,
      40,
    )
      .trim()
      .toUpperCase();

    if (assignmentStatus !== "PENDING_ASSIGNMENT") {
      throw new Error(`${name}.assignmentStatus debe ser PENDING_ASSIGNMENT.`);
    }

    return {
      assignmentStatus: "PENDING_ASSIGNMENT",
      assignmentObservation: string(
        envelope.assignmentObservation,
        `${name}.assignmentObservation`,
        2_000,
      ),
      sourceParentPath: Object.hasOwn(envelope, "sourceParentPath")
        ? nullableString(
            envelope.sourceParentPath,
            `${name}.sourceParentPath`,
            500,
          )
        : null,
      item: parseItem(envelope.item, `${name}.item`),
    };
  };

  return {
    features: array(
      pending.features,
      "structuredAnalysis.backlogStructure.pendingAssignments.features",
      40,
    ).map((value, index) =>
      parseEnvelope(
        value,
        `structuredAnalysis.backlogStructure.pendingAssignments.features[${index}]`,
        parsePlanningBacklogFeatureValueV41,
      ),
    ),
    userStories: array(
      pending.userStories,
      "structuredAnalysis.backlogStructure.pendingAssignments.userStories",
      150,
    ).map((value, index) =>
      parseEnvelope(
        value,
        `structuredAnalysis.backlogStructure.pendingAssignments.userStories[${index}]`,
        parsePlanningBacklogUserStoryValueV41,
      ),
    ),
    tasks: array(
      pending.tasks,
      "structuredAnalysis.backlogStructure.pendingAssignments.tasks",
      200,
    ).map((value, index) =>
      parseEnvelope(
        value,
        `structuredAnalysis.backlogStructure.pendingAssignments.tasks[${index}]`,
        parsePlanningBacklogTaskV41,
      ),
    ),
  };
}

function parsePlanningBacklogStructureV41(
  value: unknown,
): AiPlanningBacklogStructureV41 {
  const backlog = object(value, "structuredAnalysis.backlogStructure");
  const rawStructureStatus = Object.hasOwn(backlog, "structureStatus")
    ? string(
        backlog.structureStatus,
        "structuredAnalysis.backlogStructure.structureStatus",
        40,
      )
    : "CONFIRMED";
  if (!["CONFIRMED", "AI_SUGGESTED"].includes(rawStructureStatus)) {
    throw new Error(
      "structuredAnalysis.backlogStructure.structureStatus no está permitido.",
    );
  }
  return {
    structureStatus: rawStructureStatus as "CONFIRMED" | "AI_SUGGESTED",
    pendingAssignments: parsePlanningPendingAssignmentsV41(backlog),
    epics: array(
      backlog.epics,
      "structuredAnalysis.backlogStructure.epics",
      40,
    ).map((epicValue, epicIndex) => {
      const epicName = `structuredAnalysis.backlogStructure.epics[${epicIndex}]`;
      const epic = object(epicValue, epicName);
      return {
        code: canonicalBacklogCode(epic.code, `${epicName}.code`, "EPIC"),
        title: string(epic.title, `${epicName}.title`, 300),
        description: string(epic.description, `${epicName}.description`, 5_000),
        sourceNumber: Object.hasOwn(epic, "sourceNumber")
          ? nullableString(epic.sourceNumber, `${epicName}.sourceNumber`, 120)
          : null,
        sourceIds: sourceIds(epic.sourceIds, `${epicName}.sourceIds`),
        features: array(epic.features, `${epicName}.features`, 40).map(
          (featureValue, featureIndex) => {
            const featureName = `${epicName}.features[${featureIndex}]`;
            const feature = object(featureValue, featureName);
            return {
              code: canonicalBacklogCode(
                feature.code,
                `${featureName}.code`,
                "FEATURE",
              ),
              title: string(feature.title, `${featureName}.title`, 300),
              description: string(
                feature.description,
                `${featureName}.description`,
                5_000,
              ),
              sourceNumber: Object.hasOwn(feature, "sourceNumber")
                ? nullableString(
                    feature.sourceNumber,
                    `${featureName}.sourceNumber`,
                    120,
                  )
                : null,
              sourceIds: sourceIds(
                feature.sourceIds,
                `${featureName}.sourceIds`,
              ),
              userStories: array(
                feature.userStories,
                `${featureName}.userStories`,
                150,
              ).map((storyValue, storyIndex): AiPlanningBacklogUserStoryV41 => {
                const storyName = `${featureName}.userStories[${storyIndex}]`;
                const story = object(storyValue, storyName);
                return {
                  code: canonicalPlanningStoryCode(
                    story.code,
                    `${storyName}.code`,
                  ),
                  title: string(story.title, `${storyName}.title`, 300),
                  description: string(
                    story.description,
                    `${storyName}.description`,
                    5_000,
                  ),
                  sourceNumber: Object.hasOwn(story, "sourceNumber")
                    ? nullableString(
                        story.sourceNumber,
                        `${storyName}.sourceNumber`,
                        120,
                      )
                    : null,
                  functionalRequirementCodes: strings(
                    story.functionalRequirementCodes,
                    `${storyName}.functionalRequirementCodes`,
                    100,
                  ).map(canonicalFunctionalStoryReference),
                  sourceIds: sourceIds(
                    story.sourceIds,
                    `${storyName}.sourceIds`,
                  ),
                  tasks: array(story.tasks, `${storyName}.tasks`, 200).map(
                    (task, taskIndex) =>
                      parsePlanningBacklogTaskV41(
                        task,
                        `${storyName}.tasks[${taskIndex}]`,
                      ),
                  ),
                };
              }),
            };
          },
        ),
      };
    }),
  };
}

function parseTests(value: unknown): AiTestScenario[] {
  return array(value, "structuredAnalysis.tests", 250).map((item, index) => {
    const name = `structuredAnalysis.tests[${index}]`;
    const scenario = object(item, name);
    return {
      code: string(scenario.code, `${name}.code`, 50),
      title: string(scenario.title, `${name}.title`, 300),
      userStoryCodes: strings(
        scenario.userStoryCodes,
        `${name}.userStoryCodes`,
        30,
      ),
      acceptanceCriterionCodes: strings(
        scenario.acceptanceCriterionCodes,
        `${name}.acceptanceCriterionCodes`,
        50,
      ),
      precondition: string(
        scenario.precondition,
        `${name}.precondition`,
        2_000,
      ),
      action: string(scenario.action, `${name}.action`, 2_000),
      expectedResult: string(
        scenario.expectedResult,
        `${name}.expectedResult`,
        2_000,
      ),
      sourceIds: sourceIds(scenario.sourceIds, `${name}.sourceIds`),
      taskCodes:
        scenario.taskCodes === undefined
          ? []
          : strings(scenario.taskCodes, `${name}.taskCodes`, 50),
    };
  });
}

function isoDate(value: string, name: string): string {
  if (!new RegExp(ISO_DATE_PATTERN, "u").test(value)) {
    throw new Error(`${name} no tiene formato YYYY-MM-DD.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`${name} no es una fecha válida.`);
  }
  return value;
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseTask(
  value: unknown,
  name: string,
  schedule: {
    sprintStartDay: number;
    sprintEndDay: number;
    fallbackStartDay: number;
    confirmedStartDate: string | null;
  },
): AiScrumTask {
  const task = object(value, name);
  const type = string(task.type, `${name}.type`, 30);
  if (!AI_SCRUM_TASK_TYPES.includes(type as never)) {
    throw new Error(`${name}.type no está permitido.`);
  }
  const startDay =
    typeof task.startDay === "number"
      ? integer(task.startDay, `${name}.startDay`, 1, 1_500)
      : schedule.fallbackStartDay;
  const endDay =
    typeof task.endDay === "number"
      ? integer(task.endDay, `${name}.endDay`, 1, 1_500)
      : startDay;
  if (
    startDay < schedule.sprintStartDay ||
    endDay > schedule.sprintEndDay ||
    endDay < startDay
  ) {
    throw new Error(
      `${name} debe programarse entre los días ${schedule.sprintStartDay} y ${schedule.sprintEndDay} de su Sprint.`,
    );
  }
  // El rango programado es la fuente canónica de la duración. Los modelos de
  // IA pueden devolver una estimación distinta aun usando salida estructurada;
  // normalizarla evita invalidar el documento completo por un dato derivable.
  const estimatedDurationDays = endDay - startDay + 1;
  return {
    code: string(task.code, `${name}.code`, 50),
    type: type as AiScrumTask["type"],
    description: string(task.description, `${name}.description`, 2_000),
    userStoryCode: string(task.userStoryCode, `${name}.userStoryCode`, 50),
    suggestedRole: string(task.suggestedRole, `${name}.suggestedRole`, 300),
    dependencyCodes: strings(
      task.dependencyCodes,
      `${name}.dependencyCodes`,
      30,
    ),
    expectedResult: string(
      task.expectedResult,
      `${name}.expectedResult`,
      2_000,
    ),
    estimatedDurationDays,
    startDay,
    endDay,
    startDate: schedule.confirmedStartDate
      ? addDays(schedule.confirmedStartDate, startDay - 1)
      : null,
    endDate: schedule.confirmedStartDate
      ? addDays(schedule.confirmedStartDate, endDay - 1)
      : null,
  };
}

function parseScrumPlan(value: unknown): AiScrumPlan | null {
  if (value === null) return null;
  const plan = object(value, "structuredAnalysis.scrumPlan");
  if (plan.cadenceDays !== 15) {
    throw new Error("El plan Scrum debe usar Sprints de 15 días calendario.");
  }
  const scheduleBasis = string(
    plan.scheduleBasis,
    "structuredAnalysis.scrumPlan.scheduleBasis",
    30,
  );
  if (scheduleBasis !== "RELATIVE_DAY" && scheduleBasis !== "CONFIRMED_DATE") {
    throw new Error("scheduleBasis no es válido.");
  }
  const rawStartDate = nullableString(
    plan.confirmedStartDate,
    "structuredAnalysis.scrumPlan.confirmedStartDate",
    10,
  );
  const confirmedStartDate = rawStartDate
    ? isoDate(rawStartDate, "structuredAnalysis.scrumPlan.confirmedStartDate")
    : null;
  if (
    (scheduleBasis === "CONFIRMED_DATE" && !confirmedStartDate) ||
    (scheduleBasis === "RELATIVE_DAY" && confirmedStartDate)
  ) {
    throw new Error(
      "La fecha confirmada debe existir únicamente cuando scheduleBasis es CONFIRMED_DATE.",
    );
  }

  const sprints: AiScrumSprint[] = array(
    plan.sprints,
    "structuredAnalysis.scrumPlan.sprints",
    40,
  ).map((item, index) => {
    const name = `structuredAnalysis.scrumPlan.sprints[${index}]`;
    const sprint = object(item, name);
    const number = integer(sprint.number, `${name}.number`, 1, 100);
    if (number !== index + 1) {
      throw new Error("Los Sprints deben ser consecutivos y comenzar en 1.");
    }
    const startDay = index * 15 + 1;
    const endDay = startDay + 14;
    const startDate = confirmedStartDate
      ? addDays(confirmedStartDate, index * 15)
      : null;
    const endDate = startDate ? addDays(startDate, 14) : null;
    return {
      code: string(sprint.code, `${name}.code`, 50),
      number,
      period:
        startDate && endDate
          ? `${startDate} al ${endDate}`
          : `Día ${startDay} al Día ${endDay}`,
      startDay,
      endDay,
      startDate,
      endDate,
      objective: string(sprint.objective, `${name}.objective`, 2_000),
      featureCodes: strings(sprint.featureCodes, `${name}.featureCodes`, 100),
      userStoryCodes: strings(
        sprint.userStoryCodes,
        `${name}.userStoryCodes`,
        100,
      ),
      tasks: array(sprint.tasks, `${name}.tasks`, 200).map((task, taskIndex) =>
        parseTask(task, `${name}.tasks[${taskIndex}]`, {
          sprintStartDay: startDay,
          sprintEndDay: endDay,
          fallbackStartDay: Math.min(startDay + taskIndex, endDay),
          confirmedStartDate,
        }),
      ),
      dependencies: strings(sprint.dependencies, `${name}.dependencies`, 100),
      testCodes: strings(sprint.testCodes, `${name}.testCodes`, 100),
      deliverables: strings(sprint.deliverables, `${name}.deliverables`, 100),
      closingCriterion: string(
        sprint.closingCriterion,
        `${name}.closingCriterion`,
        2_000,
      ),
      risks: strings(sprint.risks, `${name}.risks`, 100),
    };
  });
  return {
    cadenceDays: 15,
    scheduleBasis,
    confirmedStartDate,
    sourceIds: sourceIds(
      plan.sourceIds,
      "structuredAnalysis.scrumPlan.sourceIds",
    ),
    sprints,
  };
}

function reconcileScrumDependencies(
  plan: AiScrumPlan | null,
): AiScrumPlan | null {
  if (!plan) return null;

  const sprintCodes = new Set(plan.sprints.map((sprint) => sprint.code));
  const taskCodes = new Set(
    plan.sprints.flatMap((sprint) => sprint.tasks.map((task) => task.code)),
  );

  return {
    ...plan,
    sprints: plan.sprints.map((sprint) => {
      const sprintDependencies = new Set(sprint.dependencies);
      const tasks = sprint.tasks.map((task) => {
        const taskDependencies: string[] = [];

        for (const dependencyCode of task.dependencyCodes) {
          if (taskCodes.has(dependencyCode)) {
            taskDependencies.push(dependencyCode);
          } else if (sprintCodes.has(dependencyCode)) {
            // Los modelos suelen ubicar una dependencia de Sprint dentro de una
            // tarea. Se conserva a nivel de Sprint, que es su ubicación canónica.
            if (dependencyCode !== sprint.code) {
              sprintDependencies.add(dependencyCode);
            }
          } else {
            // Se conserva para que assertReferences rechace referencias realmente
            // inexistentes en vez de ocultar información inconsistente.
            taskDependencies.push(dependencyCode);
          }
        }

        return {
          ...task,
          dependencyCodes: [...new Set(taskDependencies)],
        };
      });

      return {
        ...sprint,
        tasks,
        dependencies: [...sprintDependencies],
      };
    }),
  };
}

interface CanonicalCodeOccurrence {
  originalCode: string;
  canonicalCode: string;
  ownerIndex: number;
  itemIndex: number;
}

function canonicalCodeAtV490(
  occurrences: readonly CanonicalCodeOccurrence[],
  index: number,
): string {
  const occurrence = occurrences[index];
  if (!occurrence) {
    throw new Error(
      "La canonicalización técnica perdió la correspondencia de un nodo.",
    );
  }
  return occurrence.canonicalCode;
}

function canonicalizeTechnicalCodeOccurrencesV490(
  codes: readonly { code: string; ownerIndex: number }[],
  prefix: string,
  warningContext: (occurrence: CanonicalCodeOccurrence) => string,
  warnings: string[],
): CanonicalCodeOccurrence[] {
  const reserved = new Set(codes.map(({ code }) => code));
  const occupied = new Set<string>();
  let nextNumber = 1;

  const nextFreeCode = (): string => {
    while (true) {
      const candidate = `${prefix}-${String(nextNumber).padStart(3, "0")}`;
      nextNumber += 1;
      if (!reserved.has(candidate) && !occupied.has(candidate))
        return candidate;
    }
  };

  return codes.map(({ code, ownerIndex }, itemIndex) => {
    const canonicalCode = occupied.has(code) ? nextFreeCode() : code;
    occupied.add(canonicalCode);
    const occurrence = {
      originalCode: code,
      canonicalCode,
      ownerIndex,
      itemIndex,
    };
    if (canonicalCode !== code) {
      pushReconciliationWarning(
        warnings,
        `${warningContext(occurrence)}: ${code} duplicado fue canonicalizado como ${canonicalCode}.`,
      );
    }
    return occurrence;
  });
}

function canonicalizeSequentialAliasesV490(
  rawCodes: readonly string[],
  label: string,
  warnings: string[],
): CanonicalCodeOccurrence[] {
  const codes = rawCodes.map((code) => code.trim().toUpperCase());
  const reserved = new Set(codes);
  const occupied = new Set<string>();
  return codes.map((code, itemIndex) => {
    let canonicalCode = code;
    if (occupied.has(code)) {
      const match = code.match(/^([A-Z][A-Z0-9-]*?)-?(\d+)$/u);
      if (!match?.[1]) {
        throw new Error(
          `${label} contiene el código duplicado no reparable ${code}.`,
        );
      }
      const prefix = match[1].replace(/-$/u, "");
      let next = 1;
      do {
        canonicalCode = `${prefix}-${String(next).padStart(3, "0")}`;
        next += 1;
      } while (reserved.has(canonicalCode) || occupied.has(canonicalCode));
      pushReconciliationWarning(
        warnings,
        `${label}: ${code} duplicado fue canonicalizado como ${canonicalCode}.`,
      );
    }
    occupied.add(canonicalCode);
    return {
      originalCode: code,
      canonicalCode,
      ownerIndex: 0,
      itemIndex,
    };
  });
}

/*
 * V4_9_0_SCRUM_TASK_IDENTITY_CANONICALIZATION
 *
 * El código propuesto por la IA no identifica al nodo. La identidad de una
 * Task Scrum incluye Sprint, posición y contenido. Se preservan todos los
 * nodos y se repara únicamente el identificador técnico repetido.
 */
function canonicalizeScrumTaskCodesV490(
  plan: AiScrumPlan | null,
  warnings: string[],
): AiScrumPlan | null {
  if (!plan) return null;

  const flattened = plan.sprints.flatMap((sprint, sprintIndex) =>
    sprint.tasks.map((task) => ({ code: task.code, ownerIndex: sprintIndex })),
  );
  const occurrences = canonicalizeTechnicalCodeOccurrencesV490(
    flattened,
    "T",
    (occurrence) =>
      `Scrum/${plan.sprints[occurrence.ownerIndex]?.code ?? `Sprint ${occurrence.ownerIndex + 1}`}`,
    warnings,
  );
  let flatIndex = 0;

  return {
    ...plan,
    sprints: plan.sprints.map((sprint, sprintIndex) => ({
      ...sprint,
      tasks: sprint.tasks.map((task) => {
        const occurrence = occurrences[flatIndex++];
        if (!occurrence) {
          throw new Error("La canonicalización Scrum perdió una Task.");
        }
        const dependencyCodes = task.dependencyCodes.map((rawCode) => {
          const code = canonicalReferenceCode(rawCode, "TASK");
          const candidates = occurrences.filter(
            (candidate) =>
              candidate.originalCode === code &&
              candidate.itemIndex !== occurrence.itemIndex,
          );
          if (candidates.length <= 1) {
            return candidates[0]?.canonicalCode ?? code;
          }
          const sameSprint = candidates.filter(
            (candidate) => candidate.ownerIndex === sprintIndex,
          );
          if (sameSprint.length === 1)
            return sameSprint[0]?.canonicalCode ?? code;
          if (sameSprint.length > 1) {
            throw new Error(
              `${sprint.code}/${occurrence.canonicalCode} contiene la referencia ambigua ${code}; no se eligió un destino arbitrario.`,
            );
          }
          const previousSprints = candidates.filter(
            (candidate) => candidate.ownerIndex < sprintIndex,
          );
          if (previousSprints.length === 1) {
            return previousSprints[0]?.canonicalCode ?? code;
          }
          throw new Error(
            `${sprint.code}/${occurrence.canonicalCode} contiene la referencia ambigua ${code}; no se eligió un destino arbitrario.`,
          );
        });
        return {
          ...task,
          code: occurrence.canonicalCode,
          dependencyCodes: [...new Set(dependencyCodes)],
        };
      }),
    })),
  };
}

function resolveCanonicalOccurrenceV490(
  rawCode: string,
  occurrences: readonly CanonicalCodeOccurrence[],
  preferred: (occurrence: CanonicalCodeOccurrence) => boolean,
  context: string,
): string {
  const candidates = occurrences.filter(
    (occurrence) => occurrence.originalCode === rawCode,
  );
  if (candidates.length <= 1) return candidates[0]?.canonicalCode ?? rawCode;
  const contextual = candidates.filter(preferred);
  if (contextual.length === 1) return contextual[0]?.canonicalCode ?? rawCode;
  throw new Error(
    `${context} contiene la referencia ambigua ${rawCode}; no se eligió un destino arbitrario.`,
  );
}

function sharesEvidenceV490(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const rightSet = new Set(right);
  return left.some((sourceId) => rightSet.has(sourceId));
}

/* Canonicaliza los espacios técnicos independientes de Punto 6 y Punto 7. */
function canonicalizeV41IdentityGraphV490(
  functionalUserStories: readonly AiFunctionalUserStoryV41[],
  backlogStructure: AiPlanningBacklogStructureV41,
  tests: readonly AiTestScenario[],
  scrumPlan: AiScrumPlan | null,
  warnings: string[],
): {
  functionalUserStories: AiFunctionalUserStoryV41[];
  backlogStructure: AiPlanningBacklogStructureV41;
  tests: AiTestScenario[];
  scrumPlan: AiScrumPlan | null;
} {
  const functionalOccurrences = canonicalizeTechnicalCodeOccurrencesV490(
    functionalUserStories.map((story) => ({ code: story.code, ownerIndex: 0 })),
    "HU-F",
    () => "Punto 6/HU-F",
    warnings,
  );
  const criterionRows = functionalUserStories.flatMap((story, storyIndex) =>
    story.acceptanceCriteria.map((criterion) => ({
      code: criterion.code,
      ownerIndex: storyIndex,
    })),
  );
  const reservedCriterionCodes = new Set(criterionRows.map(({ code }) => code));
  const occupiedCriterionCodes = new Set<string>();
  const nextCriterionByStory = new Map<number, number>();
  const criterionOccurrences = criterionRows.map(
    ({ code, ownerIndex }, itemIndex): CanonicalCodeOccurrence => {
      let canonicalCode = code;
      if (occupiedCriterionCodes.has(code)) {
        const storySuffix =
          functionalOccurrences[ownerIndex]?.canonicalCode.replace(
            /^HU-F-/u,
            "",
          ) ?? String(ownerIndex + 1).padStart(3, "0");
        let next = nextCriterionByStory.get(ownerIndex) ?? 1;
        do {
          canonicalCode = `CA-F-${storySuffix}-${String(next).padStart(2, "0")}`;
          next += 1;
        } while (
          reservedCriterionCodes.has(canonicalCode) ||
          occupiedCriterionCodes.has(canonicalCode)
        );
        nextCriterionByStory.set(ownerIndex, next);
      }
      occupiedCriterionCodes.add(canonicalCode);
      const occurrence = {
        originalCode: code,
        canonicalCode,
        ownerIndex,
        itemIndex,
      };
      if (canonicalCode !== code) {
        pushReconciliationWarning(
          warnings,
          `Punto 6/${functionalOccurrences[ownerIndex]?.canonicalCode ?? "HU-F"}/CA-F: ${code} duplicado fue canonicalizado como ${canonicalCode}.`,
        );
      }
      return occurrence;
    },
  );

  const epics = backlogStructure.epics;
  const featureRows = epics.flatMap((epic, epicIndex) =>
    epic.features.map((feature) => ({
      code: feature.code,
      ownerIndex: epicIndex,
    })),
  );
  let planningFeatureIndex = 0;
  let planningStoryIndex = 0;
  const storyRows: { code: string; ownerIndex: number }[] = [];
  const taskRows: { code: string; ownerIndex: number }[] = [];
  for (const epic of epics) {
    for (const feature of epic.features) {
      for (const story of feature.userStories) {
        storyRows.push({ code: story.code, ownerIndex: planningFeatureIndex });
        for (const task of story.tasks) {
          taskRows.push({ code: task.code, ownerIndex: planningStoryIndex });
        }
        planningStoryIndex += 1;
      }
      planningFeatureIndex += 1;
    }
  }
  const epicOccurrences = canonicalizeTechnicalCodeOccurrencesV490(
    epics.map((epic) => ({ code: epic.code, ownerIndex: 0 })),
    "EP",
    () => "Punto 7/Epic",
    warnings,
  );
  const featureOccurrences = canonicalizeTechnicalCodeOccurrencesV490(
    featureRows,
    "FE",
    (occurrence) =>
      `Punto 7/${epicOccurrences[occurrence.ownerIndex]?.canonicalCode ?? "Epic"}/Feature`,
    warnings,
  );
  const storyOccurrences = canonicalizeTechnicalCodeOccurrencesV490(
    storyRows,
    "HU-P",
    () => "Punto 7/HU-P",
    warnings,
  );
  const taskOccurrences = canonicalizeTechnicalCodeOccurrencesV490(
    taskRows,
    "T",
    () => "Punto 7/Task",
    warnings,
  );

  let criterionIndex = 0;
  const canonicalFunctionalStories = functionalUserStories.map(
    (story, storyIndex) => ({
      ...story,
      code: canonicalCodeAtV490(functionalOccurrences, storyIndex),
      acceptanceCriteria: story.acceptanceCriteria.map((criterion) => ({
        ...criterion,
        code: canonicalCodeAtV490(criterionOccurrences, criterionIndex++),
      })),
    }),
  );

  let featureIndex = 0;
  let storyIndex = 0;
  let taskIndex = 0;
  const canonicalBacklog: AiPlanningBacklogStructureV41 = {
    ...backlogStructure,
    epics: epics.map((epic, epicIndex) => ({
      ...epic,
      code: canonicalCodeAtV490(epicOccurrences, epicIndex),
      features: epic.features.map((feature) => {
        const currentFeatureIndex = featureIndex++;
        return {
          ...feature,
          code: canonicalCodeAtV490(featureOccurrences, currentFeatureIndex),
          userStories: feature.userStories.map((story) => {
            const currentStoryIndex = storyIndex++;
            const canonicalFunctionalRequirementCodes =
              story.functionalRequirementCodes.map((rawCode) =>
                resolveCanonicalOccurrenceV490(
                  canonicalFunctionalStoryReference(rawCode),
                  functionalOccurrences,
                  (candidate) =>
                    sharesEvidenceV490(
                      story.sourceIds,
                      functionalUserStories[candidate.itemIndex]?.sourceIds ??
                        [],
                    ),
                  `${story.code}.functionalRequirementCodes`,
                ),
              );
            return {
              ...story,
              code: canonicalCodeAtV490(storyOccurrences, currentStoryIndex),
              functionalRequirementCodes: [
                ...new Set(canonicalFunctionalRequirementCodes),
              ],
              tasks: story.tasks.map((task) => {
                const currentTaskIndex = taskIndex++;
                const dependencyCodes = task.dependencyCodes.map((rawCode) =>
                  resolveCanonicalOccurrenceV490(
                    canonicalReferenceCode(rawCode, "TASK"),
                    taskOccurrences,
                    (candidate) => candidate.ownerIndex === currentStoryIndex,
                    `${task.code}.dependencyCodes`,
                  ),
                );
                return {
                  ...task,
                  code: canonicalCodeAtV490(taskOccurrences, currentTaskIndex),
                  dependencyCodes: [...new Set(dependencyCodes)],
                };
              }),
            };
          }),
        };
      }),
    })),
  };

  const testOccurrences = canonicalizeSequentialAliasesV490(
    tests.map((scenario) => scenario.code),
    "Pruebas",
    warnings,
  );
  const canonicalTests = tests.map((scenario, scenarioIndex) => {
    const userStoryCodes = scenario.userStoryCodes.map((rawCode) =>
      resolveCanonicalOccurrenceV490(
        canonicalFunctionalStoryReference(rawCode),
        functionalOccurrences,
        (candidate) =>
          sharesEvidenceV490(
            scenario.sourceIds,
            functionalUserStories[candidate.itemIndex]?.sourceIds ?? [],
          ),
        `${scenario.code}.userStoryCodes`,
      ),
    );
    const userStorySet = new Set(userStoryCodes);
    const acceptanceCriterionCodes = scenario.acceptanceCriterionCodes.map(
      (rawCode) =>
        resolveCanonicalOccurrenceV490(
          canonicalFunctionalCriterionReference(rawCode),
          criterionOccurrences,
          (candidate) => {
            const owner = functionalOccurrences[candidate.ownerIndex];
            return Boolean(owner && userStorySet.has(owner.canonicalCode));
          },
          `${scenario.code}.acceptanceCriterionCodes`,
        ),
    );
    const taskCodes = (scenario.taskCodes ?? []).map((rawCode) =>
      resolveCanonicalOccurrenceV490(
        canonicalReferenceCode(rawCode, "TASK"),
        taskOccurrences,
        (candidate) => {
          const originalStory = epics
            .flatMap((epic) => epic.features)
            .flatMap((feature) => feature.userStories)[candidate.ownerIndex];
          return Boolean(
            originalStory?.functionalRequirementCodes.some((code) => {
              const canonicalCode = resolveCanonicalOccurrenceV490(
                canonicalFunctionalStoryReference(code),
                functionalOccurrences,
                (functionalCandidate) =>
                  sharesEvidenceV490(
                    originalStory.sourceIds,
                    functionalUserStories[functionalCandidate.itemIndex]
                      ?.sourceIds ?? [],
                  ),
                `${originalStory.code}.functionalRequirementCodes`,
              );
              return userStorySet.has(canonicalCode);
            }),
          );
        },
        `${scenario.code}.taskCodes`,
      ),
    );
    return {
      ...scenario,
      code: canonicalCodeAtV490(testOccurrences, scenarioIndex),
      userStoryCodes: [...new Set(userStoryCodes)],
      acceptanceCriterionCodes: [...new Set(acceptanceCriterionCodes)],
      taskCodes: [...new Set(taskCodes)],
    };
  });

  const sprintOccurrences = scrumPlan
    ? canonicalizeSequentialAliasesV490(
        scrumPlan.sprints.map((sprint) => sprint.code),
        "Scrum/Sprints",
        warnings,
      )
    : [];
  const canonicalScrumPlan = scrumPlan
    ? {
        ...scrumPlan,
        sprints: scrumPlan.sprints.map((sprint, sprintIndex) => {
          const rawStoryMultiplicity = new Map<string, number>();
          for (const rawCode of sprint.userStoryCodes) {
            const code = canonicalPlanningStoryReference(rawCode);
            rawStoryMultiplicity.set(
              code,
              (rawStoryMultiplicity.get(code) ?? 0) + 1,
            );
          }
          const seenStories = new Map<string, number>();
          const userStoryCodes = sprint.userStoryCodes.map((rawCode) => {
            const code = canonicalPlanningStoryReference(rawCode);
            const candidates = storyOccurrences.filter(
              (occurrence) => occurrence.originalCode === code,
            );
            if (candidates.length <= 1) {
              return candidates[0]?.canonicalCode ?? code;
            }
            const occurrenceIndex = seenStories.get(code) ?? 0;
            seenStories.set(code, occurrenceIndex + 1);
            if (rawStoryMultiplicity.get(code) === candidates.length) {
              return canonicalCodeAtV490(candidates, occurrenceIndex);
            }
            return resolveCanonicalOccurrenceV490(
              code,
              storyOccurrences,
              (candidate) => {
                const parentFeature = featureOccurrences[candidate.ownerIndex];
                return Boolean(
                  parentFeature &&
                  sprint.featureCodes.some(
                    (featureCode) =>
                      canonicalReferenceCode(featureCode, "FEATURE") ===
                      parentFeature.originalCode,
                  ),
                );
              },
              `${sprint.code}.userStoryCodes`,
            );
          });
          const storySet = new Set(userStoryCodes);
          const featureCodes = [
            ...new Set(
              storyOccurrences
                .filter((occurrence) => storySet.has(occurrence.canonicalCode))
                .map(
                  (occurrence) =>
                    featureOccurrences[occurrence.ownerIndex]?.canonicalCode,
                )
                .filter((code): code is string => Boolean(code)),
            ),
          ];
          const sprintFunctionalCodes = new Set(
            canonicalBacklog.epics
              .flatMap((epic) => epic.features)
              .flatMap((feature) => feature.userStories)
              .filter((story) => storySet.has(story.code))
              .flatMap((story) => story.functionalRequirementCodes),
          );
          const testCodes = sprint.testCodes.map((rawCode) =>
            resolveCanonicalOccurrenceV490(
              rawCode.trim().toUpperCase(),
              testOccurrences,
              (candidate) =>
                canonicalTests[candidate.itemIndex]?.userStoryCodes.some(
                  (code) => sprintFunctionalCodes.has(code),
                ) ?? false,
              `${sprint.code}.testCodes`,
            ),
          );
          const dependencies = sprint.dependencies.map((rawCode) => {
            const code = rawCode.trim().toUpperCase();
            const candidates = sprintOccurrences.filter(
              (candidate) =>
                candidate.originalCode === code &&
                candidate.itemIndex !== sprintIndex,
            );
            if (candidates.length <= 1) {
              return candidates[0]?.canonicalCode ?? code;
            }
            const previous = candidates.filter(
              (candidate) => candidate.itemIndex < sprintIndex,
            );
            if (previous.length === 1) {
              return previous[0]?.canonicalCode ?? code;
            }
            throw new Error(
              `${sprint.code}.dependencies contiene la referencia ambigua ${code}; no se eligió un destino arbitrario.`,
            );
          });
          return {
            ...sprint,
            code: canonicalCodeAtV490(sprintOccurrences, sprintIndex),
            featureCodes,
            userStoryCodes: [...new Set(userStoryCodes)],
            testCodes: [...new Set(testCodes)],
            dependencies: [...new Set(dependencies)],
            tasks: sprint.tasks.map((task) => ({
              ...task,
              userStoryCode: resolveCanonicalOccurrenceV490(
                canonicalPlanningStoryReference(task.userStoryCode),
                storyOccurrences,
                (candidate) => storySet.has(candidate.canonicalCode),
                `${sprint.code}/${task.code}.userStoryCode`,
              ),
            })),
          };
        }),
      }
    : null;

  return {
    functionalUserStories: canonicalFunctionalStories,
    backlogStructure: canonicalBacklog,
    tests: canonicalTests,
    scrumPlan: canonicalScrumPlan,
  };
}

/*
 * AI_V4_GLOBAL_GRAPH_RECONCILIATION
 *
 * V4 trata backlogStructure como fuente canónica estructural.
 * Las referencias redundantes de Pruebas, Scrum y requirements
 * se reconcilian contra ese grafo antes de la validación estricta.
 *
 * Política:
 * - equivalencia técnica inequívoca -> normalizar;
 * - referencia inexistente no estructural -> omitir y advertir;
 * - estructura canónica rota (duplicados/ciclos) -> assertReferences falla.
 */
function reconcileV4Graph(
  backlogStructure: AiBacklogStructure,
  requirements: readonly AiAnalysisDraftRequirement[],
  tests: readonly AiTestScenario[],
  scrumPlan: AiScrumPlan | null,
  initialWarnings: readonly string[],
): {
  backlogStructure: AiBacklogStructure;
  requirements: AiAnalysisDraftRequirement[];
  tests: AiTestScenario[];
  scrumPlan: AiScrumPlan | null;
  warnings: string[];
} {
  const warnings = [...initialWarnings].slice(0, 100);

  const featureByKey = new Map<string, { code: string; title: string }>();
  const storyByKey = new Map<
    string,
    { code: string; title: string; featureCode: string }
  >();
  const criterionByKey = new Map<string, { code: string; storyCode: string }>();
  const backlogTaskByKey = new Map<
    string,
    { code: string; storyCode: string }
  >();

  for (const epic of backlogStructure.epics) {
    for (const feature of epic.features) {
      featureByKey.set(canonicalReferenceCode(feature.code, "FEATURE"), {
        code: feature.code,
        title: feature.title,
      });
      for (const story of feature.userStories) {
        storyByKey.set(canonicalReferenceCode(story.code, "USER_STORY"), {
          code: story.code,
          title: story.title,
          featureCode: feature.code,
        });
        for (const criterion of story.acceptanceCriteria) {
          criterionByKey.set(
            canonicalReferenceCode(criterion.code, "ACCEPTANCE_CRITERION"),
            {
              code: criterion.code,
              storyCode: story.code,
            },
          );
        }
        for (const task of story.tasks) {
          backlogTaskByKey.set(canonicalReferenceCode(task.code, "TASK"), {
            code: task.code,
            storyCode: story.code,
          });
        }
      }
    }
  }

  const reconciledBacklog: AiBacklogStructure = {
    epics: backlogStructure.epics.map((epic) => ({
      ...epic,
      features: epic.features.map((feature) => ({
        ...feature,
        userStories: feature.userStories.map((story) => ({
          ...story,
          tasks: story.tasks.map((task) => ({
            ...task,
            dependencyCodes: [
              ...new Set(
                task.dependencyCodes.flatMap((rawCode) => {
                  const resolved = backlogTaskByKey.get(
                    canonicalReferenceCode(rawCode, "TASK"),
                  );
                  if (!resolved) {
                    pushReconciliationWarning(
                      warnings,
                      `${task.code}: se omitió la dependencia inexistente ${rawCode}.`,
                    );
                    return [];
                  }
                  return [resolved.code];
                }),
              ),
            ],
          })),
        })),
      })),
    })),
  };

  const canonicalStories = new Map(
    [...storyByKey.values()].map(
      (story) =>
        [canonicalReferenceCode(story.code, "USER_STORY"), story] as const,
    ),
  );

  const requirementByStory = new Set<string>();
  const reconciledRequirements = requirements.flatMap((requirement) => {
    if (requirement.sectionKey !== "milestones") {
      return [requirement];
    }

    let story = canonicalStories.get(
      canonicalReferenceCode(requirement.code, "USER_STORY"),
    );

    if (!story) {
      const titleKey = normalizedTextReference(requirement.title);
      const titleMatches = [...canonicalStories.values()].filter(
        (candidate) => normalizedTextReference(candidate.title) === titleKey,
      );
      story = titleMatches.length === 1 ? titleMatches[0] : undefined;
    }

    if (!story) {
      pushReconciliationWarning(
        warnings,
        `${requirement.code}: el metadato funcional del Punto 6 no pudo vincularse de forma inequívoca a una HU del Punto 7 y se omitió para evitar una referencia huérfana.`,
      );
      return [];
    }

    if (requirementByStory.has(story.code)) {
      pushReconciliationWarning(
        warnings,
        `${story.code}: se omitió un metadato funcional duplicado del Punto 6.`,
      );
      return [];
    }

    requirementByStory.add(story.code);

    let milestone = requirement.milestone ?? null;
    if (milestone) {
      const normalizedMilestone = milestone
        .trim()
        .toUpperCase()
        .replaceAll(/\s+/gu, "-")
        .replace(/^HITO-/u, "H-");
      if (/^H-[A-Z0-9-]+$/u.test(normalizedMilestone)) {
        milestone = normalizedMilestone;
      } else {
        pushReconciliationWarning(
          warnings,
          `${story.code}: el Hito "${milestone}" no tiene formato H-... y quedó pendiente de revisión.`,
        );
        milestone = null;
      }
    }

    return [
      {
        ...requirement,
        code: story.code,
        title: story.title,
        milestone,
      },
    ];
  });

  const reconciledTests = tests.map((scenario) => {
    const storyCodes: string[] = [];
    const criterionCodes: string[] = [];
    const taskCodes: string[] = [];

    for (const rawCode of scenario.userStoryCodes) {
      const resolved = storyByKey.get(
        canonicalReferenceCode(rawCode, "USER_STORY"),
      );
      if (!resolved) {
        pushReconciliationWarning(
          warnings,
          `${scenario.code}: se omitió la HU inexistente ${rawCode}.`,
        );
        continue;
      }
      storyCodes.push(resolved.code);
    }

    for (const rawCode of scenario.acceptanceCriterionCodes) {
      const resolved = criterionByKey.get(
        canonicalReferenceCode(rawCode, "ACCEPTANCE_CRITERION"),
      );
      if (!resolved) {
        pushReconciliationWarning(
          warnings,
          `${scenario.code}: se omitió el criterio inexistente ${rawCode}.`,
        );
        continue;
      }
      criterionCodes.push(resolved.code);
      storyCodes.push(resolved.storyCode);
    }

    for (const rawCode of scenario.taskCodes ?? []) {
      const resolved = backlogTaskByKey.get(
        canonicalReferenceCode(rawCode, "TASK"),
      );
      if (!resolved) {
        pushReconciliationWarning(
          warnings,
          `${scenario.code}: se omitió la Task inexistente ${rawCode}.`,
        );
        continue;
      }
      taskCodes.push(resolved.code);
      storyCodes.push(resolved.storyCode);
    }

    const canonicalStoryCodes = [...new Set(storyCodes)];
    const storySet = new Set(canonicalStoryCodes);

    const canonicalCriterionCodes = [
      ...new Set(
        criterionCodes.filter((code) => {
          const owner = criterionByKey.get(
            canonicalReferenceCode(code, "ACCEPTANCE_CRITERION"),
          );
          if (owner && storySet.has(owner.storyCode)) {
            return true;
          }
          pushReconciliationWarning(
            warnings,
            `${scenario.code}: se omitió ${code} porque no pertenece a una HU vinculada a la prueba.`,
          );
          return false;
        }),
      ),
    ];

    const canonicalTaskCodes = [
      ...new Set(
        taskCodes.filter((code) => {
          const owner = backlogTaskByKey.get(
            canonicalReferenceCode(code, "TASK"),
          );
          if (owner && storySet.has(owner.storyCode)) {
            return true;
          }
          pushReconciliationWarning(
            warnings,
            `${scenario.code}: se omitió ${code} porque no pertenece a una HU vinculada a la prueba.`,
          );
          return false;
        }),
      ),
    ];

    if (canonicalStoryCodes.length === 0) {
      pushReconciliationWarning(
        warnings,
        `${scenario.code}: la prueba quedó sin HU canónica asociada y requiere revisión humana.`,
      );
    }

    return {
      ...scenario,
      userStoryCodes: canonicalStoryCodes,
      acceptanceCriterionCodes: canonicalCriterionCodes,
      taskCodes: canonicalTaskCodes,
    };
  });

  const testByKey = new Map(
    reconciledTests.map(
      (scenario) => [scenario.code.trim().toUpperCase(), scenario] as const,
    ),
  );

  let reconciledScrumPlan = scrumPlan;

  if (scrumPlan) {
    const firstPassSprints = scrumPlan.sprints.map((sprint) => {
      const storyCodes: string[] = [];

      for (const rawCode of sprint.userStoryCodes) {
        const resolved = storyByKey.get(
          canonicalReferenceCode(rawCode, "USER_STORY"),
        );
        if (!resolved) {
          pushReconciliationWarning(
            warnings,
            `${sprint.code}: se omitió la HU inexistente ${rawCode}.`,
          );
          continue;
        }
        storyCodes.push(resolved.code);
      }

      const canonicalStoryCodes = [...new Set(storyCodes)];

      const featureCodes =
        canonicalStoryCodes.length > 0
          ? [
              ...new Set(
                canonicalStoryCodes
                  .map((storyCode) =>
                    storyByKey.get(
                      canonicalReferenceCode(storyCode, "USER_STORY"),
                    ),
                  )
                  .filter(
                    (
                      story,
                    ): story is {
                      code: string;
                      title: string;
                      featureCode: string;
                    } => Boolean(story),
                  )
                  .map((story) => story.featureCode),
              ),
            ]
          : [
              ...new Set(
                sprint.featureCodes.flatMap((rawCode) => {
                  const resolved = featureByKey.get(
                    canonicalReferenceCode(rawCode, "FEATURE"),
                  );
                  if (!resolved) {
                    pushReconciliationWarning(
                      warnings,
                      `${sprint.code}: se omitió la Feature inexistente ${rawCode}.`,
                    );
                    return [];
                  }
                  return [resolved.code];
                }),
              ),
            ];

      const testCodes = [
        ...new Set(
          sprint.testCodes.flatMap((rawCode) => {
            const resolved = testByKey.get(rawCode.trim().toUpperCase());
            if (!resolved) {
              pushReconciliationWarning(
                warnings,
                `${sprint.code}: se omitió la prueba inexistente ${rawCode}.`,
              );
              return [];
            }
            return [resolved.code];
          }),
        ),
      ];

      const tasks = sprint.tasks.flatMap((task) => {
        const story = storyByKey.get(
          canonicalReferenceCode(task.userStoryCode, "USER_STORY"),
        );
        if (!story) {
          pushReconciliationWarning(
            warnings,
            `${sprint.code}/${task.code}: la Task Scrum se omitió porque referencia la HU inexistente ${task.userStoryCode}.`,
          );
          return [];
        }
        return [
          {
            ...task,
            code: canonicalReferenceCode(task.code, "TASK"),
            userStoryCode: story.code,
          },
        ];
      });

      return {
        ...sprint,
        code: sprint.code.trim().toUpperCase(),
        featureCodes,
        userStoryCodes: canonicalStoryCodes,
        testCodes,
        tasks,
      };
    });

    const scrumTaskByKey = new Map(
      firstPassSprints.flatMap((sprint) =>
        sprint.tasks.map(
          (task) =>
            [canonicalReferenceCode(task.code, "TASK"), task.code] as const,
        ),
      ),
    );

    reconciledScrumPlan = {
      ...scrumPlan,
      sprints: firstPassSprints.map((sprint) => ({
        ...sprint,
        tasks: sprint.tasks.map((task) => ({
          ...task,
          dependencyCodes: [
            ...new Set(
              task.dependencyCodes.flatMap((rawCode) => {
                const resolved = scrumTaskByKey.get(
                  canonicalReferenceCode(rawCode, "TASK"),
                );
                if (!resolved) {
                  pushReconciliationWarning(
                    warnings,
                    `${sprint.code}/${task.code}: se omitió la dependencia Scrum inexistente ${rawCode}.`,
                  );
                  return [];
                }
                return [resolved];
              }),
            ),
          ],
        })),
      })),
    };
  }

  return {
    backlogStructure: reconciledBacklog,
    requirements: reconciledRequirements,
    tests: reconciledTests,
    scrumPlan: reconciledScrumPlan,
    warnings,
  };
}

/*
 * AI_V41_GLOBAL_GRAPH_RECONCILIATION
 *
 * Hay dos grafos canónicos independientes:
 * - funcional: Hito -> HU-F -> CA-F
 * - planificación: EP -> FE -> HU-P -> T
 *
 * Solo functionalRequirementCodes conecta ambos. Tests apuntan a HU-F/CA-F
 * y pueden además referenciar Tasks T-. Scrum apunta a FE/HU-P/T-.
 */
function reconcileV41Graph(
  functionalUserStories: readonly AiFunctionalUserStoryV41[],
  backlogStructure: AiPlanningBacklogStructureV41,
  tests: readonly AiTestScenario[],
  scrumPlan: AiScrumPlan | null,
  initialWarnings: readonly string[],
): {
  functionalUserStories: AiFunctionalUserStoryV41[];
  backlogStructure: AiPlanningBacklogStructureV41;
  tests: AiTestScenario[];
  scrumPlan: AiScrumPlan | null;
  warnings: string[];
} {
  const warnings = [...initialWarnings].slice(0, 100);
  const functionalByCode = new Map(
    functionalUserStories.map((story) => [story.code, story] as const),
  );
  const criterionByCode = new Map<
    string,
    { code: string; storyCode: string }
  >();
  for (const story of functionalUserStories) {
    for (const criterion of story.acceptanceCriteria) {
      criterionByCode.set(criterion.code, {
        code: criterion.code,
        storyCode: story.code,
      });
    }
  }

  const featureByCode = new Map<string, { code: string; title: string }>();
  const planningStoryByCode = new Map<
    string,
    {
      code: string;
      featureCode: string;
      functionalRequirementCodes: readonly string[];
    }
  >();
  const planningTaskByCode = new Map<
    string,
    { code: string; storyCode: string }
  >();

  for (const epic of backlogStructure.epics) {
    for (const feature of epic.features) {
      featureByCode.set(feature.code, {
        code: feature.code,
        title: feature.title,
      });
      for (const story of feature.userStories) {
        planningStoryByCode.set(story.code, {
          code: story.code,
          featureCode: feature.code,
          functionalRequirementCodes: story.functionalRequirementCodes,
        });
        for (const task of story.tasks) {
          planningTaskByCode.set(task.code, {
            code: task.code,
            storyCode: story.code,
          });
        }
      }
    }
  }

  const reconciledBacklog: AiPlanningBacklogStructureV41 = {
    ...backlogStructure,
    structureStatus: backlogStructure.structureStatus ?? "CONFIRMED",
    epics: backlogStructure.epics.map((epic) => ({
      ...epic,
      features: epic.features.map((feature) => ({
        ...feature,
        userStories: feature.userStories.map((story) => ({
          ...story,
          functionalRequirementCodes: [
            ...new Set(
              story.functionalRequirementCodes.flatMap((rawCode) => {
                let code: string;
                try {
                  code = canonicalFunctionalStoryReference(rawCode);
                } catch {
                  pushReconciliationWarning(
                    warnings,
                    `${story.code}: se omitió la referencia funcional inválida ${rawCode}.`,
                  );
                  return [];
                }
                if (!functionalByCode.has(code)) {
                  pushReconciliationWarning(
                    warnings,
                    `${story.code}: se omitió la HU funcional inexistente ${rawCode}.`,
                  );
                  return [];
                }
                return [code];
              }),
            ),
          ],
          tasks: story.tasks.map((task) => ({
            ...task,
            origin: task.sourceNumber ? "EVIDENCE" : task.origin,
            dependencyCodes: [
              ...new Set(
                task.dependencyCodes.flatMap((rawCode) => {
                  const code = canonicalReferenceCode(rawCode, "TASK");
                  if (!planningTaskByCode.has(code)) {
                    pushReconciliationWarning(
                      warnings,
                      `${task.code}: se omitió la dependencia inexistente ${rawCode}.`,
                    );
                    return [];
                  }
                  return [code];
                }),
              ),
            ],
          })),
        })),
      })),
    })),
  };

  const reconciledPlanningStories = new Map<
    string,
    {
      code: string;
      featureCode: string;
      functionalRequirementCodes: readonly string[];
    }
  >();
  const reconciledPlanningTasks = new Map<
    string,
    { code: string; storyCode: string }
  >();
  for (const epic of reconciledBacklog.epics) {
    for (const feature of epic.features) {
      for (const story of feature.userStories) {
        reconciledPlanningStories.set(story.code, {
          code: story.code,
          featureCode: feature.code,
          functionalRequirementCodes: story.functionalRequirementCodes,
        });
        for (const task of story.tasks) {
          reconciledPlanningTasks.set(task.code, {
            code: task.code,
            storyCode: story.code,
          });
        }
      }
    }
  }

  const reconciledTests = tests.map((scenario) => {
    const storyCodes = [
      ...new Set(
        scenario.userStoryCodes.flatMap((rawCode) => {
          let code: string;
          try {
            code = canonicalFunctionalStoryReference(rawCode);
          } catch {
            pushReconciliationWarning(
              warnings,
              `${scenario.code}: se omitió la HU funcional inválida ${rawCode}.`,
            );
            return [];
          }
          if (!functionalByCode.has(code)) {
            pushReconciliationWarning(
              warnings,
              `${scenario.code}: se omitió la HU funcional inexistente ${rawCode}.`,
            );
            return [];
          }
          return [code];
        }),
      ),
    ];
    const storySet = new Set(storyCodes);

    const criterionCodes = [
      ...new Set(
        scenario.acceptanceCriterionCodes.flatMap((rawCode) => {
          let code: string;
          try {
            code = canonicalFunctionalCriterionReference(rawCode);
          } catch {
            pushReconciliationWarning(
              warnings,
              `${scenario.code}: se omitió el criterio funcional inválido ${rawCode}.`,
            );
            return [];
          }
          const criterion = criterionByCode.get(code);
          if (!criterion || !storySet.has(criterion.storyCode)) {
            pushReconciliationWarning(
              warnings,
              `${scenario.code}: se omitió el criterio inexistente o ajeno ${rawCode}.`,
            );
            return [];
          }
          return [criterion.code];
        }),
      ),
    ];

    const taskCodes = [
      ...new Set(
        (scenario.taskCodes ?? []).flatMap((rawCode) => {
          const code = canonicalReferenceCode(rawCode, "TASK");
          const task = reconciledPlanningTasks.get(code);
          if (!task) {
            pushReconciliationWarning(
              warnings,
              `${scenario.code}: se omitió la Task inexistente ${rawCode}.`,
            );
            return [];
          }
          const planningStory = reconciledPlanningStories.get(task.storyCode);
          if (
            planningStory &&
            storyCodes.length > 0 &&
            !planningStory.functionalRequirementCodes.some((functionalCode) =>
              storySet.has(functionalCode),
            )
          ) {
            pushReconciliationWarning(
              warnings,
              `${scenario.code}: se omitió ${code} porque su HU-P no tiene trazabilidad con las HU-F de la prueba.`,
            );
            return [];
          }
          return [code];
        }),
      ),
    ];

    return {
      ...scenario,
      userStoryCodes: storyCodes,
      acceptanceCriterionCodes: criterionCodes,
      taskCodes,
    };
  });

  let reconciledScrumPlan: AiScrumPlan | null = null;
  if (scrumPlan) {
    const testByCode = new Map(
      reconciledTests.map(
        (scenario) => [scenario.code.toUpperCase(), scenario] as const,
      ),
    );
    const firstPassSprints = scrumPlan.sprints.map((sprint) => {
      const storyCodes = [
        ...new Set(
          sprint.userStoryCodes.flatMap((rawCode) => {
            let code: string;
            try {
              code = canonicalPlanningStoryReference(rawCode);
            } catch {
              pushReconciliationWarning(
                warnings,
                `${sprint.code}: se omitió la HU-P inválida ${rawCode}.`,
              );
              return [];
            }
            if (!reconciledPlanningStories.has(code)) {
              pushReconciliationWarning(
                warnings,
                `${sprint.code}: se omitió la HU-P inexistente ${rawCode}.`,
              );
              return [];
            }
            return [code];
          }),
        ),
      ];
      const featureCodes = [
        ...new Set(
          storyCodes
            .map((code) => reconciledPlanningStories.get(code)?.featureCode)
            .filter((code): code is string => Boolean(code)),
        ),
      ];
      const tasks = sprint.tasks.flatMap((task) => {
        let storyCode: string;
        try {
          storyCode = canonicalPlanningStoryReference(task.userStoryCode);
        } catch {
          pushReconciliationWarning(
            warnings,
            `${sprint.code}/${task.code}: se omitió la Task Scrum por HU-P inválida ${task.userStoryCode}.`,
          );
          return [];
        }
        if (!reconciledPlanningStories.has(storyCode)) {
          pushReconciliationWarning(
            warnings,
            `${sprint.code}/${task.code}: se omitió la Task Scrum por HU-P inexistente ${task.userStoryCode}.`,
          );
          return [];
        }
        return [
          {
            ...task,
            code: canonicalReferenceCode(task.code, "TASK"),
            userStoryCode: storyCode,
          },
        ];
      });
      const testCodes = [
        ...new Set(
          sprint.testCodes.flatMap((rawCode) => {
            const code = rawCode.trim().toUpperCase();
            if (!testByCode.has(code)) {
              pushReconciliationWarning(
                warnings,
                `${sprint.code}: se omitió la prueba inexistente ${rawCode}.`,
              );
              return [];
            }
            return [code];
          }),
        ),
      ];
      return {
        ...sprint,
        code: sprint.code.trim().toUpperCase(),
        featureCodes,
        userStoryCodes: storyCodes,
        tasks,
        testCodes,
      };
    });

    const canonicalScrumPlan = canonicalizeScrumTaskCodesV490(
      { ...scrumPlan, sprints: firstPassSprints },
      warnings,
    );
    if (!canonicalScrumPlan) {
      throw new Error("La canonicalización Scrum perdió el plan.");
    }
    const scrumTaskByCode = new Map(
      canonicalScrumPlan.sprints.flatMap((sprint) =>
        sprint.tasks.map((task) => [task.code, task.code] as const),
      ),
    );
    reconciledScrumPlan = {
      ...canonicalScrumPlan,
      sprints: canonicalScrumPlan.sprints.map((sprint) => ({
        ...sprint,
        tasks: sprint.tasks.map((task) => ({
          ...task,
          dependencyCodes: [
            ...new Set(
              task.dependencyCodes.flatMap((rawCode) => {
                const code = canonicalReferenceCode(rawCode, "TASK");
                if (!scrumTaskByCode.has(code)) {
                  pushReconciliationWarning(
                    warnings,
                    `${sprint.code}/${task.code}: se omitió la dependencia Scrum inexistente ${rawCode}.`,
                  );
                  return [];
                }
                return [code];
              }),
            ),
          ],
        })),
      })),
    };
  }

  return {
    functionalUserStories: [...functionalUserStories],
    backlogStructure: reconciledBacklog,
    tests: reconciledTests,
    scrumPlan: reconciledScrumPlan,
    warnings,
  };
}

function assertReferencesV41(draft: AiAnalysisDraftV41): void {
  const functionalCodes = draft.structuredAnalysis.functionalUserStories.map(
    (story) => story.code,
  );
  unique(functionalCodes, "functionalUserStories");
  unique(
    draft.structuredAnalysis.functionalUserStories.flatMap((story) =>
      story.acceptanceCriteria.map((criterion) => criterion.code),
    ),
    "functionalAcceptanceCriteria",
  );
  unique(
    draft.requirements.map((item) => item.code),
    "requirements",
  );
  if (
    draft.requirements.some(
      (item) => item.sectionKey !== "nonFunctionalRequirements",
    )
  ) {
    throw new Error("AiAnalysisDraft 4.1.0 solo admite RNF en requirements.");
  }

  const functionalSet = new Set(functionalCodes);
  const criterionOwner = new Map<string, string>();
  for (const story of draft.structuredAnalysis.functionalUserStories) {
    for (const criterion of story.acceptanceCriteria) {
      criterionOwner.set(criterion.code, story.code);
    }
  }

  const epicCodes: string[] = [];
  const featureCodes: string[] = [];
  const planningStoryCodes: string[] = [];
  const taskCodes: string[] = [];
  const planningStoryFeature = new Map<string, string>();
  const taskDependencies = new Map<string, readonly string[]>();
  for (const epic of draft.structuredAnalysis.backlogStructure.epics) {
    epicCodes.push(epic.code);
    for (const feature of epic.features) {
      featureCodes.push(feature.code);
      for (const story of feature.userStories) {
        planningStoryCodes.push(story.code);
        planningStoryFeature.set(story.code, feature.code);
        if (
          story.functionalRequirementCodes.some(
            (code) => !functionalSet.has(code),
          )
        ) {
          throw new Error(
            `${story.code} referencia una HU funcional inexistente.`,
          );
        }
        for (const task of story.tasks) {
          taskCodes.push(task.code);
          taskDependencies.set(task.code, task.dependencyCodes);
          if (task.sourceNumber && task.origin !== "EVIDENCE") {
            throw new Error(
              `${task.code} proviene de fuente y debe usar origin=EVIDENCE.`,
            );
          }
        }
      }
    }
  }
  /*
   * POINT_5_PENDING_PLANNING_ASSIGNMENTS_V4_7_5
   * Los nodos pendientes se validan y conservan, pero NO forman parte del
   * conjunto canónico disponible para Scrum/Pruebas hasta tener padre.
   */
  const pending = draft.structuredAnalysis.backlogStructure
    .pendingAssignments ?? {
    features: [],
    userStories: [],
    tasks: [],
  };
  const pendingFeatureCodes: string[] = [];
  const pendingStoryCodes: string[] = [];
  const pendingTaskCodes: string[] = [];
  const pendingTaskDependencies = new Map<string, readonly string[]>();

  const inspectPendingTask = (task: AiPlanningBacklogTaskV41): void => {
    pendingTaskCodes.push(task.code);
    pendingTaskDependencies.set(task.code, task.dependencyCodes);
    if (task.sourceNumber && task.origin !== "EVIDENCE") {
      throw new Error(
        `${task.code} proviene de fuente y debe usar origin=EVIDENCE.`,
      );
    }
  };

  const inspectPendingStory = (story: AiPlanningBacklogUserStoryV41): void => {
    pendingStoryCodes.push(story.code);
    if (
      story.functionalRequirementCodes.some((code) => !functionalSet.has(code))
    ) {
      throw new Error(`${story.code} referencia una HU funcional inexistente.`);
    }
    for (const task of story.tasks) inspectPendingTask(task);
  };

  for (const envelope of pending.features) {
    pendingFeatureCodes.push(envelope.item.code);
    for (const story of envelope.item.userStories) inspectPendingStory(story);
  }
  for (const envelope of pending.userStories)
    inspectPendingStory(envelope.item);
  for (const envelope of pending.tasks) inspectPendingTask(envelope.item);

  unique(epicCodes, "epics");
  unique([...featureCodes, ...pendingFeatureCodes], "features");
  unique([...planningStoryCodes, ...pendingStoryCodes], "planningUserStories");
  unique([...taskCodes, ...pendingTaskCodes], "backlogTasks");
  const taskSet = new Set(taskCodes);
  const allTaskSet = new Set([...taskCodes, ...pendingTaskCodes]);

  for (const [taskCode, dependencies] of pendingTaskDependencies) {
    if (dependencies.some((code) => !allTaskSet.has(code))) {
      throw new Error(`${taskCode} referencia una Task inexistente.`);
    }
  }

  const pendingVisiting = new Set<string>();
  const pendingVisited = new Set<string>();
  const visitPendingTask = (code: string): void => {
    if (pendingVisiting.has(code)) {
      throw new Error(
        `Las dependencias de tareas pendientes contienen un ciclo en ${code}.`,
      );
    }
    if (pendingVisited.has(code)) return;
    pendingVisiting.add(code);
    for (const dependency of pendingTaskDependencies.get(code) ?? []) {
      if (pendingTaskDependencies.has(dependency)) visitPendingTask(dependency);
    }
    pendingVisiting.delete(code);
    pendingVisited.add(code);
  };
  for (const code of pendingTaskCodes) visitPendingTask(code);

  for (const [taskCode, dependencies] of taskDependencies) {
    if (dependencies.some((code) => !taskSet.has(code))) {
      throw new Error(`${taskCode} referencia una Task inexistente.`);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (code: string): void => {
    if (visiting.has(code)) {
      throw new Error(
        `Las dependencias de tareas contienen un ciclo en ${code}.`,
      );
    }
    if (visited.has(code)) return;
    visiting.add(code);
    for (const dependency of taskDependencies.get(code) ?? [])
      visit(dependency);
    visiting.delete(code);
    visited.add(code);
  };
  for (const code of taskCodes) visit(code);

  const planningStorySet = new Set(planningStoryCodes);
  const featureSet = new Set(featureCodes);
  const tests = new Set(
    draft.structuredAnalysis.tests.map((item) => item.code),
  );
  unique([...tests], "tests");
  for (const scenario of draft.structuredAnalysis.tests) {
    if (scenario.userStoryCodes.some((code) => !functionalSet.has(code))) {
      throw new Error(
        `${scenario.code} referencia una HU funcional inexistente.`,
      );
    }
    for (const criterionCode of scenario.acceptanceCriterionCodes) {
      const owner = criterionOwner.get(criterionCode);
      if (!owner || !scenario.userStoryCodes.includes(owner)) {
        throw new Error(
          `${scenario.code} referencia un criterio funcional inexistente o ajeno.`,
        );
      }
    }
    if ((scenario.taskCodes ?? []).some((code) => !taskSet.has(code))) {
      throw new Error(`${scenario.code} referencia una Task inexistente.`);
    }
  }

  const plan = draft.structuredAnalysis.scrumPlan;
  if (!plan) return;
  const scrumTaskCodes = plan.sprints.flatMap((sprint) =>
    sprint.tasks.map((task) => task.code),
  );
  unique(
    plan.sprints.map((sprint) => sprint.code),
    "sprints",
  );
  unique(scrumTaskCodes, "scrumTasks");
  const scrumTaskSet = new Set(scrumTaskCodes);
  for (const sprint of plan.sprints) {
    if (sprint.featureCodes.some((code) => !featureSet.has(code))) {
      throw new Error(`${sprint.code} referencia una Feature inexistente.`);
    }
    if (sprint.userStoryCodes.some((code) => !planningStorySet.has(code))) {
      throw new Error(`${sprint.code} referencia una HU-P inexistente.`);
    }
    for (const storyCode of sprint.userStoryCodes) {
      const parent = planningStoryFeature.get(storyCode);
      if (parent && !sprint.featureCodes.includes(parent)) {
        throw new Error(
          `${sprint.code} no incluye la Feature padre de ${storyCode}.`,
        );
      }
    }
    if (sprint.testCodes.some((code) => !tests.has(code))) {
      throw new Error(`${sprint.code} referencia una prueba inexistente.`);
    }
    for (const task of sprint.tasks) {
      if (!planningStorySet.has(task.userStoryCode)) {
        throw new Error(`${task.code} referencia una HU-P inexistente.`);
      }
      if (task.dependencyCodes.some((code) => !scrumTaskSet.has(code))) {
        throw new Error(`${task.code} referencia una Task Scrum inexistente.`);
      }
    }
  }
  const scrumDependencies = new Map(
    plan.sprints.flatMap((sprint) =>
      sprint.tasks.map((task) => [task.code, task.dependencyCodes] as const),
    ),
  );
  const scrumVisiting = new Set<string>();
  const scrumVisited = new Set<string>();
  const visitScrumTask = (code: string): void => {
    if (scrumVisiting.has(code)) {
      throw new Error(
        `Las dependencias de Tasks Scrum contienen un ciclo en ${code}.`,
      );
    }
    if (scrumVisited.has(code)) return;
    scrumVisiting.add(code);
    for (const dependency of scrumDependencies.get(code) ?? []) {
      visitScrumTask(dependency);
    }
    scrumVisiting.delete(code);
    scrumVisited.add(code);
  };
  for (const code of scrumTaskCodes) visitScrumTask(code);

  const scrumTasksByCode = new Map(
    plan.sprints.flatMap((sprint) =>
      sprint.tasks.map((task) => [task.code, task] as const),
    ),
  );
  for (const task of scrumTasksByCode.values()) {
    for (const dependencyCode of task.dependencyCodes) {
      const dependency = scrumTasksByCode.get(dependencyCode);
      if (
        dependency?.endDay !== undefined &&
        task.startDay !== undefined &&
        task.startDay <= dependency.endDay
      ) {
        throw new Error(
          `${task.code} debe iniciar después de finalizar ${dependencyCode}.`,
        );
      }
    }
  }
}

function parseContradictions(value: unknown): AiStructuredContradiction[] {
  return array(value, "contradictions", 100)
    .slice(0, CONTRADICTION_SUMMARY_LIMIT)
    .map((item, index) => {
      const name = `contradictions[${index}]`;
      const contradiction = object(item, name);
      if (contradiction.decision !== "[PENDIENTE POR DEFINIR]") {
        throw new Error(`${name}.decision debe quedar pendiente.`);
      }
      return {
        statementA: string(
          contradiction.statementA,
          `${name}.statementA`,
          2_000,
        ),
        sourceIdsA: sourceIds(contradiction.sourceIdsA, `${name}.sourceIdsA`),
        statementB: string(
          contradiction.statementB,
          `${name}.statementB`,
          2_000,
        ),
        sourceIdsB: sourceIds(contradiction.sourceIdsB, `${name}.sourceIdsB`),
        decision: "[PENDIENTE POR DEFINIR]",
      };
    });
}

function assertReferences(
  draft: AiAnalysisDraftV2 | AiAnalysisDraftV3 | AiAnalysisDraftV4,
): void {
  const featureCodes = draft.structuredAnalysis.features.map(
    (item) => item.code,
  );
  const storyCodes = draft.structuredAnalysis.userStories.map(
    (item) => item.code,
  );
  const criterionCodes = draft.structuredAnalysis.userStories.flatMap((story) =>
    story.acceptanceCriteria.map((criterion) => criterion.code),
  );
  const testCodes = draft.structuredAnalysis.tests.map((item) => item.code);
  unique(featureCodes, "features");
  unique(storyCodes, "userStories");
  unique(criterionCodes, "acceptanceCriteria");
  unique(testCodes, "tests");
  unique(
    draft.requirements.map((item) => item.code),
    "requirements",
  );
  const features = new Set(featureCodes);
  const stories = new Set(storyCodes);
  const criteria = new Set(criterionCodes);
  const tests = new Set(testCodes);
  const backlogTasks =
    draft.schemaVersion === "4.0.0"
      ? draft.structuredAnalysis.backlogStructure.epics.flatMap((epic) =>
          epic.features.flatMap((feature) =>
            feature.userStories.flatMap((story) => story.tasks),
          ),
        )
      : [];
  if (draft.schemaVersion === "4.0.0") {
    unique(
      draft.structuredAnalysis.backlogStructure.epics.map((epic) => epic.code),
      "epics",
    );
  }
  const backlogTaskCodes = backlogTasks.map((task) => task.code);
  unique(backlogTaskCodes, "backlogTasks");
  const backlogTaskSet = new Set(backlogTaskCodes);

  for (const story of draft.structuredAnalysis.userStories) {
    if (!features.has(story.featureCode)) {
      throw new Error(`${story.code} referencia una Feature inexistente.`);
    }
  }
  for (const feature of draft.structuredAnalysis.features) {
    for (const storyCode of feature.userStoryCodes) {
      const story = draft.structuredAnalysis.userStories.find(
        (item) => item.code === storyCode,
      );
      if (!story || story.featureCode !== feature.code) {
        throw new Error(
          `${feature.code} referencia una HU inexistente o ajena.`,
        );
      }
    }
    const actual = draft.structuredAnalysis.userStories
      .filter((story) => story.featureCode === feature.code)
      .map((story) => story.code);
    if (actual.some((code) => !feature.userStoryCodes.includes(code))) {
      throw new Error(
        `${feature.code} no agrupa todas sus Historias de Usuario.`,
      );
    }
  }
  for (const scenario of draft.structuredAnalysis.tests) {
    if (
      draft.schemaVersion !== "4.0.0" &&
      scenario.userStoryCodes.length === 0
    ) {
      throw new Error(`${scenario.code} no referencia ninguna HU.`);
    }
    if (scenario.userStoryCodes.some((code) => !stories.has(code))) {
      throw new Error(`${scenario.code} referencia una HU inexistente.`);
    }
    if (scenario.acceptanceCriterionCodes.some((code) => !criteria.has(code))) {
      throw new Error(`${scenario.code} referencia un criterio inexistente.`);
    }
    if ((scenario.taskCodes ?? []).some((code) => !backlogTaskSet.has(code))) {
      throw new Error(`${scenario.code} referencia una tarea inexistente.`);
    }
  }
  if (draft.schemaVersion === "4.0.0") {
    const parent = new Map<string, string>();
    for (const epic of draft.structuredAnalysis.backlogStructure.epics) {
      for (const feature of epic.features) {
        for (const story of feature.userStories) {
          if (story.featureCode !== feature.code) {
            throw new Error(`${story.code} no pertenece a ${feature.code}.`);
          }
          for (const task of story.tasks) {
            parent.set(task.code, story.code);
            if (
              task.dependencyCodes.some((code) => !backlogTaskSet.has(code))
            ) {
              throw new Error(`${task.code} referencia una tarea inexistente.`);
            }
          }
        }
      }
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (code: string): void => {
      if (visiting.has(code)) {
        throw new Error(
          `Las dependencias de tareas contienen un ciclo en ${code}.`,
        );
      }
      if (visited.has(code)) return;
      visiting.add(code);
      const task = backlogTasks.find((item) => item.code === code);
      for (const dependency of task?.dependencyCodes ?? []) visit(dependency);
      visiting.delete(code);
      visited.add(code);
    };
    for (const code of parent.keys()) visit(code);
  }
  const plan = draft.structuredAnalysis.scrumPlan;
  if (!plan) return;
  const taskCodes = plan.sprints.flatMap((sprint) =>
    sprint.tasks.map((task) => task.code),
  );
  unique(
    plan.sprints.map((sprint) => sprint.code),
    "sprints",
  );
  unique(taskCodes, "scrumTasks");
  const tasks = new Set(taskCodes);
  for (const sprint of plan.sprints) {
    if (sprint.featureCodes.some((code) => !features.has(code))) {
      throw new Error(`${sprint.code} referencia una Feature inexistente.`);
    }
    if (sprint.userStoryCodes.some((code) => !stories.has(code))) {
      throw new Error(`${sprint.code} referencia una HU inexistente.`);
    }
    if (sprint.testCodes.some((code) => !tests.has(code))) {
      throw new Error(`${sprint.code} referencia una prueba inexistente.`);
    }
    for (const task of sprint.tasks) {
      if (!stories.has(task.userStoryCode)) {
        throw new Error(`${task.code} referencia una HU inexistente.`);
      }
      if (task.dependencyCodes.some((code) => !tasks.has(code))) {
        throw new Error(`${task.code} referencia una tarea inexistente.`);
      }
    }
  }
}

function parseV2(root: Readonly<Record<string, unknown>>): AiAnalysisDraftV2 {
  const structured = object(root.structuredAnalysis, "structuredAnalysis");
  const userStories = parseUserStories(structured.userStories);
  const features = reconcileFeatureStoryCodes(
    parseFeatures(structured.features),
    userStories,
  );
  const draft: AiAnalysisDraftV2 = {
    schemaVersion: "2.0.0",
    sections: parseSections(root.sections),
    requirements: parseRequirements(root.requirements),
    structuredAnalysis: {
      processFlow: parseProcessFlow(structured.processFlow),
      features,
      userStories,
      tests: parseTests(structured.tests),
      scrumPlan: reconcileScrumDependencies(
        parseScrumPlan(structured.scrumPlan),
      ),
    },
    pendingQuestions: pendingSummaryStrings(
      root.pendingQuestions,
      "pendingQuestions",
    ),
    contradictions: parseContradictions(root.contradictions),
    warnings: pendingSummaryStrings(root.warnings, "warnings"),
  };
  const includesScrum = draft.sections.at(-1)?.key === "scrumPlan";
  if (includesScrum !== Boolean(draft.structuredAnalysis.scrumPlan)) {
    throw new Error(
      "El Plan Scrum estructurado no coincide con las secciones.",
    );
  }
  assertReferences(draft);
  return draft;
}

function parseV3(root: Readonly<Record<string, unknown>>): AiAnalysisDraftV3 {
  const structured = object(root.structuredAnalysis, "structuredAnalysis");
  const processFlows = object(
    structured.processFlows,
    "structuredAnalysis.processFlows",
  );
  const userStories = parseUserStories(structured.userStories);
  const features = reconcileFeatureStoryCodes(
    parseFeatures(structured.features),
    userStories,
  );
  const draft: AiAnalysisDraftV3 = {
    schemaVersion: "3.0.0",
    sections: parseSections(root.sections, true),
    requirements: parseRequirements(root.requirements),
    structuredAnalysis: {
      processFlows: {
        asIs: parseSwimlaneProcessFlow(
          processFlows.asIs,
          "structuredAnalysis.processFlows.asIs",
        ),
        toBe: parseSwimlaneProcessFlow(
          processFlows.toBe,
          "structuredAnalysis.processFlows.toBe",
        ),
      },
      entityRelationship: parseEntityRelationship(
        structured.entityRelationship,
      ),
      features,
      userStories,
      tests: parseTests(structured.tests),
      scrumPlan: reconcileScrumDependencies(
        parseScrumPlan(structured.scrumPlan),
      ),
    },
    pendingQuestions: pendingSummaryStrings(
      root.pendingQuestions,
      "pendingQuestions",
    ),
    contradictions: parseContradictions(root.contradictions),
    warnings: pendingSummaryStrings(root.warnings, "warnings"),
  };
  const includesScrum = draft.sections.at(-1)?.key === "scrumPlan";
  if (includesScrum !== Boolean(draft.structuredAnalysis.scrumPlan)) {
    throw new Error(
      "El Plan Scrum estructurado no coincide con las secciones.",
    );
  }
  assertReferences(draft);
  return draft;
}

function parseV4(root: Readonly<Record<string, unknown>>): AiAnalysisDraftV4 {
  const structured = object(root.structuredAnalysis, "structuredAnalysis");
  const processFlows = object(
    structured.processFlows,
    "structuredAnalysis.processFlows",
  );
  const reconciliationWarnings: string[] = [];
  const backlogStructure = parseBacklogStructure(structured.backlogStructure);
  const processAsIs = parseSwimlaneProcessFlow(
    processFlows.asIs,
    "structuredAnalysis.processFlows.asIs",
    reconciliationWarnings,
  );
  const processToBe = parseSwimlaneProcessFlow(
    processFlows.toBe,
    "structuredAnalysis.processFlows.toBe",
    reconciliationWarnings,
  );
  const entityRelationship = parseEntityRelationship(
    structured.entityRelationship,
    "structuredAnalysis.entityRelationship",
    reconciliationWarnings,
  );

  const reconciliation = reconcileV4Graph(
    backlogStructure,
    parseRequirements(root.requirements),
    parseTests(structured.tests),
    reconcileScrumDependencies(parseScrumPlan(structured.scrumPlan)),
    [...strings(root.warnings, "warnings", 100), ...reconciliationWarnings],
  );

  const sections = parseSections(root.sections, true).map((section) => {
    if (section.key === "milestones") {
      return {
        ...section,
        content: {
          functionalRequirements: reconciliation.requirements.filter(
            (item) => item.sectionKey === "milestones",
          ),
          nonFunctionalRequirements: reconciliation.requirements.filter(
            (item) => item.sectionKey === "nonFunctionalRequirements",
          ),
        } as unknown as DocumentJsonValue,
      };
    }
    if (section.key === "backlogStructure") {
      return {
        ...section,
        content:
          reconciliation.backlogStructure as unknown as DocumentJsonValue,
      };
    }
    if (section.key === "tests") {
      return {
        ...section,
        content: reconciliation.tests as unknown as DocumentJsonValue,
      };
    }
    return section;
  });

  const reconciledUserStories = reconciliation.backlogStructure.epics.flatMap(
    (epic) => epic.features.flatMap((feature) => feature.userStories),
  );
  const reconciledFeatures: AiFeature[] =
    reconciliation.backlogStructure.epics.flatMap((epic) =>
      epic.features.map((feature) => ({
        code: feature.code,
        title: feature.title,
        objective: feature.description,
        description: feature.description,
        inScope: [],
        outOfScope: [],
        userStoryCodes: feature.userStories.map((story) => story.code),
        sourceIds: feature.sourceIds,
      })),
    );

  const draft: AiAnalysisDraftV4 = {
    schemaVersion: "4.0.0",
    sections,
    requirements: reconciliation.requirements,
    structuredAnalysis: {
      processFlows: {
        asIs: processAsIs,
        toBe: processToBe,
      },
      entityRelationship,
      backlogStructure: reconciliation.backlogStructure,
      features: reconciledFeatures,
      userStories: reconciledUserStories,
      tests: reconciliation.tests,
      scrumPlan: reconciliation.scrumPlan,
    },
    pendingQuestions: pendingSummaryStrings(
      root.pendingQuestions,
      "pendingQuestions",
    ),
    contradictions: parseContradictions(root.contradictions),
    warnings: reconciliation.warnings.slice(0, PENDING_SUMMARY_LIMIT),
  };

  const includesScrum = draft.sections.at(-1)?.key === "scrumPlan";
  if (includesScrum !== Boolean(draft.structuredAnalysis.scrumPlan)) {
    throw new Error(
      "El Plan Scrum estructurado no coincide con las secciones.",
    );
  }

  assertReferences(draft);
  return draft;
}

function parseV41(root: Readonly<Record<string, unknown>>): AiAnalysisDraftV41 {
  const structured = object(root.structuredAnalysis, "structuredAnalysis");
  const processFlows = object(
    structured.processFlows,
    "structuredAnalysis.processFlows",
  );
  const reconciliationWarnings: string[] = [];
  const functionalUserStories = parseFunctionalUserStoriesV41(
    structured.functionalUserStories,
    reconciliationWarnings,
  );
  const backlogStructure = parsePlanningBacklogStructureV41(
    structured.backlogStructure,
  );
  const requirements = parseRequirements(root.requirements);
  if (
    requirements.some((item) => item.sectionKey !== "nonFunctionalRequirements")
  ) {
    throw new Error(
      "AiAnalysisDraft 4.1.0 solo permite RNF en requirements; las HU funcionales viven en structuredAnalysis.functionalUserStories.",
    );
  }

  /*
   * RNF_SEMANTIC_GUARD_V1
   *
   * El schema estructurado evita la mayoría de errores, pero esta validación
   * local es la última frontera antes de persistir/aplicar el resultado.
   * No transforma una HU en RNF ni intenta adivinar campos faltantes.
   */
  const invalidNonFunctionalRequirement = requirements.find((item) => {
    const requirementType = item.requirementType.trim().toUpperCase();
    const code = item.code.trim().toUpperCase();

    return (
      code.startsWith("HU-") ||
      requirementType === "USER_STORY" ||
      requirementType === "FUNCTIONAL" ||
      !item.category?.trim() ||
      !item.measure?.trim() ||
      !item.target?.trim() ||
      item.acceptanceCriteria.length === 0
    );
  });

  if (invalidNonFunctionalRequirement) {
    throw new Error(
      "AiAnalysisDraft 4.1.0 requirements solo admite RNF semánticos completos: no permite HU, USER_STORY ni FUNCTIONAL y exige category, measure, target y al menos un criterio de aceptación.",
    );
  }

  const processAsIs = parseSwimlaneProcessFlow(
    processFlows.asIs,
    "structuredAnalysis.processFlows.asIs",
    reconciliationWarnings,
  );
  const processToBe = parseSwimlaneProcessFlow(
    processFlows.toBe,
    "structuredAnalysis.processFlows.toBe",
    reconciliationWarnings,
  );
  const entityRelationship = parseEntityRelationship(
    structured.entityRelationship,
    "structuredAnalysis.entityRelationship",
    reconciliationWarnings,
  );

  /*
   * KPI_CANONICALIZATION_WARNING_V7_4_3
   *
   * Parseamos las secciones antes de reconciliar el grafo para que cualquier
   * reparación segura KPI → objetivo quede incluida en los warnings finales.
   */
  const parsedSections = parseSections(
    root.sections,
    true,
    reconciliationWarnings,
  );

  const parsedScrumPlan = reconcileScrumDependencies(
    parseScrumPlan(structured.scrumPlan),
  );
  const canonicalGraph = canonicalizeV41IdentityGraphV490(
    functionalUserStories,
    backlogStructure,
    parseTests(structured.tests),
    parsedScrumPlan,
    reconciliationWarnings,
  );
  const reconciliation = reconcileV41Graph(
    canonicalGraph.functionalUserStories,
    canonicalGraph.backlogStructure,
    canonicalGraph.tests,
    canonicalGraph.scrumPlan,
    [...strings(root.warnings, "warnings", 100), ...reconciliationWarnings],
  );

  const sections = parsedSections.map((section) => {
    if (section.key === "milestones") {
      return {
        ...section,
        content: {
          functionalRequirements: reconciliation.functionalUserStories,
          nonFunctionalRequirements: requirements,
        } as unknown as DocumentJsonValue,
      };
    }
    if (section.key === "backlogStructure") {
      return {
        ...section,
        content:
          reconciliation.backlogStructure as unknown as DocumentJsonValue,
      };
    }
    if (section.key === "tests") {
      return {
        ...section,
        content: reconciliation.tests as unknown as DocumentJsonValue,
      };
    }
    return section;
  });

  const draft: AiAnalysisDraftV41 = {
    schemaVersion: "4.1.0",
    sections,
    requirements,
    structuredAnalysis: {
      processFlows: {
        asIs: processAsIs,
        toBe: processToBe,
      },
      entityRelationship,
      functionalUserStories: reconciliation.functionalUserStories,
      backlogStructure: reconciliation.backlogStructure,
      tests: reconciliation.tests,
      scrumPlan: reconciliation.scrumPlan,
    },
    pendingQuestions: pendingSummaryStrings(
      root.pendingQuestions,
      "pendingQuestions",
    ),
    contradictions: parseContradictions(root.contradictions),
    warnings: reconciliation.warnings.slice(0, PENDING_SUMMARY_LIMIT),
  };

  const includesScrum = draft.sections.at(-1)?.key === "scrumPlan";
  if (includesScrum !== Boolean(draft.structuredAnalysis.scrumPlan)) {
    throw new Error(
      "El Plan Scrum estructurado no coincide con las secciones.",
    );
  }
  assertReferencesV41(draft);
  return draft;
}

export function parseAiAnalysisDraft(value: unknown): AiAnalysisDraft {
  const root = object(value, "resultado");
  if (root.schemaVersion === "4.1.0") return parseV41(root);
  if (root.schemaVersion === "4.0.0") return parseV4(root);
  if (root.schemaVersion === "3.0.0") return parseV3(root);
  if (root.schemaVersion === "2.0.0") return parseV2(root);
  if (root.schemaVersion !== "1.0.0") {
    throw new Error(
      "schemaVersion debe ser 1.0.0, 2.0.0, 3.0.0, 4.0.0 o 4.1.0.",
    );
  }
  return {
    schemaVersion: "1.0.0",
    sections: parseSections(root.sections),
    requirements: parseRequirements(root.requirements),
    pendingQuestions: pendingSummaryStrings(
      root.pendingQuestions,
      "pendingQuestions",
    ),
    contradictions: strings(root.contradictions, "contradictions", 100).slice(
      0,
      CONTRADICTION_SUMMARY_LIMIT,
    ),
    warnings: pendingSummaryStrings(root.warnings, "warnings"),
  };
}

/** Reúne todas las referencias de evidencia para validarlas contra la solicitud. */
export function collectAiDraftSourceIds(
  draft: AiAnalysisDraft,
): readonly string[] {
  const ids = draft.requirements.flatMap(
    (requirement) => requirement.sourceIds,
  );
  if (draft.schemaVersion === "1.0.0") return [...new Set(ids)];
  if (draft.schemaVersion === "2.0.0") {
    ids.push(...draft.structuredAnalysis.processFlow.sourceIds);
  } else {
    ids.push(
      ...draft.structuredAnalysis.processFlows.asIs.sourceIds,
      ...draft.structuredAnalysis.processFlows.toBe.sourceIds,
      ...draft.structuredAnalysis.entityRelationship.sourceIds,
    );
  }
  if (draft.schemaVersion === "4.1.0") {
    for (const story of draft.structuredAnalysis.functionalUserStories) {
      ids.push(...story.sourceIds);
      for (const field of story.fields) ids.push(...field.sourceIds);
      for (const criterion of story.acceptanceCriteria)
        ids.push(...criterion.sourceIds);
    }
  } else {
    for (const feature of draft.structuredAnalysis.features)
      ids.push(...feature.sourceIds);
    for (const story of draft.structuredAnalysis.userStories) {
      ids.push(...story.sourceIds);
      for (const field of story.fields) ids.push(...field.sourceIds);
      for (const criterion of story.acceptanceCriteria)
        ids.push(...criterion.sourceIds);
    }
  }
  for (const scenario of draft.structuredAnalysis.tests)
    ids.push(...scenario.sourceIds);
  if (draft.schemaVersion === "4.0.0" || draft.schemaVersion === "4.1.0") {
    for (const epic of draft.structuredAnalysis.backlogStructure.epics) {
      ids.push(...epic.sourceIds);
      for (const feature of epic.features) {
        ids.push(...feature.sourceIds);
        for (const story of feature.userStories) {
          ids.push(...story.sourceIds);
          for (const task of story.tasks) ids.push(...task.sourceIds);
        }
      }
    }

    if (draft.schemaVersion === "4.1.0") {
      const pending =
        draft.structuredAnalysis.backlogStructure.pendingAssignments;
      if (pending) {
        const collectStory = (story: AiPlanningBacklogUserStoryV41) => {
          ids.push(...story.sourceIds);
          for (const task of story.tasks) ids.push(...task.sourceIds);
        };

        for (const envelope of pending.features) {
          ids.push(...envelope.item.sourceIds);
          for (const story of envelope.item.userStories) collectStory(story);
        }
        for (const envelope of pending.userStories) collectStory(envelope.item);
        for (const envelope of pending.tasks)
          ids.push(...envelope.item.sourceIds);
      }
    }
  }
  if (draft.structuredAnalysis.scrumPlan) {
    ids.push(...draft.structuredAnalysis.scrumPlan.sourceIds);
  }
  for (const contradiction of draft.contradictions) {
    ids.push(...contradiction.sourceIdsA, ...contradiction.sourceIdsB);
  }
  return [...new Set(ids)];
}

/**
 * Canonicaliza referencias de evidencia devueltas por el proveedor.
 *
 * Con una única fuente seleccionada no existe ambigüedad: si el modelo altera
 * accidentalmente un carácter del UUID, la evidencia solo puede corresponder a
 * esa fuente. Con varias fuentes, cualquier referencia desconocida se conserva
 * para que la validación de pertenencia la rechace explícitamente.
 */
export function reconcileAiDraftSourceIds(
  draft: AiAnalysisDraft,
  allowedSourceIds: readonly string[],
): AiAnalysisDraft {
  const canonicalByLowerCase = new Map(
    allowedSourceIds.map((sourceId) => [sourceId.toLowerCase(), sourceId]),
  );
  const singleSourceId =
    canonicalByLowerCase.size === 1
      ? canonicalByLowerCase.values().next().value
      : undefined;
  const reconciled = structuredClone(draft) as unknown;

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;

    for (const [key, child] of Object.entries(value)) {
      if (
        (key === "sourceIds" || key === "sourceIdsA" || key === "sourceIdsB") &&
        Array.isArray(child)
      ) {
        (value as Record<string, unknown>)[key] = child.map((sourceId) => {
          if (typeof sourceId !== "string") return sourceId;
          return (
            canonicalByLowerCase.get(sourceId.toLowerCase()) ??
            singleSourceId ??
            sourceId
          );
        });
      } else {
        visit(child);
      }
    }
  };

  visit(reconciled);
  return reconciled as AiAnalysisDraft;
}
