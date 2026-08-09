import type { ConnectionOptions } from "bullmq";

export const AI_ANALYSIS_PROCESSING_CONFIG = Symbol(
  "AI_ANALYSIS_PROCESSING_CONFIG",
);

export interface AiAnalysisProcessingConfig {
  queueName: string;
  connection: ConnectionOptions;
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
  const parsed = value?.trim() ? Number(value) : fallback;
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} debe estar entre ${minimum} y ${maximum}.`);
  }
  return parsed;
}

export function loadAiAnalysisProcessingConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AiAnalysisProcessingConfig {
  const password =
    environment.AI_REDIS_PASSWORD?.trim() ||
    environment.REDIS_PASSWORD?.trim() ||
    undefined;

  return {
    queueName:
      environment.AI_PROCESSING_QUEUE?.trim() || "ai-analysis-processing",
    connection: {
      host: environment.AI_REDIS_HOST?.trim() || "127.0.0.1",
      port: integer(
        environment.AI_REDIS_PORT ?? environment.RQ_REDIS_PORT,
        6381,
        1,
        65535,
        "AI_REDIS_PORT",
      ),
      ...(password ? { password } : {}),
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    },
    attempts: integer(
      environment.AI_PROCESSING_ATTEMPTS,
      3,
      1,
      10,
      "AI_PROCESSING_ATTEMPTS",
    ),
    backoffMs: integer(
      environment.AI_PROCESSING_BACKOFF_MS,
      2000,
      100,
      60000,
      "AI_PROCESSING_BACKOFF_MS",
    ),
    concurrency: integer(
      environment.AI_PROCESSING_CONCURRENCY,
      1,
      1,
      10,
      "AI_PROCESSING_CONCURRENCY",
    ),
  };
}
