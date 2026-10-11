import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  createSqlServerDataSourceOptions,
  loadSqlServerDatabaseConfig,
} from "@levantamiento-rq/shared-persistence";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { PrototypeGenerationEntity } from "../prototypes/prototype-generation.entity";
import { PrototypeScreenEntity } from "../prototypes/prototype-screen.entity";
import { PrototypeGenerationService } from "../prototypes/prototype-generation.service";
import { PrototypesController } from "../prototypes/prototypes.controller";
import { PrototypesAccessTokenGuard } from "../prototypes/prototypes-access-token.guard";
import {
  loadPrototypesAuthConfig,
  PROTOTYPES_AUTH_CONFIG,
} from "../prototypes/prototypes-auth.config";
import { AiAnalysisStructuredExecutionClient } from "../planning/ai-analysis-structured-execution.client";
import { OpenAiPrototypePlannerProvider } from "../planning/openai-prototype-planner.provider";
import { PrototypePlanningService } from "../planning/prototype-planning.service";
import { PROTOTYPE_PLANNER_PROVIDER } from "../planning/prototype-planner.provider";
import { PrototypesServiceToken } from "../prototypes/prototypes-service-token.service";
import { PrototypeVisualSpecificationEntity } from "../visual/prototype-visual-specification.entity";
import { PrototypeVisualSpecificationBuilder } from "../visual/prototype-visual-specification.builder";
import { PrototypeVisualSpecificationService } from "../visual/prototype-visual-specification.service";
import { PrototypeImagePromptBuilder } from "../visual/prototype-image-prompt.builder";
import { PrototypeGeneratedImageEntity } from "../images/prototype-generated-image.entity";
import {
  PROTOTYPE_IMAGE_CONFIG,
  loadPrototypeImageConfig,
} from "../images/prototype-image.config";
import { PrototypeImageGenerationQueue } from "../images/prototype-image-generation.queue";
import { PrototypeImageGenerationService } from "../images/prototype-image-generation.service";
import { PrototypeImageGenerationWorker } from "../images/prototype-image-generation.worker";
import { PrototypeImageBlobStorage } from "../images/prototype-image-blob.storage";
import { PrototypeImageSizeMapper } from "../images/prototype-image-size.mapper";
import { AiAnalysisImageGenerationClient } from "../images/ai-analysis-image-generation.client";
import { OpenAiPrototypeImageProvider } from "../images/openai-prototype-image.provider";
import { PROTOTYPE_IMAGE_PROVIDER } from "../images/prototype-image.provider";
import { PrototypeImagesController } from "../images/prototype-images.controller";

// RQ_PROTOTYPES_EXPLICIT_TYPEORM_ENTITIES_V1
// El DataSource de ejecución debe conocer explícitamente las mismas entidades
// usadas por TypeOrmModule.forFeature(). Esto evita depender exclusivamente
// de autoLoadEntities durante el bundle del servicio.
const prototypeEntities = [
  PrototypeGenerationEntity,
  PrototypeScreenEntity,
  PrototypeVisualSpecificationEntity,
  PrototypeGeneratedImageEntity,
];

const databaseConfig = loadSqlServerDatabaseConfig({
  serviceName: "prototypes-service",
  defaultDatabaseName: "RqPrototypesDb",
});
@Module({
  imports: [
    ...(databaseConfig.enabled
      ? [
          TypeOrmModule.forRoot({
            ...createSqlServerDataSourceOptions(databaseConfig),
            entities: prototypeEntities,
          }),
          TypeOrmModule.forFeature(prototypeEntities),
        ]
      : []),
  ],
  controllers: [
    AppController,
    ...(databaseConfig.enabled
      ? [PrototypesController, PrototypeImagesController]
      : []),
  ],
  providers: [
    AppService,
    ...(databaseConfig.enabled
      ? [
          {
            provide: PROTOTYPES_AUTH_CONFIG,
            useFactory: loadPrototypesAuthConfig,
          },
          PrototypesAccessTokenGuard,
          PrototypeGenerationService,
          PrototypesServiceToken,
          AiAnalysisStructuredExecutionClient,
          OpenAiPrototypePlannerProvider,
          {
            provide: PROTOTYPE_PLANNER_PROVIDER,
            useExisting: OpenAiPrototypePlannerProvider,
          },
          PrototypePlanningService,
          PrototypeVisualSpecificationBuilder,
          PrototypeVisualSpecificationService,
          PrototypeImagePromptBuilder,
          {
            provide: PROTOTYPE_IMAGE_CONFIG,
            useFactory: loadPrototypeImageConfig,
          },
          PrototypeImageBlobStorage,
          PrototypeImageSizeMapper,
          PrototypeImageGenerationQueue,
          AiAnalysisImageGenerationClient,
          OpenAiPrototypeImageProvider,
          {
            provide: PROTOTYPE_IMAGE_PROVIDER,
            useExisting: OpenAiPrototypeImageProvider,
          },
          PrototypeImageGenerationService,
          PrototypeImageGenerationWorker,
        ]
      : []),
  ],
})
export class AppModule {}
