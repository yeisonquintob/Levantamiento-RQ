// LOCAL_ONLY_V2_15_TRACEABILITY_COVERAGE
//
// Gate determinístico de trazabilidad y cobertura.
//
// CRÍTICO (debe cubrirse 100%):
// 1. toda evidencia seleccionada para cada sección;
// 2. todos los findings del cuestionario obligatorio;
// 3. todas las guardas: contradictions / pendingQuestions / warnings.
//
// INFORMATIVO:
// - findings del índice canónico que no fueron seleccionados y no son críticos.
//
// También valida la dirección inversa:
// ningún finding/source/segment del borrador puede ser huérfano respecto al
// índice canónico.
//
// No llama IA, no modifica el borrador y no intenta reparar pérdidas.

import { createHash } from "node:crypto";

import {
  LOCAL_AI_CATEGORIES,
  type LocalAiCategory,
} from "../local-ai/local-ai-output";
import type {
  LocalOnlyV2ArrayBatchPlan,
  LocalOnlyV2CollectionBatchPlan,
} from "./local-only-v2-array-batches";
import type {
  LocalOnlyV2AssembledDraft,
  LocalOnlyV2AssembledSection,
} from "./local-only-v2-deterministic-assembly";
import {
  LOCAL_ONLY_V2_TRANSVERSAL_GUARD_CATEGORIES,
  type LocalOnlyV2BlockEvidencePacket,
  type LocalOnlyV2EvidenceSelectionPlan,
  type LocalOnlyV2SelectedFinding,
} from "./local-only-v2-evidence-selector";
import type { LocalOnlyV2KnowledgeIndex } from "./local-only-v2-knowledge-index";
import type { LocalOnlyV2TemplateGenerationPlan } from "./local-only-v2-template-planner";

export const LOCAL_ONLY_V2_TRACEABILITY_COVERAGE_SCHEMA_VERSION =
  "1.0.0" as const;

export type LocalOnlyV2CoverageIssueCode =
  | "PIPELINE_MISMATCH"
  | "PROJECT_MISMATCH"
  | "KNOWLEDGE_MISMATCH"
  | "PLAN_MISMATCH"
  | "SECTION_MISMATCH"
  | "SECTION_TRACEABILITY_MISMATCH"
  | "DOCUMENT_TRACEABILITY_MISMATCH"
  | "MISSING_SELECTED_FINDING"
  | "MISSING_QUESTIONNAIRE_FINDING"
  | "MISSING_GUARD_FINDING"
  | "ORPHAN_FINDING"
  | "ORPHAN_SOURCE"
  | "ORPHAN_SEGMENT"
  | "QUESTIONNAIRE_COUNT_MISMATCH";

export interface LocalOnlyV2CoverageIssue {
  readonly code: LocalOnlyV2CoverageIssueCode;
  readonly message: string;
  readonly blockId: string | null;
  readonly ids: readonly string[];
}

export interface LocalOnlyV2SectionCoverage {
  readonly blockId: string;
  readonly sectionKey: string;
  readonly order: number;
  readonly contentKind: "MICRO_BLOCK" | "BATCHED_COLLECTION";
  readonly expectedFindingIds: readonly string[];
  readonly assembledFindingIds: readonly string[];
  readonly missingFindingIds: readonly string[];
  readonly unexpectedFindingIds: readonly string[];
  readonly expectedSourceIds: readonly string[];
  readonly assembledSourceIds: readonly string[];
  readonly missingSourceIds: readonly string[];
  readonly unexpectedSourceIds: readonly string[];
  readonly expectedSegmentIds: readonly string[];
  readonly assembledSegmentIds: readonly string[];
  readonly missingSegmentIds: readonly string[];
  readonly unexpectedSegmentIds: readonly string[];
  readonly expectedQuestionnaireFindingCount: number;
  readonly assembledQuestionnaireFindingCount: number;
  readonly exactTraceability: boolean;
  readonly passed: boolean;
}

export interface LocalOnlyV2FindingCoverageTrace {
  readonly canonicalId: string;
  readonly category: LocalAiCategory;
  readonly mandatoryQuestionnaireEvidence: boolean;
  readonly sourceIds: readonly string[];
  readonly segmentIds: readonly string[];
  readonly occurrenceCount: number;
  readonly sectionKeys: readonly string[];
}

export interface LocalOnlyV2CategoryCoverage {
  readonly category: LocalAiCategory;
  readonly knowledgeCount: number;
  readonly assembledCount: number;
  readonly coverageRatio: number;
}

export interface LocalOnlyV2CoverageMetrics {
  readonly knowledgeFindingCount: number;
  readonly expectedSelectedFindingCount: number;
  readonly coveredSelectedFindingCount: number;
  readonly selectedCoverageRatio: number;
  readonly criticalFindingCount: number;
  readonly coveredCriticalFindingCount: number;
  readonly criticalCoverageRatio: number;
  readonly assembledFindingCount: number;
  readonly knowledgeCoveredFindingCount: number;
  readonly knowledgeCoverageRatio: number;
  readonly questionnaireFindingCount: number;
  readonly coveredQuestionnaireFindingCount: number;
  readonly questionnaireCoverageRatio: number;
  readonly guardFindingCount: number;
  readonly coveredGuardFindingCount: number;
  readonly guardCoverageRatio: number;
  readonly knowledgeSourceCount: number;
  readonly tracedSourceCount: number;
  readonly knowledgeSegmentCount: number;
  readonly tracedSegmentCount: number;
  readonly sectionCount: number;
  readonly passedSectionCount: number;
}

export interface LocalOnlyV2TraceabilityCoverageReport {
  readonly pipelineId: "LOCAL_ONLY_V2";
  readonly schemaVersion: typeof LOCAL_ONLY_V2_TRACEABILITY_COVERAGE_SCHEMA_VERSION;
  readonly projectId: string;
  readonly knowledgeFingerprint: string;
  readonly templatePlanFingerprint: string;
  readonly assembledDraftFingerprint: string;
  readonly passed: boolean;
  readonly metrics: LocalOnlyV2CoverageMetrics;
  readonly missingSelectedFindingIds: readonly string[];
  readonly missingCriticalFindingIds: readonly string[];
  readonly missingQuestionnaireFindingIds: readonly string[];
  readonly missingGuardFindingIds: readonly string[];
  readonly orphanAssembledFindingIds: readonly string[];
  readonly orphanSourceIds: readonly string[];
  readonly orphanSegmentIds: readonly string[];
  readonly unselectedKnowledgeFindingIds: readonly string[];
  readonly sections: readonly LocalOnlyV2SectionCoverage[];
  readonly findingTrace: readonly LocalOnlyV2FindingCoverageTrace[];
  readonly categoryCoverage: readonly LocalOnlyV2CategoryCoverage[];
  readonly issues: readonly LocalOnlyV2CoverageIssue[];
  readonly fingerprint: string;
}

interface ExpectedSectionTrace {
  readonly findingIds: readonly string[];
  readonly sourceIds: readonly string[];
  readonly segmentIds: readonly string[];
  readonly questionnaireFindingIds: readonly string[];
}

const GUARD_CATEGORY_SET = new Set<string>(
  LOCAL_ONLY_V2_TRANSVERSAL_GUARD_CATEGORIES,
);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function uniqueInOrder(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)]);
}

function difference(
  expected: readonly string[],
  actual: ReadonlySet<string>,
): readonly string[] {
  return Object.freeze(expected.filter((value) => !actual.has(value)));
}

function ratio(covered: number, total: number): number {
  return total === 0 ? 1 : covered / total;
}

function issue(
  code: LocalOnlyV2CoverageIssueCode,
  message: string,
  ids: readonly string[] = [],
  blockId: string | null = null,
): LocalOnlyV2CoverageIssue {
  return Object.freeze({
    code,
    message,
    blockId,
    ids: Object.freeze([...ids]),
  });
}

function sameOrdered(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function selectedTrace(
  findings: readonly LocalOnlyV2SelectedFinding[],
): ExpectedSectionTrace {
  const findingIds = uniqueInOrder(
    findings.map((finding) => finding.canonicalId),
  );
  const sourceIds = uniqueInOrder(
    findings.flatMap((finding) => finding.sourceIds),
  );
  const segmentIds = uniqueInOrder(
    findings.flatMap((finding) => finding.segmentIds),
  );
  const questionnaireFindingIds = uniqueInOrder(
    findings
      .filter((finding) => finding.mandatoryQuestionnaireEvidence)
      .map((finding) => finding.canonicalId),
  );

  return {
    findingIds,
    sourceIds,
    segmentIds,
    questionnaireFindingIds,
  };
}

function traceForPacket(
  packet: LocalOnlyV2BlockEvidencePacket,
): ExpectedSectionTrace {
  return selectedTrace([...packet.relevantFindings, ...packet.guardFindings]);
}

function traceForCollection(
  collection: LocalOnlyV2CollectionBatchPlan,
): ExpectedSectionTrace {
  const relevant = collection.batches.flatMap(
    (batch) => batch.relevantFindings,
  );
  const guards = collection.batches.flatMap((batch) => batch.guardFindings);
  return selectedTrace([...relevant, ...guards]);
}

function assertCompatible(
  plan: LocalOnlyV2TemplateGenerationPlan,
  knowledge: LocalOnlyV2KnowledgeIndex,
  evidence: LocalOnlyV2EvidenceSelectionPlan,
  batchPlan: LocalOnlyV2ArrayBatchPlan,
  draft: LocalOnlyV2AssembledDraft,
  issues: LocalOnlyV2CoverageIssue[],
): void {
  if (
    plan.pipelineId !== "LOCAL_ONLY_V2" ||
    knowledge.pipelineId !== "LOCAL_ONLY_V2" ||
    evidence.pipelineId !== "LOCAL_ONLY_V2" ||
    batchPlan.pipelineId !== "LOCAL_ONLY_V2" ||
    draft.pipelineId !== "LOCAL_ONLY_V2"
  ) {
    issues.push(
      issue(
        "PIPELINE_MISMATCH",
        "Paso 15 acepta únicamente artefactos LOCAL_ONLY_V2.",
      ),
    );
  }

  const projectId = knowledge.projectId;
  if (
    plan.knowledge.projectId !== projectId ||
    evidence.projectId !== projectId ||
    batchPlan.projectId !== projectId ||
    draft.projectId !== projectId
  ) {
    issues.push(
      issue(
        "PROJECT_MISMATCH",
        "Los artefactos de cobertura pertenecen a proyectos diferentes.",
      ),
    );
  }

  if (
    plan.knowledge.fingerprint !== knowledge.fingerprint ||
    evidence.knowledgeFingerprint !== knowledge.fingerprint ||
    batchPlan.knowledgeFingerprint !== knowledge.fingerprint
  ) {
    issues.push(
      issue(
        "KNOWLEDGE_MISMATCH",
        "Plan/evidencia/lotes no referencian el mismo índice canónico.",
      ),
    );
  }

  if (
    evidence.templatePlanFingerprint !== plan.planFingerprint ||
    batchPlan.templatePlanFingerprint !== plan.planFingerprint ||
    draft.templatePlanFingerprint !== plan.planFingerprint ||
    draft.template.id !== plan.template.id ||
    draft.template.version !== plan.template.version
  ) {
    issues.push(
      issue(
        "PLAN_MISMATCH",
        "El borrador y sus insumos no pertenecen al mismo plan de plantilla.",
      ),
    );
  }
}

function sectionCoverage(
  assembled: LocalOnlyV2AssembledSection,
  expected: ExpectedSectionTrace,
): LocalOnlyV2SectionCoverage {
  const assembledFindingSet = new Set(assembled.selectedFindingIds);
  const expectedFindingSet = new Set(expected.findingIds);
  const assembledSourceSet = new Set(assembled.sourceIds);
  const expectedSourceSet = new Set(expected.sourceIds);
  const assembledSegmentSet = new Set(assembled.segmentIds);
  const expectedSegmentSet = new Set(expected.segmentIds);

  const missingFindingIds = difference(
    expected.findingIds,
    assembledFindingSet,
  );
  const unexpectedFindingIds = difference(
    assembled.selectedFindingIds,
    expectedFindingSet,
  );
  const missingSourceIds = difference(expected.sourceIds, assembledSourceSet);
  const unexpectedSourceIds = difference(
    assembled.sourceIds,
    expectedSourceSet,
  );
  const missingSegmentIds = difference(
    expected.segmentIds,
    assembledSegmentSet,
  );
  const unexpectedSegmentIds = difference(
    assembled.segmentIds,
    expectedSegmentSet,
  );

  const expectedQuestionnaireFindingCount =
    expected.questionnaireFindingIds.length;

  const exactTraceability =
    missingFindingIds.length === 0 &&
    unexpectedFindingIds.length === 0 &&
    missingSourceIds.length === 0 &&
    unexpectedSourceIds.length === 0 &&
    missingSegmentIds.length === 0 &&
    unexpectedSegmentIds.length === 0 &&
    assembled.questionnaireFindingCount === expectedQuestionnaireFindingCount &&
    sameOrdered(assembled.selectedFindingIds, expected.findingIds) &&
    sameOrdered(assembled.sourceIds, expected.sourceIds) &&
    sameOrdered(assembled.segmentIds, expected.segmentIds);

  return Object.freeze({
    blockId: assembled.blockId,
    sectionKey: assembled.sectionKey,
    order: assembled.order,
    contentKind: assembled.contentKind,
    expectedFindingIds: expected.findingIds,
    assembledFindingIds: assembled.selectedFindingIds,
    missingFindingIds,
    unexpectedFindingIds,
    expectedSourceIds: expected.sourceIds,
    assembledSourceIds: assembled.sourceIds,
    missingSourceIds,
    unexpectedSourceIds,
    expectedSegmentIds: expected.segmentIds,
    assembledSegmentIds: assembled.segmentIds,
    missingSegmentIds,
    unexpectedSegmentIds,
    expectedQuestionnaireFindingCount,
    assembledQuestionnaireFindingCount: assembled.questionnaireFindingCount,
    exactTraceability,
    passed: exactTraceability,
  });
}

export function buildLocalOnlyV2TraceabilityCoverageReport(
  plan: LocalOnlyV2TemplateGenerationPlan,
  knowledge: LocalOnlyV2KnowledgeIndex,
  evidence: LocalOnlyV2EvidenceSelectionPlan,
  batchPlan: LocalOnlyV2ArrayBatchPlan,
  draft: LocalOnlyV2AssembledDraft,
): LocalOnlyV2TraceabilityCoverageReport {
  const issues: LocalOnlyV2CoverageIssue[] = [];
  assertCompatible(plan, knowledge, evidence, batchPlan, draft, issues);

  const knowledgeByFinding = new Map(
    knowledge.findings.map((finding) => [finding.canonicalId, finding]),
  );
  const knownSources = new Set(
    knowledge.sources.map((source) => source.sourceId),
  );
  const knownSegments = new Set(
    knowledge.segments.map((segment) => segment.segmentId),
  );
  const evidenceByBlock = new Map(
    evidence.blocks.map((packet) => [packet.blockId, packet]),
  );
  const collectionsByBlock = new Map(
    batchPlan.collections.map((collection) => [collection.blockId, collection]),
  );
  const assembledByBlock = new Map<string, LocalOnlyV2AssembledSection>();

  for (const section of draft.sections) {
    if (assembledByBlock.has(section.blockId)) {
      issues.push(
        issue(
          "SECTION_MISMATCH",
          `El borrador contiene blockId duplicado: ${section.blockId}.`,
          [section.blockId],
          section.blockId,
        ),
      );
    }
    assembledByBlock.set(section.blockId, section);
  }

  const sectionReports: LocalOnlyV2SectionCoverage[] = [];
  const expectedTraces: ExpectedSectionTrace[] = [];

  for (const block of [...plan.blocks].sort(
    (left, right) => left.blockNumber - right.blockNumber,
  )) {
    const assembled = assembledByBlock.get(block.blockId);
    const packet = evidenceByBlock.get(block.blockId);
    const collection = collectionsByBlock.get(block.blockId);

    if (!assembled || !packet) {
      issues.push(
        issue(
          "SECTION_MISMATCH",
          `Falta sección o evidencia para ${block.blockId}.`,
          [block.blockId],
          block.blockId,
        ),
      );
      continue;
    }

    if (
      assembled.sectionKey !== block.sectionKey ||
      assembled.order !== block.sectionOrder ||
      assembled.title !== block.title ||
      assembled.required !== block.required
    ) {
      issues.push(
        issue(
          "SECTION_MISMATCH",
          `La sección ensamblada no coincide con la plantilla: ${block.blockId}.`,
          [block.blockId],
          block.blockId,
        ),
      );
    }

    const expected = collection
      ? traceForCollection(collection)
      : traceForPacket(packet);
    expectedTraces.push(expected);

    const report = sectionCoverage(assembled, expected);
    sectionReports.push(report);

    if (!report.passed) {
      issues.push(
        issue(
          "SECTION_TRACEABILITY_MISMATCH",
          `La trazabilidad de ${block.blockId} no coincide con su evidencia seleccionada.`,
          uniqueInOrder([
            ...report.missingFindingIds,
            ...report.unexpectedFindingIds,
            ...report.missingSourceIds,
            ...report.unexpectedSourceIds,
            ...report.missingSegmentIds,
            ...report.unexpectedSegmentIds,
          ]),
          block.blockId,
        ),
      );
    }
  }

  for (const section of draft.sections) {
    if (!plan.blocks.some((block) => block.blockId === section.blockId)) {
      issues.push(
        issue(
          "SECTION_MISMATCH",
          `El borrador contiene una sección ajena a la plantilla: ${section.blockId}.`,
          [section.blockId],
          section.blockId,
        ),
      );
    }
  }

  if (
    draft.sections.length !== plan.blocks.length ||
    sectionReports.length !== plan.blocks.length
  ) {
    issues.push(
      issue(
        "SECTION_MISMATCH",
        "La cantidad de secciones ensambladas no coincide con la plantilla.",
      ),
    );
  }

  const expectedSelectedFindingIds = uniqueInOrder(
    expectedTraces.flatMap((trace) => trace.findingIds),
  );
  const expectedSourceIds = uniqueInOrder(
    expectedTraces.flatMap((trace) => trace.sourceIds),
  );
  const expectedSegmentIds = uniqueInOrder(
    expectedTraces.flatMap((trace) => trace.segmentIds),
  );

  const assembledFindingSet = new Set(draft.selectedFindingIds);
  const expectedSelectedSet = new Set(expectedSelectedFindingIds);
  const missingSelectedFindingIds = difference(
    expectedSelectedFindingIds,
    assembledFindingSet,
  );
  const unexpectedSelectedFindingIds = difference(
    draft.selectedFindingIds,
    expectedSelectedSet,
  );

  if (missingSelectedFindingIds.length > 0) {
    issues.push(
      issue(
        "MISSING_SELECTED_FINDING",
        "El borrador perdió evidencia que el pipeline había seleccionado.",
        missingSelectedFindingIds,
      ),
    );
  }
  if (
    unexpectedSelectedFindingIds.length > 0 ||
    !sameOrdered(draft.sourceIds, expectedSourceIds) ||
    !sameOrdered(draft.segmentIds, expectedSegmentIds) ||
    !sameOrdered(draft.selectedFindingIds, expectedSelectedFindingIds)
  ) {
    issues.push(
      issue(
        "DOCUMENT_TRACEABILITY_MISMATCH",
        "La trazabilidad global del borrador no coincide con sus secciones.",
        unexpectedSelectedFindingIds,
      ),
    );
  }

  const orphanAssembledFindingIds = Object.freeze(
    draft.selectedFindingIds.filter(
      (findingId) => !knowledgeByFinding.has(findingId),
    ),
  );
  const orphanSourceIds = Object.freeze(
    draft.sourceIds.filter((sourceId) => !knownSources.has(sourceId)),
  );
  const orphanSegmentIds = Object.freeze(
    draft.segmentIds.filter((segmentId) => !knownSegments.has(segmentId)),
  );

  if (orphanAssembledFindingIds.length > 0) {
    issues.push(
      issue(
        "ORPHAN_FINDING",
        "El borrador contiene findings inexistentes en el índice canónico.",
        orphanAssembledFindingIds,
      ),
    );
  }
  if (orphanSourceIds.length > 0) {
    issues.push(
      issue(
        "ORPHAN_SOURCE",
        "El borrador contiene sourceIds inexistentes en el índice canónico.",
        orphanSourceIds,
      ),
    );
  }
  if (orphanSegmentIds.length > 0) {
    issues.push(
      issue(
        "ORPHAN_SEGMENT",
        "El borrador contiene segmentIds inexistentes en el índice canónico.",
        orphanSegmentIds,
      ),
    );
  }

  for (const findingId of draft.selectedFindingIds) {
    const finding = knowledgeByFinding.get(findingId);
    if (!finding) continue;

    const missingFindingSources = finding.sourceIds.filter(
      (sourceId) => !draft.sourceIds.includes(sourceId),
    );
    const missingFindingSegments = finding.segmentIds.filter(
      (segmentId) => !draft.segmentIds.includes(segmentId),
    );

    if (missingFindingSources.length > 0 || missingFindingSegments.length > 0) {
      issues.push(
        issue(
          "DOCUMENT_TRACEABILITY_MISMATCH",
          `El finding ${findingId} perdió parte de su trazabilidad de origen.`,
          uniqueInOrder([...missingFindingSources, ...missingFindingSegments]),
        ),
      );
    }
  }

  const missingQuestionnaireFindingIds = difference(
    knowledge.questionnaireFindingIds,
    assembledFindingSet,
  );
  if (missingQuestionnaireFindingIds.length > 0) {
    issues.push(
      issue(
        "MISSING_QUESTIONNAIRE_FINDING",
        "El borrador perdió evidencia del cuestionario obligatorio.",
        missingQuestionnaireFindingIds,
      ),
    );
  }

  const guardFindingIds = Object.freeze(
    knowledge.findings
      .filter((finding) => GUARD_CATEGORY_SET.has(finding.category))
      .map((finding) => finding.canonicalId),
  );
  const missingGuardFindingIds = difference(
    guardFindingIds,
    assembledFindingSet,
  );
  if (missingGuardFindingIds.length > 0) {
    issues.push(
      issue(
        "MISSING_GUARD_FINDING",
        "El borrador perdió contradicciones, pendientes o advertencias.",
        missingGuardFindingIds,
      ),
    );
  }

  const coveredQuestionnaireFindingIds =
    knowledge.questionnaireFindingIds.filter((findingId) =>
      assembledFindingSet.has(findingId),
    );
  if (
    draft.questionnaireFindingCount !== coveredQuestionnaireFindingIds.length
  ) {
    issues.push(
      issue(
        "QUESTIONNAIRE_COUNT_MISMATCH",
        "questionnaireFindingCount no coincide con los findings realmente trazados.",
        coveredQuestionnaireFindingIds,
      ),
    );
  }

  const criticalFindingIds = uniqueInOrder([
    ...expectedSelectedFindingIds,
    ...knowledge.questionnaireFindingIds,
    ...guardFindingIds,
  ]);
  const missingCriticalFindingIds = difference(
    criticalFindingIds,
    assembledFindingSet,
  );

  const knowledgeFindingIds = knowledge.findings.map(
    (finding) => finding.canonicalId,
  );
  const knowledgeCoveredFindingIds = knowledgeFindingIds.filter((findingId) =>
    assembledFindingSet.has(findingId),
  );
  const unselectedKnowledgeFindingIds = Object.freeze(
    knowledgeFindingIds.filter(
      (findingId) => !assembledFindingSet.has(findingId),
    ),
  );

  const findingTrace: LocalOnlyV2FindingCoverageTrace[] = knowledge.findings
    .filter((finding) => assembledFindingSet.has(finding.canonicalId))
    .map((finding) =>
      Object.freeze({
        canonicalId: finding.canonicalId,
        category: finding.category,
        mandatoryQuestionnaireEvidence: finding.mandatoryQuestionnaireEvidence,
        sourceIds: finding.sourceIds,
        segmentIds: finding.segmentIds,
        occurrenceCount: finding.occurrenceCount,
        sectionKeys: Object.freeze(
          draft.sections
            .filter((section) =>
              section.selectedFindingIds.includes(finding.canonicalId),
            )
            .map((section) => section.sectionKey),
        ),
      }),
    );

  const categoryCoverage: LocalOnlyV2CategoryCoverage[] =
    LOCAL_AI_CATEGORIES.map((category) => {
      const knowledgeIds = knowledge.findingIdsByCategory[category];
      const assembledCount = knowledgeIds.filter((findingId) =>
        assembledFindingSet.has(findingId),
      ).length;
      return Object.freeze({
        category,
        knowledgeCount: knowledgeIds.length,
        assembledCount,
        coverageRatio: ratio(assembledCount, knowledgeIds.length),
      });
    });

  const coveredSelectedFindingCount = expectedSelectedFindingIds.filter(
    (findingId) => assembledFindingSet.has(findingId),
  ).length;
  const coveredCriticalFindingCount = criticalFindingIds.filter((findingId) =>
    assembledFindingSet.has(findingId),
  ).length;
  const coveredGuardFindingCount = guardFindingIds.filter((findingId) =>
    assembledFindingSet.has(findingId),
  ).length;

  const metrics: LocalOnlyV2CoverageMetrics = Object.freeze({
    knowledgeFindingCount: knowledge.findings.length,
    expectedSelectedFindingCount: expectedSelectedFindingIds.length,
    coveredSelectedFindingCount,
    selectedCoverageRatio: ratio(
      coveredSelectedFindingCount,
      expectedSelectedFindingIds.length,
    ),
    criticalFindingCount: criticalFindingIds.length,
    coveredCriticalFindingCount,
    criticalCoverageRatio: ratio(
      coveredCriticalFindingCount,
      criticalFindingIds.length,
    ),
    assembledFindingCount: draft.selectedFindingIds.length,
    knowledgeCoveredFindingCount: knowledgeCoveredFindingIds.length,
    knowledgeCoverageRatio: ratio(
      knowledgeCoveredFindingIds.length,
      knowledge.findings.length,
    ),
    questionnaireFindingCount: knowledge.questionnaireFindingIds.length,
    coveredQuestionnaireFindingCount: coveredQuestionnaireFindingIds.length,
    questionnaireCoverageRatio: ratio(
      coveredQuestionnaireFindingIds.length,
      knowledge.questionnaireFindingIds.length,
    ),
    guardFindingCount: guardFindingIds.length,
    coveredGuardFindingCount,
    guardCoverageRatio: ratio(coveredGuardFindingCount, guardFindingIds.length),
    knowledgeSourceCount: knowledge.sources.length,
    tracedSourceCount: draft.sourceIds.length,
    knowledgeSegmentCount: knowledge.segments.length,
    tracedSegmentCount: draft.segmentIds.length,
    sectionCount: plan.blocks.length,
    passedSectionCount: sectionReports.filter((section) => section.passed)
      .length,
  });

  const passed = issues.length === 0;
  const withoutFingerprint = {
    pipelineId: "LOCAL_ONLY_V2" as const,
    schemaVersion: LOCAL_ONLY_V2_TRACEABILITY_COVERAGE_SCHEMA_VERSION,
    projectId: knowledge.projectId,
    knowledgeFingerprint: knowledge.fingerprint,
    templatePlanFingerprint: plan.planFingerprint,
    assembledDraftFingerprint: draft.fingerprint,
    passed,
    metrics,
    missingSelectedFindingIds,
    missingCriticalFindingIds,
    missingQuestionnaireFindingIds,
    missingGuardFindingIds,
    orphanAssembledFindingIds,
    orphanSourceIds,
    orphanSegmentIds,
    unselectedKnowledgeFindingIds,
    sections: Object.freeze(sectionReports),
    findingTrace: Object.freeze(findingTrace),
    categoryCoverage: Object.freeze(categoryCoverage),
    issues: Object.freeze(issues),
  };

  return Object.freeze({
    ...withoutFingerprint,
    fingerprint: sha256(
      JSON.stringify({
        schemaVersion: withoutFingerprint.schemaVersion,
        projectId: withoutFingerprint.projectId,
        knowledgeFingerprint: withoutFingerprint.knowledgeFingerprint,
        templatePlanFingerprint: withoutFingerprint.templatePlanFingerprint,
        assembledDraftFingerprint: withoutFingerprint.assembledDraftFingerprint,
        passed,
        metrics,
        missingSelectedFindingIds,
        missingCriticalFindingIds,
        orphanAssembledFindingIds,
        sectionFingerprints: draft.sections.map(
          (section) => section.fingerprint,
        ),
        issues: issues.map((currentIssue) => [
          currentIssue.code,
          currentIssue.blockId,
          currentIssue.ids,
        ]),
      }),
    ),
  });
}

export function assertLocalOnlyV2TraceabilityCoverage(
  report: LocalOnlyV2TraceabilityCoverageReport,
): void {
  if (report.passed) return;

  const details = report.issues
    .map((currentIssue) => {
      const ids =
        currentIssue.ids.length > 0 ? ` [${currentIssue.ids.join(", ")}]` : "";
      return `${currentIssue.code}${ids}`;
    })
    .join("; ");

  throw new Error(
    `LOCAL_ONLY_V2 no certifica trazabilidad/cobertura: ${details}.`,
  );
}

export function assertLocalOnlyV2SequentialPointCoverage(
  plan: LocalOnlyV2TemplateGenerationPlan,
  execution: import("./local-only-v2-sequential-block-contract").LocalOnlyV2SequentialBlockExecution,
  sections: readonly import("./local-only-v2-deterministic-assembly").LocalOnlyV2AssembledSection[],
) {
  const requestedPointCount = plan.blocks.length;
  const completedPointCount = execution.blocks.filter((block) => block.status === "COMPLETED").length;
  const assembledPointCount = sections.length;
  const missingPointCount = plan.blocks.filter((block, index) => {
    const section = sections[index];
    return !section || section.blockId !== block.blockId || section.sectionKey !== block.sectionKey || section.order !== block.sectionOrder;
  }).length;
  const coverageRatio = requestedPointCount ? (requestedPointCount - missingPointCount) / requestedPointCount : 0;
  if (execution.templatePlanFingerprint !== plan.planFingerprint || requestedPointCount !== completedPointCount ||
      completedPointCount !== assembledPointCount || missingPointCount !== 0 || coverageRatio !== 1) {
    throw new Error("LOCAL_ONLY_V2: cobertura de puntos incompleta.");
  }
  return { requestedPointCount, completedPointCount, assembledPointCount, missingPointCount, coverageRatio };
}
