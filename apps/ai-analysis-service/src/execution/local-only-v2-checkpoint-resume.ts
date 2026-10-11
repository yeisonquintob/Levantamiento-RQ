// LOCAL_ONLY_V2_13_CHECKPOINT_RESUME
//
// Contrato persistible y reanudación determinística para V2.
//
// No introduce entidad TypeORM ni migración:
// la persistencia física queda detrás de LocalOnlyV2CheckpointStore.
// Esto evita reutilizar a la fuerza LocalDraftBlockCheckpoints (schema 4.1/stages).
//
// Regla principal:
// solo se reutiliza un prefijo CONTIGUO de unidades completadas e íntegras.
// El primer checkpoint faltante/incompatible/corrupto define resumeFromUnitId.
// Desde ese punto, las unidades posteriores vuelven a quedar pendientes.

import { omitKey, requireDefined } from "../common/require-defined";
import { createHash } from "node:crypto";

import type {
  LocalOnlyV2ArrayBatchPlan,
  LocalOnlyV2CollectionBatchPlan,
} from "./local-only-v2-array-batches";
import type { LocalOnlyV2EvidenceSelectionPlan } from "./local-only-v2-evidence-selector";
import type { LocalOnlyV2TemplateGenerationPlan } from "./local-only-v2-template-planner";

export const LOCAL_ONLY_V2_CHECKPOINT_SCHEMA_VERSION = "1.0.0" as const;

export type LocalOnlyV2ExecutionUnitKind = "MICRO_BLOCK" | "ARRAY_BATCH";

export interface LocalOnlyV2ExecutionUnit {
  readonly unitId: string;
  readonly unitKind: LocalOnlyV2ExecutionUnitKind;
  readonly unitNumber: number;
  readonly unitTotal: number;
  readonly blockId: string;
  readonly sectionKey: string;
  readonly blockNumber: number;
  readonly blockTotal: number;
  readonly batchNumber: number | null;
  readonly batchTotal: number | null;
  readonly inputFingerprint: string;
}

export interface LocalOnlyV2ExecutionPlan {
  readonly pipelineId: "LOCAL_ONLY_V2";
  readonly schemaVersion: typeof LOCAL_ONLY_V2_CHECKPOINT_SCHEMA_VERSION;
  readonly projectId: string;
  readonly templatePlanFingerprint: string;
  readonly units: readonly LocalOnlyV2ExecutionUnit[];
  readonly fingerprint: string;
}

export interface LocalOnlyV2CompletedCheckpoint {
  readonly pipelineId: "LOCAL_ONLY_V2";
  readonly schemaVersion: typeof LOCAL_ONLY_V2_CHECKPOINT_SCHEMA_VERSION;
  readonly projectId: string;
  readonly templatePlanFingerprint: string;
  readonly unitId: string;
  readonly unitKind: LocalOnlyV2ExecutionUnitKind;
  readonly unitNumber: number;
  readonly unitTotal: number;
  readonly blockId: string;
  readonly sectionKey: string;
  readonly blockNumber: number;
  readonly blockTotal: number;
  readonly batchNumber: number | null;
  readonly batchTotal: number | null;
  readonly inputFingerprint: string;
  readonly outputFingerprint: string;
  readonly payloadJson: string;
  readonly payloadSha256: string;
  readonly completedAtIso: string;
  readonly checkpointFingerprint: string;
}

export type LocalOnlyV2CheckpointInvalidReason =
  | "ORPHAN_UNIT"
  | "PIPELINE_MISMATCH"
  | "SCHEMA_MISMATCH"
  | "PROJECT_MISMATCH"
  | "PLAN_MISMATCH"
  | "UNIT_METADATA_MISMATCH"
  | "INPUT_CHANGED"
  | "PAYLOAD_CORRUPT"
  | "OUTPUT_FINGERPRINT_MISSING"
  | "CHECKPOINT_FINGERPRINT_MISMATCH"
  | "AFTER_RESUME_POINT";

export interface LocalOnlyV2InvalidatedCheckpoint {
  readonly unitId: string;
  readonly reason: LocalOnlyV2CheckpointInvalidReason;
}

export interface LocalOnlyV2ResumedUnit {
  readonly unit: LocalOnlyV2ExecutionUnit;
  readonly checkpoint: LocalOnlyV2CompletedCheckpoint;
  readonly payload: unknown;
}

export interface LocalOnlyV2ResumePlan {
  readonly pipelineId: "LOCAL_ONLY_V2";
  readonly projectId: string;
  readonly templatePlanFingerprint: string;
  readonly resumedUnits: readonly LocalOnlyV2ResumedUnit[];
  readonly pendingUnits: readonly LocalOnlyV2ExecutionUnit[];
  readonly invalidatedCheckpoints: readonly LocalOnlyV2InvalidatedCheckpoint[];
  readonly resumeFromUnitId: string | null;
  readonly completedPrefixCount: number;
  readonly totalUnits: number;
  readonly complete: boolean;
}

export interface LocalOnlyV2CheckpointStore {
  load(
    projectId: string,
    templatePlanFingerprint: string,
  ): Promise<readonly LocalOnlyV2CompletedCheckpoint[]>;
  upsert(checkpoint: LocalOnlyV2CompletedCheckpoint): Promise<void>;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalUnit(
  unit: LocalOnlyV2ExecutionUnit,
): Readonly<Record<string, unknown>> {
  return {
    unitId: unit.unitId,
    unitKind: unit.unitKind,
    unitNumber: unit.unitNumber,
    unitTotal: unit.unitTotal,
    blockId: unit.blockId,
    sectionKey: unit.sectionKey,
    blockNumber: unit.blockNumber,
    blockTotal: unit.blockTotal,
    batchNumber: unit.batchNumber,
    batchTotal: unit.batchTotal,
    inputFingerprint: unit.inputFingerprint,
  };
}

function collectionByBlock(
  batchPlan: LocalOnlyV2ArrayBatchPlan,
): ReadonlyMap<string, LocalOnlyV2CollectionBatchPlan> {
  const map = new Map<string, LocalOnlyV2CollectionBatchPlan>();
  for (const collection of batchPlan.collections) {
    if (map.has(collection.blockId)) {
      throw new Error(
        `LOCAL_ONLY_V2 recibió una colección duplicada: ${collection.blockId}.`,
      );
    }
    map.set(collection.blockId, collection);
  }
  return map;
}

export function buildLocalOnlyV2ExecutionPlan(
  plan: LocalOnlyV2TemplateGenerationPlan,
  evidence: LocalOnlyV2EvidenceSelectionPlan,
  batchPlan: LocalOnlyV2ArrayBatchPlan,
): LocalOnlyV2ExecutionPlan {
  if (
    plan.pipelineId !== "LOCAL_ONLY_V2" ||
    evidence.pipelineId !== "LOCAL_ONLY_V2" ||
    batchPlan.pipelineId !== "LOCAL_ONLY_V2"
  ) {
    throw new Error("Paso 13 acepta únicamente artefactos LOCAL_ONLY_V2.");
  }
  if (
    evidence.projectId !== plan.knowledge.projectId ||
    batchPlan.projectId !== plan.knowledge.projectId
  ) {
    throw new Error(
      "LOCAL_ONLY_V2 detectó projectId inconsistente en Paso 13.",
    );
  }
  if (
    evidence.templatePlanFingerprint !== plan.planFingerprint ||
    batchPlan.templatePlanFingerprint !== plan.planFingerprint
  ) {
    throw new Error(
      "LOCAL_ONLY_V2 detectó templatePlanFingerprint inconsistente en Paso 13.",
    );
  }

  const evidenceByBlock = new Map(
    evidence.blocks.map((packet) => [packet.blockId, packet]),
  );
  const collections = collectionByBlock(batchPlan);
  const provisional: Omit<
    LocalOnlyV2ExecutionUnit,
    "unitNumber" | "unitTotal"
  >[] = [];

  for (const block of plan.blocks) {
    const packet = evidenceByBlock.get(block.blockId);
    if (!packet) {
      throw new Error(
        `LOCAL_ONLY_V2 no encontró evidencia del Paso 9 para ${block.blockId}.`,
      );
    }

    const collection = collections.get(block.blockId);
    if (collection) {
      if (collection.batches.length === 0) {
        throw new Error(
          `LOCAL_ONLY_V2 recibió una colección sin lotes: ${block.blockId}.`,
        );
      }
      for (const batch of collection.batches) {
        provisional.push({
          unitId: batch.batchId,
          unitKind: "ARRAY_BATCH",
          blockId: block.blockId,
          sectionKey: block.sectionKey,
          blockNumber: block.blockNumber,
          blockTotal: block.blockTotal,
          batchNumber: batch.batchNumber,
          batchTotal: batch.batchTotal,
          inputFingerprint: batch.fingerprint,
        });
      }
      continue;
    }

    provisional.push({
      unitId: `micro-draft:${block.blockId}`,
      unitKind: "MICRO_BLOCK",
      blockId: block.blockId,
      sectionKey: block.sectionKey,
      blockNumber: block.blockNumber,
      blockTotal: block.blockTotal,
      batchNumber: null,
      batchTotal: null,
      inputFingerprint: packet.fingerprint,
    });
  }

  const unitTotal = provisional.length;
  const units = provisional.map((unit, index) =>
    Object.freeze({
      ...unit,
      unitNumber: index + 1,
      unitTotal,
    }),
  );

  const duplicateIds = units.filter(
    (unit, index) =>
      units.findIndex((candidate) => candidate.unitId === unit.unitId) !==
      index,
  );
  if (duplicateIds.length > 0) {
    throw new Error(
      `LOCAL_ONLY_V2 produjo unitId duplicado: ${requireDefined(duplicateIds[0], "Invariante: existe un unitId duplicado.").unitId}.`,
    );
  }

  const withoutFingerprint = {
    pipelineId: "LOCAL_ONLY_V2" as const,
    schemaVersion: LOCAL_ONLY_V2_CHECKPOINT_SCHEMA_VERSION,
    projectId: plan.knowledge.projectId,
    templatePlanFingerprint: plan.planFingerprint,
    units: Object.freeze(units),
  };

  return Object.freeze({
    ...withoutFingerprint,
    fingerprint: sha256(
      JSON.stringify({
        schemaVersion: withoutFingerprint.schemaVersion,
        projectId: withoutFingerprint.projectId,
        templatePlanFingerprint: withoutFingerprint.templatePlanFingerprint,
        units: units.map(canonicalUnit),
      }),
    ),
  });
}

function checkpointFingerprint(
  checkpoint: Omit<LocalOnlyV2CompletedCheckpoint, "checkpointFingerprint">,
): string {
  return sha256(
    JSON.stringify({
      pipelineId: checkpoint.pipelineId,
      schemaVersion: checkpoint.schemaVersion,
      projectId: checkpoint.projectId,
      templatePlanFingerprint: checkpoint.templatePlanFingerprint,
      unitId: checkpoint.unitId,
      unitKind: checkpoint.unitKind,
      unitNumber: checkpoint.unitNumber,
      unitTotal: checkpoint.unitTotal,
      blockId: checkpoint.blockId,
      sectionKey: checkpoint.sectionKey,
      blockNumber: checkpoint.blockNumber,
      blockTotal: checkpoint.blockTotal,
      batchNumber: checkpoint.batchNumber,
      batchTotal: checkpoint.batchTotal,
      inputFingerprint: checkpoint.inputFingerprint,
      outputFingerprint: checkpoint.outputFingerprint,
      payloadSha256: checkpoint.payloadSha256,
      completedAtIso: checkpoint.completedAtIso,
    }),
  );
}

export function createLocalOnlyV2CompletedCheckpoint(
  executionPlan: LocalOnlyV2ExecutionPlan,
  unit: LocalOnlyV2ExecutionUnit,
  payload: unknown,
  outputFingerprint: string,
  completedAtIso: string,
): LocalOnlyV2CompletedCheckpoint {
  const expected = executionPlan.units.find(
    (candidate) => candidate.unitId === unit.unitId,
  );
  if (
    !expected ||
    JSON.stringify(canonicalUnit(expected)) !==
      JSON.stringify(canonicalUnit(unit))
  ) {
    throw new Error(
      `LOCAL_ONLY_V2 no permite checkpoint de una unidad ajena al plan: ${unit.unitId}.`,
    );
  }
  if (!/^[0-9a-f]{64}$/u.test(outputFingerprint)) {
    throw new Error(
      "LOCAL_ONLY_V2 requiere outputFingerprint SHA-256 para checkpoint.",
    );
  }
  if (!Number.isFinite(Date.parse(completedAtIso))) {
    throw new Error("LOCAL_ONLY_V2 requiere completedAtIso válido.");
  }

  const payloadJson = JSON.stringify(payload);
  if (payloadJson === undefined) {
    throw new Error(
      "LOCAL_ONLY_V2 no puede serializar el payload del checkpoint.",
    );
  }
  const payloadSha256 = sha256(payloadJson);

  const withoutFingerprint = {
    pipelineId: "LOCAL_ONLY_V2" as const,
    schemaVersion: LOCAL_ONLY_V2_CHECKPOINT_SCHEMA_VERSION,
    projectId: executionPlan.projectId,
    templatePlanFingerprint: executionPlan.templatePlanFingerprint,
    ...canonicalUnit(unit),
    outputFingerprint,
    payloadJson,
    payloadSha256,
    completedAtIso,
  } as Omit<LocalOnlyV2CompletedCheckpoint, "checkpointFingerprint">;

  return Object.freeze({
    ...withoutFingerprint,
    checkpointFingerprint: checkpointFingerprint(withoutFingerprint),
  });
}

function metadataMatches(
  unit: LocalOnlyV2ExecutionUnit,
  checkpoint: LocalOnlyV2CompletedCheckpoint,
): boolean {
  return (
    checkpoint.unitKind === unit.unitKind &&
    checkpoint.unitNumber === unit.unitNumber &&
    checkpoint.unitTotal === unit.unitTotal &&
    checkpoint.blockId === unit.blockId &&
    checkpoint.sectionKey === unit.sectionKey &&
    checkpoint.blockNumber === unit.blockNumber &&
    checkpoint.blockTotal === unit.blockTotal &&
    checkpoint.batchNumber === unit.batchNumber &&
    checkpoint.batchTotal === unit.batchTotal
  );
}

function checkpointIssue(
  executionPlan: LocalOnlyV2ExecutionPlan,
  unit: LocalOnlyV2ExecutionUnit,
  checkpoint: LocalOnlyV2CompletedCheckpoint,
): LocalOnlyV2CheckpointInvalidReason | null {
  if (checkpoint.pipelineId !== "LOCAL_ONLY_V2") return "PIPELINE_MISMATCH";
  if (checkpoint.schemaVersion !== LOCAL_ONLY_V2_CHECKPOINT_SCHEMA_VERSION)
    return "SCHEMA_MISMATCH";
  if (checkpoint.projectId !== executionPlan.projectId)
    return "PROJECT_MISMATCH";
  if (
    checkpoint.templatePlanFingerprint !== executionPlan.templatePlanFingerprint
  )
    return "PLAN_MISMATCH";
  if (!metadataMatches(unit, checkpoint)) return "UNIT_METADATA_MISMATCH";
  if (checkpoint.inputFingerprint !== unit.inputFingerprint)
    return "INPUT_CHANGED";
  if (!/^[0-9a-f]{64}$/u.test(checkpoint.outputFingerprint))
    return "OUTPUT_FINGERPRINT_MISSING";
  if (sha256(checkpoint.payloadJson) !== checkpoint.payloadSha256)
    return "PAYLOAD_CORRUPT";

  const withoutFingerprint = omitKey(checkpoint, "checkpointFingerprint");
  if (
    checkpoint.checkpointFingerprint !==
    checkpointFingerprint(withoutFingerprint)
  )
    return "CHECKPOINT_FINGERPRINT_MISMATCH";

  try {
    JSON.parse(checkpoint.payloadJson);
  } catch {
    return "PAYLOAD_CORRUPT";
  }
  return null;
}

export function buildLocalOnlyV2ResumePlan(
  executionPlan: LocalOnlyV2ExecutionPlan,
  checkpoints: readonly LocalOnlyV2CompletedCheckpoint[],
): LocalOnlyV2ResumePlan {
  const checkpointByUnit = new Map<string, LocalOnlyV2CompletedCheckpoint>();

  for (const checkpoint of checkpoints) {
    if (checkpointByUnit.has(checkpoint.unitId)) {
      throw new Error(
        `LOCAL_ONLY_V2 recibió checkpoint duplicado para ${checkpoint.unitId}.`,
      );
    }
    checkpointByUnit.set(checkpoint.unitId, checkpoint);
  }

  const knownUnitIds = new Set(executionPlan.units.map((unit) => unit.unitId));
  const invalidated: LocalOnlyV2InvalidatedCheckpoint[] = checkpoints
    .filter((checkpoint) => !knownUnitIds.has(checkpoint.unitId))
    .map((checkpoint) =>
      Object.freeze({
        unitId: checkpoint.unitId,
        reason: "ORPHAN_UNIT" as const,
      }),
    );

  const resumed: LocalOnlyV2ResumedUnit[] = [];
  let resumeIndex = executionPlan.units.length;

  for (let index = 0; index < executionPlan.units.length; index += 1) {
    const unit = requireDefined(
      executionPlan.units[index],
      "Invariante: el índice de unidad está dentro del plan.",
    );
    const checkpoint = checkpointByUnit.get(unit.unitId);
    if (!checkpoint) {
      resumeIndex = index;
      break;
    }
    const reason = checkpointIssue(executionPlan, unit, checkpoint);
    if (reason) {
      invalidated.push(Object.freeze({ unitId: unit.unitId, reason }));
      resumeIndex = index;
      break;
    }
    resumed.push(
      Object.freeze({
        unit,
        checkpoint,
        payload: JSON.parse(checkpoint.payloadJson) as unknown,
      }),
    );
  }

  if (resumeIndex < executionPlan.units.length) {
    for (
      let index = resumeIndex + 1;
      index < executionPlan.units.length;
      index += 1
    ) {
      const later = requireDefined(
        executionPlan.units[index],
        "Invariante: el índice de unidad posterior está dentro del plan.",
      );
      if (checkpointByUnit.has(later.unitId)) {
        invalidated.push(
          Object.freeze({
            unitId: later.unitId,
            reason: "AFTER_RESUME_POINT" as const,
          }),
        );
      }
    }
  }

  const pendingUnits = Object.freeze(executionPlan.units.slice(resumeIndex));
  const resumeFromUnitId = pendingUnits[0]?.unitId ?? null;

  return Object.freeze({
    pipelineId: "LOCAL_ONLY_V2" as const,
    projectId: executionPlan.projectId,
    templatePlanFingerprint: executionPlan.templatePlanFingerprint,
    resumedUnits: Object.freeze(resumed),
    pendingUnits,
    invalidatedCheckpoints: Object.freeze(invalidated),
    resumeFromUnitId,
    completedPrefixCount: resumed.length,
    totalUnits: executionPlan.units.length,
    complete: pendingUnits.length === 0,
  });
}

export async function persistLocalOnlyV2Checkpoint(
  store: LocalOnlyV2CheckpointStore,
  checkpoint: LocalOnlyV2CompletedCheckpoint,
): Promise<void> {
  const payloadSha = sha256(checkpoint.payloadJson);
  const withoutFingerprint = omitKey(checkpoint, "checkpointFingerprint");
  if (
    payloadSha !== checkpoint.payloadSha256 ||
    checkpoint.checkpointFingerprint !==
      checkpointFingerprint(withoutFingerprint)
  ) {
    throw new Error(
      `LOCAL_ONLY_V2 rechazó persistir checkpoint corrupto: ${checkpoint.unitId}.`,
    );
  }
  await store.upsert(checkpoint);
}

export async function loadLocalOnlyV2ResumePlan(
  store: LocalOnlyV2CheckpointStore,
  executionPlan: LocalOnlyV2ExecutionPlan,
): Promise<LocalOnlyV2ResumePlan> {
  const checkpoints = await store.load(
    executionPlan.projectId,
    executionPlan.templatePlanFingerprint,
  );
  return buildLocalOnlyV2ResumePlan(executionPlan, checkpoints);
}

/** Point envelope stored in the existing checkpoint JSON column. */
export interface LocalOnlyV2PointCheckpoint {
  readonly pipelineId: "LOCAL_ONLY_V2";
  readonly projectId: string;
  readonly templatePlanFingerprint: string;
  readonly blockId: string;
  readonly blockNumber: number;
  readonly blockTotal: number;
  readonly sectionKey: string;
  readonly status: "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";
  readonly inputFingerprint: string;
  readonly outputFingerprint: string | null;
  readonly payload: readonly unknown[];
  readonly completedAt: string | null;
  readonly units: readonly LocalOnlyV2CompletedCheckpoint[];
  /**
   * Título legible del punto (por ejemplo "Diagrama de flujo"), solo para
   * observabilidad del monitor de progreso. Opcional y sin efecto en la
   * reanudación: buildLocalOnlyV2ResumePlan/validateLocalOnlyV2... nunca lo
   * leen, así que un checkpoint histórico sin este campo sigue siendo
   * válido y se degrada a sectionKey en la presentación.
   */
  readonly title?: string;
}

export interface LocalOnlyV2PointCheckpointStore {
  load(blockId: string): Promise<LocalOnlyV2PointCheckpoint | null>;
  save(checkpoint: LocalOnlyV2PointCheckpoint): Promise<void>;
}

export function buildLocalOnlyV2PointUnitPlan(
  plan: LocalOnlyV2TemplateGenerationPlan,
  block: LocalOnlyV2TemplateGenerationPlan["blocks"][number],
  fingerprints: readonly string[],
): LocalOnlyV2ExecutionPlan {
  const units = fingerprints.map((fingerprint, index): LocalOnlyV2ExecutionUnit => ({
    unitId: `${block.blockId}:unit:${index + 1}`, unitKind: "MICRO_BLOCK",
    unitNumber: index + 1, unitTotal: fingerprints.length,
    blockId: block.blockId, blockNumber: block.blockNumber, blockTotal: block.blockTotal,
    sectionKey: block.sectionKey, batchNumber: null, batchTotal: null,
    inputFingerprint: fingerprint,
  }));
  return { pipelineId: "LOCAL_ONLY_V2", schemaVersion: LOCAL_ONLY_V2_CHECKPOINT_SCHEMA_VERSION,
    projectId: plan.knowledge.projectId, templatePlanFingerprint: plan.planFingerprint,
    units, fingerprint: sha256(JSON.stringify(units)) };
}
