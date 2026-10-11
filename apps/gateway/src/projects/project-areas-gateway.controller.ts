import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiBearerAuth, ApiCookieAuth, ApiTags } from "@nestjs/swagger";

import { ACCESS_COOKIE, readCookie } from "../auth/cookies";
import { ProjectsClientService } from "./projects-client.service";

interface RequestLike {
  headers: Readonly<Record<string, string | string[] | undefined>>;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function requireAccessToken(request: RequestLike): string {
  const cookieToken = readCookie(
    firstHeader(request.headers.cookie),
    ACCESS_COOKIE,
  );
  if (cookieToken) return cookieToken;
  const match = firstHeader(request.headers.authorization)?.match(
    /^Bearer\s+(.+)$/i,
  );
  if (!match?.[1]) throw new UnauthorizedException("Sesión requerida.");
  return match[1];
}

@ApiTags("project-areas")
@ApiCookieAuth("rq_access")
@ApiBearerAuth()
@Controller("project-areas")
export class ProjectAreasGatewayController {
  constructor(private readonly projects: ProjectsClientService) {}

  @Get()
  list(@Req() request: RequestLike) {
    return this.projects.listAreas(requireAccessToken(request));
  }

  @Post()
  create(@Req() request: RequestLike, @Body() body: unknown) {
    return this.projects.createArea(requireAccessToken(request), body);
  }

  @Patch(":areaId")
  rename(
    @Req() request: RequestLike,
    @Param("areaId") areaId: string,
    @Body() body: unknown,
  ) {
    return this.projects.renameArea(requireAccessToken(request), areaId, body);
  }

  @Delete(":areaId")
  remove(@Req() request: RequestLike, @Param("areaId") areaId: string) {
    return this.projects.deleteArea(requireAccessToken(request), areaId);
  }
}
