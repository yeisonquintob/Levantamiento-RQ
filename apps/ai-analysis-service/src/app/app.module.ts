import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import {
  loadSqlServerDatabaseConfig,
  PersistenceModule,
} from "@levantamiento-rq/shared-persistence";

import {
  AnalysisExecutionEntity,
  AnalysisRequestEntity,
  AnalysisRequestSourceEntity,
} from "../analysis/entities";
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
  providers: [AppService],
})
export class AppModule {}
