import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Worker } from "bullmq";
import { getRuntimeMetrics } from "@levantamiento-rq/shared-observability";

import {
  EXPORT_DOCUMENT_JOB,
  type ExportDocumentJobData,
} from "./export-processing.queue";
import { ExportProcessingService } from "./export-processing.service";
import {
  OPERATIONS_PROCESSING_CONFIG,
  type OperationsProcessingConfig,
} from "./operations-processing.config";

@Injectable()
export class ExportProcessingWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExportProcessingWorker.name);
  private worker: Worker<ExportDocumentJobData> | null = null;

  constructor(
    @Inject(OPERATIONS_PROCESSING_CONFIG)
    private readonly config: OperationsProcessingConfig,
    private readonly processing: ExportProcessingService,
  ) {}

  onModuleInit(): void {
    const metrics = getRuntimeMetrics("operations-service");
    this.worker = new Worker<ExportDocumentJobData>(
      this.config.queueName,
      async (job) => {
        if (job.name !== EXPORT_DOCUMENT_JOB) {
          throw new Error(`Trabajo de Operations no reconocido: ${job.name}.`);
        }
        const configuredAttempts = Number(job.opts.attempts ?? 1);
        const attemptNumber = job.attemptsMade + 1;
        await this.processing.process(
          job.data.exportRequestId,
          attemptNumber,
          attemptNumber >= configuredAttempts,
          job.data.correlationId,
        );
      },
      {
        connection: this.config.connection,
        concurrency: this.config.concurrency,
      },
    );
    this.worker.on("ready", () =>
      metrics.setQueueWorkerConnected(this.config.queueName, true),
    );
    this.worker.on("closed", () =>
      metrics.setQueueWorkerConnected(this.config.queueName, false),
    );
    this.worker.on("completed", () =>
      metrics.recordQueueJob(this.config.queueName, "completed"),
    );
    this.worker.on("failed", () =>
      metrics.recordQueueJob(this.config.queueName, "failed"),
    );
    this.worker.on("error", (error) => {
      metrics.setQueueWorkerConnected(this.config.queueName, false);
      this.logger.error(error.message);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
  }
}
