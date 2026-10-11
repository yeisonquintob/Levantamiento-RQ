import type { AuditHistoryResponse } from "@levantamiento-rq/shared-contracts";
import {
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";

import type {
  AddProjectParticipantRequest,
  CreateProjectRequest,
  ProjectAreaListResponse,
  ProjectAreaSummary,
  ProjectDetail,
  ProjectDomainPurgeResult,
  ProjectListResponse,
  ProjectMetrics,
  UpdateProjectRequest,
} from "@levantamiento-rq/shared-contracts";

import { GATEWAY_CONFIG, type GatewayConfig } from "../config/gateway-config";

type ProjectsMethod = "GET" | "POST" | "PATCH" | "DELETE";

@Injectable()
export class ProjectsClientService {
  constructor(
    @Inject(GATEWAY_CONFIG)
    private readonly config: GatewayConfig,
  ) {}

  list(
    accessToken: string,
    query: Readonly<Record<string, unknown>>,
  ): Promise<ProjectListResponse> {
    const search = new URLSearchParams();

    for (const [name, value] of Object.entries(query)) {
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        search.set(name, String(value));
      }
    }

    const suffix = search.size > 0 ? `?${search.toString()}` : "";

    return this.request<ProjectListResponse>(
      `/api/v1/projects${suffix}`,
      "GET",
      accessToken,
    );
  }

  summary(accessToken: string): Promise<ProjectMetrics> {
    return this.request<ProjectMetrics>(
      "/api/v1/projects/summary",
      "GET",
      accessToken,
    );
  }

  listAreas(accessToken: string): Promise<ProjectAreaListResponse> {
    return this.request<ProjectAreaListResponse>(
      "/api/v1/project-areas",
      "GET",
      accessToken,
    );
  }

  createArea(accessToken: string, body: unknown): Promise<ProjectAreaSummary> {
    return this.request<ProjectAreaSummary>(
      "/api/v1/project-areas",
      "POST",
      accessToken,
      body,
    );
  }

  renameArea(
    accessToken: string,
    areaId: string,
    body: unknown,
  ): Promise<ProjectAreaSummary> {
    return this.request<ProjectAreaSummary>(
      `/api/v1/project-areas/${encodeURIComponent(areaId)}`,
      "PATCH",
      accessToken,
      body,
    );
  }

  deleteArea(accessToken: string, areaId: string): Promise<{ id: string }> {
    return this.request<{ id: string }>(
      `/api/v1/project-areas/${encodeURIComponent(areaId)}`,
      "DELETE",
      accessToken,
    );
  }

  getById(accessToken: string, projectId: string): Promise<ProjectDetail> {
    return this.request<ProjectDetail>(
      `/api/v1/projects/${encodeURIComponent(projectId)}`,
      "GET",
      accessToken,
    );
  }

  create(
    accessToken: string,
    body: CreateProjectRequest | unknown,
  ): Promise<ProjectDetail> {
    return this.request<ProjectDetail>(
      "/api/v1/projects",
      "POST",
      accessToken,
      body,
    );
  }

  update(
    accessToken: string,
    projectId: string,
    body: UpdateProjectRequest | unknown,
  ): Promise<ProjectDetail> {
    return this.request<ProjectDetail>(
      `/api/v1/projects/${encodeURIComponent(projectId)}`,
      "PATCH",
      accessToken,
      body,
    );
  }

  addParticipant(
    accessToken: string,
    projectId: string,
    body: AddProjectParticipantRequest | unknown,
  ): Promise<ProjectDetail> {
    return this.request<ProjectDetail>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/participants`,
      "POST",
      accessToken,
      body,
    );
  }

  removeParticipant(
    accessToken: string,
    projectId: string,
    userId: string,
  ): Promise<ProjectDetail> {
    return this.request<ProjectDetail>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/participants/${encodeURIComponent(userId)}`,
      "DELETE",
      accessToken,
    );
  }

  deleteProject(
    accessToken: string,
    projectId: string,
  ): Promise<ProjectDomainPurgeResult & { projectId: string; code: string }> {
    return this.request(
      `/api/v1/projects/${encodeURIComponent(projectId)}`,
      "DELETE",
      accessToken,
    );
  }

  auditHistory(
    accessToken: string,
    query: Readonly<Record<string, unknown>>,
  ): Promise<AuditHistoryResponse> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === "string" || typeof value === "number")
        params.set(key, String(value));
    }
    return this.request(
      `/api/v1/projects/audit-events?${params}`,
      "GET",
      accessToken,
    );
  }

  private async request<T>(
    path: string,
    method: ProjectsMethod,
    accessToken: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
    };

    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }

    let response: Response;

    try {
      response = await fetch(`${this.config.projectsServiceUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.projectsTimeoutMs),
      });
    } catch {
      throw new ServiceUnavailableException(
        "Projects Service no está disponible.",
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
        payload ?? { message: "Projects Service rechazó la solicitud." },
        response.status,
      );
    }

    return payload as T;
  }
}
