import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Worker } from "bullmq";
import { getRuntimeMetrics } from "@levantamiento-rq/shared-observability";

import { AiAnalysisExecutionService } from "./ai-analysis-execution.service";
import {
  AI_ANALYSIS_PROCESSING_CONFIG,
  type AiAnalysisProcessingConfig,
} from "./ai-analysis-processing.config";
import { AI_ANALYSIS_JOB, type AiAnalysisJobData } from "./ai-analysis.queue";
import { AiUsageGuardService } from "../security/ai-usage-guard.service";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AnalysisRequestEntity } from "../analysis/analysis-request.entity";

@Injectable()
export class AiAnalysisWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiAnalysisWorker.name);
  private worker: Worker<AiAnalysisJobData> | null = null;

  constructor(
    @Inject(AI_ANALYSIS_PROCESSING_CONFIG)
    private readonly config: AiAnalysisProcessingConfig,
    private readonly execution: AiAnalysisExecutionService,
    private readonly usageGuard: AiUsageGuardService,
    @InjectRepository(AnalysisRequestEntity)
    private readonly requests: Repository<AnalysisRequestEntity>,
  ) {}

  private async release(job: { data: AiAnalysisJobData }): Promise<void> {
    const request = await this.requests.findOneBy({ id: job.data.analysisRequestId });
    if (!request) return;
    await this.usageGuard.release({
      requestId: request.id,
      userId: request.requestedByUserId,
      projectId: request.projectId,
    });
  }

  onModuleInit(): void {
    const metrics = getRuntimeMetrics("ai-analysis-service");
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
    this.worker.on("ready", () =>
      metrics.setQueueWorkerConnected(this.config.queueName, true),
    );
    this.worker.on("closed", () =>
      metrics.setQueueWorkerConnected(this.config.queueName, false),
    );
    this.worker.on("completed", (job) => {
      metrics.recordQueueJob(this.config.queueName, "completed");
      void this.release(job);
    });
    this.worker.on("failed", (job) => {
      metrics.recordQueueJob(this.config.queueName, "failed");
      if (job && job.attemptsMade >= Number(job.opts.attempts ?? 1)) {
        void this.release(job);
      }
    });
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
