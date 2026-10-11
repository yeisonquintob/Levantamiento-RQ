// PASO_3_PROGRESO_REAL_POR_ESTADO_V1
//
// Rangos por etapa (ver monitor de Fuentes):
// IA local:  Preparación 0-5, Análisis 5-35, Consolidación 35-45,
//            Borrador por puntos 45-92, Validación 92-100.
// Híbrido:   igual hasta Consolidación; Generación en nube 40-92.
// IA nube:   Preparación 0-5, Generación en nube 5-92, Validación 92-100.
//
// Ningún valor aquí se calcula por tiempo transcurrido: todo proviene de
// contadores reales (fuentes/segmentos completados, unidades completadas
// dentro del bloque en curso).

import type { AiAnalysisLocalDraftBlockProgress } from "@levantamiento-rq/shared-contracts";

const LOCAL_DRAFT_START_PROGRESS = 45;
const LOCAL_DRAFT_END_PROGRESS = 92;

export function localSourceAnalysisProgress(
  completedSources: number,
  totalSources: number,
  completedSegments: number | null | undefined,
  totalSegments: number | null | undefined,
): number {
  if (totalSources <= 0) return 5;
  // El segmento actual solo aporta una fracción demostrable cuando existe
  // más de un segmento; con un único segmento en curso no se puede afirmar
  // ningún avance parcial verificable dentro de esa fuente.
  const segmentFraction =
    totalSegments && totalSegments > 1
      ? Math.min(1, Math.max(0, completedSegments ?? 0) / totalSegments)
      : 0;
  const sourceFraction = Math.min(
    1,
    (completedSources + segmentFraction) / totalSources,
  );
  return Math.min(35, 5 + Math.round(sourceFraction * 30));
}

/**
 * Combina puntos/bloques completados con las unidades (subunidades) ya
 * completadas dentro del bloque en curso, para que una plantilla con un
 * único bloque grande (por ejemplo, un punto dividido en varias subunidades)
 * no se quede clavada en el valor inicial hasta terminar el bloque entero.
 * Una reparación no reinicia el contador: completedUnits solo crece.
 */
export function localDraftGenerationProgress(
  blocks: readonly AiAnalysisLocalDraftBlockProgress[],
): number {
  const total =
    blocks.find((block) => block.blockTotal > 0)?.blockTotal ?? blocks.length;

  if (total <= 0) return LOCAL_DRAFT_START_PROGRESS;

  const completed = blocks.filter(
    (block) => block.status === "COMPLETED",
  ).length;
  const current = blocks.find((block) => block.status === "PROCESSING") ?? null;
  const unitFraction =
    current && current.totalUnits && current.totalUnits > 0
      ? Math.min(1, (current.completedUnits ?? 0) / current.totalUnits)
      : 0;
  const blockFraction = Math.min(1, (completed + unitFraction) / total);

  return Math.min(
    LOCAL_DRAFT_END_PROGRESS,
    LOCAL_DRAFT_START_PROGRESS +
      Math.round(blockFraction * (LOCAL_DRAFT_END_PROGRESS - LOCAL_DRAFT_START_PROGRESS)),
  );
}

// Sin eventos parciales del proveedor de nube, el valor se fija al inicio
// real de la etapa (nunca fabrica movimiento); el monitor muestra en su
// lugar un indicador indeterminado mientras esta etapa está activa.
export function cloudGenerationProgress(usesLocalKnowledge: boolean): number {
  return usesLocalKnowledge ? 40 : 5;
}
