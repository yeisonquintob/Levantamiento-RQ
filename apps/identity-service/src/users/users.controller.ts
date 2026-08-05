import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import type {
  AuthenticatedUser,
  IdentityUserStatus,
} from "@levantamiento-rq/shared-contracts";

import { AccessTokenGuard } from "../auth/access-token.guard";
import {
  PermissionsGuard,
  RequirePermissions,
} from "../auth/permissions.guard";
import type { AuthenticatedRequest } from "../auth/auth-request";
import {
  asRecord,
  email,
  optionalText,
  pagination,
  roleCodes,
  text,
} from "./users-input";
import { UsersService } from "./users.service";

function actorOf(request: AuthenticatedRequest): AuthenticatedUser {
  if (!request.authPrincipal) {
    throw new BadRequestException("No se resolvió la identidad.");
  }

  return request.authPrincipal;
}

function listQuery(query: Readonly<Record<string, unknown>>) {
  const search =
    typeof query.search === "string" && query.search.trim()
      ? query.search.trim().slice(0, 200)
      : undefined;
  const rawStatus =
    typeof query.status === "string" ? query.status.toUpperCase() : undefined;
  const status = rawStatus as IdentityUserStatus | undefined;

  if (status && status !== "ACTIVE" && status !== "INACTIVE") {
    throw new BadRequestException("El estado de usuario no es válido.");
  }

  const roleCode =
    typeof query.roleCode === "string" && query.roleCode.trim()
      ? query.roleCode.trim().toUpperCase()
      : undefined;

  return {
    page: pagination(query.page, 1, 100000),
    pageSize: pagination(query.pageSize, 25, 100),
    search,
    status,
    roleCode,
  };
}

@ApiTags("users")
@ApiBearerAuth()
@Controller("users")
@UseGuards(AccessTokenGuard, PermissionsGuard)
@RequirePermissions("system.admin")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @ApiOperation({ summary: "Listar cuentas de Identity" })
  @Get()
  list(@Query() query: Readonly<Record<string, unknown>>) {
    return this.users.list(listQuery(query));
  }

  @ApiOperation({ summary: "Consultar métricas de cuentas" })
  @Get("summary")
  summary() {
    return this.users.metrics();
  }

  @ApiOperation({ summary: "Consultar roles globales disponibles" })
  @Get("roles")
  roles() {
    return this.users.availableRoles();
  }

  @ApiOperation({ summary: "Crear una cuenta con contraseña temporal" })
  @Post()
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const record = asRecord(body);

    return this.users.create(actorOf(request), {
      displayName: text(record, "displayName", 2, 200),
      email: email(text(record, "email", 3, 320)),
      roleCodes: roleCodes(record),
      temporaryPassword: optionalText(
        record,
        "temporaryPassword",
        12,
        256,
      ),
    });
  }

  @ApiOperation({ summary: "Consultar detalle de una cuenta" })
  @Get(":userId")
  getById(
    @Param("userId", new ParseUUIDPipe({ version: "4" })) userId: string,
  ) {
    return this.users.getById(userId);
  }

  @ApiOperation({ summary: "Editar nombre o correo" })
  @Patch(":userId")
  update(
    @Param("userId", new ParseUUIDPipe({ version: "4" })) userId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const record = asRecord(body);
    const rawEmail = optionalText(record, "email", 3, 320);

    return this.users.update(actorOf(request), userId, {
      displayName: optionalText(record, "displayName", 2, 200),
      email: rawEmail ? email(rawEmail) : undefined,
    });
  }

  @ApiOperation({ summary: "Reemplazar roles globales de una cuenta" })
  @Put(":userId/roles")
  setRoles(
    @Param("userId", new ParseUUIDPipe({ version: "4" })) userId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const record = asRecord(body);
    return this.users.setRoles(actorOf(request), userId, roleCodes(record));
  }

  @ApiOperation({ summary: "Activar una cuenta" })
  @Post(":userId/activate")
  activate(
    @Param("userId", new ParseUUIDPipe({ version: "4" })) userId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.users.activate(actorOf(request), userId);
  }

  @ApiOperation({ summary: "Desactivar una cuenta y revocar sesiones" })
  @Post(":userId/deactivate")
  deactivate(
    @Param("userId", new ParseUUIDPipe({ version: "4" })) userId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.users.deactivate(actorOf(request), userId);
  }

  @ApiOperation({ summary: "Restablecer contraseña y revocar sesiones" })
  @Post(":userId/reset-password")
  resetPassword(
    @Param("userId", new ParseUUIDPipe({ version: "4" })) userId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const record = asRecord(body);
    return this.users.resetPassword(
      actorOf(request),
      userId,
      optionalText(record, "temporaryPassword", 12, 256),
    );
  }

  @ApiOperation({ summary: "Revocar todas las sesiones de una cuenta" })
  @Post(":userId/revoke-sessions")
  revokeSessions(
    @Param("userId", new ParseUUIDPipe({ version: "4" })) userId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.users.revokeAllSessions(actorOf(request), userId);
  }
}
