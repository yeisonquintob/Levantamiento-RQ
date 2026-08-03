import {
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";

import type {
  AuthenticatedUser,
  ProjectDetail,
  ProjectParticipantRole,
} from "@levantamiento-rq/shared-contracts";

import {
  SOURCES_AUTH_CONFIG,
  type SourcesAuthConfig,
} from "./sources-auth.config";

export interface ProjectAccess {
  project: ProjectDetail;
  role: ProjectParticipantRole | "ADMIN";
  canManage: boolean;
}

function isAdministrator(actor: AuthenticatedUser): boolean {
  return (
    actor.roles.some((role) => role.toUpperCase() === "ADMIN") ||
    actor.permissions.includes("system.admin")
  );
}

@Injectable()
export class ProjectsAccessClient {
  constructor(
    @Inject(SOURCES_AUTH_CONFIG)
    private readonly config: SourcesAuthConfig,
  ) {}

  async requireRead(
    projectId: string,
    accessToken: string,
    actor: AuthenticatedUser,
  ): Promise<ProjectAccess> {
    return this.resolve(projectId, accessToken, actor, false);
  }

  async requireManage(
    projectId: string,
    accessToken: string,
    actor: AuthenticatedUser,
  ): Promise<ProjectAccess> {
    return this.resolve(projectId, accessToken, actor, true);
  }

  private async resolve(
    projectId: string,
    accessToken: string,
    actor: AuthenticatedUser,
    managementRequired: boolean,
  ): Promise<ProjectAccess> {
    let response: Response;

    try {
      response = await fetch(
        `${this.config.projectsServiceUrl}/api/v1/projects/${encodeURIComponent(projectId)}`,
        {
          headers: {
            accept: "application/json",
            authorization: `Bearer ${accessToken}`,
          },
          signal: AbortSignal.timeout(this.config.projectsTimeoutMs),
        },
      );
    } catch {
      throw new ServiceUnavailableException(
        "Projects Service no está disponible para validar el acceso.",
      );
    }

    const text = await response.text();
    let payload: unknown = null;

    if (text) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = { message: text };
      }
    }

    if (!response.ok) {
      throw new HttpException(
        payload ?? { message: "No fue posible validar el proyecto." },
        response.status,
      );
    }

    const project = payload as ProjectDetail;
    const administrator = isAdministrator(actor);
    const role = administrator
      ? "ADMIN"
      : project.participants.find(
          (participant) => participant.userId === actor.id,
        )?.role;

    if (!role) {
      throw new ForbiddenException("No tienes acceso a este proyecto.");
    }

    const canManage =
      administrator || role === "OWNER" || role === "EDITOR";

    if (managementRequired && !canManage) {
      throw new ForbiddenException(
        "No tienes autorización para modificar fuentes de este proyecto.",
      );
    }

    return {
      project,
      role,
      canManage,
    };
  }
}
