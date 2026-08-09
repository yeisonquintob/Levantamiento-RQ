import type { RedisOptions } from "ioredis";

export const OPERATIONS_PROCESSING_CONFIG = Symbol(
  "OPERATIONS_PROCESSING_CONFIG",
);

export interface OperationsProcessingConfig {
  queueName: string;
  connection: RedisOptions;
  attempts: number;
  backoffMs: number;
  concurrency: number;
}

function integer(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const result = value?.trim() ? Number(value) : fallback;
  if (!Number.isInteger(result) || result < minimum || result > maximum) {
    throw new Error(`${name} debe estar entre ${minimum} y ${maximum}.`);
  }
  return result;
}

export function loadOperationsProcessingConfig(
  environment: NodeJS.ProcessEnv = process.env,
): OperationsProcessingConfig {
  const password = environment.REDIS_PASSWORD?.trim();
  if (!password) throw new Error("REDIS_PASSWORD es obligatoria.");
  return {
    queueName: environment.OPERATIONS_EXPORT_QUEUE?.trim() || "rq-exports-v1",
    connection: {
      host: environment.REDIS_HOST?.trim() || "127.0.0.1",
      port: integer(environment.REDIS_PORT, 6381, 1, 65535, "REDIS_PORT"),
      password,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    },
    attempts: integer(
      environment.OPERATIONS_EXPORT_ATTEMPTS,
      3,
      1,
      10,
      "OPERATIONS_EXPORT_ATTEMPTS",
    ),
    backoffMs: integer(
      environment.OPERATIONS_EXPORT_BACKOFF_MS,
      2000,
      100,
      60_000,
      "OPERATIONS_EXPORT_BACKOFF_MS",
    ),
    concurrency: integer(
      environment.OPERATIONS_EXPORT_CONCURRENCY,
      2,
      1,
      20,
      "OPERATIONS_EXPORT_CONCURRENCY",
    ),
  };
}
