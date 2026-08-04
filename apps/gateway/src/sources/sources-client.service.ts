import {
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";

import type {
  CreateTextSourceRequest,
  SourceDetail,
  SourceListResponse,
  SourceMetrics,
  SourceUploadBatchResponse,
  UpdateSourceRequest,
} from "@levantamiento-rq/shared-contracts";

import {
  GATEWAY_CONFIG,
  type GatewayConfig,
} from "../config/gateway-config";

type SourcesMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface GatewayUploadFile {
  fileName: string;
  mediaType: string;
  buffer: Buffer;
}

export interface GatewayDownloadFile {
  fileName: string;
  mediaType: string;
  buffer: Buffer;
}

function fileNameFromDisposition(
  value: string | null,
  fallback: string,
): string {
  if (!value) {
    return fallback;
  }

  const utf8 = value.match(/filename\*=UTF-8''([^;]+)/i);

  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      return fallback;
    }
  }

  const regular = value.match(/filename="?([^";]+)"?/i);
  return regular?.[1]?.trim() || fallback;
}

@Injectable()
export class SourcesClientService {
  constructor(
    @Inject(GATEWAY_CONFIG)
    private readonly config: GatewayConfig,
  ) {}

  list(
    accessToken: string,
    projectId: string,
    query: Readonly<Record<string, unknown>>,
  ): Promise<SourceListResponse> {
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

    return this.request<SourceListResponse>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/sources${suffix}`,
      "GET",
      accessToken,
    );
  }

  summary(
    accessToken: string,
    projectId: string,
  ): Promise<SourceMetrics> {
    return this.request<SourceMetrics>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/sources/summary`,
      "GET",
      accessToken,
    );
  }

  getById(
    accessToken: string,
    projectId: string,
    sourceId: string,
  ): Promise<SourceDetail> {
    return this.request<SourceDetail>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(sourceId)}`,
      "GET",
      accessToken,
    );
  }

  create(
    accessToken: string,
    projectId: string,
    body: CreateTextSourceRequest | unknown,
  ): Promise<SourceDetail> {
    return this.request<SourceDetail>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/sources`,
      "POST",
      accessToken,
      body,
    );
  }

  async uploadFiles(
    accessToken: string,
    projectId: string,
    files: readonly GatewayUploadFile[],
    metadata: string,
  ): Promise<SourceUploadBatchResponse> {
    const form = new FormData();
    form.append("metadata", metadata);

    for (const file of files) {
      form.append(
        "files",
        new Blob([new Uint8Array(file.buffer)], {
          type: file.mediaType || "application/octet-stream",
        }),
        file.fileName,
      );
    }

    return this.requestMultipart<SourceUploadBatchResponse>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/sources/files`,
      accessToken,
      form,
    );
  }

  update(
    accessToken: string,
    projectId: string,
    sourceId: string,
    body: UpdateSourceRequest | unknown,
  ): Promise<SourceDetail> {
    return this.request<SourceDetail>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(sourceId)}`,
      "PATCH",
      accessToken,
      body,
    );
  }

  reprocess(
    accessToken: string,
    projectId: string,
    sourceId: string,
  ): Promise<SourceDetail> {
    return this.request<SourceDetail>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(sourceId)}/reprocess`,
      "POST",
      accessToken,
    );
  }

  async download(
    accessToken: string,
    projectId: string,
    sourceId: string,
  ): Promise<GatewayDownloadFile> {
    let response: Response;

    try {
      response = await fetch(
        `${this.config.sourcesServiceUrl}/api/v1/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(sourceId)}/download`,
        {
          method: "GET",
          headers: {
            accept: "application/octet-stream",
            authorization: `Bearer ${accessToken}`,
          },
          signal: AbortSignal.timeout(
            this.config.sourcesUploadTimeoutMs,
          ),
        },
      );
    } catch {
      throw new ServiceUnavailableException(
        "Sources Service no está disponible.",
      );
    }

    if (!response.ok) {
      throw new HttpException(
        await this.readPayload(response),
        response.status,
      );
    }

    return {
      fileName: fileNameFromDisposition(
        response.headers.get("content-disposition"),
        "fuente",
      ),
      mediaType:
        response.headers.get("content-type") ??
        "application/octet-stream",
      buffer: Buffer.from(await response.arrayBuffer()),
    };
  }

  archive(
    accessToken: string,
    projectId: string,
    sourceId: string,
  ): Promise<SourceDetail> {
    return this.request<SourceDetail>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(sourceId)}`,
      "DELETE",
      accessToken,
    );
  }

  private async requestMultipart<T>(
    path: string,
    accessToken: string,
    form: FormData,
  ): Promise<T> {
    let response: Response;

    try {
      response = await fetch(
        `${this.config.sourcesServiceUrl}${path}`,
        {
          method: "POST",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${accessToken}`,
          },
          body: form,
          signal: AbortSignal.timeout(
            this.config.sourcesUploadTimeoutMs,
          ),
        },
      );
    } catch {
      throw new ServiceUnavailableException(
        "Sources Service no está disponible.",
      );
    }

    const payload = await this.readPayload(response);

    if (!response.ok) {
      throw new HttpException(
        payload ?? {
          message: "Sources Service rechazó la carga.",
        },
        response.status,
      );
    }

    return payload as T;
  }

  private async request<T>(
    path: string,
    method: SourcesMethod,
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
      response = await fetch(
        `${this.config.sourcesServiceUrl}${path}`,
        {
          method,
          headers,
          body:
            body === undefined
              ? undefined
              : JSON.stringify(body),
          signal: AbortSignal.timeout(
            this.config.sourcesTimeoutMs,
          ),
        },
      );
    } catch {
      throw new ServiceUnavailableException(
        "Sources Service no está disponible.",
      );
    }

    const payload = await this.readPayload(response);

    if (!response.ok) {
      throw new HttpException(
        payload ?? {
          message: "Sources Service rechazó la solicitud.",
        },
        response.status,
      );
    }

    return payload as T;
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
