import {
  Body,
  Controller,
  Delete,
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
  parseApplyAiDraft,
  parseCreateDocument,
  parseCreateVersion,
  parseDocumentId,
  parseProjectId,
  parseReplaceFields,
  parseSectionKey,
  parseTransition,
  parseUpdateDocument,
  parseUpdateSection,
  validateDocumentSectionContent,
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
  @ApiBody({
    schema: { type: "object", properties: { title: { type: "string" } } },
  })
  @ApiResponse({
    status: 201,
    description: "Documento y versión inicial creados.",
  })
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

  @ApiOperation({
    summary: "Eliminar definitivamente los documentos del proyecto",
  })
  @Delete("projects/:projectId/documents")
  @HttpCode(200)
  purgeProject(
    @Req() request: DocumentsRequest,
    @Param("projectId") projectId: string,
  ) {
    return this.documents.purgeProject(
      context(request),
      parseProjectId(projectId),
    );
  }

  @ApiOperation({ summary: "Consultar un documento y su versión actual" })
  @Get("documents/:documentId")
  getById(
    @Req() request: DocumentsRequest,
    @Param("documentId") documentId: string,
  ) {
    return this.documents.getById(
      context(request),
      parseDocumentId(documentId),
    );
  }

  @ApiOperation({
    summary: "Listar todas las versiones existentes del documento",
  })
  @Get("documents/:documentId/versions")
  listVersions(
    @Req() request: DocumentsRequest,
    @Param("documentId") documentId: string,
  ) {
    return this.documents.listVersions(
      context(request),
      parseDocumentId(documentId),
    );
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

  @ApiOperation({
    summary: "Eliminar una versión que todavía está en borrador",
  })
  @Delete("documents/:documentId/versions/:versionNumber")
  @HttpCode(200)
  deleteDraftVersion(
    @Req() request: DocumentsRequest,
    @Param("documentId") documentId: string,
    @Param("versionNumber") versionNumber: string,
  ) {
    return this.documents.deleteDraftVersion(
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
    const parsedSectionKey = parseSectionKey(sectionKey);
    const parsedRequest = parseUpdateSection(body);
    validateDocumentSectionContent(parsedSectionKey, parsedRequest.content);
    return this.documents.updateSection(
      context(request),
      parseDocumentId(documentId),
      parseVersionNumber(versionNumber),
      parsedSectionKey,
      parsedRequest,
    );
  }

  @ApiOperation({
    summary: "Reemplazar campos, requisitos, criterios y evidencias",
  })
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

  @ApiOperation({
    summary: "Aplicar de forma atómica un borrador de IA revisado",
  })
  @Patch("documents/:documentId/versions/:versionNumber/apply-ai-draft")
  applyAiDraft(
    @Req() request: DocumentsRequest,
    @Param("documentId") documentId: string,
    @Param("versionNumber") versionNumber: string,
    @Body() body: unknown,
  ) {
    return this.documents.applyAiDraft(
      context(request),
      parseDocumentId(documentId),
      parseVersionNumber(versionNumber),
      parseApplyAiDraft(body),
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

  @ApiOperation({ summary: "Reabrir una versión para aplicar correcciones" })
  @Post("documents/:documentId/versions/:versionNumber/request-changes")
  @HttpCode(200)
  requestChanges(
    @Req() request: DocumentsRequest,
    @Param("documentId") documentId: string,
    @Param("versionNumber") versionNumber: string,
    @Body() body: unknown,
  ) {
    return this.documents.requestChanges(
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
    return this.documents.history(
      context(request),
      parseDocumentId(documentId),
    );
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
