import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";

import type { AuthenticatedUser } from "@levantamiento-rq/shared-contracts";

import { DocumentsAccessTokenGuard } from "../templates/documents-access-token.guard";
import type { DocumentsRequest } from "../templates/documents-request";
import {
  parseArchive,
  parseCreateDocument,
  parseCreateVersion,
  parseDocumentId,
  parseProjectId,
  parseReplaceFields,
  parseSectionKey,
  parseTransition,
  parseUpdateDocument,
  parseUpdateSection,
  parseVersionNumber,
} from "./documents-input";
import {
  type DocumentsActorContext,
  DocumentsService,
} from "./documents.service";

function context(request: DocumentsRequest): DocumentsActorContext {
  if (
    !request.authPrincipal ||
    !request.accessToken ||
    !request.correlationId
  ) {
    throw new Error("No se resolvió el contexto autenticado.");
  }

  return {
    actor: request.authPrincipal as AuthenticatedUser,
    accessToken: request.accessToken,
    correlationId: request.correlationId,
  };
}

@ApiTags("documents")
@ApiBearerAuth()
@UseGuards(DocumentsAccessTokenGuard)
@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @ApiOperation({ summary: "Crear un documento para el proyecto" })
  @ApiParam({ name: "projectId", format: "uuid" })
  @ApiBody({ schema: { type: "object", properties: { title: { type: "string" } } } })
  @ApiResponse({ status: 201, description: "Documento y versión inicial creados." })
  @Post("projects/:projectId/documents")
  create(
    @Req() request: DocumentsRequest,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    return this.documents.create(
      context(request),
      parseProjectId(projectId),
      parseCreateDocument(body),
    );
  }

  @ApiOperation({ summary: "Listar documentos del proyecto" })
  @Get("projects/:projectId/documents")
  list(
    @Req() request: DocumentsRequest,
    @Param("projectId") projectId: string,
  ) {
    return this.documents.list(context(request), parseProjectId(projectId));
  }

  @ApiOperation({ summary: "Consultar un documento y su versión actual" })
  @Get("documents/:documentId")
  getById(
    @Req() request: DocumentsRequest,
    @Param("documentId") documentId: string,
  ) {
    return this.documents.getById(context(request), parseDocumentId(documentId));
  }

  @ApiOperation({ summary: "Consultar una versión específica" })
  @Get("documents/:documentId/versions/:versionNumber")
  getVersion(
    @Req() request: DocumentsRequest,
    @Param("documentId") documentId: string,
    @Param("versionNumber") versionNumber: string,
  ) {
    return this.documents.getVersion(
      context(request),
      parseDocumentId(documentId),
      parseVersionNumber(versionNumber),
    );
  }

  @ApiOperation({ summary: "Actualizar metadatos del documento" })
  @Patch("documents/:documentId")
  updateMetadata(
    @Req() request: DocumentsRequest,
    @Param("documentId") documentId: string,
    @Body() body: unknown,
  ) {
    return this.documents.updateMetadata(
      context(request),
      parseDocumentId(documentId),
      parseUpdateDocument(body),
    );
  }

  @ApiOperation({ summary: "Clonar la versión actual como nuevo borrador" })
  @Post("documents/:documentId/versions")
  createVersion(
    @Req() request: DocumentsRequest,
    @Param("documentId") documentId: string,
    @Body() body: unknown,
  ) {
    return this.documents.createVersion(
      context(request),
      parseDocumentId(documentId),
      parseCreateVersion(body),
    );
  }

  @ApiOperation({ summary: "Actualizar el contenido de una sección" })
  @Patch("documents/:documentId/versions/:versionNumber/sections/:sectionKey")
  updateSection(
    @Req() request: DocumentsRequest,
    @Param("documentId") documentId: string,
    @Param("versionNumber") versionNumber: string,
    @Param("sectionKey") sectionKey: string,
    @Body() body: unknown,
  ) {
    return this.documents.updateSection(
      context(request),
      parseDocumentId(documentId),
      parseVersionNumber(versionNumber),
      parseSectionKey(sectionKey),
      parseUpdateSection(body),
    );
  }

  @ApiOperation({ summary: "Reemplazar campos, requisitos, criterios y evidencias" })
  @Patch("documents/:documentId/versions/:versionNumber/fields")
  replaceFields(
    @Req() request: DocumentsRequest,
    @Param("documentId") documentId: string,
    @Param("versionNumber") versionNumber: string,
    @Body() body: unknown,
  ) {
    return this.documents.replaceFields(
      context(request),
      parseDocumentId(documentId),
      parseVersionNumber(versionNumber),
      parseReplaceFields(body),
    );
  }

  @ApiOperation({ summary: "Enviar la versión a validación" })
  @Post("documents/:documentId/versions/:versionNumber/submit-review")
  @HttpCode(200)
  submitReview(
    @Req() request: DocumentsRequest,
    @Param("documentId") documentId: string,
    @Param("versionNumber") versionNumber: string,
    @Body() body: unknown,
  ) {
    return this.documents.submitReview(
      context(request),
      parseDocumentId(documentId),
      parseVersionNumber(versionNumber),
      parseTransition(body),
    );
  }

  @ApiOperation({ summary: "Aprobar y bloquear una versión" })
  @Post("documents/:documentId/versions/:versionNumber/approve")
  @HttpCode(200)
  approve(
    @Req() request: DocumentsRequest,
    @Param("documentId") documentId: string,
    @Param("versionNumber") versionNumber: string,
    @Body() body: unknown,
  ) {
    return this.documents.approve(
      context(request),
      parseDocumentId(documentId),
      parseVersionNumber(versionNumber),
      parseTransition(body),
    );
  }

  @ApiOperation({ summary: "Rechazar una versión en validación" })
  @Post("documents/:documentId/versions/:versionNumber/reject")
  @HttpCode(200)
  reject(
    @Req() request: DocumentsRequest,
    @Param("documentId") documentId: string,
    @Param("versionNumber") versionNumber: string,
    @Body() body: unknown,
  ) {
    return this.documents.reject(
      context(request),
      parseDocumentId(documentId),
      parseVersionNumber(versionNumber),
      parseTransition(body),
    );
  }

  @ApiOperation({ summary: "Consultar el historial documental" })
  @Get("documents/:documentId/history")
  history(
    @Req() request: DocumentsRequest,
    @Param("documentId") documentId: string,
  ) {
    return this.documents.history(context(request), parseDocumentId(documentId));
  }

  @ApiOperation({ summary: "Consultar la plantilla aplicada inmutable" })
  @Get("documents/:documentId/template")
  appliedTemplate(
    @Req() request: DocumentsRequest,
    @Param("documentId") documentId: string,
  ) {
    return this.documents.appliedTemplate(
      context(request),
      parseDocumentId(documentId),
    );
  }

  @ApiOperation({ summary: "Archivar un documento" })
  @Post("documents/:documentId/archive")
  @HttpCode(200)
  archive(
    @Req() request: DocumentsRequest,
    @Param("documentId") documentId: string,
    @Body() body: unknown,
  ) {
    return this.documents.archive(
      context(request),
      parseDocumentId(documentId),
      parseArchive(body),
    );
  }
}
