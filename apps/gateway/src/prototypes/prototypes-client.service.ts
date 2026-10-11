import {
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import type {
  PrototypeGenerationCreateRequest,
  PrototypeGenerationDetail,
  PrototypePlanningResult,
  PrototypeScreenDetail,
  PrototypeVisualSpecification,
  PrototypeVisualSpecificationBuildResult,
  PrototypeGeneratedImage,
  PrototypeImageGenerationResult,
  PrototypeImageProgress,
  PrototypePromptExport,
  PrototypeScreenDetailResult,
  PrototypeImageActionResult,
  PrototypeAiOptions,
} from "@levantamiento-rq/shared-contracts";
import { GATEWAY_CONFIG, type GatewayConfig } from "../config/gateway-config";
@Injectable()
export class PrototypesClientService {
  constructor(@Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig) {}
  aiOptions(token: string) {
    return this.request<PrototypeAiOptions>(
      "/api/v1/prototypes/generations/providers",
      "GET",
      token,
    );
  }
  create(token: string, body: PrototypeGenerationCreateRequest | unknown) {
    return this.request<PrototypeGenerationDetail>(
      "/api/v1/prototypes/generations",
      "POST",
      token,
      body,
    );
  }
  list(token: string) {
    return this.request<PrototypeGenerationDetail[]>(
      "/api/v1/prototypes/generations",
      "GET",
      token,
    );
  }
  get(token: string, id: string) {
    return this.request<PrototypeGenerationDetail>(
      `/api/v1/prototypes/generations/${encodeURIComponent(id)}`,
      "GET",
      token,
    );
  }
  screens(token: string, id: string) {
    return this.request<PrototypeScreenDetail[]>(
      `/api/v1/prototypes/generations/${encodeURIComponent(id)}/screens`,
      "GET",
      token,
    );
  }
  plan(token: string, id: string) {
    return this.request<PrototypePlanningResult>(
      `/api/v1/prototypes/generations/${encodeURIComponent(id)}/plan`,
      "POST",
      token,
    );
  }
  detailScreen(token: string, id: string, screenId: string) {
    return this.request<PrototypeScreenDetailResult>(
      `/api/v1/prototypes/generations/${encodeURIComponent(id)}/screens/${encodeURIComponent(screenId)}/detail`,
      "POST",
      token,
    );
  }
  buildVisualSpecifications(token: string, id: string, body: unknown) {
    return this.request<PrototypeVisualSpecificationBuildResult>(
      `/api/v1/prototypes/generations/${encodeURIComponent(id)}/visual-specifications`,
      "POST",
      token,
      body,
    );
  }
  visualSpecifications(token: string, id: string) {
    return this.request<PrototypeVisualSpecification[]>(
      `/api/v1/prototypes/generations/${encodeURIComponent(id)}/visual-specifications`,
      "GET",
      token,
    );
  }
  changeImageProvider(token: string, id: string, body: unknown) {
    return this.request<PrototypeGenerationDetail>(
      `/api/v1/prototypes/generations/${encodeURIComponent(id)}/image-provider`,
      "POST",
      token,
      body,
    );
  }
  startImages(token: string, id: string) {
    return this.request<PrototypeImageGenerationResult>(
      `/api/v1/prototypes/generations/${encodeURIComponent(id)}/images`,
      "POST",
      token,
    );
  }
  images(token: string, id: string) {
    return this.request<PrototypeGeneratedImage[]>(
      `/api/v1/prototypes/generations/${encodeURIComponent(id)}/images`,
      "GET",
      token,
    );
  }
  imageProgress(token: string, id: string) {
    return this.request<PrototypeImageProgress>(
      `/api/v1/prototypes/generations/${encodeURIComponent(id)}/image-progress`,
      "GET",
      token,
    );
  }
  promptExport(token: string, id: string) {
    return this.request<PrototypePromptExport>(
      `/api/v1/prototypes/generations/${encodeURIComponent(id)}/prompt-export`,
      "GET",
      token,
    );
  }
  importImage(token: string, id: string, body: unknown) {
    return this.request<PrototypeImageActionResult>(
      `/api/v1/prototypes/generations/${encodeURIComponent(id)}/images/import`,
      "POST",
      token,
      body,
    );
  }
  retryImage(token: string, imageId: string) {
    return this.request<PrototypeImageActionResult>(
      `/api/v1/prototypes/images/${encodeURIComponent(imageId)}/retry`,
      "POST",
      token,
    );
  }
  regenerateImage(token: string, imageId: string) {
    return this.request<PrototypeImageActionResult>(
      `/api/v1/prototypes/images/${encodeURIComponent(imageId)}/regenerate`,
      "POST",
      token,
    );
  }
  retryFailedImages(token: string, generationId: string) {
    return this.request<PrototypeImageGenerationResult>(
      `/api/v1/prototypes/generations/${encodeURIComponent(generationId)}/images/retry-failed`,
      "POST",
      token,
    );
  }
  stop(token: string, generationId: string) {
    return this.request<PrototypeImageGenerationResult>(
      `/api/v1/prototypes/generations/${encodeURIComponent(generationId)}/stop`,
      "POST",
      token,
    );
  }
  remove(token: string, generationId: string) {
    return this.request<{ id: string; deleted: true }>(
      `/api/v1/prototypes/generations/${encodeURIComponent(generationId)}`,
      "DELETE",
      token,
    );
  }
  async imageContent(token: string, imageId: string): Promise<Buffer> {
    let response: Response;
    try {
      response = await fetch(
        `${this.config.prototypesServiceUrl}/api/v1/prototypes/images/${encodeURIComponent(imageId)}/content`,
        {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(this.config.prototypesTimeoutMs),
        },
      );
    } catch {
      throw new ServiceUnavailableException(
        "Prototypes Service no está disponible.",
      );
    }
    if (!response.ok)
      throw new HttpException(
        { message: "La imagen de prototipo no está disponible." },
        response.status,
      );
    return Buffer.from(await response.arrayBuffer());
  }
  private async request<T>(
    path: string,
    method: "GET" | "POST" | "DELETE",
    token: string,
    body?: unknown,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.config.prototypesServiceUrl}${path}`, {
        method,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.prototypesTimeoutMs),
      });
    } catch {
      throw new ServiceUnavailableException(
        "Prototypes Service no está disponible.",
      );
    }
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }
    if (!response.ok)
      throw new HttpException(
        payload && typeof payload === "object"
          ? (payload as Record<string, unknown>)
          : { message: "Prototypes Service rechazó la solicitud." },
        response.status,
      );
    return payload as T;
  }
}
