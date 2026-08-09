import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue, type Job } from "bullmq";
import { getRuntimeMetrics } from "@levantamiento-rq/shared-observability";

import {
  AI_ANALYSIS_PROCESSING_CONFIG,
  type AiAnalysisProcessingConfig,
} from "./ai-analysis-processing.config";

export const AI_ANALYSIS_JOB = "analyze-requirement-document";

export interface AiAnalysisJobData {
  analysisRequestId: string;
  correlationId: string;
}

@Injectable()
export class AiAnalysisQueue implements OnModuleDestroy {
  private readonly queue: Queue<AiAnalysisJobData>;
  private readonly queueName: string;

  constructor(
    @Inject(AI_ANALYSIS_PROCESSING_CONFIG)
    config: AiAnalysisProcessingConfig,
  ) {
    this.queueName = config.queueName;
    this.queue = new Queue<AiAnalysisJobData>(config.queueName, {
      connection: config.connection,
      defaultJobOptions: {
        attempts: config.attempts,
        backoff: { type: "exponential", delay: config.backoffMs },
        removeOnComplete: 1000,
        removeOnFail: false,
      },
    });
  }

  async enqueue(
    analysisRequestId: string,
    correlationId: string,
    discriminator = "initial",
  ): Promise<Job<AiAnalysisJobData>> {
    const job = await this.queue.add(
      AI_ANALYSIS_JOB,
      { analysisRequestId, correlationId },
      { jobId: `${analysisRequestId}-${discriminator}` },
    );
    getRuntimeMetrics("ai-analysis-service").recordQueueJob(
      this.queueName,
      "enqueued",
    );
    return job;
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
