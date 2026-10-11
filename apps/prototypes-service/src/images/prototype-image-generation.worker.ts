import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Worker } from "bullmq";
import {
  PROTOTYPE_IMAGE_CONFIG,
  type PrototypeImageConfig,
} from "./prototype-image.config";
import {
  PROTOTYPE_IMAGE_GENERATION_JOB,
  type PrototypeImageGenerationJobData,
} from "./prototype-image-generation.queue";
import { PrototypeImageGenerationService } from "./prototype-image-generation.service";

@Injectable()
export class PrototypeImageGenerationWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrototypeImageGenerationWorker.name);
  private worker: Worker<PrototypeImageGenerationJobData> | null = null;
  constructor(
    @Inject(PROTOTYPE_IMAGE_CONFIG)
    private readonly config: PrototypeImageConfig,
    private readonly generation: PrototypeImageGenerationService,
  ) {}
  onModuleInit() {
    this.worker = new Worker(
      this.config.queueName,
      async (job) => {
        if (job.name !== PROTOTYPE_IMAGE_GENERATION_JOB)
          throw new Error(`Trabajo de prototipo no reconocido: ${job.name}.`);
        await this.generation.process(
          job.data,
          job.attemptsMade + 1,
          this.config.attempts,
        );
      },
      {
        connection: this.config.connection,
        concurrency: this.config.concurrency,
      },
    );
    this.worker.on("error", (error) => this.logger.error(error.message));
  }
  async onModuleDestroy() {
    await this.worker?.close();
    this.worker = null;
  }
}
