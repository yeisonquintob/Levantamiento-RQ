import { randomUUID } from "node:crypto";

import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue, type Job } from "bullmq";

import {
  SOURCE_PROCESSING_STAGES,
  type SourceProcessingProgress,
} from "@levantamiento-rq/shared-contracts";

import {
  SOURCES_PROCESSING_CONFIG,
  type SourcesProcessingConfig,
} from "./sources-processing.config";

export const SOURCE_PROCESSING_JOB = "extract-source-file";

export interface SourceProcessingJobData {
  sourceId: string;
  actorId: string;
  correlationId: string;
}

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeRuntimeProgress(
  value: unknown,
): SourceProcessingProgress | null {
  if (typeof value === "number") {
    return {
      percentage: clampPercentage(value),
      stage: "EXTRACTING",
      message: "Procesando contenido",
    };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Readonly<Record<string, unknown>>;
  const percentage = Number(record.percentage);
  const stage = record.stage;
  const message = record.message;

  if (
    !Number.isFinite(percentage) ||
    typeof stage !== "string" ||
    !SOURCE_PROCESSING_STAGES.includes(
      stage as SourceProcessingProgress["stage"],
    )
  ) {
    return null;
  }

  return {
    percentage: clampPercentage(percentage),
    stage: stage as SourceProcessingProgress["stage"],
    message:
      typeof message === "string" && message.trim()
        ? message.trim()
        : "Procesando archivo",
  };
}

@Injectable()
export class SourceProcessingQueue implements OnModuleDestroy {
  private readonly queue: Queue<SourceProcessingJobData>;

  constructor(
    @Inject(SOURCES_PROCESSING_CONFIG)
    config: SourcesProcessingConfig,
  ) {
    this.queue = new Queue<SourceProcessingJobData>(config.queueName, {
      connection: config.connection,
      defaultJobOptions: {
        attempts: config.attempts,
        backoff: { type: "fixed", delay: config.backoffMs },
        removeOnComplete: false,
        removeOnFail: false,
      },
    });
  }

  enqueue(
    sourceId: string,
    actorId: string,
    correlationId = randomUUID(),
  ): Promise<Job<SourceProcessingJobData>> {
    return this.queue.add(
      SOURCE_PROCESSING_JOB,
      { sourceId, actorId, correlationId },
      { jobId: `${sourceId}-${Date.now()}` },
    );
  }

  async getProgressBySourceIds(
    sourceIds: readonly string[],
  ): Promise<ReadonlyMap<string, SourceProcessingProgress>> {
    if (sourceIds.length === 0) {
      return new Map();
    }

    const wanted = new Set(
      sourceIds.map((sourceId) => sourceId.toLowerCase()),
    );

    try {
      /*
       * Solo necesitamos trabajos que todavía puedan aportar
       * progreso útil. Los READY se resuelven directamente con
       * processingStatus=READY en RqSourcesDb.
       */
      const jobs = await this.queue.getJobs(
        ["active", "waiting", "delayed", "failed"],
        0,
        Math.min(500, Math.max(100, sourceIds.length * 20)),
        false,
      );

      jobs.sort(
        (left, right) =>
          (right.timestamp ?? 0) - (left.timestamp ?? 0),
      );

      const result = new Map<string, SourceProcessingProgress>();

      for (const job of jobs) {
        const sourceId = job.data.sourceId?.toLowerCase();

        if (
          !sourceId ||
          !wanted.has(sourceId) ||
          result.has(sourceId)
        ) {
          continue;
        }

        const runtime = normalizeRuntimeProgress(job.progress);

        result.set(
          sourceId,
          runtime ?? {
            percentage: 5,
            stage: "QUEUED",
            message: "En espera de procesamiento",
          },
        );

        if (result.size === wanted.size) {
          break;
        }
      }

      return result;
    } catch {
      /*
       * Consultar progreso nunca debe impedir consultar las fuentes.
       * Si Redis no puede entregar el detalle puntual, la API conserva
       * processingStatus como fuente de verdad.
       */
      return new Map();
    }
  }

  get bullQueue(): Queue<SourceProcessingJobData> {
    return this.queue;
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
