import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue, type Job } from "bullmq";
import {
  PROTOTYPE_IMAGE_CONFIG,
  type PrototypeImageConfig,
} from "./prototype-image.config";

export const PROTOTYPE_IMAGE_GENERATION_JOB = "generate-prototype-image";
export interface PrototypeImageGenerationJobData {
  generationId: string;
  visualSpecificationId: string;
  imageRecordId: string;
  /**
   * Intento de la imagen con el que nació el trabajo. Es inmutable: si al ejecutarse la imagen ya
   * está en otro intento (reintento, importación, detención), el trabajo es obsoleto y no escribe.
   * Opcional por compatibilidad con trabajos creados antes de este campo.
   */
  attemptNumber?: number;
}
@Injectable()
export class PrototypeImageGenerationQueue implements OnModuleDestroy {
  private readonly queue: Queue<PrototypeImageGenerationJobData>;
  constructor(
    @Inject(PROTOTYPE_IMAGE_CONFIG)
    private readonly config: PrototypeImageConfig,
  ) {
    this.queue = new Queue(config.queueName, {
      connection: config.connection,
      defaultJobOptions: {
        attempts: config.attempts,
        backoff: { type: "exponential", delay: config.backoffMs },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    });
  }
  enqueue(
    data: PrototypeImageGenerationJobData,
    attemptNumber = 1,
  ): Promise<Job<PrototypeImageGenerationJobData>> {
    return this.queue.add(
      PROTOTYPE_IMAGE_GENERATION_JOB,
      { ...data, attemptNumber },
      {
        jobId: `prototype-image-${data.imageRecordId}-attempt-${attemptNumber}`,
      },
    );
  }
  get attempts(): number {
    return this.config.attempts;
  }

  // RQ_PROTOTYPE_PENDING_JOB_RECOVERY_V1
  // SQL es la fuente de verdad. Si un registro sigue PENDING pero Redis/BullMQ
  // ya no conserva su trabajo, se vuelve a crear sin duplicar jobs activos.
  async ensurePendingJobs(
    items: Array<{
      data: PrototypeImageGenerationJobData;
      attemptNumber: number;
    }>,
  ): Promise<number> {
    if (!items.length) return 0;

    const runnable = await this.queue.getJobs([
      "waiting",
      "active",
      "delayed",
      "paused",
      "prioritized",
    ]);
    const runnableImageIds = new Set(
      runnable.map((job) => job.data.imageRecordId),
    );

    let recovered = 0;

    for (const item of items) {
      if (runnableImageIds.has(item.data.imageRecordId)) continue;

      const recoveryJobId =
        `prototype-image-${item.data.imageRecordId}` +
        `-attempt-${item.attemptNumber}-recovery`;

      const previous = await this.queue.getJob(recoveryJobId);
      if (previous) {
        const state = await previous.getState();
        if (
          ["waiting", "active", "delayed", "paused", "prioritized"].includes(
            state,
          )
        ) {
          runnableImageIds.add(item.data.imageRecordId);
          continue;
        }

        await previous.remove().catch(() => undefined);
      }

      await this.queue.add(
        PROTOTYPE_IMAGE_GENERATION_JOB,
        { ...item.data, attemptNumber: item.attemptNumber },
        { jobId: recoveryJobId },
      );
      runnableImageIds.add(item.data.imageRecordId);
      recovered += 1;
    }

    return recovered;
  }

  async cancelGeneration(generationId: string): Promise<void> {
    const jobs = await this.queue.getJobs(["waiting", "delayed", "paused"]);
    await Promise.all(
      jobs
        .filter((job) => job.data.generationId === generationId)
        .map((job) => job.remove()),
    );
  }
  async onModuleDestroy() {
    await this.queue.close();
  }
}
