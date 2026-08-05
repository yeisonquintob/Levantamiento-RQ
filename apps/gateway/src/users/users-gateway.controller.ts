import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";

import { ACCESS_COOKIE, readCookie } from "../auth/cookies";
import { UsersClientService } from "./users-client.service";

interface RequestLike {
  headers: Readonly<Record<string, string | string[] | undefined>>;
}

function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function context(request: RequestLike): {
  token: string;
  correlationId?: string;
} {
  const token = readCookie(header(request.headers.cookie), ACCESS_COOKIE);

  if (!token) throw new UnauthorizedException("Sesión requerida.");

  return {
    token,
    correlationId: header(request.headers["x-correlation-id"]),
  };
}

@ApiTags("users")
@ApiCookieAuth("rq_access")
@Controller("users")
export class UsersGatewayController {
  constructor(private readonly users: UsersClientService) {}

  @ApiOperation({ summary: "Listar usuarios por medio de Identity" })
  @Get()
  list(
    @Req() request: RequestLike,
    @Query() query: Readonly<Record<string, unknown>>,
  ) {
    const { token, correlationId } = context(request);
    return this.users.list(token, query, correlationId);
  }

  @Get("summary")
  summary(@Req() request: RequestLike) {
    const { token, correlationId } = context(request);
    return this.users.summary(token, correlationId);
  }

  @Get("roles")
  roles(@Req() request: RequestLike) {
    const { token, correlationId } = context(request);
    return this.users.roles(token, correlationId);
  }

  @Get(":userId")
  get(@Req() request: RequestLike, @Param("userId") userId: string) {
    const { token, correlationId } = context(request);
    return this.users.get(token, userId, correlationId);
  }

  @Post()
  create(@Req() request: RequestLike, @Body() body: unknown) {
    const { token, correlationId } = context(request);
    return this.users.create(token, body, correlationId);
  }

  @Patch(":userId")
  update(
    @Req() request: RequestLike,
    @Param("userId") userId: string,
    @Body() body: unknown,
  ) {
    const { token, correlationId } = context(request);
    return this.users.update(token, userId, body, correlationId);
  }

  @Put(":userId/roles")
  setRoles(
    @Req() request: RequestLike,
    @Param("userId") userId: string,
    @Body() body: unknown,
  ) {
    const { token, correlationId } = context(request);
    return this.users.setRoles(token, userId, body, correlationId);
  }

  @Post(":userId/activate")
  activate(@Req() request: RequestLike, @Param("userId") userId: string) {
    const { token, correlationId } = context(request);
    return this.users.action(token, userId, "activate", {}, correlationId);
  }

  @Post(":userId/deactivate")
  deactivate(@Req() request: RequestLike, @Param("userId") userId: string) {
    const { token, correlationId } = context(request);
    return this.users.action(token, userId, "deactivate", {}, correlationId);
  }

  @Post(":userId/reset-password")
  resetPassword(
    @Req() request: RequestLike,
    @Param("userId") userId: string,
    @Body() body: unknown,
  ) {
    const { token, correlationId } = context(request);
    return this.users.resetPassword(token, userId, body, correlationId);
  }

  @Post(":userId/revoke-sessions")
  revokeSessions(
    @Req() request: RequestLike,
    @Param("userId") userId: string,
  ) {
    const { token, correlationId } = context(request);
    return this.users.revokeSessions(token, userId, correlationId);
  }
}
