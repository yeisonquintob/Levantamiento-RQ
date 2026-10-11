import {
  AI_ENTITY_CARDINALITIES,
  AI_BACKLOG_TASK_ORIGINS,
  AI_PROCESS_LANE_KINDS,
  AI_PROCESS_NODE_KINDS,
  AI_SCRUM_TASK_TYPES,
} from "@levantamiento-rq/shared-contracts";
import {
  text,
  nullableText,
  sourceIdsSchema,
  stringArraySchema,
} from "./ai-draft-schema-primitives";
import { ISO_DATE_PATTERN } from "./ai-draft-constants";

export const requirementSchema = {
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

export const swimlaneProcessFlowSchema = {
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

export const entityRelationshipSchema = {
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

export const backlogStructureSchema = (
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
export const functionalUserStoryV41Schema = {
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

export const planningBacklogStructureV41Schema = (
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
export const nonFunctionalRequirementV41Schema = {
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

export const testScenarioSchema = {
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

export const scrumPlanSchema = (maximumSprints: number) =>
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

export const contradictionSchema = {
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
