// LOCAL_ONLY_V2_11_ARRAY_BATCHES
//
// Paso 11: planifica lotes para secciones con intención de colección.
//
// Problema que resuelve:
// el selector normal del Paso 9 limita deliberadamente la evidencia por llamada.
// Para una colección grande (requisitos, HU, pruebas, backlog, criterios, etc.)
// ese límite NO puede convertirse en pérdida silenciosa.
//
// Estrategia:
// 1. valida el plan + índice + selección certificada de Paso 9;
// 2. detecta intención de colección por key/título/guidance, sin mapa de keys;
// 3. recalcula SOLO esos bloques con selección exhaustiva;
// 4. parte los hallazgos relevantes en lotes pequeños y trazables;
// 5. demuestra cobertura exacta: sin pérdidas y sin duplicados.
//
// Este paso NO llama IA y NO define el schema final específico de cada colección.
// requirements, HU, tests y backlog tienen contratos diferentes; sus resultados se
// validarán/ensamblarán en pasos posteriores sin acoplar este planner al contrato
// histórico structuredAnalysis.

import { createHash } from "node:crypto";

import type { LocalOnlyV2KnowledgeIndex } from "./local-only-v2-knowledge-index";
import {
  LOCAL_ONLY_V2_DEFAULT_EVIDENCE_SELECTION_POLICY,
  selectLocalOnlyV2EvidenceByBlock,
  type LocalOnlyV2BlockEvidencePacket,
  type LocalOnlyV2EvidenceSelectionPlan,
  type LocalOnlyV2SelectedFinding,
} from "./local-only-v2-evidence-selector";
import type {
  LocalOnlyV2TemplateGenerationBlock,
  LocalOnlyV2TemplateGenerationPlan,
} from "./local-only-v2-template-planner";

export const LOCAL_ONLY_V2_ARRAY_BATCH_SCHEMA_VERSION = "1.0.0" as const;

export interface LocalOnlyV2ArrayBatchPolicy {
  readonly maxRelevantFindingsPerBatch: number;
  readonly maxEstimatedRelevantTokensPerBatch: number;
}

export const LOCAL_ONLY_V2_DEFAULT_ARRAY_BATCH_POLICY: LocalOnlyV2ArrayBatchPolicy =
  Object.freeze({
    maxRelevantFindingsPerBatch: 6,
    maxEstimatedRelevantTokensPerBatch: 700,
  });

export interface LocalOnlyV2ArrayBatch {
  readonly batchId: string;
  readonly batchNumber: number;
  readonly batchTotal: number;
  readonly blockId: string;
  readonly sectionKey: string;
  readonly relevantFindings: readonly LocalOnlyV2SelectedFinding[];
  readonly guardFindings: readonly LocalOnlyV2SelectedFinding[];
  readonly selectedFindingIds: readonly string[];
  readonly sourceIds: readonly string[];
  readonly segmentIds: readonly string[];
  readonly questionnaireFindingCount: number;
  readonly estimatedRelevantTokens: number;
  readonly fingerprint: string;
}

export interface LocalOnlyV2CollectionBatchPlan {
  readonly blockId: string;
  readonly sectionKey: string;
  readonly title: string;
  readonly guidance: string;
  readonly collectionIntentTerms: readonly string[];
  readonly exhaustiveRelevantFindingCount: number;
  readonly baselineRelevantFindingCount: number;
  readonly expandedBeyondBaseline: boolean;
  readonly requiresMultipleBatches: boolean;
  readonly batches: readonly LocalOnlyV2ArrayBatch[];
  readonly coveredRelevantFindingIds: readonly string[];
  readonly missingRelevantFindingIds: readonly string[];
  readonly duplicateRelevantFindingIds: readonly string[];
  readonly fingerprint: string;
}

export interface LocalOnlyV2ArrayBatchPlan {
  readonly pipelineId: "LOCAL_ONLY_V2";
  readonly schemaVersion: typeof LOCAL_ONLY_V2_ARRAY_BATCH_SCHEMA_VERSION;
  readonly projectId: string;
  readonly knowledgeFingerprint: string;
  readonly templatePlanFingerprint: string;
  readonly evidenceSelectionSchemaVersion: string;
  readonly policy: LocalOnlyV2ArrayBatchPolicy;
  readonly collections: readonly LocalOnlyV2CollectionBatchPlan[];
  readonly fingerprint: string;
}

const COLLECTION_TERMS = new Set([
  "array",
  "arrays",
  "lista",
  "listas",
  "coleccion",
  "colecciones",
  "catalogo",
  "catalogos",
  "matriz",
  "matrices",
  "requisito",
  "requisitos",
  "requerimiento",
  "requerimientos",
  "historia",
  "historias",
  "story",
  "stories",
  "usuario",
  "usuarios",
  "criterio",
  "criterios",
  "acceptance",
  "prueba",
  "pruebas",
  "test",
  "tests",
  "escenario",
  "escenarios",
  "backlog",
  "epic",
  "epics",
  "feature",
  "features",
  "task",
  "tasks",
  "tarea",
  "tareas",
  "item",
  "items",
]);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedTokens(value: string): readonly string[] {
  const separated = value.replace(/([a-záéíóúñ0-9])([A-ZÁÉÍÓÚÑ])/gu, "$1 $2");
  return [
    ...new Set(
      separated
        .normalize("NFD")
        .replace(/\p{M}+/gu, "")
        .toLocaleLowerCase("es")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .split(/\s+/u)
        .map((token) => token.trim())
        .filter(Boolean),
    ),
  ];
}

export function localOnlyV2CollectionIntentTerms(
  block: LocalOnlyV2TemplateGenerationBlock,
): readonly string[] {
  const tokens = normalizedTokens(
    [block.sectionKey, block.title, block.guidance].join(" "),
  );
  return Object.freeze(tokens.filter((token) => COLLECTION_TERMS.has(token)));
}

export function isLocalOnlyV2CollectionBlock(
  block: LocalOnlyV2TemplateGenerationBlock,
): boolean {
  return localOnlyV2CollectionIntentTerms(block).length > 0;
}

function validatePolicy(
  policy: LocalOnlyV2ArrayBatchPolicy,
): LocalOnlyV2ArrayBatchPolicy {
  if (
    !Number.isInteger(policy.maxRelevantFindingsPerBatch) ||
    policy.maxRelevantFindingsPerBatch < 1
  ) {
    throw new Error(
      "LOCAL_ONLY_V2 requiere maxRelevantFindingsPerBatch entero >= 1.",
    );
  }
  if (
    !Number.isInteger(policy.maxEstimatedRelevantTokensPerBatch) ||
    policy.maxEstimatedRelevantTokensPerBatch < 100
  ) {
    throw new Error(
      "LOCAL_ONLY_V2 requiere maxEstimatedRelevantTokensPerBatch entero >= 100.",
    );
  }
  return Object.freeze({ ...policy });
}

function validateCompatibility(
  plan: LocalOnlyV2TemplateGenerationPlan,
  knowledge: LocalOnlyV2KnowledgeIndex,
  baseline: LocalOnlyV2EvidenceSelectionPlan,
): void {
  if (
    plan.pipelineId !== "LOCAL_ONLY_V2" ||
    knowledge.pipelineId !== "LOCAL_ONLY_V2" ||
    baseline.pipelineId !== "LOCAL_ONLY_V2"
  ) {
    throw new Error("El Paso 11 acepta únicamente artefactos LOCAL_ONLY_V2.");
  }
  if (
    plan.knowledge.projectId !== knowledge.projectId ||
    baseline.projectId !== knowledge.projectId
  ) {
    throw new Error(
      "LOCAL_ONLY_V2 detectó projectId inconsistente en Paso 11.",
    );
  }
  if (
    plan.knowledge.fingerprint !== knowledge.fingerprint ||
    baseline.knowledgeFingerprint !== knowledge.fingerprint
  ) {
    throw new Error(
      "LOCAL_ONLY_V2 detectó knowledgeFingerprint inconsistente en Paso 11.",
    );
  }
  if (baseline.templatePlanFingerprint !== plan.planFingerprint) {
    throw new Error(
      "LOCAL_ONLY_V2 detectó templatePlanFingerprint inconsistente en Paso 11.",
    );
  }

  const blockIds = plan.blocks.map((block) => block.blockId);
  const baselineIds = baseline.blocks.map((block) => block.blockId);
  if (
    blockIds.length !== baselineIds.length ||
    blockIds.some((blockId, index) => blockId !== baselineIds[index])
  ) {
    throw new Error(
      "LOCAL_ONLY_V2 detectó bloques distintos entre Paso 8 y Paso 9.",
    );
  }
}

function estimateFindingTokens(finding: LocalOnlyV2SelectedFinding): number {
  const characters =
    finding.description.length +
    finding.occurrences.reduce(
      (sum, occurrence) =>
        sum + occurrence.evidenceText.length + occurrence.sourceTitle.length,
      0,
    );
  return Math.max(1, Math.ceil(characters / 4));
}

function uniqueInOrder(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)]);
}

function createBatch(
  block: LocalOnlyV2TemplateGenerationBlock,
  relevantFindings: readonly LocalOnlyV2SelectedFinding[],
  guardFindings: readonly LocalOnlyV2SelectedFinding[],
  batchNumber: number,
  batchTotal: number,
): LocalOnlyV2ArrayBatch {
  const selected = [...relevantFindings, ...guardFindings];
  const selectedFindingIds = uniqueInOrder(
    selected.map((finding) => finding.canonicalId),
  );
  const sourceIds = uniqueInOrder(
    selected.flatMap((finding) => finding.sourceIds),
  );
  const segmentIds = uniqueInOrder(
    selected.flatMap((finding) => finding.segmentIds),
  );
  const questionnaireFindingCount = selected.filter(
    (finding) => finding.mandatoryQuestionnaireEvidence,
  ).length;
  const estimatedRelevantTokens = relevantFindings.reduce(
    (sum, finding) => sum + estimateFindingTokens(finding),
    0,
  );

  const withoutFingerprint = {
    batchId: `${block.blockId}:batch:${String(batchNumber).padStart(3, "0")}`,
    batchNumber,
    batchTotal,
    blockId: block.blockId,
    sectionKey: block.sectionKey,
    relevantFindings: Object.freeze([...relevantFindings]),
    guardFindings: Object.freeze([...guardFindings]),
    selectedFindingIds,
    sourceIds,
    segmentIds,
    questionnaireFindingCount,
    estimatedRelevantTokens,
  };

  return Object.freeze({
    ...withoutFingerprint,
    fingerprint: sha256(
      JSON.stringify({
        batchId: withoutFingerprint.batchId,
        selectedFindingIds,
        sourceIds,
        segmentIds,
        estimatedRelevantTokens,
      }),
    ),
  });
}

function partitionRelevantFindings(
  findings: readonly LocalOnlyV2SelectedFinding[],
  policy: LocalOnlyV2ArrayBatchPolicy,
): readonly (readonly LocalOnlyV2SelectedFinding[])[] {
  if (findings.length === 0) return Object.freeze([Object.freeze([])]);

  const batches: LocalOnlyV2SelectedFinding[][] = [];
  let current: LocalOnlyV2SelectedFinding[] = [];
  let currentTokens = 0;

  const flush = () => {
    if (current.length === 0) return;
    batches.push(current);
    current = [];
    currentTokens = 0;
  };

  for (const finding of findings) {
    const findingTokens = estimateFindingTokens(finding);
    const exceedsCount = current.length >= policy.maxRelevantFindingsPerBatch;
    const exceedsTokens =
      current.length > 0 &&
      currentTokens + findingTokens > policy.maxEstimatedRelevantTokensPerBatch;

    if (exceedsCount || exceedsTokens) flush();

    current.push(finding);
    currentTokens += findingTokens;

    if (
      current.length >= policy.maxRelevantFindingsPerBatch ||
      currentTokens >= policy.maxEstimatedRelevantTokensPerBatch
    ) {
      flush();
    }
  }
  flush();

  return Object.freeze(batches.map((batch) => Object.freeze([...batch])));
}

function duplicates(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return Object.freeze([...repeated].sort());
}

function collectionPlan(
  block: LocalOnlyV2TemplateGenerationBlock,
  baselinePacket: LocalOnlyV2BlockEvidencePacket,
  exhaustivePacket: LocalOnlyV2BlockEvidencePacket,
  policy: LocalOnlyV2ArrayBatchPolicy,
): LocalOnlyV2CollectionBatchPlan {
  const partitions = partitionRelevantFindings(
    exhaustivePacket.relevantFindings,
    policy,
  );
  const batchTotal = partitions.length;
  const batches = partitions.map((relevant, index) =>
    createBatch(
      block,
      relevant,
      exhaustivePacket.guardFindings,
      index + 1,
      batchTotal,
    ),
  );

  const expectedIds = exhaustivePacket.relevantFindings.map(
    (finding) => finding.canonicalId,
  );
  const coveredIds = batches.flatMap((batch) =>
    batch.relevantFindings.map((finding) => finding.canonicalId),
  );
  const coveredSet = new Set(coveredIds);
  const missing = expectedIds.filter((id) => !coveredSet.has(id));
  const repeated = duplicates(coveredIds);

  if (missing.length > 0 || repeated.length > 0) {
    throw new Error(
      `LOCAL_ONLY_V2 perdió o duplicó evidencia al lotear ${block.blockId}.`,
    );
  }

  const collectionIntentTerms = localOnlyV2CollectionIntentTerms(block);
  const withoutFingerprint = {
    blockId: block.blockId,
    sectionKey: block.sectionKey,
    title: block.title,
    guidance: block.guidance,
    collectionIntentTerms,
    exhaustiveRelevantFindingCount: exhaustivePacket.relevantFindings.length,
    baselineRelevantFindingCount: baselinePacket.relevantFindings.length,
    expandedBeyondBaseline:
      exhaustivePacket.relevantFindings.length >
      baselinePacket.relevantFindings.length,
    requiresMultipleBatches: batches.length > 1,
    batches: Object.freeze(batches),
    coveredRelevantFindingIds: Object.freeze([...coveredIds]),
    missingRelevantFindingIds: Object.freeze([...missing]),
    duplicateRelevantFindingIds: repeated,
  };

  return Object.freeze({
    ...withoutFingerprint,
    fingerprint: sha256(
      JSON.stringify({
        blockId: block.blockId,
        collectionIntentTerms,
        baselineRelevantFindingCount:
          withoutFingerprint.baselineRelevantFindingCount,
        exhaustiveRelevantFindingCount:
          withoutFingerprint.exhaustiveRelevantFindingCount,
        batchFingerprints: batches.map((batch) => batch.fingerprint),
      }),
    ),
  });
}

export function buildLocalOnlyV2ArrayBatchPlan(
  plan: LocalOnlyV2TemplateGenerationPlan,
  knowledge: LocalOnlyV2KnowledgeIndex,
  baseline: LocalOnlyV2EvidenceSelectionPlan,
  requestedPolicy: LocalOnlyV2ArrayBatchPolicy = LOCAL_ONLY_V2_DEFAULT_ARRAY_BATCH_POLICY,
): LocalOnlyV2ArrayBatchPlan {
  validateCompatibility(plan, knowledge, baseline);
  const policy = validatePolicy(requestedPolicy);

  const guardCount = knowledge.findings.filter((finding) =>
    ["contradictions", "pendingQuestions", "warnings"].includes(
      finding.category,
    ),
  ).length;

  const exhaustive = selectLocalOnlyV2EvidenceByBlock(plan, knowledge, {
    ...LOCAL_ONLY_V2_DEFAULT_EVIDENCE_SELECTION_POLICY,
    maxRelevantFindingsPerBlock: Math.max(1, knowledge.findings.length),
    maxGuardFindingsPerBlock: guardCount,
    maxOccurrencesPerFinding: baseline.policy.maxOccurrencesPerFinding,
    minimumRelevantScore: baseline.policy.minimumRelevantScore,
  });

  const baselineByBlock = new Map(
    baseline.blocks.map((packet) => [packet.blockId, packet]),
  );
  const exhaustiveByBlock = new Map(
    exhaustive.blocks.map((packet) => [packet.blockId, packet]),
  );

  const collections = plan.blocks
    .filter(isLocalOnlyV2CollectionBlock)
    .map((block) => {
      const baselinePacket = baselineByBlock.get(block.blockId);
      const exhaustivePacket = exhaustiveByBlock.get(block.blockId);
      if (!baselinePacket || !exhaustivePacket) {
        throw new Error(
          `LOCAL_ONLY_V2 no encontró evidencia para ${block.blockId}.`,
        );
      }
      return collectionPlan(block, baselinePacket, exhaustivePacket, policy);
    });

  const withoutFingerprint = {
    pipelineId: "LOCAL_ONLY_V2" as const,
    schemaVersion: LOCAL_ONLY_V2_ARRAY_BATCH_SCHEMA_VERSION,
    projectId: knowledge.projectId,
    knowledgeFingerprint: knowledge.fingerprint,
    templatePlanFingerprint: plan.planFingerprint,
    evidenceSelectionSchemaVersion: baseline.schemaVersion,
    policy,
    collections: Object.freeze(collections),
  };

  return Object.freeze({
    ...withoutFingerprint,
    fingerprint: sha256(
      JSON.stringify({
        schemaVersion: withoutFingerprint.schemaVersion,
        projectId: withoutFingerprint.projectId,
        knowledgeFingerprint: withoutFingerprint.knowledgeFingerprint,
        templatePlanFingerprint: withoutFingerprint.templatePlanFingerprint,
        policy,
        collectionFingerprints: collections.map(
          (collection) => collection.fingerprint,
        ),
      }),
    ),
  });
}

/** Uses the same partitioner for any large active point, without selecting future points. */
export function batchLocalOnlyV2ProcessingPacket(
  block: LocalOnlyV2TemplateGenerationBlock,
  packet: LocalOnlyV2BlockEvidencePacket,
  policy: LocalOnlyV2ArrayBatchPolicy = LOCAL_ONLY_V2_DEFAULT_ARRAY_BATCH_POLICY,
): LocalOnlyV2CollectionBatchPlan {
  if (block.blockId !== packet.blockId || block.sectionKey !== packet.sectionKey) {
    throw new Error("LOCAL_ONLY_V2: paquete ajeno al punto a subdividir.");
  }
  return collectionPlan(block, packet, packet, validatePolicy(policy));
}
