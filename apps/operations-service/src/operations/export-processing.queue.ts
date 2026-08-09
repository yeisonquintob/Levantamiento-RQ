import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue, type Job } from "bullmq";

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

  constructor(
    @Inject(OPERATIONS_PROCESSING_CONFIG)
    config: OperationsProcessingConfig,
  ) {
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

  enqueue(
    exportRequestId: string,
    correlationId: string,
  ): Promise<Job<ExportDocumentJobData>> {
    return this.queue.add(
      EXPORT_DOCUMENT_JOB,
      { exportRequestId, correlationId },
      { jobId: exportRequestId },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
