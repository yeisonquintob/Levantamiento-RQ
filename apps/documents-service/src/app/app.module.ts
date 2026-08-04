import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import {
  loadSqlServerDatabaseConfig,
  PersistenceModule,
} from "@levantamiento-rq/shared-persistence";

import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { DocumentTemplateEntity } from "../templates/entities";
import {
  DOCUMENTS_AUTH_CONFIG,
  loadDocumentsAuthConfig,
} from "../templates/documents-auth.config";
import { DocumentsAccessTokenGuard } from "../templates/documents-access-token.guard";
import { DocumentTemplatesController } from "../templates/document-templates.controller";
import { DocumentTemplatesService } from "../templates/document-templates.service";

const databaseConfig = loadSqlServerDatabaseConfig({
  serviceName: "documents-service",
  defaultDatabaseName: "RqDocumentsDb",
});

const documentEntities = [DocumentTemplateEntity];

@Module({
  imports: [
    PersistenceModule.register({
      serviceName: "documents-service",
      defaultDatabaseName: "RqDocumentsDb",
    }),
    ...(databaseConfig.enabled
      ? [TypeOrmModule.forFeature(documentEntities)]
      : []),
  ],
  controllers: [
    AppController,
    ...(databaseConfig.enabled
      ? [DocumentTemplatesController]
      : []),
  ],
  providers: [
    AppService,
    ...(databaseConfig.enabled
      ? [
          {
            provide: DOCUMENTS_AUTH_CONFIG,
            useFactory: loadDocumentsAuthConfig,
          },
          DocumentsAccessTokenGuard,
          DocumentTemplatesService,
        ]
      : []),
  ],
})
export class AppModule {}
