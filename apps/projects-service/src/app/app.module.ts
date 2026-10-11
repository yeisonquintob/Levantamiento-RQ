import { ProjectAuditEntity } from "../projects/project-audit.entity";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import {
  loadSqlServerDatabaseConfig,
  PersistenceModule,
} from "@levantamiento-rq/shared-persistence";

import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import {
  ProjectAreaEntity,
  ProjectEntity,
  ProjectParticipantEntity,
} from "../projects/entities";
import { ProjectAreasController } from "../projects/project-areas.controller";
import { ProjectAreasService } from "../projects/project-areas.service";
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

const projectEntities = [
  ProjectEntity,
  ProjectParticipantEntity,
  ProjectAuditEntity,
  ProjectAreaEntity,
];

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
    ...(databaseConfig.enabled
      ? [ProjectsController, ProjectAreasController]
      : []),
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
          ProjectAreasService,
        ]
      : []),
  ],
})
export class AppModule {}
