import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import {
  loadSqlServerDatabaseConfig,
  PersistenceModule,
} from "@levantamiento-rq/shared-persistence";

import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { ProjectEntity, ProjectParticipantEntity } from "../projects/entities";
import { DocumentTemplatesAccessClient } from "../projects/document-templates-access.client";
import {
  loadProjectsAuthConfig,
  PROJECTS_AUTH_CONFIG,
} from "../projects/projects-auth.config";
import { ProjectsAccessTokenGuard } from "../projects/projects-access-token.guard";
import { ProjectsController } from "../projects/projects.controller";
import { ProjectsService } from "../projects/projects.service";

const databaseConfig = loadSqlServerDatabaseConfig({
  serviceName: "projects-service",
  defaultDatabaseName: "RqProjectsDb",
});

const projectEntities = [ProjectEntity, ProjectParticipantEntity];

@Module({
  imports: [
    PersistenceModule.register({
      serviceName: "projects-service",
      defaultDatabaseName: "RqProjectsDb",
    }),
    ...(databaseConfig.enabled
      ? [TypeOrmModule.forFeature(projectEntities)]
      : []),
  ],
  controllers: [
    AppController,
    ...(databaseConfig.enabled ? [ProjectsController] : []),
  ],
  providers: [
    AppService,
    ...(databaseConfig.enabled
      ? [
          {
            provide: PROJECTS_AUTH_CONFIG,
            useFactory: loadProjectsAuthConfig,
          },
          ProjectsAccessTokenGuard,
          DocumentTemplatesAccessClient,
          ProjectsService,
        ]
      : []),
  ],
})
export class AppModule {}
