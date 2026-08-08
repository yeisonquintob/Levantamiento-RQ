import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import {
  loadSqlServerDatabaseConfig,
  PersistenceModule,
} from "@levantamiento-rq/shared-persistence";

import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import {
  WorkflowReviewActivityEntity,
  WorkflowReviewAssignmentEntity,
  WorkflowReviewRequestEntity,
} from "../reviews/entities";

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
    ...(databaseConfig.enabled
      ? [TypeOrmModule.forFeature(workflowEntities)]
      : []),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
