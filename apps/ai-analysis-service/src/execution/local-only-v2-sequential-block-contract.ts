// LOCAL_ONLY_V2_NEW_STEP_01_SEQUENTIAL_BLOCK_CONTRACT
//
// Nuevo Paso 1: la sección real de la plantilla es la unidad principal de
// ejecución. Este archivo define únicamente el contrato/estado secuencial.
//
// NO:
// - selecciona evidencia;
// - llama modelos;
// - conecta Ollama;
// - persiste checkpoints;
// - ensambla documento;
// - cambia otros modos.
//
// Reutiliza los bloques ya construidos por local-only-v2-template-planner.

import type { LocalOnlyV2TemplateGenerationPlan } from "./local-only-v2-template-planner";

export const LOCAL_ONLY_V2_SEQUENTIAL_BLOCK_SCHEMA_VERSION = "1.0.0" as const;

export const LOCAL_ONLY_V2_BLOCK_STATUSES = [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type LocalOnlyV2BlockStatus =
  (typeof LOCAL_ONLY_V2_BLOCK_STATUSES)[number];

export interface LocalOnlyV2SequentialBlockState {
  readonly blockId: string;
  readonly blockNumber: number;
  readonly blockTotal: number;
  readonly sectionKey: string;
  readonly sectionOrder: number;
  readonly title: string;
  readonly required: boolean;
  readonly guidance: string;
  readonly status: LocalOnlyV2BlockStatus;
}

export interface LocalOnlyV2SequentialBlockExecution {
  readonly pipelineId: "LOCAL_ONLY_V2";
  readonly schemaVersion: typeof LOCAL_ONLY_V2_SEQUENTIAL_BLOCK_SCHEMA_VERSION;
  readonly templatePlanFingerprint: string;
  readonly blockTotal: number;
  readonly completedCount: number;
  readonly activeBlockId: string | null;
  readonly blocks: readonly LocalOnlyV2SequentialBlockState[];
}

function isBlockStatus(value: string): value is LocalOnlyV2BlockStatus {
  return (LOCAL_ONLY_V2_BLOCK_STATUSES as readonly string[]).includes(value);
}

function freezeExecution(
  execution: Omit<LocalOnlyV2SequentialBlockExecution, "blocks"> & {
    readonly blocks: readonly LocalOnlyV2SequentialBlockState[];
  },
): LocalOnlyV2SequentialBlockExecution {
  const blocks = Object.freeze(
    execution.blocks.map((block) => Object.freeze({ ...block })),
  );

  return Object.freeze({
    ...execution,
    blocks,
  });
}

function validateExecution(
  execution: LocalOnlyV2SequentialBlockExecution,
): void {
  if (execution.pipelineId !== "LOCAL_ONLY_V2") {
    throw new Error(
      "El contrato secuencial acepta únicamente el pipeline LOCAL_ONLY_V2.",
    );
  }

  if (execution.blocks.length < 1) {
    throw new Error(
      "El contrato secuencial requiere al menos un punto de plantilla.",
    );
  }

  if (execution.blockTotal !== execution.blocks.length) {
    throw new Error(
      "El total del contrato secuencial no coincide con sus puntos.",
    );
  }

  const seenIds = new Set<string>();
  let processingCount = 0;
  let processingId: string | null = null;
  let completedPrefix = 0;
  let foundIncomplete = false;

  execution.blocks.forEach((block, index) => {
    const expectedNumber = index + 1;

    if (!block.blockId.trim()) {
      throw new Error("Existe un punto secuencial sin blockId.");
    }
    if (seenIds.has(block.blockId)) {
      throw new Error(
        `Existe un blockId duplicado en el contrato secuencial: ${block.blockId}.`,
      );
    }
    seenIds.add(block.blockId);

    if (
      block.blockNumber !== expectedNumber ||
      block.sectionOrder !== expectedNumber
    ) {
      throw new Error(
        `Orden secuencial inválido en ${block.blockId}; se esperaba ${expectedNumber}.`,
      );
    }

    if (block.blockTotal !== execution.blockTotal) {
      throw new Error(
        `blockTotal inconsistente en ${block.blockId}.`,
      );
    }

    if (!isBlockStatus(block.status)) {
      throw new Error(
        `Estado secuencial inválido en ${block.blockId}: ${String(block.status)}.`,
      );
    }

    if (block.status === "PROCESSING") {
      processingCount += 1;
      processingId = block.blockId;
    }

    if (!foundIncomplete && block.status === "COMPLETED") {
      completedPrefix += 1;
      return;
    }

    if (block.status !== "COMPLETED") {
      foundIncomplete = true;
      return;
    }

    throw new Error(
      `Secuencia inválida: ${block.blockId} está COMPLETED después de un punto incompleto.`,
    );
  });

  if (processingCount > 1) {
    throw new Error(
      "LOCAL_ONLY_V2 no permite dos puntos principales en PROCESSING simultáneamente.",
    );
  }

  if (processingCount === 1) {
    const firstIncomplete = execution.blocks[completedPrefix];
    if (!firstIncomplete || firstIncomplete.status !== "PROCESSING") {
      throw new Error(
        "El único punto PROCESSING debe ser exactamente el primer punto no completado.",
      );
    }
  }

  if (execution.activeBlockId !== processingId) {
    throw new Error(
      "activeBlockId no coincide con el punto que está PROCESSING.",
    );
  }

  if (execution.completedCount !== completedPrefix) {
    throw new Error(
      "completedCount no coincide con el prefijo continuo de puntos COMPLETED.",
    );
  }
}

function requireBlockIndex(
  execution: LocalOnlyV2SequentialBlockExecution,
  blockId: string,
): number {
  const index = execution.blocks.findIndex((block) => block.blockId === blockId);
  if (index < 0) {
    throw new Error(`Punto desconocido en LOCAL_ONLY_V2: ${blockId}.`);
  }
  return index;
}

function replaceBlockStatus(
  execution: LocalOnlyV2SequentialBlockExecution,
  index: number,
  status: LocalOnlyV2BlockStatus,
): LocalOnlyV2SequentialBlockExecution {
  const current = execution.blocks[index];
  if (!current) {
    throw new Error(`Índice de punto fuera de rango: ${index}.`);
  }

  const blocks = execution.blocks.map((block, currentIndex) =>
    currentIndex === index
      ? Object.freeze({
          ...block,
          status,
        })
      : block,
  );

  const activeBlock =
    status === "PROCESSING"
      ? blocks[index]
      : blocks.find((block) => block.status === "PROCESSING");

  const completedCount = blocks.findIndex(
    (block) => block.status !== "COMPLETED",
  );

  const next = freezeExecution({
    pipelineId: "LOCAL_ONLY_V2",
    schemaVersion: LOCAL_ONLY_V2_SEQUENTIAL_BLOCK_SCHEMA_VERSION,
    templatePlanFingerprint: execution.templatePlanFingerprint,
    blockTotal: execution.blockTotal,
    completedCount:
      completedCount < 0 ? blocks.length : completedCount,
    activeBlockId: activeBlock?.blockId ?? null,
    blocks,
  });

  validateExecution(next);
  return next;
}

export function createLocalOnlyV2SequentialBlockExecution(
  plan: LocalOnlyV2TemplateGenerationPlan,
): LocalOnlyV2SequentialBlockExecution {
  if (plan.pipelineId !== "LOCAL_ONLY_V2") {
    throw new Error(
      "El contrato secuencial acepta únicamente planes LOCAL_ONLY_V2.",
    );
  }

  if (plan.blocks.length < 1) {
    throw new Error(
      "LOCAL_ONLY_V2 recibió una plantilla sin puntos para ejecutar.",
    );
  }

  const blockTotal = plan.blocks.length;

  const blocks = plan.blocks.map((block, index) => {
    const expectedNumber = index + 1;

    if (
      block.blockNumber !== expectedNumber ||
      block.sectionOrder !== expectedNumber ||
      block.blockTotal !== blockTotal
    ) {
      throw new Error(
        `El planner entregó un orden inconsistente en ${block.blockId}.`,
      );
    }

    return Object.freeze({
      blockId: block.blockId,
      blockNumber: block.blockNumber,
      blockTotal,
      sectionKey: block.sectionKey,
      sectionOrder: block.sectionOrder,
      title: block.title,
      required: block.required,
      guidance: block.guidance,
      status: "PENDING" as const,
    });
  });

  const execution = freezeExecution({
    pipelineId: "LOCAL_ONLY_V2",
    schemaVersion: LOCAL_ONLY_V2_SEQUENTIAL_BLOCK_SCHEMA_VERSION,
    templatePlanFingerprint: plan.planFingerprint,
    blockTotal,
    completedCount: 0,
    activeBlockId: null,
    blocks,
  });

  validateExecution(execution);
  return execution;
}

export function getLocalOnlyV2NextExecutableBlock(
  execution: LocalOnlyV2SequentialBlockExecution,
): LocalOnlyV2SequentialBlockState | null {
  validateExecution(execution);

  if (execution.activeBlockId !== null) {
    return null;
  }

  const firstIncomplete = execution.blocks[execution.completedCount];
  if (!firstIncomplete) {
    return null;
  }

  if (
    firstIncomplete.status === "PENDING" ||
    firstIncomplete.status === "FAILED"
  ) {
    return firstIncomplete;
  }

  return null;
}

export function beginLocalOnlyV2Block(
  execution: LocalOnlyV2SequentialBlockExecution,
  blockId: string,
): LocalOnlyV2SequentialBlockExecution {
  validateExecution(execution);

  if (execution.activeBlockId !== null) {
    throw new Error(
      `Ya existe un punto PROCESSING: ${execution.activeBlockId}.`,
    );
  }

  const index = requireBlockIndex(execution, blockId);
  const expectedIndex = execution.completedCount;

  if (index !== expectedIndex) {
    const expected = execution.blocks[expectedIndex];
    throw new Error(
      `No se puede iniciar ${blockId}; primero debe terminar ${expected?.blockId ?? "el punto anterior"}.`,
    );
  }

  const block = execution.blocks[index];
  if (!block) {
    throw new Error(`No existe el punto solicitado: ${blockId}.`);
  }

  if (block.status === "CANCELLED") {
    throw new Error(
      `El punto ${blockId} está CANCELLED y no puede continuar automáticamente.`,
    );
  }

  if (block.status !== "PENDING" && block.status !== "FAILED") {
    throw new Error(
      `El punto ${blockId} no puede pasar de ${block.status} a PROCESSING.`,
    );
  }

  return replaceBlockStatus(execution, index, "PROCESSING");
}

export function completeLocalOnlyV2Block(
  execution: LocalOnlyV2SequentialBlockExecution,
  blockId: string,
): LocalOnlyV2SequentialBlockExecution {
  validateExecution(execution);

  const index = requireBlockIndex(execution, blockId);
  const block = execution.blocks[index];

  if (
    !block ||
    execution.activeBlockId !== blockId ||
    block.status !== "PROCESSING"
  ) {
    throw new Error(
      `Solo el punto actualmente PROCESSING puede marcarse COMPLETED: ${blockId}.`,
    );
  }

  return replaceBlockStatus(execution, index, "COMPLETED");
}

export function failLocalOnlyV2Block(
  execution: LocalOnlyV2SequentialBlockExecution,
  blockId: string,
): LocalOnlyV2SequentialBlockExecution {
  validateExecution(execution);

  const index = requireBlockIndex(execution, blockId);
  const block = execution.blocks[index];

  if (
    !block ||
    execution.activeBlockId !== blockId ||
    block.status !== "PROCESSING"
  ) {
    throw new Error(
      `Solo el punto actualmente PROCESSING puede marcarse FAILED: ${blockId}.`,
    );
  }

  return replaceBlockStatus(execution, index, "FAILED");
}

export function cancelLocalOnlyV2Block(
  execution: LocalOnlyV2SequentialBlockExecution,
  blockId: string,
): LocalOnlyV2SequentialBlockExecution {
  validateExecution(execution);

  const index = requireBlockIndex(execution, blockId);
  const block = execution.blocks[index];

  if (
    !block ||
    execution.activeBlockId !== blockId ||
    block.status !== "PROCESSING"
  ) {
    throw new Error(
      `Solo el punto actualmente PROCESSING puede marcarse CANCELLED: ${blockId}.`,
    );
  }

  return replaceBlockStatus(execution, index, "CANCELLED");
}
