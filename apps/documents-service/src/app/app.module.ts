import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import {
  loadSqlServerDatabaseConfig,
  PersistenceModule,
} from "@levantamiento-rq/shared-persistence";

import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import {
  AcceptanceCriterionEntity,
  AppliedAiAnalysisResultEntity,
  AppliedDocumentTemplateEntity,
  DocumentEvidenceEntity,
  DocumentFieldEntity,
  DocumentHistoryEntity,
  DocumentRequirementEntity,
  DocumentSectionEntity,
  DocumentVersionEntity,
  RequirementDocumentEntity,
} from "../documents/entities";
import { DocumentsController } from "../documents/documents.controller";
import { DocumentsService } from "../documents/documents.service";
import { DocumentsProjectsAccessClient } from "../documents/projects-access.client";
import { DocumentsSourcesAccessClient } from "../documents/sources-access.client";
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

const documentEntities = [
  DocumentTemplateEntity,
  AppliedDocumentTemplateEntity,
  RequirementDocumentEntity,
  DocumentVersionEntity,
  DocumentSectionEntity,
  DocumentFieldEntity,
  DocumentRequirementEntity,
  AcceptanceCriterionEntity,
  DocumentEvidenceEntity,
  DocumentHistoryEntity,
  AppliedAiAnalysisResultEntity,
];

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
      ? [DocumentTemplatesController, DocumentsController]
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
          DocumentsProjectsAccessClient,
          DocumentsSourcesAccessClient,
          DocumentsService,
        ]
      : []),
  ],
})
export class AppModule {}
