import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { IntegrationEventsModule } from "@levantamiento-rq/shared-messaging";
import {
  loadSqlServerDatabaseConfig,
  PersistenceModule,
} from "@levantamiento-rq/shared-persistence";

import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { OperationsDocumentsAccessClient } from "../operations/documents-access.client";
import { ExportProcessingQueue } from "../operations/export-processing.queue";
import { ExportRequestsController } from "../operations/export-requests.controller";
import { ExportRequestsService } from "../operations/export-requests.service";
import { operationEntities } from "../operations/operation.entities";
import { OperationsAccessTokenGuard } from "../operations/operations-access-token.guard";
import {
  loadOperationsAuthConfig,
  OPERATIONS_AUTH_CONFIG,
} from "../operations/operations-auth.config";
import {
  loadOperationsProcessingConfig,
  OPERATIONS_PROCESSING_CONFIG,
} from "../operations/operations-processing.config";
import { OperationsProjectsAccessClient } from "../operations/projects-access.client";

const databaseConfig = loadSqlServerDatabaseConfig({
  serviceName: "operations-service",
  defaultDatabaseName: "RqOperationsDb",
});

@Module({
  imports: [
    PersistenceModule.register({
      serviceName: "operations-service",
      defaultDatabaseName: "RqOperationsDb",
    }),
    IntegrationEventsModule.register({ serviceName: "operations-service" }),
    ...(databaseConfig.enabled
      ? [TypeOrmModule.forFeature(operationEntities)]
      : []),
  ],
  controllers: [
    AppController,
    ...(databaseConfig.enabled ? [ExportRequestsController] : []),
  ],
  providers: [
    AppService,
    ...(databaseConfig.enabled
      ? [
          {
            provide: OPERATIONS_AUTH_CONFIG,
            useFactory: loadOperationsAuthConfig,
          },
          {
            provide: OPERATIONS_PROCESSING_CONFIG,
            useFactory: loadOperationsProcessingConfig,
          },
          OperationsAccessTokenGuard,
          OperationsProjectsAccessClient,
          OperationsDocumentsAccessClient,
          ExportProcessingQueue,
          ExportRequestsService,
        ]
      : []),
  ],
})
export class AppModule {}
