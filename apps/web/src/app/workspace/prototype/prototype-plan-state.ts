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
 * Indica si el texto del Markdown ya fue interpretado. Una generación en FAILED con pantallas
 * (`totalScreens > 0`) falló después de planificar (p. ej. todas las imágenes fallaron): su plan
 * sigue vigente. Un fallo de planificación deja `totalScreens` en 0, y solo entonces hay que
 * volver a interpretar el Markdown.
 */
export function hasCompletedPrototypePlan(
  generation: Pick<PrototypeGenerationDetail, "status" | "totalScreens">,
): boolean {
  return (
    PLAN_READY_STATUSES.includes(generation.status) ||
    (generation.status === "FAILED" && generation.totalScreens > 0)
  );
}
