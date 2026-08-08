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
  WORKFLOW_AUTH_CONFIG,
  type WorkflowAuthConfig,
} from "./workflow-auth.config";

export interface WorkflowProjectAccess {
  project: ProjectDetail;
  role: ProjectParticipantRole | "ADMIN";
  canCreateReview: boolean;
  canReview: boolean;
  canApprove: boolean;
}

function isAdministrator(actor: AuthenticatedUser): boolean {
  return (
    actor.roles.some((role) => role.toUpperCase() === "ADMIN") ||
    actor.permissions.includes("system.admin")
  );
}

function sameUuid(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

@Injectable()
export class WorkflowProjectsAccessClient {
  constructor(
    @Inject(WORKFLOW_AUTH_CONFIG)
    private readonly config: WorkflowAuthConfig,
  ) {}

  async requireRead(
    projectId: string,
    accessToken: string,
    actor: AuthenticatedUser,
    correlationId: string,
  ): Promise<WorkflowProjectAccess> {
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

    const payload = await this.readPayload(response);

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
      : project.participants.find((participant) =>
          sameUuid(participant.userId, actor.id),
        )?.role;

    if (!role) {
      throw new ForbiddenException("No tienes acceso a este proyecto.");
    }

    return {
      project,
      role,
      canCreateReview: administrator || role === "OWNER" || role === "EDITOR",
      canReview: administrator || role === "OWNER" || role === "REVIEWER",
      canApprove: administrator || role === "OWNER",
    };
  }

  private async readPayload(response: Response): Promise<unknown> {
    const text = await response.text();

    if (!text) return null;

    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { message: text };
    }
  }
}
