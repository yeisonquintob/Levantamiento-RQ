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
import { AiAnalysisServiceToken } from "../analysis/ai-analysis-service-token.service";
import { AiAnalysisController } from "../analysis/ai-analysis.controller";
import { AiAnalysisService } from "../analysis/ai-analysis.service";
import { AnalysisExecutionEntity } from "../analysis/analysis-execution.entity";
import { AnalysisPromptVersionEntity } from "../analysis/analysis-prompt-version.entity";
import { AnalysisRequestSourceEntity } from "../analysis/analysis-request-source.entity";
import { AnalysisRequestEntity } from "../analysis/analysis-request.entity";
import { AnalysisResultEntity } from "../analysis/analysis-result.entity";
import { LocalDraftBlockCheckpointEntity } from "../analysis/local-draft-block-checkpoint.entity";
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
import { LOCAL_AI_CONFIG, loadLocalAiConfig } from "../local-ai/ollama.config";
import { OllamaClient } from "../local-ai/ollama.client";
import { OllamaSourceAnalyzerService } from "../local-ai/ollama-source-analyzer.service";
import { LocalAiPipelineService } from "../local-ai/local-ai-pipeline.service";
import { SourceLocalAnalysisEntity } from "../local-ai/source-local-analysis.entity";
import { ProjectKnowledgeSnapshotEntity } from "../local-ai/project-knowledge-snapshot.entity";
import { LocalSourceAnalysisQueue } from "../local-ai/local-source-analysis.queue";
import { LocalAiAuditEntity } from "../local-ai/local-ai-audit.entity";
import { LocalAiSettingsService } from "../local-ai/local-ai-settings.service";
import { AiUsageGuardService } from "../security/ai-usage-guard.service";
import { AiSecurityAuditEntity } from "../security/ai-security-audit.entity";
import { RequirementDiscussionService } from "../discussion/requirement-discussion.service";
import { ViabilityCriterionEntity } from "../viability/viability-criterion.entity";
import { ViabilitySettingEntity } from "../viability/viability-setting.entity";
import { ViabilityCriteriaController } from "../viability/viability-criteria.controller";
import { ViabilityCriteriaService } from "../viability/viability-criteria.service";
import { InternalStructuredExecutionController } from "../internal/internal-structured-execution.controller";
import { InternalStructuredExecutionService } from "../internal/internal-structured-execution.service";
import { InternalImageGenerationController } from "../internal/internal-image-generation.controller";
import { InternalImageGenerationService } from "../internal/internal-image-generation.service";
import {
  PROTOTYPE_IMAGE_GENERATION_CONFIG,
  loadPrototypeImageGenerationConfig,
} from "../internal/prototype-image-generation.config";

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
  LocalDraftBlockCheckpointEntity,
  SourceLocalAnalysisEntity,
  ProjectKnowledgeSnapshotEntity,
  LocalAiAuditEntity,
  AiSecurityAuditEntity,
  ViabilityCriterionEntity,
  ViabilitySettingEntity,
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
      ? [
          AiAnalysisController,
          AiProviderConfigurationsController,
          ViabilityCriteriaController,
          InternalStructuredExecutionController,
          InternalImageGenerationController,
        ]
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
          AiAnalysisServiceToken,
          AiAnalysisService,
          {
            provide: AI_ANALYSIS_PROCESSING_CONFIG,
            useFactory: loadAiAnalysisProcessingConfig,
          },
          AiAnalysisQueue,
          AiUsageGuardService,
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
          ViabilityCriteriaService,
          { provide: LOCAL_AI_CONFIG, useFactory: loadLocalAiConfig },
          OllamaClient,
          OllamaSourceAnalyzerService,
          LocalAiSettingsService,
          LocalSourceAnalysisQueue,
          LocalAiPipelineService,
          RequirementDiscussionService,
          AiAnalysisExecutionService,
          AiAnalysisWorker,
          InternalStructuredExecutionService,
          {
            provide: PROTOTYPE_IMAGE_GENERATION_CONFIG,
            useFactory: loadPrototypeImageGenerationConfig,
          },
          InternalImageGenerationService,
        ]
      : []),
  ],
})
export class AppModule {}
