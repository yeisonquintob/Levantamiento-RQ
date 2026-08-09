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
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";

import { AiAnalysisAccessTokenGuard } from "../analysis/ai-analysis-access-token.guard";
import type { AiAnalysisRequest } from "../analysis/ai-analysis-request";
import {
  type AiProviderActorContext,
  AiProviderConfigurationsService,
} from "./ai-provider-configurations.service";
import {
  parseCreateAiProviderConfiguration,
  parseProviderConfigurationId,
  parseRotateAiProviderCredential,
  parseUpdateAiProviderConfiguration,
} from "./ai-provider-input";

function actorContext(request: AiAnalysisRequest): AiProviderActorContext {
  if (!request.authPrincipal || !request.correlationId) {
    throw new Error("No se resolvió el contexto autenticado.");
  }
  return {
    actor: request.authPrincipal,
    correlationId: request.correlationId,
  };
}

@ApiTags("ai-providers")
@ApiBearerAuth("access-token")
@UseGuards(AiAnalysisAccessTokenGuard)
@Controller("admin/ai-providers")
export class AiProviderConfigurationsController {
  constructor(private readonly providers: AiProviderConfigurationsService) {}

  @ApiOperation({ summary: "Listar proveedores de IA configurados" })
  @Get()
  list(@Req() request: AiAnalysisRequest) {
    return this.providers.list(actorContext(request));
  }

  @ApiOperation({ summary: "Registrar un proveedor de IA" })
  @ApiResponse({
    status: 201,
    description: "Clave protegida en la bóveda; nunca se devuelve.",
  })
  @Post()
  create(@Req() request: AiAnalysisRequest, @Body() body: unknown) {
    return this.providers.create(
      actorContext(request),
      parseCreateAiProviderConfiguration(body),
    );
  }

  @ApiOperation({ summary: "Actualizar parámetros no secretos" })
  @ApiParam({ name: "providerConfigurationId", format: "uuid" })
  @Patch(":providerConfigurationId")
  update(
    @Req() request: AiAnalysisRequest,
    @Param("providerConfigurationId") providerConfigurationId: string,
    @Body() body: unknown,
  ) {
    return this.providers.update(
      actorContext(request),
      parseProviderConfigurationId(providerConfigurationId),
      parseUpdateAiProviderConfiguration(body),
    );
  }

  @ApiOperation({ summary: "Rotar la credencial protegida" })
  @ApiParam({ name: "providerConfigurationId", format: "uuid" })
  @Post(":providerConfigurationId/credential")
  @HttpCode(200)
  rotateCredential(
    @Req() request: AiAnalysisRequest,
    @Param("providerConfigurationId") providerConfigurationId: string,
    @Body() body: unknown,
  ) {
    return this.providers.rotateCredential(
      actorContext(request),
      parseProviderConfigurationId(providerConfigurationId),
      parseRotateAiProviderCredential(body),
    );
  }

  @ApiOperation({ summary: "Validar credencial, endpoint y modelo" })
  @ApiParam({ name: "providerConfigurationId", format: "uuid" })
  @Post(":providerConfigurationId/test")
  @HttpCode(200)
  testConnection(
    @Req() request: AiAnalysisRequest,
    @Param("providerConfigurationId") providerConfigurationId: string,
  ) {
    return this.providers.testConnection(
      actorContext(request),
      parseProviderConfigurationId(providerConfigurationId),
    );
  }

  @ApiOperation({ summary: "Eliminar un proveedor deshabilitado" })
  @ApiParam({ name: "providerConfigurationId", format: "uuid" })
  @Delete(":providerConfigurationId")
  delete(
    @Req() request: AiAnalysisRequest,
    @Param("providerConfigurationId") providerConfigurationId: string,
  ) {
    return this.providers.delete(
      actorContext(request),
      parseProviderConfigurationId(providerConfigurationId),
    );
  }
}
