// LOCAL_ONLY_V2_07_CANONICAL_KNOWLEDGE_INDEX
//
// Índice canónico determinístico del proyecto.
// Entrada:
// - inventario de fuentes/segmentos certificado por Paso 3;
// - hallazgos normalizados certificados por Paso 5.
//
// Salida:
// - catálogo de fuentes sin texto completo;
// - catálogo de segmentos sin texto completo;
// - hallazgos canónicos;
// - índices invertidos por categoría/fuente/segmento;
// - métricas de cobertura;
// - fingerprint determinístico.
//
// No usa IA, no persiste en BD y no modifica ProjectKnowledgeSnapshot histórico.

import { createHash } from "node:crypto";

import {
  LOCAL_AI_CATEGORIES,
  type LocalAiCategory,
} from "../local-ai/local-ai-output";
import type {
  LocalOnlyV2FindingOccurrence,
  LocalOnlyV2NormalizedFinding,
  LocalOnlyV2NormalizedFindingSet,
} from "./local-only-v2-normalizer";
import type {
  LocalOnlyV2Segment,
  LocalOnlyV2SegmentedEvidenceInput,
} from "./local-only-v2-segmentation";

export const LOCAL_ONLY_V2_KNOWLEDGE_INDEX_SCHEMA_VERSION = "1.0.0" as const;

export interface LocalOnlyV2KnowledgeSource {
  readonly sourceId: string;
  readonly sourceTitle: string;
  readonly sourcePosition: number;
  readonly mandatoryQuestionnaireEvidence: boolean;
  readonly segmentIds: readonly string[];
  readonly findingIds: readonly string[];
}

export interface LocalOnlyV2KnowledgeSegment {
  readonly segmentId: string;
  readonly sourceId: string;
  readonly sourceTitle: string;
  readonly sourcePosition: number;
  readonly segmentIndex: number;
  readonly startCharacter: number;
  readonly endCharacter: number;
  readonly estimatedTokens: number;
  readonly mandatoryQuestionnaireEvidence: boolean;
  readonly findingIds: readonly string[];
}

export interface LocalOnlyV2KnowledgeIndexMetrics {
  readonly sourceCount: number;
  readonly segmentCount: number;
  readonly rawFindingCount: number;
  readonly canonicalFindingCount: number;
  readonly exactDuplicateCount: number;
  readonly occurrenceCount: number;
  readonly nonEmptyCategoryCount: number;
  readonly sourcesWithFindings: number;
  readonly sourceCoverageRatio: number;
  readonly segmentsWithFindings: number;
  readonly segmentCoverageRatio: number;
  readonly questionnaireSegmentCount: number;
  readonly questionnaireFindingCount: number;
}

export interface LocalOnlyV2KnowledgeIndex {
  readonly pipelineId: "LOCAL_ONLY_V2";
  readonly schemaVersion: typeof LOCAL_ONLY_V2_KNOWLEDGE_INDEX_SCHEMA_VERSION;
  readonly projectId: string;
  readonly questionnaireSourceId: string;
  readonly fingerprint: string;
  readonly sources: readonly LocalOnlyV2KnowledgeSource[];
  readonly segments: readonly LocalOnlyV2KnowledgeSegment[];
  readonly findings: readonly LocalOnlyV2NormalizedFinding[];
  readonly findingIdsByCategory: Readonly<
    Record<LocalAiCategory, readonly string[]>
  >;
  readonly findingIdsBySource: Readonly<Record<string, readonly string[]>>;
  readonly findingIdsBySegment: Readonly<Record<string, readonly string[]>>;
  readonly questionnaireFindingIds: readonly string[];
  readonly metrics: LocalOnlyV2KnowledgeIndexMetrics;
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function uniqueOrdered(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)]);
}

function assertUniqueSegments(
  segments: readonly LocalOnlyV2Segment[],
): ReadonlyMap<string, LocalOnlyV2Segment> {
  const indexed = new Map<string, LocalOnlyV2Segment>();
  for (const segment of segments) {
    if (indexed.has(segment.segmentId)) {
      throw new Error(
        `LOCAL_ONLY_V2 recibió segmentId duplicado: ${segment.segmentId}.`,
      );
    }
    indexed.set(segment.segmentId, segment);
  }
  return indexed;
}

interface SourceAccumulator {
  sourceId: string;
  sourceTitle: string;
  sourcePosition: number;
  mandatoryQuestionnaireEvidence: boolean;
  segmentIds: string[];
}

function sourceInventory(
  segmented: LocalOnlyV2SegmentedEvidenceInput,
): ReadonlyMap<string, SourceAccumulator> {
  const sources = new Map<string, SourceAccumulator>();

  for (const segment of segmented.segments) {
    const existing = sources.get(segment.sourceId);
    if (!existing) {
      sources.set(segment.sourceId, {
        sourceId: segment.sourceId,
        sourceTitle: segment.sourceTitle,
        sourcePosition: segment.sourcePosition,
        mandatoryQuestionnaireEvidence: segment.mandatoryQuestionnaireEvidence,
        segmentIds: [segment.segmentId],
      });
      continue;
    }

    if (
      existing.sourceTitle !== segment.sourceTitle ||
      existing.sourcePosition !== segment.sourcePosition
    ) {
      throw new Error(
        `LOCAL_ONLY_V2 detectó metadatos inconsistentes para la fuente ${segment.sourceId}.`,
      );
    }
    if (
      existing.mandatoryQuestionnaireEvidence !==
      segment.mandatoryQuestionnaireEvidence
    ) {
      throw new Error(
        `LOCAL_ONLY_V2 detectó marcación inconsistente de cuestionario para ${segment.sourceId}.`,
      );
    }
    existing.segmentIds.push(segment.segmentId);
  }

  return sources;
}

function expectedIdsFromOccurrences(
  occurrences: readonly LocalOnlyV2FindingOccurrence[],
  field: "sourceId" | "segmentId",
): readonly string[] {
  return uniqueOrdered(occurrences.map((occurrence) => occurrence[field]));
}

function sameIds(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function verifyOccurrence(
  occurrence: LocalOnlyV2FindingOccurrence,
  segmentsById: ReadonlyMap<string, LocalOnlyV2Segment>,
): void {
  const segment = segmentsById.get(occurrence.segmentId);
  if (!segment) {
    throw new Error(
      `LOCAL_ONLY_V2 encontró una ocurrencia con segmentId huérfano: ${occurrence.segmentId}.`,
    );
  }
  if (segment.sourceId !== occurrence.sourceId) {
    throw new Error(
      `LOCAL_ONLY_V2 detectó sourceId inconsistente en ${occurrence.atomicFindingId}.`,
    );
  }
  if (
    segment.sourceTitle !== occurrence.sourceTitle ||
    segment.sourcePosition !== occurrence.sourcePosition ||
    segment.segmentIndex !== occurrence.segmentIndex
  ) {
    throw new Error(
      `LOCAL_ONLY_V2 detectó trazabilidad inconsistente en ${occurrence.atomicFindingId}.`,
    );
  }
  if (
    occurrence.evidenceStartCharacter < segment.startCharacter ||
    occurrence.evidenceEndCharacter > segment.endCharacter ||
    occurrence.evidenceEndCharacter < occurrence.evidenceStartCharacter
  ) {
    throw new Error(
      `LOCAL_ONLY_V2 detectó offsets fuera del segmento en ${occurrence.atomicFindingId}.`,
    );
  }

  const relativeStart =
    occurrence.evidenceStartCharacter - segment.startCharacter;
  const relativeEnd = occurrence.evidenceEndCharacter - segment.startCharacter;
  const exactEvidence = segment.text.slice(relativeStart, relativeEnd);

  if (
    exactEvidence !== occurrence.evidenceText ||
    occurrence.evidenceEndCharacter - occurrence.evidenceStartCharacter !==
      occurrence.evidenceText.length
  ) {
    throw new Error(
      `LOCAL_ONLY_V2 detectó evidencia que no coincide con el segmento en ${occurrence.atomicFindingId}.`,
    );
  }

  if (
    segment.mandatoryQuestionnaireEvidence !==
    occurrence.mandatoryQuestionnaireEvidence
  ) {
    throw new Error(
      `LOCAL_ONLY_V2 detectó una marca de cuestionario inconsistente en ${occurrence.atomicFindingId}.`,
    );
  }
}

function verifyFinding(
  finding: LocalOnlyV2NormalizedFinding,
  segmentsById: ReadonlyMap<string, LocalOnlyV2Segment>,
): void {
  if (finding.occurrences.length !== finding.occurrenceCount) {
    throw new Error(
      `LOCAL_ONLY_V2 detectó occurrenceCount inconsistente en ${finding.canonicalId}.`,
    );
  }

  for (const occurrence of finding.occurrences) {
    verifyOccurrence(occurrence, segmentsById);
  }

  const sourceIds = expectedIdsFromOccurrences(finding.occurrences, "sourceId");
  const segmentIds = expectedIdsFromOccurrences(
    finding.occurrences,
    "segmentId",
  );

  if (!sameIds(finding.sourceIds, sourceIds)) {
    throw new Error(
      `LOCAL_ONLY_V2 detectó sourceIds inconsistentes en ${finding.canonicalId}.`,
    );
  }
  if (!sameIds(finding.segmentIds, segmentIds)) {
    throw new Error(
      `LOCAL_ONLY_V2 detectó segmentIds inconsistentes en ${finding.canonicalId}.`,
    );
  }

  const mandatory = finding.occurrences.some(
    (occurrence) => occurrence.mandatoryQuestionnaireEvidence,
  );
  if (finding.mandatoryQuestionnaireEvidence !== mandatory) {
    throw new Error(
      `LOCAL_ONLY_V2 detectó marca de cuestionario inconsistente en ${finding.canonicalId}.`,
    );
  }
}

function buildFindingIdsByCategory(
  normalized: LocalOnlyV2NormalizedFindingSet,
): Readonly<Record<LocalAiCategory, readonly string[]>> {
  return Object.freeze(
    Object.fromEntries(
      LOCAL_AI_CATEGORIES.map((category) => [
        category,
        Object.freeze(
          normalized.findingsByCategory[category].map(
            (finding) => finding.canonicalId,
          ),
        ),
      ]),
    ) as Record<LocalAiCategory, readonly string[]>,
  );
}

function canonicalFingerprintPayload(
  index: Omit<LocalOnlyV2KnowledgeIndex, "fingerprint">,
): string {
  return JSON.stringify({
    schemaVersion: index.schemaVersion,
    projectId: index.projectId,
    questionnaireSourceId: index.questionnaireSourceId,
    sources: index.sources.map((source) => ({
      sourceId: source.sourceId,
      sourceTitle: source.sourceTitle,
      sourcePosition: source.sourcePosition,
      mandatoryQuestionnaireEvidence: source.mandatoryQuestionnaireEvidence,
      segmentIds: source.segmentIds,
      findingIds: source.findingIds,
    })),
    segments: index.segments.map((segment) => ({
      segmentId: segment.segmentId,
      sourceId: segment.sourceId,
      segmentIndex: segment.segmentIndex,
      startCharacter: segment.startCharacter,
      endCharacter: segment.endCharacter,
      estimatedTokens: segment.estimatedTokens,
      mandatoryQuestionnaireEvidence: segment.mandatoryQuestionnaireEvidence,
      findingIds: segment.findingIds,
    })),
    findings: index.findings.map((finding) => ({
      canonicalId: finding.canonicalId,
      sequence: finding.sequence,
      categorySequence: finding.categorySequence,
      category: finding.category,
      description: finding.description,
      sourceIds: finding.sourceIds,
      segmentIds: finding.segmentIds,
      occurrenceCount: finding.occurrenceCount,
      mandatoryQuestionnaireEvidence: finding.mandatoryQuestionnaireEvidence,
      occurrences: finding.occurrences.map((occurrence) => ({
        sourceId: occurrence.sourceId,
        segmentId: occurrence.segmentId,
        evidenceText: occurrence.evidenceText,
        evidenceStartCharacter: occurrence.evidenceStartCharacter,
        evidenceEndCharacter: occurrence.evidenceEndCharacter,
      })),
    })),
    metrics: index.metrics,
  });
}

export function buildLocalOnlyV2KnowledgeIndex(
  projectId: string,
  segmented: LocalOnlyV2SegmentedEvidenceInput,
  normalized: LocalOnlyV2NormalizedFindingSet,
): LocalOnlyV2KnowledgeIndex {
  const cleanProjectId = projectId.trim();
  if (!cleanProjectId) {
    throw new Error(
      "LOCAL_ONLY_V2 requiere projectId para construir el índice de conocimiento.",
    );
  }
  if (
    segmented.pipelineId !== "LOCAL_ONLY_V2" ||
    normalized.pipelineId !== "LOCAL_ONLY_V2"
  ) {
    throw new Error(
      "El índice canónico acepta únicamente artefactos LOCAL_ONLY_V2.",
    );
  }

  const segmentsById = assertUniqueSegments(segmented.segments);
  const sourcesById = sourceInventory(segmented);

  const questionnaireSource = sourcesById.get(segmented.questionnaireSourceId);
  if (!questionnaireSource) {
    throw new Error(
      "LOCAL_ONLY_V2 no encontró la fuente obligatoria del cuestionario en el inventario.",
    );
  }
  if (!questionnaireSource.mandatoryQuestionnaireEvidence) {
    throw new Error(
      "LOCAL_ONLY_V2 perdió la marca obligatoria del cuestionario.",
    );
  }

  const actualQuestionnaireSegments = segmented.segments.filter(
    (segment) =>
      segment.sourceId === segmented.questionnaireSourceId &&
      segment.mandatoryQuestionnaireEvidence,
  ).length;
  if (actualQuestionnaireSegments !== segmented.questionnaireSegmentCount) {
    throw new Error(
      "LOCAL_ONLY_V2 detectó un conteo inconsistente de segmentos del cuestionario.",
    );
  }

  for (const segment of segmented.segments) {
    const shouldBeQuestionnaire =
      segment.sourceId === segmented.questionnaireSourceId;
    if (segment.mandatoryQuestionnaireEvidence !== shouldBeQuestionnaire) {
      throw new Error(
        `LOCAL_ONLY_V2 detectó una marca de cuestionario inválida en ${segment.segmentId}.`,
      );
    }
  }

  const findingIds = new Set<string>();
  for (const finding of normalized.findings) {
    if (findingIds.has(finding.canonicalId)) {
      throw new Error(
        `LOCAL_ONLY_V2 recibió canonicalId duplicado: ${finding.canonicalId}.`,
      );
    }
    findingIds.add(finding.canonicalId);
    verifyFinding(finding, segmentsById);
  }

  const findingIdsBySourceMutable = new Map<string, string[]>();
  const findingIdsBySegmentMutable = new Map<string, string[]>();

  for (const sourceId of sourcesById.keys()) {
    findingIdsBySourceMutable.set(sourceId, []);
  }
  for (const segmentId of segmentsById.keys()) {
    findingIdsBySegmentMutable.set(segmentId, []);
  }

  for (const finding of normalized.findings) {
    for (const sourceId of finding.sourceIds) {
      const target = findingIdsBySourceMutable.get(sourceId);
      if (!target) {
        throw new Error(
          `LOCAL_ONLY_V2 encontró sourceId huérfano en ${finding.canonicalId}: ${sourceId}.`,
        );
      }
      target.push(finding.canonicalId);
    }
    for (const segmentId of finding.segmentIds) {
      const target = findingIdsBySegmentMutable.get(segmentId);
      if (!target) {
        throw new Error(
          `LOCAL_ONLY_V2 encontró segmentId huérfano en ${finding.canonicalId}: ${segmentId}.`,
        );
      }
      target.push(finding.canonicalId);
    }
  }

  const sources = [...sourcesById.values()]
    .sort(
      (left, right) =>
        left.sourcePosition - right.sourcePosition ||
        compareText(left.sourceId, right.sourceId),
    )
    .map((source) =>
      Object.freeze({
        sourceId: source.sourceId,
        sourceTitle: source.sourceTitle,
        sourcePosition: source.sourcePosition,
        mandatoryQuestionnaireEvidence: source.mandatoryQuestionnaireEvidence,
        segmentIds: Object.freeze([...source.segmentIds]),
        findingIds: Object.freeze([
          ...(findingIdsBySourceMutable.get(source.sourceId) ?? []),
        ]),
      }),
    );

  const segments = [...segmented.segments]
    .sort(
      (left, right) =>
        left.sourcePosition - right.sourcePosition ||
        compareText(left.sourceId, right.sourceId) ||
        left.segmentIndex - right.segmentIndex ||
        compareText(left.segmentId, right.segmentId),
    )
    .map((segment) =>
      Object.freeze({
        segmentId: segment.segmentId,
        sourceId: segment.sourceId,
        sourceTitle: segment.sourceTitle,
        sourcePosition: segment.sourcePosition,
        segmentIndex: segment.segmentIndex,
        startCharacter: segment.startCharacter,
        endCharacter: segment.endCharacter,
        estimatedTokens: segment.estimatedTokens,
        mandatoryQuestionnaireEvidence: segment.mandatoryQuestionnaireEvidence,
        findingIds: Object.freeze([
          ...(findingIdsBySegmentMutable.get(segment.segmentId) ?? []),
        ]),
      }),
    );

  const findingIdsBySource = Object.freeze(
    Object.fromEntries(
      sources.map((source) => [source.sourceId, source.findingIds]),
    ),
  ) as Readonly<Record<string, readonly string[]>>;

  const findingIdsBySegment = Object.freeze(
    Object.fromEntries(
      segments.map((segment) => [segment.segmentId, segment.findingIds]),
    ),
  ) as Readonly<Record<string, readonly string[]>>;

  const findingIdsByCategory = buildFindingIdsByCategory(normalized);
  const questionnaireFindingIds = Object.freeze(
    normalized.findings
      .filter((finding) => finding.mandatoryQuestionnaireEvidence)
      .map((finding) => finding.canonicalId),
  );

  const occurrenceCount = normalized.findings.reduce(
    (sum, finding) => sum + finding.occurrenceCount,
    0,
  );
  const sourcesWithFindings = sources.filter(
    (source) => source.findingIds.length > 0,
  ).length;
  const segmentsWithFindings = segments.filter(
    (segment) => segment.findingIds.length > 0,
  ).length;

  const metrics = Object.freeze({
    sourceCount: sources.length,
    segmentCount: segments.length,
    rawFindingCount: normalized.rawFindingCount,
    canonicalFindingCount: normalized.canonicalFindingCount,
    exactDuplicateCount: normalized.exactDuplicateCount,
    occurrenceCount,
    nonEmptyCategoryCount: normalized.nonEmptyCategories.length,
    sourcesWithFindings,
    sourceCoverageRatio:
      sources.length === 0 ? 0 : sourcesWithFindings / sources.length,
    segmentsWithFindings,
    segmentCoverageRatio:
      segments.length === 0 ? 0 : segmentsWithFindings / segments.length,
    questionnaireSegmentCount: segmented.questionnaireSegmentCount,
    questionnaireFindingCount: questionnaireFindingIds.length,
  });

  const withoutFingerprint = Object.freeze({
    pipelineId: "LOCAL_ONLY_V2" as const,
    schemaVersion: LOCAL_ONLY_V2_KNOWLEDGE_INDEX_SCHEMA_VERSION,
    projectId: cleanProjectId,
    questionnaireSourceId: segmented.questionnaireSourceId,
    sources: Object.freeze(sources),
    segments: Object.freeze(segments),
    findings: normalized.findings,
    findingIdsByCategory,
    findingIdsBySource,
    findingIdsBySegment,
    questionnaireFindingIds,
    metrics,
  });

  const fingerprint = createHash("sha256")
    .update(canonicalFingerprintPayload(withoutFingerprint))
    .digest("hex");

  return Object.freeze({
    ...withoutFingerprint,
    fingerprint,
  });
}
