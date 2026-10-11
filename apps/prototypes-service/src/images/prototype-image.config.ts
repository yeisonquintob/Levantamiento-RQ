import type { ConnectionOptions } from "bullmq";

export const PROTOTYPE_IMAGE_CONFIG = Symbol("PROTOTYPE_IMAGE_CONFIG");
export interface PrototypeImageConfig {
  queueName: string;
  connection: ConnectionOptions;
  attempts: number;
  backoffMs: number;
  concurrency: number;
  storageConnectionString: string;
  storageContainer: string;
  maxImageBytes: number;
}
function integer(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
) {
  const result = value?.trim() ? Number(value) : fallback;
  if (!Number.isInteger(result) || result < min || result > max)
    throw new Error(`${name} debe estar entre ${min} y ${max}.`);
  return result;
}
export function loadPrototypeImageConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PrototypeImageConfig {
  const password =
    environment.PROTOTYPE_REDIS_PASSWORD?.trim() ||
    environment.REDIS_PASSWORD?.trim() ||
    undefined;
  const storageConnectionString = (
    environment.AZURE_STORAGE_CONNECTION_STRING ??
    environment.AZURE_STORAGE_CONNECTION_STRING_HOST
  )?.trim();
  if (!storageConnectionString)
    throw new Error(
      "AZURE_STORAGE_CONNECTION_STRING es obligatorio para imágenes de prototipo.",
    );
  const storageContainer =
    environment.PROTOTYPE_IMAGES_STORAGE_CONTAINER?.trim() ||
    "rq-prototype-images";
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(storageContainer))
    throw new Error("PROTOTYPE_IMAGES_STORAGE_CONTAINER no es válido.");
  return {
    queueName:
      environment.PROTOTYPE_IMAGE_QUEUE?.trim() || "prototype-image-generation",
    connection: {
      host: environment.PROTOTYPE_REDIS_HOST?.trim() || "127.0.0.1",
      port: integer(
        environment.PROTOTYPE_REDIS_PORT ?? environment.RQ_REDIS_PORT,
        6381,
        1,
        65535,
        "PROTOTYPE_REDIS_PORT",
      ),
      ...(password ? { password } : {}),
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    },
    attempts: integer(
      environment.PROTOTYPE_IMAGE_ATTEMPTS,
      3,
      1,
      5,
      "PROTOTYPE_IMAGE_ATTEMPTS",
    ),
    backoffMs: integer(
      environment.PROTOTYPE_IMAGE_BACKOFF_MS,
      2_000,
      100,
      60_000,
      "PROTOTYPE_IMAGE_BACKOFF_MS",
    ),
    concurrency: integer(
      environment.PROTOTYPE_IMAGE_CONCURRENCY,
      1,
      1,
      2,
      "PROTOTYPE_IMAGE_CONCURRENCY",
    ),
    storageConnectionString,
    storageContainer,
    maxImageBytes: integer(
      environment.PROTOTYPE_IMAGE_MAX_BYTES,
      20 * 1024 * 1024,
      1024,
      50 * 1024 * 1024,
      "PROTOTYPE_IMAGE_MAX_BYTES",
    ),
  };
}
