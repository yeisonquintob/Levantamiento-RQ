import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";

import type {
  CloneDocumentTemplateRequest,
  CreateDocumentTemplateRequest,
  UpdateDocumentTemplateRequest,
} from "@levantamiento-rq/shared-contracts";

import { ACCESS_COOKIE, readCookie } from "../auth/cookies";
import { DocumentTemplatesClientService } from "./document-templates-client.service";

interface RequestLike {
  headers: Readonly<Record<string, string | string[] | undefined>>;
}

function firstHeader(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function requireAccessToken(request: RequestLike): string {
  const cookieToken = readCookie(
    firstHeader(request.headers.cookie),
    ACCESS_COOKIE,
  );

  if (cookieToken) {
    return cookieToken;
  }

  const authorization = firstHeader(
    request.headers.authorization,
  );
  const match = authorization?.match(/^Bearer\s+(.+)$/i);

  if (!match?.[1]) {
    throw new UnauthorizedException("Sesión requerida.");
  }

  return match[1];
}

@ApiTags("templates")
@ApiCookieAuth("rq_access")
@ApiBearerAuth()
@Controller("templates")
export class DocumentTemplatesGatewayController {
  constructor(
    private readonly templates: DocumentTemplatesClientService,
  ) {}

  @ApiOperation({
    summary: "Consultar indicadores del catálogo de plantillas",
  })
  @Get("summary")
  summary(@Req() request: RequestLike) {
    return this.templates.summary(requireAccessToken(request));
  }

  @ApiOperation({ summary: "Listar plantillas documentales" })
  @Get()
  list(
    @Req() request: RequestLike,
    @Query() query: Readonly<Record<string, unknown>>,
  ) {
    return this.templates.list(
      requireAccessToken(request),
      query,
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
    },
  })
  @ApiResponse({ status: 201, description: "Plantilla creada." })
  @Post()
  create(
    @Req() request: RequestLike,
    @Body() body: CreateDocumentTemplateRequest | unknown,
  ) {
    return this.templates.create(
      requireAccessToken(request),
      body,
    );
  }

  @ApiOperation({ summary: "Consultar una plantilla" })
  @ApiParam({ name: "templateId", format: "uuid" })
  @Get(":templateId")
  getById(
    @Req() request: RequestLike,
    @Param("templateId") templateId: string,
  ) {
    return this.templates.getById(
      requireAccessToken(request),
      templateId,
    );
  }

  @ApiOperation({ summary: "Actualizar una plantilla en borrador" })
  @ApiParam({ name: "templateId", format: "uuid" })
  @Patch(":templateId")
  update(
    @Req() request: RequestLike,
    @Param("templateId") templateId: string,
    @Body() body: UpdateDocumentTemplateRequest | unknown,
  ) {
    return this.templates.update(
      requireAccessToken(request),
      templateId,
      body,
    );
  }

  @ApiOperation({ summary: "Publicar una plantilla inmutable" })
  @ApiParam({ name: "templateId", format: "uuid" })
  @Post(":templateId/publish")
  publish(
    @Req() request: RequestLike,
    @Param("templateId") templateId: string,
  ) {
    return this.templates.publish(
      requireAccessToken(request),
      templateId,
    );
  }

  @ApiOperation({ summary: "Retirar una plantilla publicada" })
  @ApiParam({ name: "templateId", format: "uuid" })
  @Post(":templateId/retire")
  retire(
    @Req() request: RequestLike,
    @Param("templateId") templateId: string,
  ) {
    return this.templates.retire(
      requireAccessToken(request),
      templateId,
    );
  }

  @ApiOperation({
    summary: "Clonar una plantilla como nueva versión borrador",
  })
  @ApiParam({ name: "templateId", format: "uuid" })
  @Post(":templateId/clone")
  clone(
    @Req() request: RequestLike,
    @Param("templateId") templateId: string,
    @Body() body: CloneDocumentTemplateRequest | unknown,
  ) {
    return this.templates.clone(
      requireAccessToken(request),
      templateId,
      body,
    );
  }
}
