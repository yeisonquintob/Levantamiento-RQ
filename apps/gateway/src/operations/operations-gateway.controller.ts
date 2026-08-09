import { randomUUID } from "node:crypto";

import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import { ACCESS_COOKIE, readCookie } from "../auth/cookies";
import { OperationsClientService } from "./operations-client.service";

interface RequestLike {
  headers: Readonly<Record<string, string | string[] | undefined>>;
}

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

function token(request: RequestLike): string {
  const cookie = readCookie(first(request.headers.cookie), ACCESS_COOKIE);
  if (cookie) return cookie;
  const match = first(request.headers.authorization)?.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new UnauthorizedException("Sesión requerida.");
  return match[1];
}

const correlation = (request: RequestLike) =>
  first(request.headers["x-correlation-id"])?.trim() || randomUUID();
const idempotency = (request: RequestLike) =>
  first(request.headers["x-idempotency-key"])?.trim() || null;

@ApiTags("exports")
@ApiCookieAuth("rq_access")
@ApiBearerAuth()
@ApiHeader({
  name: "x-idempotency-key",
  required: false,
  description: "Obligatoria al solicitar exportaciones.",
})
@Controller()
export class OperationsGatewayController {
  constructor(private readonly operations: OperationsClientService) {}

  @ApiOperation({ summary: "Solicitar exportación documental" })
  @Post(
    "projects/:projectId/documents/:documentId/versions/:versionNumber/exports",
  )
  create(
    @Req() request: RequestLike,
    @Param("projectId") projectId: string,
    @Param("documentId") documentId: string,
    @Param("versionNumber") versionNumber: string,
    @Body() body: unknown,
  ) {
    return this.operations.createExport(
      token(request),
      correlation(request),
      idempotency(request),
      projectId,
      documentId,
      versionNumber,
      body,
    );
  }

  @ApiOperation({ summary: "Consultar historial de exportaciones" })
  @Get("projects/:projectId/documents/:documentId/exports")
  list(
    @Req() request: RequestLike,
    @Param("projectId") projectId: string,
    @Param("documentId") documentId: string,
  ) {
    return this.operations.listExports(
      token(request),
      correlation(request),
      projectId,
      documentId,
    );
  }

  @ApiOperation({ summary: "Consultar estado de exportación" })
  @Get("exports/:exportRequestId")
  getById(
    @Req() request: RequestLike,
    @Param("exportRequestId") exportRequestId: string,
  ) {
    return this.operations.getExport(
      token(request),
      correlation(request),
      exportRequestId,
    );
  }
}
