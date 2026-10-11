import { randomUUID } from "node:crypto";
import { parseProviderConfigurationId } from "../providers/ai-provider-input";
import {
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  RequestTimeoutException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import type {
  PrototypeImageGenerationInternalRequest,
  PrototypeImageGenerationInternalResponse,
  PrototypeVisualDevice,
} from "@levantamiento-rq/shared-contracts";
import {
  inspectAiOutboundContent,
  resolveAiDlpPolicy,
} from "../execution/ai-data-loss-prevention";
import { AiProviderConfigurationsService } from "../providers/ai-provider-configurations.service";
import type { AiProviderConfigurationEntity } from "../providers/ai-provider-configuration.entity";
import { AiProviderAuditEntity } from "../providers/ai-provider-audit.entity";
import {
  PROTOTYPE_IMAGE_GENERATION_CONFIG,
  type PrototypeImageGenerationConfig,
} from "./prototype-image-generation.config";
import {
  loadComfyUiWorkflowTemplate,
  parseComfyUiWorkflowReference,
  renderComfyUiWorkflowTemplate,
} from "../comfyui/comfyui-workflow-template";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function ollamaImageFromResponse(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const payload = record(JSON.parse(trimmed));
    return typeof payload?.image === "string" && payload.image
      ? payload.image
      : null;
  } catch {
    for (const line of trimmed.split(/\r?\n/).reverse()) {
      if (!line.trim()) continue;
      try {
        const payload = record(JSON.parse(line));
        if (typeof payload?.image === "string" && payload.image) {
          return payload.image;
        }
      } catch {
        // Ignora eventos de progreso incompletos/no JSON.
      }
    }
    return null;
  }
}

const COMFYUI_AUTOMATIC_MODELS = new Set([
  "workflow-pendiente",
  "auto",
  "auto-checkpoint",
  "checkpoint automatico",
  "checkpoint automático",
]);

function comfyUiCheckpointNames(value: unknown): string[] {
  const root = record(value);
  const loader = record(root?.CheckpointLoaderSimple);
  const input = record(loader?.input);
  const required = record(input?.required);
  const raw = required?.ckpt_name;
  if (!Array.isArray(raw) || !Array.isArray(raw[0])) return [];
  return raw[0].filter(
    (item): item is string => typeof item === "string" && Boolean(item.trim()),
  );
}

function comfyUiDimensions(size: "1536x1024" | "1024x1536") {
  return size === "1536x1024"
    ? { width: 1536, height: 1024 }
    : { width: 1024, height: 1536 };
}

function buildComfyUiWorkflow(input: {
  checkpoint: string;
  prompt: string;
  requestedSize: "1536x1024" | "1024x1536";
}): Record<string, unknown> {
  const { width, height } = comfyUiDimensions(input.requestedSize);
  const seed = Number.parseInt(
    randomUUID().replace(/-/gu, "").slice(0, 12),
    16,
  );
  return {
    "3": {
      class_type: "KSampler",
      inputs: {
        seed,
        steps: 4,
        cfg: 1,
        sampler_name: "euler",
        scheduler: "sgm_uniform",
        denoise: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
    },
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: input.checkpoint },
    },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: { width, height, batch_size: 1 },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: { text: input.prompt, clip: ["4", 1] },
    },
    "7": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: "low quality, blurry, distorted interface, watermark, random letters, illegible text, duplicated elements, cropped layout",
        clip: ["4", 1],
      },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: { samples: ["3", 0], vae: ["4", 2] },
    },
    "9": {
      class_type: "SaveImage",
      inputs: { filename_prefix: "rq_prototype", images: ["8", 0] },
    },
  };
}

const COMFYUI_UI_NEGATIVE_PROMPT =
  "low quality, blurry, distorted interface, watermark, random letters, illegible text, duplicated elements, cropped layout, laptop, desktop monitor, smartphone hardware, tablet hardware, physical device, device frame, 3d mockup, perspective mockup, isometric view, marketing presentation, moodboard, storyboard, infographic, flowchart, wireframe, sketch";

function comfyUiSeed(): number {
  return Number.parseInt(randomUUID().replace(/-/gu, "").slice(0, 12), 16);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function parsePrototypeImageGenerationInternalRequest(
  value: unknown,
): PrototypeImageGenerationInternalRequest {
  const input = record(value);
  if (
    input?.purpose !== "PROTOTYPE_IMAGE_GENERATION" ||
    typeof input.prompt !== "string" ||
    !input.prompt.trim() ||
    !["WEB", "MOBILE"].includes(input.device as string) ||
    !["1536x1024", "1024x1536"].includes(input.requestedSize as string)
  ) {
    throw new ConflictException("La solicitud interna de imagen no es válida.");
  }
  const device = input.device as PrototypeVisualDevice;
  const requestedSize = input.requestedSize as "1536x1024" | "1024x1536";
  if (
    (device === "WEB" && requestedSize !== "1536x1024") ||
    (device === "MOBILE" && requestedSize !== "1024x1536")
  )
    throw new ConflictException("El tamaño no corresponde al dispositivo.");
  if (Buffer.byteLength(input.prompt, "utf8") > 32_000)
    throw new ConflictException("El prompt visual supera el tamaño permitido.");
  return {
    purpose: "PROTOTYPE_IMAGE_GENERATION",
    ...(input.providerConfigurationId !== undefined
      ? {
          providerConfigurationId: parseProviderConfigurationId(
            String(input.providerConfigurationId),
          ),
        }
      : {}),
    prompt: input.prompt.trim(),
    device,
    requestedSize,
  };
}

@Injectable()
export class InternalImageGenerationService {
  constructor(
    private readonly providers: AiProviderConfigurationsService,
    @InjectRepository(AiProviderAuditEntity)
    private readonly audits: Repository<AiProviderAuditEntity>,
    @Inject(PROTOTYPE_IMAGE_GENERATION_CONFIG)
    private readonly config: PrototypeImageGenerationConfig,
  ) {}
  async generate(
    request: PrototypeImageGenerationInternalRequest,
    correlationId: string,
  ): Promise<PrototypeImageGenerationInternalResponse> {
    const executionId = randomUUID();
    const startedAt = new Date();

    if (request.providerConfigurationId) {
      const selected = await this.providers.resolveImageProviderConfiguration(
        request.providerConfigurationId,
      );
      if (selected.providerType === "OLLAMA_IMAGES") {
        return this.generateOllamaImage(
          selected,
          request,
          correlationId,
          executionId,
          startedAt,
        );
      }
    }
    let resolved: {
      configuration: AiProviderConfigurationEntity;
      apiKey: string | null;
    };

    try {
      if (request.providerConfigurationId) {
        resolved = await this.providers.resolveImageProvider(
          request.providerConfigurationId,
        );
      } else {
        const legacy = await this.providers.resolveDefault();
        resolved = {
          configuration: legacy.configuration,
          apiKey: legacy.apiKey,
        };
      }
    } catch {
      throw new ConflictException({
        errorCode: "IMAGE_PROVIDER_NOT_CONFIGURED",
        message:
          "No hay un proveedor de imágenes habilitado, validado y seleccionado para el prototipo.",
      });
    }

    const { configuration, apiKey } = resolved;
    const providerCode =
      configuration.providerType === "COMFYUI"
        ? ("COMFYUI" as const)
        : ("OPENAI_IMAGES" as const);
    const configuredModel =
      configuration.providerType === "OPENAI" &&
      configuration.purpose !== "IMAGE"
        ? this.config.model
        : configuration.model;

    const decision = inspectAiOutboundContent(
      request.prompt,
      resolveAiDlpPolicy(),
    );
    const metadata = {
      purpose: request.purpose,
      provider: providerCode,
      model: configuredModel,
      device: request.device,
      requestedSize: request.requestedSize,
      startedAt: startedAt.toISOString(),
    };

    if (decision.action === "BLOCK") {
      await this.audit(executionId, configuration.id, correlationId, "FAILED", {
        ...metadata,
        errorCode: "PROTOTYPE_IMAGE_DLP_BLOCKED",
        completedAt: new Date().toISOString(),
      });
      throw new ConflictException({
        errorCode: "PROTOTYPE_IMAGE_DLP_BLOCKED",
        message:
          "El contenido visual contiene información sensible no permitida.",
      });
    }

    try {
      const result =
        configuration.providerType === "COMFYUI"
          ? await this.generateWithComfyUi(
              configuration,
              decision.content,
              request,
              correlationId,
            )
          : await this.generateWithOpenAi(
              configuration,
              apiKey,
              decision.content,
              request,
            );

      await this.audit(
        executionId,
        configuration.id,
        correlationId,
        "SUCCEEDED",
        {
          ...metadata,
          provider: result.provider,
          model: result.model,
          completedAt: new Date().toISOString(),
        },
      );
      return { ...result, executionId };
    } catch (error) {
      const errorCode =
        error instanceof RequestTimeoutException
          ? `${providerCode}_TIMEOUT`
          : error instanceof ConflictException
            ? `${providerCode}_CONFIGURATION`
            : error instanceof ServiceUnavailableException
              ? `${providerCode}_UNAVAILABLE`
              : `${providerCode}_INVALID_RESPONSE`;

      await this.audit(executionId, configuration.id, correlationId, "FAILED", {
        ...metadata,
        errorCode,
        completedAt: new Date().toISOString(),
      });

      if (
        error instanceof ConflictException ||
        error instanceof ServiceUnavailableException ||
        error instanceof BadGatewayException ||
        error instanceof RequestTimeoutException
      ) {
        throw error;
      }
      throw new BadGatewayException({
        errorCode,
        message:
          configuration.providerType === "COMFYUI"
            ? "ComfyUI no devolvió una imagen válida."
            : "OpenAI no devolvió una imagen estructural válida.",
      });
    }
  }

  private async generateWithOpenAi(
    configuration: AiProviderConfigurationEntity,
    apiKey: string | null,
    prompt: string,
    request: PrototypeImageGenerationInternalRequest,
  ): Promise<Omit<PrototypeImageGenerationInternalResponse, "executionId">> {
    if (!apiKey) {
      throw new ConflictException({
        errorCode: "OPENAI_IMAGE_CREDENTIAL_NOT_CONFIGURED",
        message:
          "El proveedor OpenAI de imágenes no tiene credencial disponible.",
      });
    }
    const model =
      configuration.purpose === "IMAGE"
        ? configuration.model
        : this.config.model;

    let response: Response;
    try {
      response = await fetch(`${configuration.baseUrl}/images/generations`, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          prompt,
          size: request.requestedSize,
          quality: this.config.quality,
          output_format: "png",
          n: 1,
        }),
        signal: AbortSignal.timeout(configuration.timeoutMs),
      });
    } catch (error) {
      const timeout =
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError");
      if (timeout) {
        throw new RequestTimeoutException({
          errorCode: "OPENAI_IMAGE_TIMEOUT",
          message: "OpenAI excedió el tiempo permitido para generar la imagen.",
        });
      }
      throw new ServiceUnavailableException({
        errorCode: "OPENAI_IMAGE_UNAVAILABLE",
        message: "OpenAI Images no está disponible temporalmente.",
      });
    }

    const raw = await response.text();
    if (!response.ok) {
      const retryable =
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500;
      const code = `OPENAI_IMAGE_HTTP_${response.status}`;
      if (retryable) {
        throw new ServiceUnavailableException({
          errorCode: code,
          message: "OpenAI Images no está disponible temporalmente.",
        });
      }
      throw new BadGatewayException({
        errorCode: code,
        message: "OpenAI Images rechazó la solicitud visual.",
      });
    }

    let payload: Record<string, unknown> | null = null;
    try {
      payload = record(raw ? JSON.parse(raw) : null);
    } catch {
      payload = null;
    }
    const first = Array.isArray(payload?.data) ? record(payload.data[0]) : null;
    const imageBase64 = first?.b64_json;
    if (
      typeof imageBase64 !== "string" ||
      !imageBase64 ||
      imageBase64.length > this.config.maxBase64Chars
    ) {
      throw new BadGatewayException({
        errorCode: "OPENAI_IMAGE_INVALID_RESPONSE",
        message: "OpenAI no devolvió una imagen estructural válida.",
      });
    }
    return {
      provider: "OPENAI_IMAGES",
      model,
      mediaType: "image/png",
      imageBase64,
    };
  }

  private async generateWithComfyUi(
    configuration: AiProviderConfigurationEntity,
    prompt: string,
    request: PrototypeImageGenerationInternalRequest,
    correlationId: string,
  ): Promise<Omit<PrototypeImageGenerationInternalResponse, "executionId">> {
    const baseUrl = configuration.baseUrl.replace(/\/+$/u, "");
    const workflowReference = parseComfyUiWorkflowReference(
      configuration.model,
    );

    let workflow: Record<string, unknown>;
    let generatedModel: string;

    if (workflowReference) {
      const { width, height } = comfyUiDimensions(request.requestedSize);
      const template = loadComfyUiWorkflowTemplate(workflowReference);
      workflow = renderComfyUiWorkflowTemplate(template, {
        prompt,
        negativePrompt: COMFYUI_UI_NEGATIVE_PROMPT,
        width,
        height,
        seed: comfyUiSeed(),
        model: workflowReference.model,
      });
      generatedModel = workflowReference.model ?? configuration.model;
    } else {
      const checkpoint = await this.resolveComfyUiCheckpoint(configuration);
      workflow = buildComfyUiWorkflow({
        checkpoint,
        prompt,
        requestedSize: request.requestedSize,
      });
      generatedModel = checkpoint;
    }

    let promptResponse: Response;
    try {
      promptResponse = await fetch(`${baseUrl}/prompt`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          prompt: workflow,
          client_id: correlationId.slice(0, 100),
        }),
        signal: AbortSignal.timeout(Math.min(configuration.timeoutMs, 30_000)),
      });
    } catch (error) {
      throw this.throwComfyUiTransport(error);
    }

    const promptText = await promptResponse.text();
    if (!promptResponse.ok) {
      const body = promptText.slice(0, 500);
      if (promptResponse.status >= 500) {
        throw new ServiceUnavailableException({
          errorCode: `COMFYUI_PROMPT_HTTP_${promptResponse.status}`,
          message: `ComfyUI no pudo aceptar temporalmente el workflow. ${body}`,
        });
      }
      throw new ConflictException({
        errorCode: `COMFYUI_PROMPT_HTTP_${promptResponse.status}`,
        message: `ComfyUI rechazó el workflow configurado. ${body}`,
      });
    }

    let promptPayload: Record<string, unknown> | null = null;
    try {
      promptPayload = record(promptText ? JSON.parse(promptText) : null);
    } catch {
      promptPayload = null;
    }
    const promptId = promptPayload?.prompt_id;
    if (typeof promptId !== "string" || !promptId) {
      throw new BadGatewayException({
        errorCode: "COMFYUI_PROMPT_ID_MISSING",
        message: "ComfyUI no devolvió el identificador del trabajo.",
      });
    }

    const deadline = Date.now() + configuration.timeoutMs;
    while (Date.now() < deadline) {
      const remaining = Math.max(1_000, deadline - Date.now());
      let historyResponse: Response;
      try {
        historyResponse = await fetch(
          `${baseUrl}/history/${encodeURIComponent(promptId)}`,
          {
            headers: { accept: "application/json" },
            signal: AbortSignal.timeout(Math.min(remaining, 30_000)),
          },
        );
      } catch (error) {
        throw this.throwComfyUiTransport(error);
      }

      if (!historyResponse.ok) {
        if (historyResponse.status >= 500) {
          throw new ServiceUnavailableException({
            errorCode: `COMFYUI_HISTORY_HTTP_${historyResponse.status}`,
            message: "ComfyUI no pudo consultar temporalmente el trabajo.",
          });
        }
        throw new BadGatewayException({
          errorCode: `COMFYUI_HISTORY_HTTP_${historyResponse.status}`,
          message: "ComfyUI no permitió consultar el trabajo generado.",
        });
      }

      const history = record(await historyResponse.json().catch(() => null));
      const entry = history ? record(history[promptId]) : null;
      if (entry) {
        const status = record(entry.status);
        const completed = status?.completed === true;
        const statusString =
          typeof status?.status_str === "string"
            ? status.status_str.toLowerCase()
            : "";
        if (statusString === "error") {
          throw new BadGatewayException({
            errorCode: "COMFYUI_EXECUTION_FAILED",
            message:
              "ComfyUI informó un error durante la ejecución del workflow.",
          });
        }
        if (completed) {
          const output = this.comfyUiOutputImage(entry);
          if (!output) {
            throw new BadGatewayException({
              errorCode: "COMFYUI_IMAGE_NOT_FOUND",
              message:
                "El workflow terminó, pero ComfyUI no reportó imagen de salida.",
            });
          }
          const query = new URLSearchParams({
            filename: output.filename,
            subfolder: output.subfolder,
            type: output.type,
          });
          let imageResponse: Response;
          try {
            imageResponse = await fetch(`${baseUrl}/view?${query.toString()}`, {
              headers: { accept: "image/png,*/*" },
              signal: AbortSignal.timeout(Math.min(remaining, 30_000)),
            });
          } catch (error) {
            throw this.throwComfyUiTransport(error);
          }
          if (!imageResponse.ok) {
            throw new BadGatewayException({
              errorCode: `COMFYUI_VIEW_HTTP_${imageResponse.status}`,
              message:
                "No fue posible recuperar la imagen generada por ComfyUI.",
            });
          }
          const binary = Buffer.from(await imageResponse.arrayBuffer());
          if (binary.length === 0) {
            throw new BadGatewayException({
              errorCode: "COMFYUI_EMPTY_IMAGE",
              message: "ComfyUI devolvió una imagen vacía.",
            });
          }
          const imageBase64 = binary.toString("base64");
          if (imageBase64.length > this.config.maxBase64Chars) {
            throw new BadGatewayException({
              errorCode: "COMFYUI_IMAGE_TOO_LARGE",
              message: "La imagen de ComfyUI supera el tamaño permitido.",
            });
          }
          return {
            provider: "COMFYUI",
            model: generatedModel,
            mediaType: "image/png",
            imageBase64,
          };
        }
      }
      await delay(750);
    }
    throw new RequestTimeoutException({
      errorCode: "COMFYUI_TIMEOUT",
      message: "ComfyUI excedió el tiempo permitido para generar la imagen.",
    });
  }

  private async resolveComfyUiCheckpoint(
    configuration: AiProviderConfigurationEntity,
  ): Promise<string> {
    const baseUrl = configuration.baseUrl.replace(/\/+$/u, "");
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/object_info/CheckpointLoaderSimple`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(Math.min(configuration.timeoutMs, 15_000)),
      });
    } catch (error) {
      throw this.throwComfyUiTransport(error);
    }
    if (!response.ok) {
      if (response.status >= 500) {
        throw new ServiceUnavailableException({
          errorCode: `COMFYUI_CHECKPOINT_HTTP_${response.status}`,
          message: "ComfyUI no pudo consultar temporalmente sus checkpoints.",
        });
      }
      throw new ConflictException({
        errorCode: "COMFYUI_CHECKPOINTS_UNAVAILABLE",
        message: "ComfyUI no expone CheckpointLoaderSimple.",
      });
    }
    const checkpoints = comfyUiCheckpointNames(
      await response.json().catch(() => null),
    );
    if (checkpoints.length === 0) {
      throw new ConflictException({
        errorCode: "COMFYUI_CHECKPOINTS_EMPTY",
        message:
          "ComfyUI está conectado, pero no tiene checkpoints disponibles.",
      });
    }
    const configured = configuration.model.trim();
    if (COMFYUI_AUTOMATIC_MODELS.has(configured.toLowerCase())) {
      return checkpoints[0];
    }
    const exact = checkpoints.find((checkpoint) => checkpoint === configured);
    if (!exact) {
      throw new ConflictException({
        errorCode: "COMFYUI_CHECKPOINT_NOT_FOUND",
        message: `El checkpoint configurado "${configured}" no está instalado en ComfyUI.`,
      });
    }
    return exact;
  }

  private comfyUiOutputImage(historyEntry: Record<string, unknown>): {
    filename: string;
    subfolder: string;
    type: string;
  } | null {
    const outputs = record(historyEntry.outputs);
    if (!outputs) return null;
    for (const value of Object.values(outputs)) {
      const node = record(value);
      if (!Array.isArray(node?.images)) continue;
      for (const rawImage of node.images) {
        const image = record(rawImage);
        if (
          typeof image?.filename === "string" &&
          image.filename &&
          typeof image?.type === "string" &&
          image.type
        ) {
          return {
            filename: image.filename,
            subfolder:
              typeof image.subfolder === "string" ? image.subfolder : "",
            type: image.type,
          };
        }
      }
    }
    return null;
  }

  private throwComfyUiTransport(error: unknown): never {
    const timeout =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    if (timeout) {
      throw new RequestTimeoutException({
        errorCode: "COMFYUI_TIMEOUT",
        message: "ComfyUI excedió el tiempo permitido.",
      });
    }
    throw new ServiceUnavailableException({
      errorCode: "COMFYUI_UNAVAILABLE",
      message: "ComfyUI no está disponible temporalmente.",
    });
  }

  private async generateOllamaImage(
    configuration: AiProviderConfigurationEntity,
    request: PrototypeImageGenerationInternalRequest,
    correlationId: string,
    executionId: string,
    startedAt: Date,
  ): Promise<PrototypeImageGenerationInternalResponse> {
    const dimensions =
      request.device === "WEB"
        ? { width: 1024, height: 768 }
        : { width: 768, height: 1024 };

    const metadata = {
      purpose: request.purpose,
      provider: "OLLAMA_IMAGES",
      model: configuration.model,
      device: request.device,
      requestedSize: request.requestedSize,
      actualSize: `${dimensions.width}x${dimensions.height}`,
      startedAt: startedAt.toISOString(),
    };

    try {
      const response = await fetch(`${configuration.baseUrl}/api/generate`, {
        method: "POST",
        headers: {
          accept: "application/json, application/x-ndjson",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: configuration.model,
          prompt: request.prompt,
          stream: false,
          width: dimensions.width,
          height: dimensions.height,
        }),
        signal: AbortSignal.timeout(configuration.timeoutMs),
      });

      const raw = await response.text();
      if (!response.ok) {
        // Falta de memoria de GPU: es determinista, así que no se reintenta ni se presenta como
        // «no disponible temporalmente».
        const memory =
          /model requires ([\d.]+ GiB) but only ([\d.]+ GiB)/u.exec(raw);
        if (memory) {
          await this.audit(
            executionId,
            configuration.id,
            correlationId,
            "FAILED",
            {
              ...metadata,
              errorCode: "OLLAMA_IMAGE_INSUFFICIENT_MEMORY",
              completedAt: new Date().toISOString(),
            },
          );
          throw new BadGatewayException({
            errorCode: "OLLAMA_IMAGE_INSUFFICIENT_MEMORY",
            message: `El modelo ${configuration.model} necesita ${memory[1]} de memoria de GPU y solo hay ${memory[2]} disponibles. Libera memoria, usa un modelo más ligero o elige ComfyUI.`,
          });
        }
        const retryable =
          response.status === 408 ||
          response.status === 429 ||
          response.status >= 500;
        const errorCode = `OLLAMA_IMAGE_HTTP_${response.status}`;

        await this.audit(
          executionId,
          configuration.id,
          correlationId,
          "FAILED",
          {
            ...metadata,
            errorCode,
            completedAt: new Date().toISOString(),
          },
        );

        if (retryable) {
          throw new ServiceUnavailableException({
            errorCode,
            message: "Ollama Images no está disponible temporalmente.",
          });
        }
        if (response.status === 404) {
          throw new BadGatewayException({
            errorCode: "OLLAMA_IMAGE_MODEL_NOT_FOUND",
            message: `El modelo ${configuration.model} no está instalado en Ollama. Descárgalo con: ollama pull ${configuration.model}`,
          });
        }
        throw new BadGatewayException({
          errorCode,
          message: "Ollama Images rechazó la solicitud visual.",
        });
      }

      const imageBase64 = ollamaImageFromResponse(raw);
      if (!imageBase64 || imageBase64.length > this.config.maxBase64Chars) {
        throw new Error("OLLAMA_IMAGE_INVALID_RESPONSE");
      }

      await this.audit(
        executionId,
        configuration.id,
        correlationId,
        "SUCCEEDED",
        { ...metadata, completedAt: new Date().toISOString() },
      );

      return {
        provider: "OLLAMA_IMAGES",
        model: configuration.model,
        mediaType: "image/png",
        imageBase64,
        executionId,
      };
    } catch (error) {
      if (
        error instanceof ServiceUnavailableException ||
        error instanceof BadGatewayException
      ) {
        throw error;
      }

      const timeout =
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError");
      const errorCode = timeout
        ? "OLLAMA_IMAGE_TIMEOUT"
        : "OLLAMA_IMAGE_INVALID_RESPONSE";

      await this.audit(executionId, configuration.id, correlationId, "FAILED", {
        ...metadata,
        errorCode,
        completedAt: new Date().toISOString(),
      });

      if (timeout) {
        throw new RequestTimeoutException({
          errorCode,
          message:
            "Ollama Images excedió el tiempo permitido para generar la imagen.",
        });
      }
      throw new BadGatewayException({
        errorCode,
        message: "Ollama Images no devolvió una imagen PNG válida.",
      });
    }
  }

  private async audit(
    id: string,
    providerConfigurationId: string,
    correlationId: string,
    outcome: "SUCCEEDED" | "FAILED",
    metadata: object,
  ) {
    await this.audits.save(
      this.audits.create({
        id,
        providerConfigurationId,
        action: "PROTOTYPE_IMAGE_GENERATION",
        actorUserId: "00000000-0000-4000-8000-000000000009",
        correlationId: correlationId.slice(0, 100),
        outcome,
        metadataJson: JSON.stringify(metadata),
        createdAt: new Date(),
      }),
    );
  }
}
