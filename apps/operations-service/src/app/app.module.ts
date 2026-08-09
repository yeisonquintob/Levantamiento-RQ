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
import { ExportArtifactStorage } from "../operations/export-artifact-storage.service";
import { ExportProcessingQueue } from "../operations/export-processing.queue";
import { ExportProcessingService } from "../operations/export-processing.service";
import { ExportProcessingWorker } from "../operations/export-processing.worker";
import { ExportRequestsController } from "../operations/export-requests.controller";
import { ExportRequestsService } from "../operations/export-requests.service";
import { IntegrationEventInboxService } from "../operations/integration-event-inbox.service";
import { IntegrationEventsConsumer } from "../operations/integration-events.consumer";
import { NotificationsAuditController } from "../operations/notifications-audit.controller";
import { NotificationsAuditService } from "../operations/notifications-audit.service";
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
import {
  loadOperationsNotificationsConfig,
  OPERATIONS_NOTIFICATIONS_CONFIG,
} from "../operations/operations-notifications.config";
import { OperationsServiceToken } from "../operations/operations-service-token.service";
import {
  loadOperationsStorageConfig,
  OPERATIONS_STORAGE_CONFIG,
} from "../operations/operations-storage.config";
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
    ...(databaseConfig.enabled
      ? [ExportRequestsController, NotificationsAuditController]
      : []),
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
          {
            provide: OPERATIONS_STORAGE_CONFIG,
            useFactory: loadOperationsStorageConfig,
          },
          {
            provide: OPERATIONS_NOTIFICATIONS_CONFIG,
            useFactory: loadOperationsNotificationsConfig,
          },
          OperationsAccessTokenGuard,
          OperationsProjectsAccessClient,
          OperationsDocumentsAccessClient,
          OperationsServiceToken,
          ExportArtifactStorage,
          ExportProcessingQueue,
          ExportProcessingService,
          ExportProcessingWorker,
          ExportRequestsService,
          IntegrationEventInboxService,
          IntegrationEventsConsumer,
          NotificationsAuditService,
        ]
      : []),
  ],
})
export class AppModule {}
