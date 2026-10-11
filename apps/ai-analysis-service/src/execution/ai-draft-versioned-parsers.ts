import {
  type AiAnalysisDraft,
  type AiAnalysisDraftV2,
  type AiAnalysisDraftV3,
  type AiAnalysisDraftV4,
  type AiAnalysisDraftV41,
  type AiFeature,
  type DocumentJsonValue,
} from "@levantamiento-rq/shared-contracts";
import {
  object,
  strings,
  pendingSummaryStrings,
} from "./ai-draft-parse-primitives";
import {
  parseFeatures,
  reconcileFeatureStoryCodes,
  parseUserStories,
  parseBacklogStructure,
} from "./ai-draft-backlog-parsers";
import { parseSections } from "./ai-draft-section-parsers";
import {
  parseRequirements,
  parseProcessFlow,
  parseSwimlaneProcessFlow,
  parseEntityRelationship,
  parseTests,
  parseContradictions,
} from "./ai-draft-artifact-parsers";
import {
  parseScrumPlan,
  reconcileScrumDependencies,
} from "./ai-draft-scrum-parsers";
import {
  assertReferencesV41,
  assertReferences,
} from "./ai-draft-reference-assertions";
import { reconcileV4Graph } from "./ai-draft-graph-reconciliation-v4";
import {
  PENDING_SUMMARY_LIMIT,
  CONTRADICTION_SUMMARY_LIMIT,
} from "./ai-draft-constants";
import {
  parseFunctionalUserStoriesV41,
  parsePlanningBacklogStructureV41,
} from "./ai-draft-v41-backlog-parsers";
import { canonicalizeV41IdentityGraphV490 } from "./ai-draft-identity-canonicalization";
import { reconcileV41Graph } from "./ai-draft-graph-reconciliation-v41";

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
