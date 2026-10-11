// LOCAL_ONLY_V2_15_TRACEABILITY_COVERAGE
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  LOCAL_AI_CATEGORIES,
  type LocalAiCategory,
} from "../../apps/ai-analysis-service/src/local-ai/local-ai-output.js";
import type { LocalOnlyV2ArrayBatchPlan } from "../../apps/ai-analysis-service/src/execution/local-only-v2-array-batches.js";
import type {
  LocalOnlyV2AssembledDraft,
  LocalOnlyV2AssembledSection,
} from "../../apps/ai-analysis-service/src/execution/local-only-v2-deterministic-assembly.js";
import type {
  LocalOnlyV2BlockEvidencePacket,
  LocalOnlyV2EvidenceSelectionPlan,
  LocalOnlyV2SelectedFinding,
} from "../../apps/ai-analysis-service/src/execution/local-only-v2-evidence-selector.js";
import type { LocalOnlyV2KnowledgeIndex } from "../../apps/ai-analysis-service/src/execution/local-only-v2-knowledge-index.js";
import type { LocalOnlyV2NormalizedFinding } from "../../apps/ai-analysis-service/src/execution/local-only-v2-normalizer.js";
import type { LocalOnlyV2TemplateGenerationPlan } from "../../apps/ai-analysis-service/src/execution/local-only-v2-template-planner.js";
import {
  assertLocalOnlyV2TraceabilityCoverage,
  buildLocalOnlyV2TraceabilityCoverageReport,
} from "../../apps/ai-analysis-service/src/execution/local-only-v2-traceability-coverage.js";

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

interface FixtureFinding {
  readonly id: string;
  readonly category: LocalAiCategory;
  readonly sourceId: string;
  readonly segmentId: string;
  readonly questionnaire?: boolean;
}

const BASE_FINDINGS: readonly FixtureFinding[] = [
  {
    id: "v2f-q1",
    category: "problems",
    sourceId: "discussion",
    segmentId: "discussion#0001",
    questionnaire: true,
  },
  {
    id: "v2f-context-doc",
    category: "facts",
    sourceId: "source-a",
    segmentId: "source-a#0001",
  },
  {
    id: "v2f-pending",
    category: "pendingQuestions",
    sourceId: "source-a",
    segmentId: "source-a#0001",
  },
  {
    id: "v2f-r1",
    category: "functionalRequirements",
    sourceId: "source-a",
    segmentId: "source-a#0001",
  },
  {
    id: "v2f-r2",
    category: "functionalRequirements",
    sourceId: "source-a",
    segmentId: "source-a#0001",
  },
  {
    id: "v2f-warning",
    category: "warnings",
    sourceId: "source-a",
    segmentId: "source-a#0001",
  },
  {
    id: "v2f-unused",
    category: "entities",
    sourceId: "source-a",
    segmentId: "source-a#0001",
  },
];

function normalizedFinding(
  spec: FixtureFinding,
  sequence: number,
): LocalOnlyV2NormalizedFinding {
  const description = `Hallazgo ${spec.id}`;
  return {
    canonicalId: spec.id,
    sequence,
    categorySequence: sequence,
    category: spec.category,
    description,
    normalizedDescription: description.toLocaleLowerCase("es"),
    sourceIds: [spec.sourceId],
    segmentIds: [spec.segmentId],
    occurrenceCount: 1,
    mandatoryQuestionnaireEvidence: spec.questionnaire === true,
    occurrences: [
      {
        atomicFindingId: `${spec.segmentId}@${sequence}`,
        sourceId: spec.sourceId,
        sourceTitle:
          spec.sourceId === "discussion"
            ? "Preguntas de análisis · RQ-15"
            : "Fuente funcional",
        sourcePosition: spec.sourceId === "discussion" ? 2 : 1,
        segmentId: spec.segmentId,
        segmentIndex: 0,
        evidenceText: description,
        evidenceStartCharacter: 0,
        evidenceEndCharacter: description.length,
        mandatoryQuestionnaireEvidence: spec.questionnaire === true,
      },
    ],
  };
}

function knowledge(
  extra: readonly FixtureFinding[] = [],
): LocalOnlyV2KnowledgeIndex {
  const specs = [...BASE_FINDINGS, ...extra];
  const findings = specs.map((spec, index) =>
    normalizedFinding(spec, index + 1),
  );
  const fingerprint = sha(
    `knowledge:${findings.map((finding) => finding.canonicalId).join("|")}`,
  );

  const byCategory = Object.fromEntries(
    LOCAL_AI_CATEGORIES.map((category) => [
      category,
      findings
        .filter((finding) => finding.category === category)
        .map((finding) => finding.canonicalId),
    ]),
  ) as Record<LocalAiCategory, string[]>;

  const sourceIds = ["source-a", "discussion"] as const;
  const segmentIds = ["source-a#0001", "discussion#0001"] as const;

  return {
    pipelineId: "LOCAL_ONLY_V2",
    schemaVersion: "1.0.0",
    projectId: "project-15",
    questionnaireSourceId: "discussion",
    fingerprint,
    sources: sourceIds.map((sourceId) => ({
      sourceId,
      sourceTitle:
        sourceId === "discussion"
          ? "Preguntas de análisis · RQ-15"
          : "Fuente funcional",
      sourcePosition: sourceId === "discussion" ? 2 : 1,
      mandatoryQuestionnaireEvidence: sourceId === "discussion",
      segmentIds: [
        sourceId === "discussion" ? "discussion#0001" : "source-a#0001",
      ],
      findingIds: findings
        .filter((finding) => finding.sourceIds.includes(sourceId))
        .map((finding) => finding.canonicalId),
    })),
    segments: segmentIds.map((segmentId) => {
      const sourceId =
        segmentId === "discussion#0001" ? "discussion" : "source-a";
      return {
        segmentId,
        sourceId,
        sourceTitle:
          sourceId === "discussion"
            ? "Preguntas de análisis · RQ-15"
            : "Fuente funcional",
        sourcePosition: sourceId === "discussion" ? 2 : 1,
        segmentIndex: 0,
        startCharacter: 0,
        endCharacter: 10_000,
        estimatedTokens: 2_500,
        mandatoryQuestionnaireEvidence: sourceId === "discussion",
        findingIds: findings
          .filter((finding) => finding.segmentIds.includes(segmentId))
          .map((finding) => finding.canonicalId),
      };
    }),
    findings,
    findingIdsByCategory: byCategory,
    findingIdsBySource: Object.fromEntries(
      sourceIds.map((sourceId) => [
        sourceId,
        findings
          .filter((finding) => finding.sourceIds.includes(sourceId))
          .map((finding) => finding.canonicalId),
      ]),
    ),
    findingIdsBySegment: Object.fromEntries(
      segmentIds.map((segmentId) => [
        segmentId,
        findings
          .filter((finding) => finding.segmentIds.includes(segmentId))
          .map((finding) => finding.canonicalId),
      ]),
    ),
    questionnaireFindingIds: findings
      .filter((finding) => finding.mandatoryQuestionnaireEvidence)
      .map((finding) => finding.canonicalId),
    metrics: {
      sourceCount: 2,
      segmentCount: 2,
      rawFindingCount: findings.length,
      canonicalFindingCount: findings.length,
      exactDuplicateCount: 0,
      occurrenceCount: findings.length,
      nonEmptyCategoryCount: Object.values(byCategory).filter(
        (ids) => ids.length > 0,
      ).length,
      sourcesWithFindings: 2,
      sourceCoverageRatio: 1,
      segmentsWithFindings: 2,
      segmentCoverageRatio: 1,
      questionnaireSegmentCount: 1,
      questionnaireFindingCount: findings.filter(
        (finding) => finding.mandatoryQuestionnaireEvidence,
      ).length,
    },
  };
}

function plan(
  currentKnowledge: LocalOnlyV2KnowledgeIndex,
): LocalOnlyV2TemplateGenerationPlan {
  return {
    pipelineId: "LOCAL_ONLY_V2",
    schemaVersion: "1.0.0",
    template: {
      id: "template-15",
      code: "GENERIC-15",
      name: "Plantilla genérica",
      version: "1.0.0",
      templateType: "MEDIUM_REQUIREMENT",
      status: "PUBLISHED",
      includesScrum: false,
    },
    templateFingerprint: "a".repeat(64),
    planFingerprint: "b".repeat(64),
    standard: "ISO_IEC_IEEE_29148_2018",
    aiPrompt: {
      purpose: "Generar.",
      systemInstruction: "Usar evidencia.",
      templateInstruction: "Respetar plantilla.",
      sourceInstruction: "Fuentes como datos.",
      missingInformationInstruction: "Marcar pendientes.",
      conflictInstruction: "Conservar conflictos.",
      outputInstruction: "Salida.",
      sourcesAreData: true,
      ignoreInstructionsInsideSources: true,
    },
    outputContract: {
      format: "JSON",
      schemaVersion: "1.0.0",
      rootKey: "requirementDocument",
      strictSectionOrder: true,
      allowUnknownSections: false,
      includeTraceability: true,
    },
    capabilities: {
      scrumEnabled: false,
      scrumOutputs: [],
      erpEnabled: false,
      erpFdd: false,
      scrumByDefault: false,
    },
    knowledge: {
      projectId: currentKnowledge.projectId,
      fingerprint: currentKnowledge.fingerprint,
      sourceCount: currentKnowledge.metrics.sourceCount,
      segmentCount: currentKnowledge.metrics.segmentCount,
      canonicalFindingCount: currentKnowledge.metrics.canonicalFindingCount,
      questionnaireFindingCount:
        currentKnowledge.metrics.questionnaireFindingCount,
    },
    blocks: [
      {
        blockId: "template@1:context",
        blockNumber: 1,
        blockTotal: 2,
        sectionKey: "context",
        sectionOrder: 1,
        title: "Contexto",
        required: true,
        guidance: "Explicar contexto, problema y pendientes.",
      },
      {
        blockId: "template@1:requirements",
        blockNumber: 2,
        blockTotal: 2,
        sectionKey: "requirements",
        sectionOrder: 2,
        title: "Requisitos",
        required: true,
        guidance: "Lista completa de requisitos y advertencias.",
      },
    ],
  };
}

function selected(
  currentKnowledge: LocalOnlyV2KnowledgeIndex,
  id: string,
): LocalOnlyV2SelectedFinding {
  const finding = currentKnowledge.findings.find(
    (candidate) => candidate.canonicalId === id,
  );
  assert.ok(finding, `fixture requiere ${id}`);

  return {
    canonicalId: finding.canonicalId,
    category: finding.category,
    description: finding.description,
    selectionScore: 10,
    sourceIds: finding.sourceIds,
    segmentIds: finding.segmentIds,
    mandatoryQuestionnaireEvidence: finding.mandatoryQuestionnaireEvidence,
    occurrenceCount: finding.occurrenceCount,
    occurrences: finding.occurrences.map((occurrence) => ({
      sourceId: occurrence.sourceId,
      sourceTitle: occurrence.sourceTitle,
      sourcePosition: occurrence.sourcePosition,
      segmentId: occurrence.segmentId,
      segmentIndex: occurrence.segmentIndex,
      evidenceText: occurrence.evidenceText,
      evidenceStartCharacter: occurrence.evidenceStartCharacter,
      evidenceEndCharacter: occurrence.evidenceEndCharacter,
      mandatoryQuestionnaireEvidence: occurrence.mandatoryQuestionnaireEvidence,
    })),
  };
}

function packet(
  currentKnowledge: LocalOnlyV2KnowledgeIndex,
  blockId: string,
  blockNumber: number,
  sectionKey: string,
  title: string,
  guidance: string,
  relevantIds: readonly string[],
  guardIds: readonly string[],
  fingerprint: string,
): LocalOnlyV2BlockEvidencePacket {
  const relevantFindings = relevantIds.map((id) =>
    selected(currentKnowledge, id),
  );
  const guardFindings = guardIds.map((id) => selected(currentKnowledge, id));
  const all = [...relevantFindings, ...guardFindings];
  const sourceIds = [...new Set(all.flatMap((finding) => finding.sourceIds))];
  const segmentIds = [...new Set(all.flatMap((finding) => finding.segmentIds))];

  return {
    pipelineId: "LOCAL_ONLY_V2",
    schemaVersion: "1.0.0",
    projectId: currentKnowledge.projectId,
    knowledgeFingerprint: currentKnowledge.fingerprint,
    templatePlanFingerprint: "b".repeat(64),
    blockId,
    blockNumber,
    blockTotal: 2,
    sectionKey,
    title,
    required: true,
    guidance,
    relevantFindings,
    guardFindings,
    selectedFindingIds: all.map((finding) => finding.canonicalId),
    sourceIds,
    segmentIds,
    metrics: {
      relevantFindingCount: relevantFindings.length,
      guardFindingCount: guardFindings.length,
      totalFindingCount: all.length,
      questionnaireFindingCount: all.filter(
        (finding) => finding.mandatoryQuestionnaireEvidence,
      ).length,
      sourceCount: sourceIds.length,
      segmentCount: segmentIds.length,
      evidenceCharacterCount: 100,
      estimatedEvidenceTokens: 25,
    },
    fingerprint,
  };
}

function evidence(
  currentKnowledge: LocalOnlyV2KnowledgeIndex,
): LocalOnlyV2EvidenceSelectionPlan {
  return {
    pipelineId: "LOCAL_ONLY_V2",
    schemaVersion: "1.0.0",
    projectId: currentKnowledge.projectId,
    knowledgeFingerprint: currentKnowledge.fingerprint,
    templatePlanFingerprint: "b".repeat(64),
    policy: {
      maxRelevantFindingsPerBlock: 24,
      maxGuardFindingsPerBlock: 9,
      maxOccurrencesPerFinding: 2,
      minimumRelevantScore: 1,
    },
    blocks: [
      packet(
        currentKnowledge,
        "template@1:context",
        1,
        "context",
        "Contexto",
        "Explicar contexto, problema y pendientes.",
        ["v2f-q1", "v2f-context-doc"],
        ["v2f-pending"],
        "c".repeat(64),
      ),
      packet(
        currentKnowledge,
        "template@1:requirements",
        2,
        "requirements",
        "Requisitos",
        "Lista completa de requisitos y advertencias.",
        ["v2f-r1", "v2f-r2"],
        ["v2f-warning"],
        "d".repeat(64),
      ),
    ],
  };
}

function batchPlan(
  currentKnowledge: LocalOnlyV2KnowledgeIndex,
): LocalOnlyV2ArrayBatchPlan {
  const warning = selected(currentKnowledge, "v2f-warning");
  const buildBatch = (
    number: number,
    requirementId: string,
    fingerprint: string,
  ) => {
    const requirement = selected(currentKnowledge, requirementId);
    return {
      batchId: `template@1:requirements:batch:${String(number).padStart(3, "0")}`,
      batchNumber: number,
      batchTotal: 2,
      blockId: "template@1:requirements",
      sectionKey: "requirements",
      relevantFindings: [requirement],
      guardFindings: [warning],
      selectedFindingIds: [requirement.canonicalId, warning.canonicalId],
      sourceIds: ["source-a"],
      segmentIds: ["source-a#0001"],
      questionnaireFindingCount: 0,
      estimatedRelevantTokens: 40,
      fingerprint,
    };
  };

  return {
    pipelineId: "LOCAL_ONLY_V2",
    schemaVersion: "1.0.0",
    projectId: currentKnowledge.projectId,
    knowledgeFingerprint: currentKnowledge.fingerprint,
    templatePlanFingerprint: "b".repeat(64),
    evidenceSelectionSchemaVersion: "1.0.0",
    policy: {
      maxRelevantFindingsPerBatch: 1,
      maxEstimatedRelevantTokensPerBatch: 700,
    },
    collections: [
      {
        blockId: "template@1:requirements",
        sectionKey: "requirements",
        title: "Requisitos",
        guidance: "Lista completa de requisitos y advertencias.",
        collectionIntentTerms: ["requisitos"],
        exhaustiveRelevantFindingCount: 2,
        baselineRelevantFindingCount: 2,
        expandedBeyondBaseline: false,
        requiresMultipleBatches: true,
        batches: [
          buildBatch(1, "v2f-r1", "e".repeat(64)),
          buildBatch(2, "v2f-r2", "f".repeat(64)),
        ],
        coveredRelevantFindingIds: ["v2f-r1", "v2f-r2"],
        missingRelevantFindingIds: [],
        duplicateRelevantFindingIds: [],
        fingerprint: "1".repeat(64),
      },
    ],
    fingerprint: "2".repeat(64),
  };
}

function section(
  blockId: string,
  sectionKey: string,
  order: number,
  contentKind: "MICRO_BLOCK" | "BATCHED_COLLECTION",
  findingIds: readonly string[],
  sourceIds: readonly string[],
  segmentIds: readonly string[],
  questionnaireFindingCount: number,
): LocalOnlyV2AssembledSection {
  return {
    blockId,
    sectionKey,
    order,
    title: order === 1 ? "Contexto" : "Requisitos",
    required: true,
    guidance:
      order === 1
        ? "Explicar contexto, problema y pendientes."
        : "Lista completa de requisitos y advertencias.",
    contentKind,
    content:
      contentKind === "MICRO_BLOCK"
        ? "Contexto redactado."
        : [{ batchNumber: 1 }, { batchNumber: 2 }],
    unitIds:
      contentKind === "MICRO_BLOCK"
        ? [`micro-draft:${blockId}`]
        : [
            "template@1:requirements:batch:001",
            "template@1:requirements:batch:002",
          ],
    selectedFindingIds: findingIds,
    sourceIds,
    segmentIds,
    questionnaireFindingCount,
    fingerprint: sha(`${blockId}:${findingIds.join("|")}`),
  };
}

function draft(): LocalOnlyV2AssembledDraft {
  const sections = [
    section(
      "template@1:context",
      "context",
      1,
      "MICRO_BLOCK",
      ["v2f-q1", "v2f-context-doc", "v2f-pending"],
      ["discussion", "source-a"],
      ["discussion#0001", "source-a#0001"],
      1,
    ),
    section(
      "template@1:requirements",
      "requirements",
      2,
      "BATCHED_COLLECTION",
      ["v2f-r1", "v2f-r2", "v2f-warning"],
      ["source-a"],
      ["source-a#0001"],
      0,
    ),
  ] as const;

  return {
    pipelineId: "LOCAL_ONLY_V2",
    schemaVersion: "1.0.0",
    projectId: "project-15",
    template: {
      id: "template-15",
      code: "GENERIC-15",
      name: "Plantilla genérica",
      version: "1.0.0",
      templateType: "MEDIUM_REQUIREMENT",
    },
    templatePlanFingerprint: "b".repeat(64),
    executionPlanFingerprint: "3".repeat(64),
    sections,
    unitCount: 3,
    sourceIds: ["discussion", "source-a"],
    segmentIds: ["discussion#0001", "source-a#0001"],
    selectedFindingIds: [
      "v2f-q1",
      "v2f-context-doc",
      "v2f-pending",
      "v2f-r1",
      "v2f-r2",
      "v2f-warning",
    ],
    questionnaireFindingCount: 1,
    fingerprint: "4".repeat(64),
  };
}

function fixture(extra: readonly FixtureFinding[] = []) {
  const currentKnowledge = knowledge(extra);
  return {
    currentKnowledge,
    currentPlan: plan(currentKnowledge),
    currentEvidence: evidence(currentKnowledge),
    currentBatches: batchPlan(currentKnowledge),
    currentDraft: draft(),
  };
}

test("Paso 15 certifica 100% de evidencia seleccionada, cuestionario y guardas", () => {
  const {
    currentKnowledge,
    currentPlan,
    currentEvidence,
    currentBatches,
    currentDraft,
  } = fixture();

  const report = buildLocalOnlyV2TraceabilityCoverageReport(
    currentPlan,
    currentKnowledge,
    currentEvidence,
    currentBatches,
    currentDraft,
  );

  assert.equal(report.passed, true);
  assert.equal(report.metrics.selectedCoverageRatio, 1);
  assert.equal(report.metrics.criticalCoverageRatio, 1);
  assert.equal(report.metrics.questionnaireCoverageRatio, 1);
  assert.equal(report.metrics.guardCoverageRatio, 1);
  assert.equal(report.metrics.passedSectionCount, 2);
  assert.deepEqual(report.missingCriticalFindingIds, []);
  assert.doesNotThrow(() => assertLocalOnlyV2TraceabilityCoverage(report));
});

test("un finding no crítico y no seleccionado queda como cobertura informativa, no como pérdida", () => {
  const data = fixture();
  const report = buildLocalOnlyV2TraceabilityCoverageReport(
    data.currentPlan,
    data.currentKnowledge,
    data.currentEvidence,
    data.currentBatches,
    data.currentDraft,
  );

  assert.equal(report.passed, true);
  assert.ok(report.metrics.knowledgeCoverageRatio < 1);
  assert.deepEqual(report.unselectedKnowledgeFindingIds, ["v2f-unused"]);
  const entities = report.categoryCoverage.find(
    (item) => item.category === "entities",
  );
  assert.ok(entities);
  assert.equal(entities.knowledgeCount, 1);
  assert.equal(entities.assembledCount, 0);
});

test("si se pierde evidencia ya seleccionada, la certificación falla con el ID exacto", () => {
  const data = fixture();
  const requirements = data.currentDraft.sections[1]!;
  const corrupted: LocalOnlyV2AssembledDraft = {
    ...data.currentDraft,
    sections: [
      data.currentDraft.sections[0]!,
      {
        ...requirements,
        selectedFindingIds: ["v2f-r1", "v2f-warning"],
      },
    ],
    selectedFindingIds: data.currentDraft.selectedFindingIds.filter(
      (id) => id !== "v2f-r2",
    ),
  };

  const report = buildLocalOnlyV2TraceabilityCoverageReport(
    data.currentPlan,
    data.currentKnowledge,
    data.currentEvidence,
    data.currentBatches,
    corrupted,
  );

  assert.equal(report.passed, false);
  assert.ok(report.missingSelectedFindingIds.includes("v2f-r2"));
  assert.ok(report.missingCriticalFindingIds.includes("v2f-r2"));
  assert.throws(() => assertLocalOnlyV2TraceabilityCoverage(report), /v2f-r2/u);
});

test("todo finding del cuestionario canónico es crítico aunque el selector no lo haya usado", () => {
  const data = fixture([
    {
      id: "v2f-q2",
      category: "businessRules",
      sourceId: "discussion",
      segmentId: "discussion#0001",
      questionnaire: true,
    },
  ]);

  const report = buildLocalOnlyV2TraceabilityCoverageReport(
    data.currentPlan,
    data.currentKnowledge,
    data.currentEvidence,
    data.currentBatches,
    data.currentDraft,
  );

  assert.equal(report.passed, false);
  assert.deepEqual(report.missingQuestionnaireFindingIds, ["v2f-q2"]);
  assert.ok(
    report.issues.some((item) => item.code === "MISSING_QUESTIONNAIRE_FINDING"),
  );
});

test("contradicciones, pendientes y warnings del índice son críticos globales", () => {
  const data = fixture([
    {
      id: "v2f-contradiction-extra",
      category: "contradictions",
      sourceId: "source-a",
      segmentId: "source-a#0001",
    },
  ]);

  const report = buildLocalOnlyV2TraceabilityCoverageReport(
    data.currentPlan,
    data.currentKnowledge,
    data.currentEvidence,
    data.currentBatches,
    data.currentDraft,
  );

  assert.equal(report.passed, false);
  assert.deepEqual(report.missingGuardFindingIds, ["v2f-contradiction-extra"]);
  assert.equal(report.metrics.guardCoverageRatio, 2 / 3);
});

test("Paso 15 valida cobertura por sección y detecta evidencia ubicada en el bloque equivocado", () => {
  const data = fixture();
  const context = data.currentDraft.sections[0]!;
  const corruptedContext: LocalOnlyV2AssembledSection = {
    ...context,
    selectedFindingIds: ["v2f-q1", "v2f-r1", "v2f-pending"],
  };
  const corrupted: LocalOnlyV2AssembledDraft = {
    ...data.currentDraft,
    sections: [corruptedContext, data.currentDraft.sections[1]!],
  };

  const report = buildLocalOnlyV2TraceabilityCoverageReport(
    data.currentPlan,
    data.currentKnowledge,
    data.currentEvidence,
    data.currentBatches,
    corrupted,
  );

  assert.equal(report.passed, false);
  assert.equal(report.sections[0]!.passed, false);
  assert.deepEqual(report.sections[0]!.missingFindingIds, ["v2f-context-doc"]);
  assert.deepEqual(report.sections[0]!.unexpectedFindingIds, ["v2f-r1"]);
});

test("ningún finding/source/segment huérfano puede aparecer en el borrador", () => {
  const data = fixture();
  const corrupted: LocalOnlyV2AssembledDraft = {
    ...data.currentDraft,
    selectedFindingIds: [
      ...data.currentDraft.selectedFindingIds,
      "ghost-finding",
    ],
    sourceIds: [...data.currentDraft.sourceIds, "ghost-source"],
    segmentIds: [...data.currentDraft.segmentIds, "ghost-segment"],
  };

  const report = buildLocalOnlyV2TraceabilityCoverageReport(
    data.currentPlan,
    data.currentKnowledge,
    data.currentEvidence,
    data.currentBatches,
    corrupted,
  );

  assert.equal(report.passed, false);
  assert.deepEqual(report.orphanAssembledFindingIds, ["ghost-finding"]);
  assert.deepEqual(report.orphanSourceIds, ["ghost-source"]);
  assert.deepEqual(report.orphanSegmentIds, ["ghost-segment"]);
});

test("questionnaireFindingCount se contrasta con los IDs realmente trazados", () => {
  const data = fixture();
  const corrupted: LocalOnlyV2AssembledDraft = {
    ...data.currentDraft,
    questionnaireFindingCount: 2,
  };

  const report = buildLocalOnlyV2TraceabilityCoverageReport(
    data.currentPlan,
    data.currentKnowledge,
    data.currentEvidence,
    data.currentBatches,
    corrupted,
  );

  assert.equal(report.passed, false);
  assert.ok(
    report.issues.some((item) => item.code === "QUESTIONNAIRE_COUNT_MISMATCH"),
  );
});

test("findingTrace permite navegar finding -> sección -> fuente -> segmento", () => {
  const data = fixture();
  const report = buildLocalOnlyV2TraceabilityCoverageReport(
    data.currentPlan,
    data.currentKnowledge,
    data.currentEvidence,
    data.currentBatches,
    data.currentDraft,
  );

  const q1 = report.findingTrace.find((item) => item.canonicalId === "v2f-q1");
  assert.ok(q1);
  assert.equal(q1.mandatoryQuestionnaireEvidence, true);
  assert.deepEqual(q1.sectionKeys, ["context"]);
  assert.deepEqual(q1.sourceIds, ["discussion"]);
  assert.deepEqual(q1.segmentIds, ["discussion#0001"]);

  const warning = report.findingTrace.find(
    (item) => item.canonicalId === "v2f-warning",
  );
  assert.ok(warning);
  assert.deepEqual(warning.sectionKeys, ["requirements"]);
});

test("el reporte y su fingerprint son determinísticos", () => {
  const data = fixture();
  const first = buildLocalOnlyV2TraceabilityCoverageReport(
    data.currentPlan,
    data.currentKnowledge,
    data.currentEvidence,
    data.currentBatches,
    data.currentDraft,
  );
  const second = buildLocalOnlyV2TraceabilityCoverageReport(
    data.currentPlan,
    data.currentKnowledge,
    data.currentEvidence,
    data.currentBatches,
    data.currentDraft,
  );

  assert.deepEqual(second, first);
  assert.match(first.fingerprint, /^[0-9a-f]{64}$/u);
});

test("Paso 15 no llama IA, no repara, no toca TypeORM y no depende de SOAT", async () => {
  const production = await readFile(
    "apps/ai-analysis-service/src/execution/local-only-v2-traceability-coverage.ts",
    "utf8",
  );
  const executable = production
    .split(/\r?\n/u)
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

  assert.doesNotMatch(executable, /Ollama/u);
  assert.doesNotMatch(executable, /OpenAi/u);
  assert.doesNotMatch(executable, /\.generate\(/u);
  assert.doesNotMatch(executable, /from "typeorm"/u);
  assert.doesNotMatch(executable, /repairLocal/u);
  assert.doesNotMatch(executable, /structuredAnalysis\./u);
  assert.doesNotMatch(production, /SOAT/iu);
  assert.match(production, /MISSING_QUESTIONNAIRE_FINDING/u);
  assert.match(production, /MISSING_GUARD_FINDING/u);
  assert.match(production, /findingTrace/u);
  assert.match(production, /categoryCoverage/u);
});
