import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import type {
  PrototypePlanningInternalRequest,
  PrototypePlanningInternalResponse,
  PrototypeScreenDetailInternalRequest,
  PrototypeScreenDetailInternalResponse,
  PrototypeAiOptions,
} from "@levantamiento-rq/shared-contracts";
import {
  PROTOTYPES_AUTH_CONFIG,
  type PrototypesAuthConfig,
} from "../prototypes/prototypes-auth.config";
import { PrototypesServiceToken } from "../prototypes/prototypes-service-token.service";
import { PrototypePlannerError } from "./prototype-planner.provider";
@Injectable()
export class AiAnalysisStructuredExecutionClient {
  constructor(
    @Inject(PROTOTYPES_AUTH_CONFIG)
    private readonly config: PrototypesAuthConfig,
    private readonly tokens: PrototypesServiceToken,
  ) {}
  async options(): Promise<PrototypeAiOptions> {
    try {
      const response = await fetch(`${this.config.aiAnalysisServiceUrl}/api/v1/internal/structured-executions/providers`, {
        headers: { accept: "application/json", authorization: `Bearer ${await this.tokens.issue()}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error("PROVIDERS_UNAVAILABLE");
      return await response.json() as PrototypeAiOptions;
    } catch { throw new ServiceUnavailableException("No fue posible consultar los modelos disponibles para prototipos."); }
  }
  async execute(
    request: PrototypePlanningInternalRequest,
    correlationId: string,
  ): Promise<PrototypePlanningInternalResponse> {
    return this.post<PrototypePlanningInternalResponse>(
      "",
      request,
      correlationId,
      "No fue posible planificar el prototipo.",
      "PROTOTYPE_PLANNING_FAILED",
    );
  }
  async executeScreenDetail(
    request: PrototypeScreenDetailInternalRequest,
    correlationId: string,
  ): Promise<PrototypeScreenDetailInternalResponse> {
    return this.post<PrototypeScreenDetailInternalResponse>(
      "/screen-detail",
      request,
      correlationId,
      "No fue posible detallar la pantalla.",
      "PROTOTYPE_SCREEN_DETAIL_FAILED",
    );
  }
  private async post<T>(
    path: string,
    request: unknown,
    correlationId: string,
    failureMessage: string,
    failureCode: string,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(
        `${this.config.aiAnalysisServiceUrl}/api/v1/internal/structured-executions${path}`,
        {
          method: "POST",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${await this.tokens.issue()}`,
            "content-type": "application/json",
            "x-correlation-id": correlationId,
          },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(this.config.aiAnalysisTimeoutMs),
        },
      );
    } catch {
      throw new ServiceUnavailableException(
        "El servicio de planificación no está disponible.",
      );
    }
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const message =
        payload &&
        typeof payload === "object" &&
        "message" in payload &&
        typeof payload.message === "string"
          ? payload.message
          : failureMessage;
      const errorCode =
        payload &&
        typeof payload === "object" &&
        "errorCode" in payload &&
        typeof payload.errorCode === "string"
          ? payload.errorCode
          : failureCode;
      throw new PrototypePlannerError(errorCode, message);
    }
    return payload as T;
  }
}
