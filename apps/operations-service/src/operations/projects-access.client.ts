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
} from "@levantamiento-rq/shared-contracts";

import {
  OPERATIONS_AUTH_CONFIG,
  type OperationsAuthConfig,
} from "./operations-auth.config";

@Injectable()
export class OperationsProjectsAccessClient {
  constructor(
    @Inject(OPERATIONS_AUTH_CONFIG)
    private readonly config: OperationsAuthConfig,
  ) {}

  async requireRead(
    projectId: string,
    accessToken: string,
    actor: AuthenticatedUser,
    correlationId: string,
  ): Promise<ProjectDetail> {
    let response: Response;
    try {
      response = await fetch(
        `${this.config.projectsServiceUrl}/api/v1/projects/${encodeURIComponent(projectId)}`,
        {
          headers: {
            accept: "application/json",
            authorization: `Bearer ${accessToken}`,
            "x-correlation-id": correlationId,
          },
          signal: AbortSignal.timeout(this.config.projectsTimeoutMs),
        },
      );
    } catch {
      throw new ServiceUnavailableException(
        "Projects Service no está disponible para validar el acceso.",
      );
    }
    const payload = await this.read(response);
    if (!response.ok) {
      throw new HttpException(
        payload && typeof payload === "object"
          ? (payload as Record<string, unknown>)
          : {
              message:
                typeof payload === "string"
                  ? payload
                  : "No fue posible validar el proyecto.",
            },
        response.status,
      );
    }
    const project = payload as ProjectDetail;
    const admin =
      actor.roles.some((role) => role.toUpperCase() === "ADMIN") ||
      actor.permissions.includes("system.admin");
    if (
      !admin &&
      !project.participants.some(
        (item) => item.userId.toLowerCase() === actor.id.toLowerCase(),
      )
    ) {
      throw new ForbiddenException("No tienes acceso a este proyecto.");
    }
    return project;
  }

  private async read(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { message: text };
    }
  }
}
