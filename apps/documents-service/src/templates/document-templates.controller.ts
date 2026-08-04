import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
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

import { DocumentsAccessTokenGuard } from "./documents-access-token.guard";
import {
  parseCloneDocumentTemplate,
  parseCreateDocumentTemplate,
  parseDocumentTemplateId,
  parseDocumentTemplateListQuery,
  parseUpdateDocumentTemplate,
} from "./document-templates-input";
import { DocumentTemplatesService } from "./document-templates.service";
import type { DocumentsRequest } from "./documents-request";

function requireActor(request: DocumentsRequest): AuthenticatedUser {
  if (!request.authPrincipal) {
    throw new Error("No se resolvió el usuario autenticado.");
  }

  return request.authPrincipal;
}

@ApiTags("templates")
@ApiBearerAuth()
@UseGuards(DocumentsAccessTokenGuard)
@Controller("templates")
export class DocumentTemplatesController {
  constructor(
    private readonly templates: DocumentTemplatesService,
  ) {}

  @ApiOperation({
    summary: "Consultar indicadores del catálogo de plantillas",
  })
  @ApiResponse({ status: 200, description: "Indicadores calculados." })
  @Get("summary")
  summary(@Req() request: DocumentsRequest) {
    return this.templates.metrics(requireActor(request));
  }

  @ApiOperation({ summary: "Listar plantillas documentales" })
  @ApiResponse({
    status: 200,
    description: "Listado paginado de plantillas.",
  })
  @Get()
  list(
    @Req() request: DocumentsRequest,
    @Query() query: unknown,
  ) {
    return this.templates.list(
      requireActor(request),
      parseDocumentTemplateListQuery(query),
    );
  }

  @ApiOperation({ summary: "Crear una plantilla en borrador" })
  @ApiBody({
    schema: {
      type: "object",
      required: [
        "code",
        "name",
        "templateType",
        "version",
        "includesScrum",
      ],
      properties: {
        code: { type: "string", example: "RQ-CUSTOM" },
        name: { type: "string", minLength: 3, maxLength: 200 },
        description: {
          type: "string",
          nullable: true,
          maxLength: 2000,
        },
        templateType: {
          type: "string",
          enum: [
            "SMALL_REQUIREMENT",
            "MEDIUM_REQUIREMENT",
            "LARGE_REQUIREMENT",
            "ERP_FDD",
          ],
        },
        version: { type: "string", example: "1.0.0" },
        includesScrum: { type: "boolean" },
      },
    },
  })
  @ApiResponse({ status: 201, description: "Plantilla creada." })
  @Post()
  create(
    @Req() request: DocumentsRequest,
    @Body() body: unknown,
  ) {
    return this.templates.create(
      requireActor(request),
      parseCreateDocumentTemplate(body),
    );
  }

  @ApiOperation({ summary: "Consultar una plantilla" })
  @ApiParam({ name: "templateId", format: "uuid" })
  @ApiResponse({ status: 200, description: "Detalle de plantilla." })
  @Get(":templateId")
  getById(
    @Req() request: DocumentsRequest,
    @Param("templateId") templateId: string,
  ) {
    return this.templates.getById(
      requireActor(request),
      parseDocumentTemplateId(templateId),
    );
  }

  @ApiOperation({ summary: "Actualizar una plantilla en borrador" })
  @ApiParam({ name: "templateId", format: "uuid" })
  @ApiResponse({ status: 200, description: "Plantilla actualizada." })
  @Patch(":templateId")
  update(
    @Req() request: DocumentsRequest,
    @Param("templateId") templateId: string,
    @Body() body: unknown,
  ) {
    return this.templates.update(
      requireActor(request),
      parseDocumentTemplateId(templateId),
      parseUpdateDocumentTemplate(body),
    );
  }

  @ApiOperation({ summary: "Publicar una plantilla inmutable" })
  @ApiParam({ name: "templateId", format: "uuid" })
  @ApiResponse({ status: 200, description: "Plantilla publicada." })
  @Post(":templateId/publish")
  publish(
    @Req() request: DocumentsRequest,
    @Param("templateId") templateId: string,
  ) {
    return this.templates.publish(
      requireActor(request),
      parseDocumentTemplateId(templateId),
    );
  }

  @ApiOperation({ summary: "Retirar una plantilla publicada" })
  @ApiParam({ name: "templateId", format: "uuid" })
  @ApiResponse({ status: 200, description: "Plantilla retirada." })
  @Post(":templateId/retire")
  retire(
    @Req() request: DocumentsRequest,
    @Param("templateId") templateId: string,
  ) {
    return this.templates.retire(
      requireActor(request),
      parseDocumentTemplateId(templateId),
    );
  }

  @ApiOperation({
    summary: "Clonar una plantilla como nueva versión borrador",
  })
  @ApiParam({ name: "templateId", format: "uuid" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["version"],
      properties: {
        version: { type: "string", example: "1.1.0" },
        name: { type: "string", minLength: 3, maxLength: 200 },
        description: {
          type: "string",
          nullable: true,
          maxLength: 2000,
        },
        includesScrum: { type: "boolean" },
      },
    },
  })
  @ApiResponse({ status: 201, description: "Nueva versión creada." })
  @Post(":templateId/clone")
  clone(
    @Req() request: DocumentsRequest,
    @Param("templateId") templateId: string,
    @Body() body: unknown,
  ) {
    return this.templates.clone(
      requireActor(request),
      parseDocumentTemplateId(templateId),
      parseCloneDocumentTemplate(body),
    );
  }
}
