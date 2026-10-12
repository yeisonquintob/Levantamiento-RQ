/** Tamaño por defecto del PNG que se puede importar a la galería (20 MB). */
export const PROTOTYPE_IMAGE_DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
/** Tope absoluto configurable (50 MB). */
export const PROTOTYPE_IMAGE_ABSOLUTE_MAX_BYTES = 50 * 1024 * 1024;

const JSON_ENVELOPE_BYTES = 1024 * 1024;

/** Tamaño en base64 de `bytes` bytes: 4 caracteres por cada 3 bytes. */
export function base64Size(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

/** Máximo configurado para un PNG (`PROTOTYPE_IMAGE_MAX_BYTES`); valores inválidos usan el valor por defecto. */
export function resolvePrototypeImageMaxBytes(
  environment: Record<string, string | undefined>,
): number {
  const configured = Number(environment["PROTOTYPE_IMAGE_MAX_BYTES"]);
  return Number.isInteger(configured) &&
    configured >= 1024 &&
    configured <= PROTOTYPE_IMAGE_ABSOLUTE_MAX_BYTES
    ? configured
    : PROTOTYPE_IMAGE_DEFAULT_MAX_BYTES;
}

/**
 * Límite del cuerpo HTTP (JSON) de Gateway y Prototypes. El PNG importado viaja en base64 (+33 %),
 * así que el límite sale del tamaño máximo del PNG y no puede quedar por debajo de 20 MB.
 */
export function resolvePrototypeImageBodyLimit(
  environment: Record<string, string | undefined>,
): number {
  return Math.max(
    PROTOTYPE_IMAGE_DEFAULT_MAX_BYTES,
    base64Size(resolvePrototypeImageMaxBytes(environment)) +
      JSON_ENVELOPE_BYTES,
  );
}
