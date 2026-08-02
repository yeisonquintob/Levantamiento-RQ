import {
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";

import type {
  AuthSessionResponse,
  AuthenticatedUser,
  SignOutResponse,
} from "@levantamiento-rq/shared-contracts";

import {
  GATEWAY_CONFIG,
  type GatewayConfig,
} from "../config/gateway-config";

interface ClientContext {
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class IdentityClientService {
  constructor(
    @Inject(GATEWAY_CONFIG)
    private readonly config: GatewayConfig,
  ) {}

  signIn(
    body: unknown,
    context: ClientContext,
  ): Promise<AuthSessionResponse> {
    return this.request<AuthSessionResponse>(
      "/api/v1/auth/sign-in",
      "POST",
      body,
      context,
    );
  }

  refresh(
    refreshToken: string,
    context: ClientContext,
  ): Promise<AuthSessionResponse> {
    return this.request<AuthSessionResponse>(
      "/api/v1/auth/refresh",
      "POST",
      { refreshToken },
      context,
    );
  }

  signOut(refreshToken: string): Promise<SignOutResponse> {
    return this.request<SignOutResponse>(
      "/api/v1/auth/sign-out",
      "POST",
      { refreshToken },
      {},
    );
  }

  me(accessToken: string): Promise<AuthenticatedUser> {
    return this.request<AuthenticatedUser>(
      "/api/v1/auth/me",
      "GET",
      undefined,
      {},
      accessToken,
    );
  }

  private async request<T>(
    path: string,
    method: "GET" | "POST",
    body: unknown,
    context: ClientContext,
    accessToken?: string,
  ): Promise<T> {
    const headers: Record<string, string> = {
      accept: "application/json",
    };

    if (method === "POST") {
      headers["content-type"] = "application/json";
    }

    if (context.userAgent) {
      headers["x-client-user-agent"] = context.userAgent;
    }

    if (context.ipAddress) {
      headers["x-client-ip"] = context.ipAddress;
    }

    if (accessToken) {
      headers.authorization = `Bearer ${accessToken}`;
    }

    let response: Response;

    try {
      response = await fetch(
        `${this.config.identityServiceUrl}${path}`,
        {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(this.config.identityTimeoutMs),
        },
      );
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
        payload ?? { message: "Identity Service rechazó la solicitud." },
        response.status,
      );
    }

    return payload as T;
  }
}
