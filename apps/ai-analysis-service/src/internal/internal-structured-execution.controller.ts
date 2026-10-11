import { randomUUID } from "node:crypto";
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AiAnalysisAccessTokenGuard } from "../analysis/ai-analysis-access-token.guard";
import type { AiAnalysisRequest } from "../analysis/ai-analysis-request";
import {
  InternalStructuredExecutionService,
  parsePrototypePlanningInternalRequest,
  parsePrototypeScreenDetailInternalRequest,
} from "./internal-structured-execution.service";
@ApiTags("internal")
@ApiBearerAuth("access-token")
@UseGuards(AiAnalysisAccessTokenGuard)
@Controller("internal/structured-executions")
export class InternalStructuredExecutionController {
  constructor(
    private readonly executions: InternalStructuredExecutionService,
  ) {}
  @Get("providers")
  options(@Req() request: AiAnalysisRequest) {
    if (request.serviceIdentity !== "prototypes-service") throw new ForbiddenException("Este recurso está reservado para Prototypes Service.");
    return this.executions.options();
  }
  @Post()
  @ApiOperation({ summary: "Ejecutar una planificación estructurada interna" })
  execute(@Req() request: AiAnalysisRequest, @Body() body: unknown) {
    if (request.serviceIdentity !== "prototypes-service")
      throw new ForbiddenException(
        "Este recurso está reservado para Prototypes Service.",
      );
    return this.executions.execute(
      parsePrototypePlanningInternalRequest(body),
      request.correlationId ?? randomCorrelation(),
    );
  }
  @Post("screen-detail")
  @ApiOperation({ summary: "Detallar una pantalla del prototipo con IA" })
  screenDetail(@Req() request: AiAnalysisRequest, @Body() body: unknown) {
    if (request.serviceIdentity !== "prototypes-service")
      throw new ForbiddenException(
        "Este recurso está reservado para Prototypes Service.",
      );
    return this.executions.executeScreenDetail(
      parsePrototypeScreenDetailInternalRequest(body),
      request.correlationId ?? randomCorrelation(),
    );
  }
}
function randomCorrelation(): string {
  return randomUUID();
}
