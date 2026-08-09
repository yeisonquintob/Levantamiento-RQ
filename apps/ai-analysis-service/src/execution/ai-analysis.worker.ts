import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Worker } from "bullmq";

import { AiAnalysisExecutionService } from "./ai-analysis-execution.service";
import {
  AI_ANALYSIS_PROCESSING_CONFIG,
  type AiAnalysisProcessingConfig,
} from "./ai-analysis-processing.config";
import { AI_ANALYSIS_JOB, type AiAnalysisJobData } from "./ai-analysis.queue";

@Injectable()
export class AiAnalysisWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiAnalysisWorker.name);
  private worker: Worker<AiAnalysisJobData> | null = null;

  constructor(
    @Inject(AI_ANALYSIS_PROCESSING_CONFIG)
    private readonly config: AiAnalysisProcessingConfig,
    private readonly execution: AiAnalysisExecutionService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<AiAnalysisJobData>(
      this.config.queueName,
      async (job) => {
        if (job.name !== AI_ANALYSIS_JOB) {
          throw new Error(`Trabajo de IA no reconocido: ${job.name}.`);
        }
        const configuredAttempts = Number(job.opts.attempts ?? 1);
        const finalAttempt = job.attemptsMade + 1 >= configuredAttempts;
        await this.execution.process(
          job.data.analysisRequestId,
          finalAttempt,
          job.data.correlationId,
        );
      },
      {
        connection: this.config.connection,
        concurrency: this.config.concurrency,
      },
    );
    this.worker.on("error", (error) => this.logger.error(error.message));
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
  }
}
