import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue, type Job } from "bullmq";

import {
  SOURCES_PROCESSING_CONFIG,
  type SourcesProcessingConfig,
} from "./sources-processing.config";

export const SOURCE_PROCESSING_JOB = "extract-source-file";

export interface SourceProcessingJobData {
  sourceId: string;
  actorId: string;
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
  ): Promise<Job<SourceProcessingJobData>> {
    return this.queue.add(
      SOURCE_PROCESSING_JOB,
      { sourceId, actorId },
      { jobId: `${sourceId}-${Date.now()}` },
    );
  }

  get bullQueue(): Queue<SourceProcessingJobData> {
    return this.queue;
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
