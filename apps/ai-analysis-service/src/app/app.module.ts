import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import {
  loadSqlServerDatabaseConfig,
  PersistenceModule,
} from "@levantamiento-rq/shared-persistence";

import {
  AI_ANALYSIS_AUTH_CONFIG,
  loadAiAnalysisAuthConfig,
} from "../analysis/ai-analysis-auth.config";
import { AiAnalysisAccessTokenGuard } from "../analysis/ai-analysis-access-token.guard";
import {
  AnalysisExecutionEntity,
  AnalysisRequestEntity,
  AnalysisRequestSourceEntity,
} from "../analysis/entities";
import { AiAnalysisProjectsAccessClient } from "../analysis/projects-access.client";
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
];

@Module({
  imports: [
    PersistenceModule.register({
      serviceName: "ai-analysis-service",
      defaultDatabaseName: "RqAiDb",
    }),
    ...(databaseConfig.enabled
      ? [TypeOrmModule.forFeature(aiAnalysisEntities)]
      : []),
  ],
  controllers: [AppController],
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
        ]
      : []),
  ],
})
export class AppModule {}
