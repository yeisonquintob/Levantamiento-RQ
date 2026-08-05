import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Worker } from "bullmq";

import {
  SOURCE_PROCESSING_JOB,
  type SourceProcessingJobData,
} from "./source-processing.queue";
import { SourceProcessingService } from "./source-processing.service";
import {
  SOURCES_PROCESSING_CONFIG,
  type SourcesProcessingConfig,
} from "./sources-processing.config";

@Injectable()
export class SourceProcessingWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SourceProcessingWorker.name);
  private worker: Worker<SourceProcessingJobData> | null = null;

  constructor(
    @Inject(SOURCES_PROCESSING_CONFIG)
    private readonly config: SourcesProcessingConfig,
    @Inject(SourceProcessingService)
    private readonly processing: SourceProcessingService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<SourceProcessingJobData>(
      this.config.queueName,
      async (job) => {
        if (job.name !== SOURCE_PROCESSING_JOB) {
          throw new Error(`Trabajo de Sources no reconocido: ${job.name}.`);
        }

        await this.processing.process(job.data, job.attemptsMade + 1);
      },
      {
        connection: this.config.connection,
        concurrency: this.config.concurrency,
      },
    );

    this.worker.on("error", (error) => {
      this.logger.error(error.message);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
  }
}
