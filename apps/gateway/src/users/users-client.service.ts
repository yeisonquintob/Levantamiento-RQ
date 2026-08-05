import {
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";

import type {
  CreateIdentityUserResponse,
  IdentityRoleSummary,
  IdentityUserDetail,
  IdentityUserListResponse,
  IdentityUserMetrics,
  ResetIdentityUserPasswordResponse,
  RevokeIdentityUserSessionsResponse,
} from "@levantamiento-rq/shared-contracts";

import {
  GATEWAY_CONFIG,
  type GatewayConfig,
} from "../config/gateway-config";

type Method = "GET" | "POST" | "PATCH" | "PUT";

@Injectable()
export class UsersClientService {
  constructor(
    @Inject(GATEWAY_CONFIG)
    private readonly config: GatewayConfig,
  ) {}

  list(
    accessToken: string,
    query: Readonly<Record<string, unknown>>,
    correlationId?: string,
  ): Promise<IdentityUserListResponse> {
    const search = new URLSearchParams();

    for (const [name, value] of Object.entries(query)) {
      if (typeof value === "string" || typeof value === "number") {
        search.set(name, String(value));
      }
    }

    return this.request(
      `/api/v1/users${search.size ? `?${search.toString()}` : ""}`,
      "GET",
      accessToken,
      undefined,
      correlationId,
    );
  }

  summary(accessToken: string, correlationId?: string): Promise<IdentityUserMetrics> {
    return this.request(
      "/api/v1/users/summary",
      "GET",
      accessToken,
      undefined,
      correlationId,
    );
  }

  roles(accessToken: string, correlationId?: string): Promise<readonly IdentityRoleSummary[]> {
    return this.request(
      "/api/v1/users/roles",
      "GET",
      accessToken,
      undefined,
      correlationId,
    );
  }

  get(accessToken: string, userId: string, correlationId?: string): Promise<IdentityUserDetail> {
    return this.request(
      `/api/v1/users/${encodeURIComponent(userId)}`,
      "GET",
      accessToken,
      undefined,
      correlationId,
    );
  }

  create(accessToken: string, body: unknown, correlationId?: string): Promise<CreateIdentityUserResponse> {
    return this.request(
      "/api/v1/users",
      "POST",
      accessToken,
      body,
      correlationId,
    );
  }

  update(accessToken: string, userId: string, body: unknown, correlationId?: string): Promise<IdentityUserDetail> {
    return this.request(
      `/api/v1/users/${encodeURIComponent(userId)}`,
      "PATCH",
      accessToken,
      body,
      correlationId,
    );
  }

  setRoles(accessToken: string, userId: string, body: unknown, correlationId?: string): Promise<IdentityUserDetail> {
    return this.request(
      `/api/v1/users/${encodeURIComponent(userId)}/roles`,
      "PUT",
      accessToken,
      body,
      correlationId,
    );
  }

  action<T>(
    accessToken: string,
    userId: string,
    action: "activate" | "deactivate" | "reset-password" | "revoke-sessions",
    body: unknown,
    correlationId?: string,
  ): Promise<T> {
    return this.request(
      `/api/v1/users/${encodeURIComponent(userId)}/${action}`,
      "POST",
      accessToken,
      body,
      correlationId,
    );
  }

  resetPassword(
    accessToken: string,
    userId: string,
    body: unknown,
    correlationId?: string,
  ): Promise<ResetIdentityUserPasswordResponse> {
    return this.action(
      accessToken,
      userId,
      "reset-password",
      body,
      correlationId,
    );
  }

  revokeSessions(
    accessToken: string,
    userId: string,
    correlationId?: string,
  ): Promise<RevokeIdentityUserSessionsResponse> {
    return this.action(
      accessToken,
      userId,
      "revoke-sessions",
      {},
      correlationId,
    );
  }

  private async request<T>(
    path: string,
    method: Method,
    accessToken: string,
    body?: unknown,
    correlationId?: string,
  ): Promise<T> {
    const headers: Record<string, string> = {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
    };

    if (body !== undefined) headers["content-type"] = "application/json";
    if (correlationId) headers["x-correlation-id"] = correlationId;

    let response: Response;

    try {
      response = await fetch(`${this.config.identityServiceUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.identityTimeoutMs),
      });
    } catch {
      throw new ServiceUnavailableException(
        "Identity Service no está disponible.",
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
        payload && typeof payload === "object"
          ? (payload as Readonly<Record<string, unknown>>)
          : { message: "Identity Service rechazó la solicitud." },
        response.status,
      );
    }

    return payload as T;
  }
}
