// LOCAL_ONLY_V2_05_DETERMINISTIC_NORMALIZER
//
// Paso 5 mueve a TypeScript las tareas mecánicas posteriores a la extracción:
// - normalización de texto;
// - IDs internos determinísticos;
// - numeración estable;
// - deduplicación exacta normalizada;
// - clasificación ya conocida por category;
// - orden y agrupación;
// - agregación de trazabilidad.
//
// NO realiza deduplicación semántica, inferencias, relaciones nuevas ni resuelve
// contradicciones. Hallazgos parecidos pero no exactos permanecen separados.

import { createHash } from "node:crypto";

import {
  LOCAL_AI_CATEGORIES,
  type LocalAiCategory,
} from "../local-ai/local-ai-output";
import type { LocalOnlyV2AtomicFinding } from "./local-only-v2-atomic-extraction";

export const LOCAL_ONLY_V2_NORMALIZED_SCHEMA_VERSION = "1.0.0" as const;

export interface LocalOnlyV2FindingOccurrence {
  readonly atomicFindingId: string;
  readonly sourceId: string;
  readonly sourceTitle: string;
  readonly sourcePosition: number;
  readonly segmentId: string;
  readonly segmentIndex: number;
  readonly evidenceText: string;
  readonly evidenceStartCharacter: number;
  readonly evidenceEndCharacter: number;
  readonly mandatoryQuestionnaireEvidence: boolean;
}

export interface LocalOnlyV2NormalizedFinding {
  readonly canonicalId: string;
  readonly sequence: number;
  readonly categorySequence: number;
  readonly category: LocalAiCategory;
  readonly description: string;
  readonly normalizedDescription: string;
  readonly sourceIds: readonly string[];
  readonly segmentIds: readonly string[];
  readonly occurrenceCount: number;
  readonly mandatoryQuestionnaireEvidence: boolean;
  readonly occurrences: readonly LocalOnlyV2FindingOccurrence[];
}

export interface LocalOnlyV2NormalizedFindingSet {
  readonly pipelineId: "LOCAL_ONLY_V2";
  readonly schemaVersion: typeof LOCAL_ONLY_V2_NORMALIZED_SCHEMA_VERSION;
  readonly rawFindingCount: number;
  readonly canonicalFindingCount: number;
  readonly exactDuplicateCount: number;
  readonly nonEmptyCategories: readonly LocalAiCategory[];
  readonly findings: readonly LocalOnlyV2NormalizedFinding[];
  readonly findingsByCategory: Readonly<
    Record<LocalAiCategory, readonly LocalOnlyV2NormalizedFinding[]>
  >;
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function normalizeLocalOnlyV2DisplayText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\u00a0/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function localOnlyV2ExactDedupKey(
  category: LocalAiCategory,
  description: string,
): string {
  return `${category}\u001f${normalizeLocalOnlyV2DisplayText(
    description,
  ).toLocaleLowerCase("es")}`;
}

function canonicalIdForKey(key: string): string {
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 20);
  return `v2f_${digest}`;
}

function compareOccurrence(
  left: LocalOnlyV2FindingOccurrence,
  right: LocalOnlyV2FindingOccurrence,
): number {
  return (
    left.sourcePosition - right.sourcePosition ||
    compareText(left.sourceId, right.sourceId) ||
    left.segmentIndex - right.segmentIndex ||
    left.evidenceStartCharacter - right.evidenceStartCharacter ||
    compareText(left.atomicFindingId, right.atomicFindingId)
  );
}

function occurrenceFromFinding(
  finding: LocalOnlyV2AtomicFinding,
): LocalOnlyV2FindingOccurrence {
  return Object.freeze({
    atomicFindingId: finding.findingId,
    sourceId: finding.sourceId,
    sourceTitle: normalizeLocalOnlyV2DisplayText(finding.sourceTitle),
    sourcePosition: finding.sourcePosition,
    segmentId: finding.segmentId,
    segmentIndex: finding.segmentIndex,
    evidenceText: finding.evidenceText,
    evidenceStartCharacter: finding.evidenceStartCharacter,
    evidenceEndCharacter: finding.evidenceEndCharacter,
    mandatoryQuestionnaireEvidence: finding.mandatoryQuestionnaireEvidence,
  });
}

function assertUniqueAtomicFindingIds(
  findings: readonly LocalOnlyV2AtomicFinding[],
): void {
  const seen = new Set<string>();
  for (const finding of findings) {
    if (seen.has(finding.findingId)) {
      throw new Error(
        `LOCAL_ONLY_V2 recibió findingId duplicado: ${finding.findingId}.`,
      );
    }
    seen.add(finding.findingId);
  }
}

interface MutableGroup {
  readonly category: LocalAiCategory;
  readonly normalizedDescription: string;
  readonly descriptions: Set<string>;
  readonly occurrences: LocalOnlyV2FindingOccurrence[];
}

function buildGroups(
  findings: readonly LocalOnlyV2AtomicFinding[],
): Map<string, MutableGroup> {
  const allowedCategories = new Set<string>(LOCAL_AI_CATEGORIES);
  const groups = new Map<string, MutableGroup>();

  for (const finding of findings) {
    if (!allowedCategories.has(finding.category)) {
      throw new Error(
        `LOCAL_ONLY_V2 recibió una categoría desconocida: ${finding.category}.`,
      );
    }

    const description = normalizeLocalOnlyV2DisplayText(finding.description);
    if (!description) {
      throw new Error(
        "LOCAL_ONLY_V2 no puede normalizar una descripción vacía.",
      );
    }

    const key = localOnlyV2ExactDedupKey(finding.category, description);
    let group = groups.get(key);
    if (!group) {
      group = {
        category: finding.category,
        normalizedDescription: description.toLocaleLowerCase("es"),
        descriptions: new Set<string>(),
        occurrences: [],
      };
      groups.set(key, group);
    }

    group.descriptions.add(description);
    group.occurrences.push(occurrenceFromFinding(finding));
  }

  return groups;
}

function uniqueInOrder(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)]);
}

function categoryIndex(category: LocalAiCategory): number {
  return LOCAL_AI_CATEGORIES.indexOf(category);
}

export function normalizeLocalOnlyV2AtomicFindings(
  rawFindings: readonly LocalOnlyV2AtomicFinding[],
): LocalOnlyV2NormalizedFindingSet {
  assertUniqueAtomicFindingIds(rawFindings);
  const groups = buildGroups(rawFindings);

  const provisional = [...groups.entries()].map(([key, group]) => {
    const occurrences = [...group.occurrences].sort(compareOccurrence);
    const descriptions = [...group.descriptions].sort(compareText);
    const description = descriptions[0]!;
    const sourceIds = uniqueInOrder(
      occurrences.map((occurrence) => occurrence.sourceId),
    );
    const segmentIds = uniqueInOrder(
      occurrences.map((occurrence) => occurrence.segmentId),
    );

    return {
      canonicalId: canonicalIdForKey(key),
      category: group.category,
      description,
      normalizedDescription: group.normalizedDescription,
      sourceIds,
      segmentIds,
      mandatoryQuestionnaireEvidence: occurrences.some(
        (occurrence) => occurrence.mandatoryQuestionnaireEvidence,
      ),
      occurrences: Object.freeze(occurrences),
    };
  });

  provisional.sort(
    (left, right) =>
      categoryIndex(left.category) - categoryIndex(right.category) ||
      compareText(left.normalizedDescription, right.normalizedDescription) ||
      compareText(left.canonicalId, right.canonicalId),
  );

  const categoryCounters = new Map<LocalAiCategory, number>();
  const findings = provisional.map((finding, index) => {
    const categorySequence = (categoryCounters.get(finding.category) ?? 0) + 1;
    categoryCounters.set(finding.category, categorySequence);

    return Object.freeze({
      canonicalId: finding.canonicalId,
      sequence: index + 1,
      categorySequence,
      category: finding.category,
      description: finding.description,
      normalizedDescription: finding.normalizedDescription,
      sourceIds: finding.sourceIds,
      segmentIds: finding.segmentIds,
      occurrenceCount: finding.occurrences.length,
      mandatoryQuestionnaireEvidence: finding.mandatoryQuestionnaireEvidence,
      occurrences: finding.occurrences,
    });
  });

  const findingsByCategory = Object.fromEntries(
    LOCAL_AI_CATEGORIES.map((category) => [
      category,
      Object.freeze(
        findings.filter((finding) => finding.category === category),
      ),
    ]),
  ) as Record<LocalAiCategory, readonly LocalOnlyV2NormalizedFinding[]>;

  const nonEmptyCategories = LOCAL_AI_CATEGORIES.filter(
    (category) => findingsByCategory[category].length > 0,
  );

  return Object.freeze({
    pipelineId: "LOCAL_ONLY_V2" as const,
    schemaVersion: LOCAL_ONLY_V2_NORMALIZED_SCHEMA_VERSION,
    rawFindingCount: rawFindings.length,
    canonicalFindingCount: findings.length,
    exactDuplicateCount: rawFindings.length - findings.length,
    nonEmptyCategories: Object.freeze(nonEmptyCategories),
    findings: Object.freeze(findings),
    findingsByCategory: Object.freeze(findingsByCategory),
  });
}
