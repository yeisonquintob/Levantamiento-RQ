import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import {
  loadSqlServerDatabaseConfig,
  PersistenceModule,
} from "@levantamiento-rq/shared-persistence";
import { IntegrationEventsModule } from "@levantamiento-rq/shared-messaging";

import {
  AI_ANALYSIS_AUTH_CONFIG,
  loadAiAnalysisAuthConfig,
} from "../analysis/ai-analysis-auth.config";
import { AiAnalysisAccessTokenGuard } from "../analysis/ai-analysis-access-token.guard";
import { AiAnalysisController } from "../analysis/ai-analysis.controller";
import { AiAnalysisService } from "../analysis/ai-analysis.service";
import { AnalysisExecutionEntity } from "../analysis/analysis-execution.entity";
import { AnalysisPromptVersionEntity } from "../analysis/analysis-prompt-version.entity";
import { AnalysisRequestSourceEntity } from "../analysis/analysis-request-source.entity";
import { AnalysisRequestEntity } from "../analysis/analysis-request.entity";
import { AnalysisResultEntity } from "../analysis/analysis-result.entity";
import { AiAnalysisDocumentsAccessClient } from "../analysis/documents-access.client";
import { AiAnalysisProjectsAccessClient } from "../analysis/projects-access.client";
import { AiAnalysisSourcesAccessClient } from "../analysis/sources-access.client";
import { AiAnalysisExecutionService } from "../execution/ai-analysis-execution.service";
import {
  AI_ANALYSIS_PROCESSING_CONFIG,
  loadAiAnalysisProcessingConfig,
} from "../execution/ai-analysis-processing.config";
import { AiAnalysisWorker } from "../execution/ai-analysis.worker";
import { AiAnalysisQueue } from "../execution/ai-analysis.queue";
import { AiProviderAuditEntity } from "../providers/ai-provider-audit.entity";
import { AiProviderConfigurationEntity } from "../providers/ai-provider-configuration.entity";
import { AiProviderConfigurationsController } from "../providers/ai-provider-configurations.controller";
import { AiProviderConfigurationsService } from "../providers/ai-provider-configurations.service";
import {
  AI_PROVIDER_RUNTIME_CONFIG,
  loadAiProviderRuntimeConfig,
} from "../providers/ai-provider.config";
import {
  AI_SECRET_VAULT,
  PlatformAiSecretVault,
} from "../providers/ai-secret-vault";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";

const databaseConfig = loadSqlServerDatabaseConfig({
  serviceName: "ai-analysis-service",
  defaultDatabaseName: "RqAiDb",
});

const aiAnalysisEntities = [
  AnalysisRequestEntity,
  AnalysisRequestSourceEntity,
  AnalysisExecutionEntity,
  AiProviderConfigurationEntity,
  AiProviderAuditEntity,
  AnalysisPromptVersionEntity,
  AnalysisResultEntity,
];

@Module({
  imports: [
    PersistenceModule.register({
      serviceName: "ai-analysis-service",
      defaultDatabaseName: "RqAiDb",
    }),
    IntegrationEventsModule.register({
      serviceName: "ai-analysis-service",
    }),
    ...(databaseConfig.enabled
      ? [TypeOrmModule.forFeature(aiAnalysisEntities)]
      : []),
  ],
  controllers: [
    AppController,
    ...(databaseConfig.enabled
      ? [AiAnalysisController, AiProviderConfigurationsController]
      : []),
  ],
  providers: [
    AppService,
    ...(databaseConfig.enabled
      ? [
          {
            provide: AI_ANALYSIS_AUTH_CONFIG,
            useFactory: loadAiAnalysisAuthConfig,
          },
          AiAnalysisAccessTokenGuard,
          AiAnalysisProjectsAccessClient,
          AiAnalysisDocumentsAccessClient,
          AiAnalysisSourcesAccessClient,
          AiAnalysisService,
          {
            provide: AI_ANALYSIS_PROCESSING_CONFIG,
            useFactory: loadAiAnalysisProcessingConfig,
          },
          AiAnalysisQueue,
          {
            provide: AI_PROVIDER_RUNTIME_CONFIG,
            useFactory: loadAiProviderRuntimeConfig,
          },
          PlatformAiSecretVault,
          {
            provide: AI_SECRET_VAULT,
            useExisting: PlatformAiSecretVault,
          },
          AiProviderConfigurationsService,
          AiAnalysisExecutionService,
          AiAnalysisWorker,
        ]
      : []),
  ],
})
export class AppModule {}
