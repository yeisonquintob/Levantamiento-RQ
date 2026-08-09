import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import {
  loadSqlServerDatabaseConfig,
  PersistenceModule,
} from "@levantamiento-rq/shared-persistence";
import { IntegrationEventsModule } from "@levantamiento-rq/shared-messaging";

import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import {
  WorkflowReviewActivityEntity,
  WorkflowReviewAssignmentEntity,
  WorkflowReviewRequestEntity,
} from "../reviews/entities";
import { WorkflowDocumentsAccessClient } from "../reviews/documents-access.client";
import { WorkflowProjectsAccessClient } from "../reviews/projects-access.client";
import { WorkflowAccessTokenGuard } from "../reviews/workflow-access-token.guard";
import {
  loadWorkflowAuthConfig,
  WORKFLOW_AUTH_CONFIG,
} from "../reviews/workflow-auth.config";
import { WorkflowReviewsController } from "../reviews/workflow-reviews.controller";
import { WorkflowReviewsService } from "../reviews/workflow-reviews.service";

const databaseConfig = loadSqlServerDatabaseConfig({
  serviceName: "workflow-service",
  defaultDatabaseName: "RqWorkflowDb",
});

const workflowEntities = [
  WorkflowReviewRequestEntity,
  WorkflowReviewAssignmentEntity,
  WorkflowReviewActivityEntity,
];

@Module({
  imports: [
    PersistenceModule.register({
      serviceName: "workflow-service",
      defaultDatabaseName: "RqWorkflowDb",
    }),
    IntegrationEventsModule.register({ serviceName: "workflow-service" }),
    ...(databaseConfig.enabled
      ? [TypeOrmModule.forFeature(workflowEntities)]
      : []),
  ],
  controllers: [
    AppController,
    ...(databaseConfig.enabled ? [WorkflowReviewsController] : []),
  ],
  providers: [
    AppService,
    ...(databaseConfig.enabled
      ? [
          {
            provide: WORKFLOW_AUTH_CONFIG,
            useFactory: loadWorkflowAuthConfig,
          },
          WorkflowAccessTokenGuard,
          WorkflowProjectsAccessClient,
          WorkflowDocumentsAccessClient,
          WorkflowReviewsService,
        ]
      : []),
  ],
})
export class AppModule {}
