import { UsersClientService } from "../users/users-client.service";
import { randomUUID } from "node:crypto";

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Query,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";

import { ACCESS_COOKIE, readCookie } from "../auth/cookies";
import { AiAnalysisClientService } from "./ai-analysis-client.service";

interface RequestLike {
  headers: Readonly<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function context(request: RequestLike): {
  token: string;
  correlationId: string;
} {
  const token = readCookie(first(request.headers.cookie), ACCESS_COOKIE);
  if (!token) throw new UnauthorizedException("Sesión requerida.");
  return {
    token,
    correlationId:
      first(request.headers["x-correlation-id"])?.trim() || randomUUID(),
  };
}

@ApiTags("ai-providers")
@ApiCookieAuth("rq_access")
@Controller("admin/ai-providers")
export class AiProviderConfigurationsGatewayController {
  constructor(
    private readonly analysis: AiAnalysisClientService,
    private readonly users: UsersClientService,
  ) {}

  @Get("audit-events")
  async auditHistory(
    @Req() request: RequestLike,
    @Query() query: Readonly<Record<string, unknown>>,
  ) {
    const { token, correlationId } = context(request);
    return this.users.resolveAuditActors(
      await this.analysis.auditHistory(token, query, correlationId),
      token,
      correlationId,
    );
  }

  @Get()
  @ApiOperation({ summary: "Listar configuraciones de proveedores de IA" })
  list(@Req() request: RequestLike) {
    const { token, correlationId } = context(request);
    return this.analysis.listProviders(token, correlationId);
  }

  @Get("ollama/models")
  listOllamaModels(
    @Req() request: RequestLike,
    @Query("baseUrl") baseUrl: string,
  ) {
    const { token, correlationId } = context(request);
    return this.analysis.listOllamaModels(token, correlationId, baseUrl);
  }

  @Get("openai-compatible/models")
  listOpenAiCompatibleModels(
    @Req() request: RequestLike,
    @Query("baseUrl") baseUrl: string,
  ) {
    const { token, correlationId } = context(request);
    return this.analysis.listOpenAiCompatibleModels(
      token,
      correlationId,
      baseUrl,
    );
  }

  @Get(":providerConfigurationId/openai/models")
  @ApiOperation({
    summary: "Listar los modelos disponibles para una clave OpenAI",
  })
  listOpenAiModels(
    @Req() request: RequestLike,
    @Param("providerConfigurationId") providerConfigurationId: string,
  ) {
    const { token, correlationId } = context(request);
    return this.analysis.listOpenAiModels(
      token,
      correlationId,
      providerConfigurationId,
    );
  }

  @Post()
  create(@Req() request: RequestLike, @Body() body: unknown) {
    const { token, correlationId } = context(request);
    return this.analysis.createProvider(token, correlationId, body);
  }

  @Post(":providerConfigurationId/duplicate")
  duplicate(
    @Req() request: RequestLike,
    @Param("providerConfigurationId") id: string,
    @Body() body: unknown,
  ) {
    const { token, correlationId } = context(request);
    return this.analysis.duplicateProvider(token, correlationId, id, body);
  }

  @Patch(":providerConfigurationId")
  update(
    @Req() request: RequestLike,
    @Param("providerConfigurationId") id: string,
    @Body() body: unknown,
  ) {
    const { token, correlationId } = context(request);
    return this.analysis.updateProvider(token, correlationId, id, body);
  }

  @Post(":providerConfigurationId/credential")
  rotateCredential(
    @Req() request: RequestLike,
    @Param("providerConfigurationId") id: string,
    @Body() body: unknown,
  ) {
    const { token, correlationId } = context(request);
    return this.analysis.rotateProviderCredential(
      token,
      correlationId,
      id,
      body,
    );
  }

  @Post(":providerConfigurationId/test")
  test(
    @Req() request: RequestLike,
    @Param("providerConfigurationId") id: string,
  ) {
    const { token, correlationId } = context(request);
    return this.analysis.testProvider(token, correlationId, id);
  }

  @Delete(":providerConfigurationId")
  delete(
    @Req() request: RequestLike,
    @Param("providerConfigurationId") id: string,
  ) {
    const { token, correlationId } = context(request);
    return this.analysis.deleteProvider(token, correlationId, id);
  }
}
