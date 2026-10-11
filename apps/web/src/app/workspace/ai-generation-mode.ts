import type { AiEngine } from "@levantamiento-rq/shared-contracts";

// Los tres modos canónicos de procesamiento. No existe un cuarto modo ni una
// combinación distinta: LOCAL, LOCAL+CLOUD o CLOUD.
export type AiGenerationMode = "LOCAL_ONLY" | "LOCAL_CLOUD" | "CLOUD_ONLY";

/** Resuelve el modo a partir de un conjunto de motores. Sin motores → null. */
export function resolveAiGenerationMode(
  engines: readonly AiEngine[] | null | undefined,
): AiGenerationMode | null {
  const hasLocal = Boolean(engines?.includes("LOCAL"));
  const hasCloud = Boolean(engines?.includes("CLOUD"));
  if (hasLocal && hasCloud) return "LOCAL_CLOUD";
  if (hasLocal) return "LOCAL_ONLY";
  if (hasCloud) return "CLOUD_ONLY";
  return null;
}

interface TrackedGenerationModeSource {
  readonly processing?: { readonly engines?: readonly AiEngine[] } | null;
  readonly engines?: readonly AiEngine[];
  readonly useLocalAi?: boolean;
  readonly useCloudAi?: boolean;
}

/**
 * Resuelve el modo REALMENTE ejecutado por una solicitud, con esta
 * prioridad de fuentes:
 * 1. trackedGeneration.processing.engines (motores persistidos en curso).
 * 2. trackedGeneration.engines (motores persistidos del resumen).
 * 3. useLocalAi/useCloudAi (indicadores originales de la solicitud).
 * 4. El selector actual, EXCLUSIVAMENTE cuando todavía no existe una
 *    solicitud seguida (hasTrackedRequest === false).
 *
 * El selector actual NUNCA se usa para una solicitud ya iniciada (en cola,
 * en proceso, completada, fallida o cancelada): cambiarlo después de haber
 * iniciado una generación no puede alterar el modo mostrado para ella.
 */
export function resolveTrackedGenerationMode(
  tracked: TrackedGenerationModeSource | null | undefined,
  selectorEngines: readonly AiEngine[],
): AiGenerationMode | null {
  if (tracked) {
    const fromProcessing = resolveAiGenerationMode(tracked.processing?.engines);
    if (fromProcessing) return fromProcessing;

    const fromSummary = resolveAiGenerationMode(tracked.engines);
    if (fromSummary) return fromSummary;

    if (tracked.useLocalAi !== undefined || tracked.useCloudAi !== undefined) {
      const fromFlags = resolveAiGenerationMode([
        ...(tracked.useLocalAi ? (["LOCAL"] as const) : []),
        ...(tracked.useCloudAi ? (["CLOUD"] as const) : []),
      ]);
      if (fromFlags) return fromFlags;
    }

    // Existe una solicitud seguida pero ninguna fuente persistida identificó
    // el modo todavía (por ejemplo, justo al crearla): no se adivina con el
    // selector actual, que puede cambiar libremente sin afectar esta
    // solicitud.
    return null;
  }

  return resolveAiGenerationMode(selectorEngines);
}

const MODE_LABELS: Readonly<Record<AiGenerationMode, string>> = {
  LOCAL_ONLY: "IA local",
  LOCAL_CLOUD: "Híbrido",
  CLOUD_ONLY: "IA nube",
};

export function aiGenerationModeLabel(mode: AiGenerationMode | null): string {
  return mode ? MODE_LABELS[mode] : "IA no registrada";
}

/** Descripción secundaria, solo para el modo híbrido. */
export function aiGenerationModeDescription(
  mode: AiGenerationMode | null,
): string | null {
  return mode === "LOCAL_CLOUD" ? "IA local + IA nube" : null;
}

export function aiGenerationModeExecutedLabel(
  mode: AiGenerationMode | null,
): string {
  if (mode === "LOCAL_ONLY") return "Modo ejecutado: IA local";
  if (mode === "LOCAL_CLOUD") return "Modo ejecutado: Híbrido · IA local + IA nube";
  if (mode === "CLOUD_ONLY") return "Modo ejecutado: IA nube";
  return "Modo ejecutado: —";
}

// REQUISITO 3: nombres de etapa distintos por modo; nunca "Borrador local" en
// híbrido, nunca "IA nube" en modo local, nunca etapas locales en modo nube.
const STAGE_SEQUENCE_LOCAL_ONLY = [
  "Preparación",
  "Análisis local",
  "Consolidación",
  "Borrador por puntos",
  "Validación y aplicación",
] as const;
const STAGE_SEQUENCE_LOCAL_CLOUD = [
  "Preparación",
  "Análisis local",
  "Consolidación",
  "Generación en nube",
  "Validación y aplicación",
] as const;
const STAGE_SEQUENCE_CLOUD_ONLY = [
  "Preparación",
  "Generación en nube",
  "Validación y aplicación",
] as const;

export function generationStageSequence(
  mode: AiGenerationMode | null,
): readonly string[] {
  if (mode === "LOCAL_ONLY") return STAGE_SEQUENCE_LOCAL_ONLY;
  if (mode === "LOCAL_CLOUD") return STAGE_SEQUENCE_LOCAL_CLOUD;
  if (mode === "CLOUD_ONLY") return STAGE_SEQUENCE_CLOUD_ONLY;
  return ["Preparación"];
}

export type AiAnalysisProcessingStageName =
  | "QUEUED"
  | "LOCAL_AI_ANALYSIS"
  | "LOCAL_AI_CONSOLIDATION"
  | "LOCAL_AI_GENERATION"
  | "CLOUD_AI_GENERATION"
  | "OUTPUT_VALIDATION"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

/**
 * Índice (0-based) de la etapa de `generationStageSequence(mode)` que
 * corresponde a la etapa técnica actual del backend. Determinista: sin
 * fabricar avance a partir del tiempo, solo mapea stage -> posición.
 */
export function generationStageIndex(
  mode: AiGenerationMode | null,
  stage: AiAnalysisProcessingStageName | null | undefined,
  progress: number,
): number {
  if (!stage) return 0;
  if (mode === "LOCAL_ONLY" || mode === "LOCAL_CLOUD") {
    if (stage === "LOCAL_AI_ANALYSIS") return 1;
    if (stage === "LOCAL_AI_CONSOLIDATION") return 2;
    if (stage === "LOCAL_AI_GENERATION") return 3;
    if (stage === "CLOUD_AI_GENERATION") return 3;
    if (stage === "OUTPUT_VALIDATION" || stage === "COMPLETED") return 4;
    if (stage === "FAILED" || stage === "CANCELLED") {
      if (progress >= 92) return 4;
      if (progress >= 45) return 3;
      if (progress >= 35) return 2;
      if (progress > 5) return 1;
      return 0;
    }
    return 0;
  }
  // CLOUD_ONLY (o modo aún no resuelto): dos etapas intermedias posibles.
  if (stage === "CLOUD_AI_GENERATION") return 1;
  if (stage === "OUTPUT_VALIDATION" || stage === "COMPLETED") return 2;
  if (stage === "FAILED" || stage === "CANCELLED") {
    if (progress >= 92) return 2;
    if (progress > 5) return 1;
    return 0;
  }
  return 0;
}

// REQUISITO 5: nombres técnicos crudos transformados a texto comprensible.
// Cubre tanto las rutas de esquema heredadas (structuredAnalysis.*) como los
// identificadores de artefacto de diagramas de LOCAL_ONLY_V2.
const TECHNICAL_STAGE_LABELS: Readonly<Record<string, string>> = {
  "structuredAnalysis.processFlows.asIs": "Flujo AS-IS",
  "structuredAnalysis.processFlows.toBe": "Flujo TO-BE",
  "structuredAnalysis.entityRelationship": "Modelo entidad-relación",
  AS_IS: "Flujo AS-IS",
  TO_BE: "Flujo TO-BE",
  ENTITY_RELATIONSHIP: "Modelo entidad-relación",
};

/**
 * Convierte una ruta o identificador técnico (por ejemplo
 * "structuredAnalysis.processFlows.asIs" o "AS_IS") en una etiqueta legible.
 * Si no hay una traducción conocida, deriva un texto razonable del último
 * segmento en vez de mostrar la ruta cruda completa.
 */
export function humanizeTechnicalStagePath(
  path: string | null | undefined,
): string | null {
  const trimmed = path?.trim();
  if (!trimmed) return null;

  const direct = TECHNICAL_STAGE_LABELS[trimmed];
  if (direct) return direct;

  const lastSegment = trimmed.split(".").at(-1) ?? trimmed;
  const spaced = lastSegment
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/_/gu, " ")
    .trim();
  if (!spaced) return trimmed;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

const OPERATION_LABELS: Readonly<Record<string, string>> = {
  GENERATING: "Generando",
  REPAIRING: "Reparando",
};

export function localDraftOperationLabel(
  operation: string | null | undefined,
): string {
  if (!operation) return "Generando";
  return OPERATION_LABELS[operation] ?? operation;
}
