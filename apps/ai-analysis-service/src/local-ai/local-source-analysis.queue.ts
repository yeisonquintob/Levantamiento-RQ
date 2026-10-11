import { createHash } from "node:crypto";
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Job, Queue, QueueEvents, Worker } from "bullmq";
import { Repository } from "typeorm";
import { getRuntimeMetrics } from "@levantamiento-rq/shared-observability";
import { AnalysisRequestSourceEntity } from "../analysis/analysis-request-source.entity";
import {
  AI_ANALYSIS_PROCESSING_CONFIG,
  type AiAnalysisProcessingConfig,
} from "../execution/ai-analysis-processing.config";
import { LOCAL_AI_CONFIG, type LocalAiConfig } from "./ollama.config";
import {
  OllamaSourceAnalyzerService,
  type LocalSourceAnalysisProfile,
} from "./ollama-source-analyzer.service";
import {
  LOCAL_AI_PROMPT_VERSION,
  parseLocalSourceAnalysis,
  type LocalSourceAnalysis,
} from "./local-ai-output";
import { AiAnalysisSourcesAccessClient } from "../analysis/sources-access.client";
import { AiAnalysisServiceToken } from "../analysis/ai-analysis-service-token.service";
import { OllamaClient } from "./ollama.client";

export const LOCAL_SOURCE_ANALYSIS_QUEUE = "local-source-analysis";
export const LOCAL_SOURCE_ANALYSIS_JOB = "analyze-local-source";

interface LocalSourceAnalysisJobData {
  projectId: string;
  requestSourceId: string;
  expectedSha256: string;
  runtime: LocalAiConfig;
  templateGuidance: string;
  promptVersion: string;
  analysisProfile?: LocalSourceAnalysisProfile;
}

export interface LocalSourceAnalysisJobProgress {
  completedSegments: number;
  currentSegment: number;
  totalSegments: number;
}

function jobId(
  source: AnalysisRequestSourceEntity,
  model: string,
  sha: string,
  promptVersion: string,
): string {
  const key = `${source.sourceId}|${sha}|${model}|${promptVersion}`;
  return `local-${createHash("sha256").update(key).digest("hex")}`;
}

@Injectable()
export class LocalSourceAnalysisQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LocalSourceAnalysisQueue.name);
  private readonly queue: Queue<LocalSourceAnalysisJobData>;
  private readonly events: QueueEvents;
  private worker: Worker<
    LocalSourceAnalysisJobData,
    LocalSourceAnalysis
  > | null = null;
  private readonly activeCancellations = new Map<string, AbortController>();

  constructor(
    @Inject(AI_ANALYSIS_PROCESSING_CONFIG)
    processing: AiAnalysisProcessingConfig,
    @Inject(LOCAL_AI_CONFIG) private readonly config: LocalAiConfig,
    @InjectRepository(AnalysisRequestSourceEntity)
    private readonly sources: Repository<AnalysisRequestSourceEntity>,
    private readonly sourcesAccess: AiAnalysisSourcesAccessClient,
    private readonly serviceToken: AiAnalysisServiceToken,
  ) {
    this.queue = new Queue(LOCAL_SOURCE_ANALYSIS_QUEUE, {
      connection: processing.connection,
      defaultJobOptions: {
        attempts: processing.attempts,
        backoff: { type: "exponential", delay: processing.backoffMs },
        removeOnComplete: 1000,
        removeOnFail: false,
      },
    });
    this.events = new QueueEvents(LOCAL_SOURCE_ANALYSIS_QUEUE, {
      connection: processing.connection,
    });
  }

  onModuleInit(): void {
    const metrics = getRuntimeMetrics("ai-analysis-service");
    this.worker = new Worker<LocalSourceAnalysisJobData, LocalSourceAnalysis>(
      LOCAL_SOURCE_ANALYSIS_QUEUE,
      async (job) => this.process(job),
      {
        connection: this.queue.opts.connection,
        concurrency: this.config.maxConcurrentJobs,
      },
    );
    this.worker.on("completed", () =>
      metrics.recordQueueJob(LOCAL_SOURCE_ANALYSIS_QUEUE, "completed"),
    );
    this.worker.on("failed", (_job, error) => {
      metrics.recordQueueJob(LOCAL_SOURCE_ANALYSIS_QUEUE, "failed");
      this.logger.error(error.message);
    });
    this.worker.on("error", (error) => this.logger.error(error.message));
  }

  async analyze(
    projectId: string,
    source: AnalysisRequestSourceEntity,
    sha: string,
    runtime: LocalAiConfig,
    templateGuidance = "",
    promptVersion: string = LOCAL_AI_PROMPT_VERSION,
    analysisProfile: LocalSourceAnalysisProfile = "DEFAULT",
  ): Promise<LocalSourceAnalysis> {
    const id = jobId(source, runtime.model, sha, promptVersion);
    let job = await this.queue.getJob(id);
    if (!job) {
      job = await this.queue.add(
        LOCAL_SOURCE_ANALYSIS_JOB,
        {
          projectId,
          requestSourceId: source.id,
          expectedSha256: sha,
          runtime,
          templateGuidance,
          promptVersion,
          analysisProfile,
        },
        { jobId: id },
      );
      getRuntimeMetrics("ai-analysis-service").recordQueueJob(
        LOCAL_SOURCE_ANALYSIS_QUEUE,
        "enqueued",
      );
    } else if ((await job.getState()) === "failed") {
      await job.retry();
      getRuntimeMetrics("ai-analysis-service").recordQueueJob(
        LOCAL_SOURCE_ANALYSIS_QUEUE,
        "enqueued",
      );
    }
    /*
     * LOCAL_SOURCE_JOB_WAIT_V4_4
     *
     * El timeout configurado por el usuario limita CADA inferencia Ollama.
     * Una fuente puede requerir varias inferencias por el split adaptativo,
     * por lo que la espera BullMQ no debe imponer un segundo límite global
     * derivado de runtime.timeoutMs. El job termina por completed/failed o
     * por la cancelación explícita del proceso.
     */
    const result = await job.waitUntilFinished(this.events);
    return parseLocalSourceAnalysis(result, source.sourceId);
  }

  async cancel(requestSourceId: string): Promise<boolean> {
    const jobs = await this.queue.getJobs([
      "waiting",
      "active",
      "delayed",
      "paused",
      "prioritized",
    ]);
    const matches = jobs.filter(
      (job) => job.data.requestSourceId === requestSourceId,
    );
    await Promise.all(
      matches.map(async (job) => {
        const state = await job.getState();
        if (state === "active") {
          job.discard();
          return;
        }
        await job.remove();
      }),
    );
    const active = this.activeCancellations.get(requestSourceId);
    active?.abort();
    return matches.length > 0 || Boolean(active);
  }

  async getProgress(
    source: AnalysisRequestSourceEntity,
    model: string,
    sha: string,
    promptVersion: string,
  ): Promise<LocalSourceAnalysisJobProgress | null> {
    const job = await this.queue.getJob(
      jobId(source, model, sha, promptVersion),
    );
    const progress = job?.progress;
    if (!progress || typeof progress !== "object") return null;
    const value = progress as Partial<LocalSourceAnalysisJobProgress>;
    const completedSegments = Number(value.completedSegments);
    const currentSegment = Number(value.currentSegment);
    const totalSegments = Number(value.totalSegments);
    if (
      !Number.isInteger(completedSegments) ||
      !Number.isInteger(currentSegment) ||
      !Number.isInteger(totalSegments) ||
      totalSegments < 1
    ) {
      return null;
    }
    return {
      completedSegments,
      currentSegment,
      totalSegments,
    };
  }

  private async process(
    job: Job<LocalSourceAnalysisJobData>,
  ): Promise<LocalSourceAnalysis> {
    if (job.name !== LOCAL_SOURCE_ANALYSIS_JOB)
      throw new Error("Trabajo local no reconocido.");
    const source = await this.sources.findOneBy({
      id: job.data.requestSourceId,
    });
    if (!source) throw new Error("El snapshot de la fuente ya no existe.");
    const text = source.snapshotText ?? "";
    const actualSha =
      source.sourceSha256 ?? createHash("sha256").update(text).digest("hex");
    if (actualSha !== job.data.expectedSha256)
      throw new Error(
        "El contenido de la fuente cambió antes del análisis local.",
      );
    let imageBase64: string | undefined;
    if (source.sourceMediaType?.startsWith("image/")) {
      const token = await this.serviceToken.issue();
      const image = await this.sourcesAccess.downloadInternalImage(
        job.data.projectId,
        source.sourceId,
        token,
        job.id ?? source.id,
      );
      if (image.sha256 !== actualSha)
        throw new Error(
          "La imagen descargada no coincide con el SHA-256 esperado.",
        );
      imageBase64 = image.buffer.toString("base64");
    }
    const runtime = job.data.runtime ?? this.config;
    const analyzer = new OllamaSourceAnalyzerService(new OllamaClient(runtime));
    const cancellation = new AbortController();
    this.activeCancellations.set(source.id, cancellation);
    try {
      return await analyzer.analyze(
        {
          sourceId: source.sourceId,
          title: source.sourceTitle ?? "Fuente",
          classification: source.sourceClassification ?? "OTHER",
          text,
          imageBase64,
        },
        cancellation.signal,
        job.data.templateGuidance ?? "",
        job.data.analysisProfile ?? "DEFAULT",
        (progress) => job.updateProgress(progress),
      );
    } finally {
      this.activeCancellations.delete(source.id);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.events.close();
    await this.queue.close();
  }
}
