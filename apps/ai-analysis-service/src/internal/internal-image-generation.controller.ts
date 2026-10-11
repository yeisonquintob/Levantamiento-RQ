import { randomUUID } from "node:crypto";
import {
  Body,
  Controller,
  ForbiddenException,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AiAnalysisAccessTokenGuard } from "../analysis/ai-analysis-access-token.guard";
import type { AiAnalysisRequest } from "../analysis/ai-analysis-request";
import {
  InternalImageGenerationService,
  parsePrototypeImageGenerationInternalRequest,
} from "./internal-image-generation.service";

@ApiTags("internal")
@ApiBearerAuth("access-token")
@UseGuards(AiAnalysisAccessTokenGuard)
@Controller("internal/image-generations")
export class InternalImageGenerationController {
  constructor(private readonly images: InternalImageGenerationService) {}
  @Post()
  @ApiOperation({ summary: "Generar una imagen interna de prototipo" })
  generate(@Req() request: AiAnalysisRequest, @Body() body: unknown) {
    if (request.serviceIdentity !== "prototypes-service")
      throw new ForbiddenException(
        "Este recurso está reservado para Prototypes Service.",
      );
    return this.images.generate(
      parsePrototypeImageGenerationInternalRequest(body),
      request.correlationId ?? randomUUID(),
    );
  }
}
