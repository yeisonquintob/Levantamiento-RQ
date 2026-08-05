import type { ConnectionOptions } from "bullmq";

export const SOURCES_PROCESSING_CONFIG = Symbol(
  "SOURCES_PROCESSING_CONFIG",
);

export interface SourcesProcessingConfig {
  queueName: string;
  connection: ConnectionOptions;
  attempts: number;
  backoffMs: number;
  concurrency: number;
}

function readInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const resolved = value?.trim() ? Number(value) : fallback;

  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${name} debe estar entre ${minimum} y ${maximum}.`);
  }

  return resolved;
}

export function loadSourcesProcessingConfig(
  environment: NodeJS.ProcessEnv = process.env,
): SourcesProcessingConfig {
  const password = environment.SOURCES_REDIS_PASSWORD?.trim() ||
    environment.REDIS_PASSWORD?.trim() || undefined;

  return {
    queueName:
      environment.SOURCES_PROCESSING_QUEUE?.trim() || "source-processing",
    connection: {
      host: environment.SOURCES_REDIS_HOST?.trim() || "127.0.0.1",
      port: readInteger(
        environment.SOURCES_REDIS_PORT ?? environment.RQ_REDIS_PORT,
        6381,
        1,
        65535,
        "SOURCES_REDIS_PORT",
      ),
      ...(password ? { password } : {}),
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    },
    attempts: readInteger(
      environment.SOURCES_PROCESSING_ATTEMPTS,
      3,
      1,
      10,
      "SOURCES_PROCESSING_ATTEMPTS",
    ),
    backoffMs: readInteger(
      environment.SOURCES_PROCESSING_BACKOFF_MS,
      1000,
      100,
      60000,
      "SOURCES_PROCESSING_BACKOFF_MS",
    ),
    concurrency: readInteger(
      environment.SOURCES_PROCESSING_CONCURRENCY,
      2,
      1,
      20,
      "SOURCES_PROCESSING_CONCURRENCY",
    ),
  };
}
