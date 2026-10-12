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

/** Límite de cuerpo JSON del resto de rutas de Gateway y Prototypes (20 MB). */
export const DEFAULT_JSON_BODY_LIMIT = 20 * 1024 * 1024;

export interface RouteOptionsLike {
  url: string;
  method: string | string[];
  bodyLimit?: number;
}

/** Instancia de Fastify, descrita de forma estructural para no depender del paquete. */
export interface RouteHookHost {
  addHook(name: "onRoute", hook: (route: RouteOptionsLike) => void): unknown;
}

const IMPORT_ROUTE = /\/generations\/[^/]+\/images\/import$/u;

/**
 * Sube el límite de cuerpo SOLO en la ruta de importación de imágenes (el PNG viaja en base64);
 * las demás rutas conservan el límite general. Debe registrarse antes de que se creen las rutas.
 */
export function limitBodyForPrototypeImport(
  host: RouteHookHost,
  environment: Record<string, string | undefined>,
): number {
  const importLimit = resolvePrototypeImageBodyLimit(environment);
  host.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    if (methods.includes("POST") && IMPORT_ROUTE.test(route.url))
      route.bodyLimit = importLimit;
  });
  return importLimit;
}
