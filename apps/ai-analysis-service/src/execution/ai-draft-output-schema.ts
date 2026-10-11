import {
  getDocumentSectionDefinitions,
  type DocumentTemplateType,
} from "@levantamiento-rq/shared-contracts";
import {
  PENDING_SUMMARY_LIMIT,
  CONTRADICTION_SUMMARY_LIMIT,
  DEPTH_LIMITS,
} from "./ai-draft-constants";
import { sectionContentSchema } from "./ai-draft-section-schemas";
import {
  requirementSchema,
  swimlaneProcessFlowSchema,
  entityRelationshipSchema,
  backlogStructureSchema,
  functionalUserStoryV41Schema,
  planningBacklogStructureV41Schema,
  nonFunctionalRequirementV41Schema,
  testScenarioSchema,
  scrumPlanSchema,
  contradictionSchema,
} from "./ai-draft-structure-schemas";
import {
  restrictSchemaSourceIdsToAllowedValues,
  stringArraySchema,
} from "./ai-draft-schema-primitives";

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
