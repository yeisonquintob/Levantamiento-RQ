import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import {
  loadSqlServerDatabaseConfig,
  PersistenceModule,
} from "@levantamiento-rq/shared-persistence";

import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { SourceBlobStorage } from "../sources/source-blob-storage.service";
import { SourceEntity } from "../sources/entities";
import { SourceExtractionService } from "../sources/source-extraction.service";
import { ProjectsAccessClient } from "../sources/projects-access.client";
import {
  loadSourcesAuthConfig,
  SOURCES_AUTH_CONFIG,
} from "../sources/sources-auth.config";
import { SourcesAccessTokenGuard } from "../sources/sources-access-token.guard";
import { SourcesController } from "../sources/sources.controller";
import { SourcesService } from "../sources/sources.service";
import {
  loadSourcesStorageConfig,
  SOURCES_STORAGE_CONFIG,
} from "../sources/sources-storage.config";

const databaseConfig = loadSqlServerDatabaseConfig({
  serviceName: "sources-service",
  defaultDatabaseName: "RqSourcesDb",
});

const sourceEntities = [SourceEntity];

@Module({
  imports: [
    PersistenceModule.register({
      serviceName: "sources-service",
      defaultDatabaseName: "RqSourcesDb",
    }),
    ...(databaseConfig.enabled
      ? [TypeOrmModule.forFeature(sourceEntities)]
      : []),
  ],
  controllers: [
    AppController,
    ...(databaseConfig.enabled ? [SourcesController] : []),
  ],
  providers: [
    AppService,
    ...(databaseConfig.enabled
      ? [
          {
            provide: SOURCES_AUTH_CONFIG,
            useFactory: loadSourcesAuthConfig,
          },
          {
            provide: SOURCES_STORAGE_CONFIG,
            useFactory: loadSourcesStorageConfig,
          },
          SourcesAccessTokenGuard,
          ProjectsAccessClient,
          SourceBlobStorage,
          SourceExtractionService,
          SourcesService,
        ]
      : []),
  ],
})
export class AppModule {}
