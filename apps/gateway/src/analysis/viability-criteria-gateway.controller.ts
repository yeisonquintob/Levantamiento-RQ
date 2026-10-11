import { randomUUID } from "node:crypto";
import {
  Body,
  Controller,
  Get,
  Put,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { ACCESS_COOKIE, readCookie } from "../auth/cookies";
import { AiAnalysisClientService } from "./ai-analysis-client.service";

interface RequestLike {
  headers: Readonly<Record<string, string | string[] | undefined>>;
}
function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
function context(request: RequestLike) {
  const token = readCookie(first(request.headers.cookie), ACCESS_COOKIE);
  if (!token) throw new UnauthorizedException("Sesión requerida.");
  return {
    token,
    correlationId:
      first(request.headers["x-correlation-id"])?.trim() || randomUUID(),
  };
}

@ApiTags("viability-criteria")
@ApiCookieAuth("rq_access")
@Controller("viability-criteria")
export class ViabilityCriteriaGatewayController {
  constructor(private readonly analysis: AiAnalysisClientService) {}
  @Get() get(@Req() request: RequestLike) {
    const ctx = context(request);
    return this.analysis.getViabilityCriteria(ctx.token, ctx.correlationId);
  }
  @Put() update(@Req() request: RequestLike, @Body() body: unknown) {
    const ctx = context(request);
    return this.analysis.updateViabilityCriteria(
      ctx.token,
      ctx.correlationId,
      body,
    );
  }
}
