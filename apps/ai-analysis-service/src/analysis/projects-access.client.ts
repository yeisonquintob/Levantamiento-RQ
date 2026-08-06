import {
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";

import type {
  AiAnalysisProjectAction,
  AuthenticatedUser,
  ProjectDetail,
  ProjectParticipantRole,
} from "@levantamiento-rq/shared-contracts";

import {
  AI_ANALYSIS_AUTH_CONFIG,
  type AiAnalysisAuthConfig,
} from "./ai-analysis-auth.config";

export interface AiAnalysisProjectAccess {
  project: ProjectDetail;
  role: ProjectParticipantRole | "ADMIN";
  canRead: true;
  canCreate: boolean;
  canCancel: boolean;
}

function isAdministrator(actor: AuthenticatedUser): boolean {
  return (
    actor.roles.some((role) => role.toUpperCase() === "ADMIN") ||
    actor.permissions.includes("system.admin")
  );
}

function canManageAnalysis(
  role: ProjectParticipantRole | "ADMIN",
): boolean {
  return role === "ADMIN" || role === "OWNER" || role === "EDITOR";
}

@Injectable()
export class AiAnalysisProjectsAccessClient {
  constructor(
    @Inject(AI_ANALYSIS_AUTH_CONFIG)
    private readonly config: AiAnalysisAuthConfig,
  ) {}

  requireRead(
    projectId: string,
    accessToken: string,
    actor: AuthenticatedUser,
    correlationId: string,
  ): Promise<AiAnalysisProjectAccess> {
    return this.resolve(
      projectId,
      accessToken,
      actor,
      correlationId,
      "READ",
    );
  }

  requireCreate(
    projectId: string,
    accessToken: string,
    actor: AuthenticatedUser,
    correlationId: string,
  ): Promise<AiAnalysisProjectAccess> {
    return this.resolve(
      projectId,
      accessToken,
      actor,
      correlationId,
      "CREATE",
    );
  }

  requireCancel(
    projectId: string,
    accessToken: string,
    actor: AuthenticatedUser,
    correlationId: string,
  ): Promise<AiAnalysisProjectAccess> {
    return this.resolve(
      projectId,
      accessToken,
      actor,
      correlationId,
      "CANCEL",
    );
  }

  private async resolve(
    projectId: string,
    accessToken: string,
    actor: AuthenticatedUser,
    correlationId: string,
    action: AiAnalysisProjectAction,
  ): Promise<AiAnalysisProjectAccess> {
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
      : project.participants.find(
          (participant) => participant.userId === actor.id,
        )?.role;

    if (!role) {
      throw new ForbiddenException("No tienes acceso a este proyecto.");
    }

    const canManage = canManageAnalysis(role);

    if (action === "CREATE" && !canManage) {
      throw new ForbiddenException(
        "Solo ADMIN, OWNER o EDITOR pueden crear análisis para este proyecto.",
      );
    }

    if (action === "CANCEL" && !canManage) {
      throw new ForbiddenException(
        "Solo ADMIN, OWNER o EDITOR pueden cancelar análisis de este proyecto.",
      );
    }

    return {
      project,
      role,
      canRead: true,
      canCreate: canManage,
      canCancel: canManage,
    };
  }

  private async readPayload(response: Response): Promise<unknown> {
    const text = await response.text();

    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { message: text };
    }
  }
}
