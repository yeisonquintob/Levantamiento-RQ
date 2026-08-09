import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue, type Job } from "bullmq";
import { getRuntimeMetrics } from "@levantamiento-rq/shared-observability";

import {
  OPERATIONS_PROCESSING_CONFIG,
  type OperationsProcessingConfig,
} from "./operations-processing.config";

export const EXPORT_DOCUMENT_JOB = "export-approved-document";

export interface ExportDocumentJobData {
  exportRequestId: string;
  correlationId: string;
}

@Injectable()
export class ExportProcessingQueue implements OnModuleDestroy {
  private readonly queue: Queue<ExportDocumentJobData>;
  private readonly queueName: string;

  constructor(
    @Inject(OPERATIONS_PROCESSING_CONFIG)
    config: OperationsProcessingConfig,
  ) {
    this.queueName = config.queueName;
    this.queue = new Queue<ExportDocumentJobData>(config.queueName, {
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
    exportRequestId: string,
    correlationId: string,
  ): Promise<Job<ExportDocumentJobData>> {
    const job = await this.queue.add(
      EXPORT_DOCUMENT_JOB,
      { exportRequestId, correlationId },
      { jobId: exportRequestId },
    );
    getRuntimeMetrics("operations-service").recordQueueJob(
      this.queueName,
      "enqueued",
    );
    return job;
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
