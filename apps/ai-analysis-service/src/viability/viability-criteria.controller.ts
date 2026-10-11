import { Body, Controller, Get, Put, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AiAnalysisAccessTokenGuard } from "../analysis/ai-analysis-access-token.guard";
import type { AiAnalysisRequest } from "../analysis/ai-analysis-request";
import { ViabilityCriteriaService } from "./viability-criteria.service";

@ApiTags("viability-criteria")
@ApiBearerAuth("access-token")
@UseGuards(AiAnalysisAccessTokenGuard)
@Controller("viability-criteria")
export class ViabilityCriteriaController {
  constructor(private readonly service: ViabilityCriteriaService) {}
  @Get() get() { return this.service.get(); }
  @Put() update(@Req() request: AiAnalysisRequest, @Body() body: unknown) {
    if (!request.authPrincipal) throw new Error("No se resolvió el usuario autenticado.");
    return this.service.update(request.authPrincipal, body);
  }
}
