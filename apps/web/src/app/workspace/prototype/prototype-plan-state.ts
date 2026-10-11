import type { PrototypeGenerationDetail } from "@levantamiento-rq/shared-contracts";

const PLAN_READY_STATUSES: ReadonlyArray<PrototypeGenerationDetail["status"]> =
  [
    "PLANNED",
    "VISUAL_SPEC_BUILDING",
    "VISUAL_SPEC_READY",
    "IMAGE_GENERATING",
    "COMPLETED",
    "PARTIALLY_COMPLETED",
  ];

/**
 * Indica si el texto del Markdown ya fue interpretado. Una generación en FAILED con imágenes
 * creadas falló después de planificar (p. ej. todas las imágenes fallaron): su plan sigue vigente
 * y solo faltan imágenes. FAILED sin imágenes significa que falló la interpretación.
 */
export function hasCompletedPrototypePlan(
  generation: Pick<PrototypeGenerationDetail, "status" | "totalImages">,
): boolean {
  return (
    PLAN_READY_STATUSES.includes(generation.status) ||
    (generation.status === "FAILED" && generation.totalImages > 0)
  );
}
