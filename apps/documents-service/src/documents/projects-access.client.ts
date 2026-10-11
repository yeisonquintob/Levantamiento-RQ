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
  DOCUMENTS_AUTH_CONFIG,
  type DocumentsAuthConfig,
} from "../templates/documents-auth.config";

export interface DocumentProjectAccess {
  project: ProjectDetail;
  role: ProjectParticipantRole | "ADMIN" | "SERVICE";
  canEdit: boolean;
  canReview: boolean;
}

function isAdministrator(actor: AuthenticatedUser): boolean {
  return (
    actor.roles.some((role) => role.toUpperCase() === "ADMIN") ||
    actor.permissions.includes("system.admin")
  );
}

@Injectable()
export class DocumentsProjectsAccessClient {
  constructor(
    @Inject(DOCUMENTS_AUTH_CONFIG)
    private readonly config: DocumentsAuthConfig,
  ) {}

  async requireRead(
    projectId: string,
    accessToken: string,
    actor: AuthenticatedUser,
    correlationId: string,
  ): Promise<DocumentProjectAccess> {
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
    const serviceReader = actor.permissions.includes("projects.read.all");
    const role = administrator
      ? "ADMIN"
      : serviceReader
        ? "SERVICE"
      : project.participants.find(
          (participant) => participant.userId === actor.id,
        )?.role;

    if (!role) {
      throw new ForbiddenException("No tienes acceso a este proyecto.");
    }

    return {
      project,
      role,
      canEdit: administrator || role === "OWNER" || role === "EDITOR",
      canReview: administrator || role === "OWNER" || role === "REVIEWER",
    };
  }

  async documentGenerated(projectId: string, documentId: string, accessToken: string): Promise<void> {
    const response = await fetch(`${this.config.projectsServiceUrl}/api/v1/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}/generated`, {
      method: "POST", headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(this.config.projectsTimeoutMs),
    });
    if (!response.ok) throw new ServiceUnavailableException("El borrador se guardó, pero no se pudo actualizar el estado del proyecto. Reintenta la operación.");
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
