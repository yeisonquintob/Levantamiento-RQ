import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import type {
  ArchiveRequirementDocumentRequest,
  CreateDocumentVersionRequest,
  CreateRequirementDocumentRequest,
  ReplaceDocumentFieldsRequest,
  UpdateDocumentSectionRequest,
  UpdateRequirementDocumentRequest,
} from "@levantamiento-rq/shared-contracts";

import { ACCESS_COOKIE, readCookie } from "../auth/cookies";
import { DocumentsClientService } from "./documents-client.service";

interface RequestLike {
  headers: Readonly<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function accessToken(request: RequestLike): string {
  const cookie = readCookie(first(request.headers.cookie), ACCESS_COOKIE);
  if (cookie) return cookie;
  const match = first(request.headers.authorization)?.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new UnauthorizedException("Sesión requerida.");
  return match[1];
}

function correlationId(request: RequestLike): string {
  return first(request.headers["x-correlation-id"])?.trim() || randomUUID();
}

@ApiTags("documents")
@ApiCookieAuth("rq_access")
@ApiBearerAuth()
@Controller()
export class DocumentsGatewayController {
  constructor(private readonly documents: DocumentsClientService) {}

  @ApiOperation({ summary: "Crear un documento" })
  @Post("projects/:projectId/documents")
  create(
    @Req() req: RequestLike,
    @Param("projectId") projectId: string,
    @Body() body: CreateRequirementDocumentRequest | unknown,
  ) {
    return this.documents.create(
      accessToken(req),
      correlationId(req),
      projectId,
      body,
    );
  }

  @ApiOperation({ summary: "Listar documentos del proyecto" })
  @Get("projects/:projectId/documents")
  list(@Req() req: RequestLike, @Param("projectId") projectId: string) {
    return this.documents.list(accessToken(req), correlationId(req), projectId);
  }

  @ApiOperation({ summary: "Consultar un documento" })
  @Get("documents/:documentId")
  getById(@Req() req: RequestLike, @Param("documentId") documentId: string) {
    return this.documents.getById(
      accessToken(req),
      correlationId(req),
      documentId,
    );
  }

  @ApiOperation({ summary: "Consultar una versión" })
  @Get("documents/:documentId/versions/:versionNumber")
  getVersion(
    @Req() req: RequestLike,
    @Param("documentId") documentId: string,
    @Param("versionNumber") versionNumber: string,
  ) {
    return this.documents.getVersion(
      accessToken(req),
      correlationId(req),
      documentId,
      versionNumber,
    );
  }

  @ApiOperation({ summary: "Actualizar metadatos" })
  @Patch("documents/:documentId")
  updateMetadata(
    @Req() req: RequestLike,
    @Param("documentId") documentId: string,
    @Body() body: UpdateRequirementDocumentRequest | unknown,
  ) {
    return this.documents.updateMetadata(
      accessToken(req),
      correlationId(req),
      documentId,
      body,
    );
  }

  @ApiOperation({ summary: "Crear una nueva versión" })
  @Post("documents/:documentId/versions")
  createVersion(
    @Req() req: RequestLike,
    @Param("documentId") documentId: string,
    @Body() body: CreateDocumentVersionRequest | unknown,
  ) {
    return this.documents.createVersion(
      accessToken(req),
      correlationId(req),
      documentId,
      body,
    );
  }

  @ApiOperation({ summary: "Actualizar una sección" })
  @Patch("documents/:documentId/versions/:versionNumber/sections/:sectionKey")
  updateSection(
    @Req() req: RequestLike,
    @Param("documentId") documentId: string,
    @Param("versionNumber") versionNumber: string,
    @Param("sectionKey") sectionKey: string,
    @Body() body: UpdateDocumentSectionRequest | unknown,
  ) {
    return this.documents.updateSection(
      accessToken(req),
      correlationId(req),
      documentId,
      versionNumber,
      sectionKey,
      body,
    );
  }

  @ApiOperation({ summary: "Actualizar contenido estructurado" })
  @Patch("documents/:documentId/versions/:versionNumber/fields")
  replaceFields(
    @Req() req: RequestLike,
    @Param("documentId") documentId: string,
    @Param("versionNumber") versionNumber: string,
    @Body() body: ReplaceDocumentFieldsRequest | unknown,
  ) {
    return this.documents.replaceFields(
      accessToken(req),
      correlationId(req),
      documentId,
      versionNumber,
      body,
    );
  }

  @ApiOperation({ summary: "Consultar historial" })
  @Get("documents/:documentId/history")
  history(@Req() req: RequestLike, @Param("documentId") documentId: string) {
    return this.documents.history(
      accessToken(req),
      correlationId(req),
      documentId,
    );
  }

  @ApiOperation({ summary: "Consultar plantilla aplicada" })
  @Get("documents/:documentId/template")
  template(@Req() req: RequestLike, @Param("documentId") documentId: string) {
    return this.documents.appliedTemplate(
      accessToken(req),
      correlationId(req),
      documentId,
    );
  }

  @ApiOperation({ summary: "Archivar documento" })
  @Post("documents/:documentId/archive")
  @HttpCode(200)
  archive(
    @Req() req: RequestLike,
    @Param("documentId") documentId: string,
    @Body() body: ArchiveRequirementDocumentRequest | unknown,
  ) {
    return this.documents.archive(
      accessToken(req),
      correlationId(req),
      documentId,
      body,
    );
  }
}
