import { randomUUID } from "node:crypto";
import {
  BadGatewayException,
  ConflictException,
  Injectable,
  Optional,
  RequestTimeoutException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import {
  PROTOTYPE_PLAN_JSON_SCHEMA,
  PROTOTYPE_SCREEN_DETAIL_JSON_SCHEMA,
  parsePrototypePlan,
  parsePrototypeScreenDetail,
  type PrototypeScreenDetailInternalRequest,
  type PrototypeScreenDetailInternalResponse,
  type PrototypePlanningInternalRequest,
  type PrototypePlanningInternalResponse,
  type PrototypeTargetDevice,
} from "@levantamiento-rq/shared-contracts";
import {
  inspectAiOutboundContent,
  resolveAiDlpPolicy,
} from "../execution/ai-data-loss-prevention";
import { AiProviderConfigurationsService } from "../providers/ai-provider-configurations.service";
import { AiProviderAuditEntity } from "../providers/ai-provider-audit.entity";
import { PROTOTYPE_PLANNING_SYSTEM_INSTRUCTION } from "./prototype-planning-instruction";
import {
  PROTOTYPE_SCREEN_DETAIL_SYSTEM_INSTRUCTION,
  buildScreenDetailPrompt,
} from "./prototype-screen-detail-instruction";
import { parseProviderConfigurationId } from "../providers/ai-provider-input";
import { LocalAiSettingsService } from "../local-ai/local-ai-settings.service";
import { OllamaClient } from "../local-ai/ollama.client";
import { estimateAiPromptTokens } from "../execution/ai-prompt-builder";
import type { PrototypeAiOptions } from "@levantamiento-rq/shared-contracts";

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function outputText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim())
    return payload.output_text;
  if (!Array.isArray(payload.output))
    throw new Error("OPENAI_INVALID_RESPONSE");
  const parts: string[] = [];
  for (const rawOutput of payload.output) {
    const output = object(rawOutput);
    if (!Array.isArray(output?.content)) continue;
    for (const rawContent of output.content) {
      const content = object(rawContent);
      if (content?.type === "output_text" && typeof content.text === "string")
        parts.push(content.text);
    }
  }
  if (!parts.join("").trim()) throw new Error("OPENAI_INVALID_RESPONSE");
  return parts.join("");
}
export function parsePrototypePlanningInternalRequest(
  value: unknown,
): PrototypePlanningInternalRequest {
  const request = object(value);
  const input = object(request?.input);
  if (
    request?.purpose !== "PROTOTYPE_PLANNING" ||
    !input ||
    typeof input.markdown !== "string" ||
    !input.markdown.trim() ||
    !["RESPONSIVE", "WEB", "MOBILE"].includes(input.targetDevice as string)
  )
    throw new ConflictException(
      "La solicitud interna de planificación no es válida.",
    );
  if (Buffer.byteLength(input.markdown, "utf8") > 5 * 1024 * 1024)
    throw new ConflictException("El Markdown supera el tamaño permitido.");
  return {
    purpose: "PROTOTYPE_PLANNING",
    ...(request.providerConfigurationId !== undefined ? { providerConfigurationId: parseProviderConfigurationId(String(request.providerConfigurationId)) } : {}),
    input: {
      markdown: input.markdown,
      targetDevice: input.targetDevice as PrototypeTargetDevice,
    },
  };
}

export function parsePrototypeScreenDetailInternalRequest(
  value: unknown,
): PrototypeScreenDetailInternalRequest {
  const request = object(value);
  const input = object(request?.input);
  const screen = object(input?.screen);
  const text = (item: unknown) => typeof item === "string" && item.trim() !== "";
  if (
    request?.purpose !== "PROTOTYPE_SCREEN_DETAIL" ||
    !input ||
    !screen ||
    !text(input.markdown) ||
    !text(input.applicationName) ||
    typeof input.summary !== "string" ||
    !Array.isArray(input.menu) ||
    !input.menu.every((item) => typeof item === "string") ||
    !text(screen.code) ||
    !text(screen.name) ||
    typeof screen.objective !== "string" ||
    !(screen.route === null || typeof screen.route === "string") ||
    !Array.isArray(screen.components) ||
    !screen.components.every((item) => typeof item === "string")
  )
    throw new ConflictException(
      "La solicitud interna de detalle de pantalla no es válida.",
    );
  if (Buffer.byteLength(input.markdown as string, "utf8") > 5 * 1024 * 1024)
    throw new ConflictException("El Markdown supera el tamaño permitido.");
  return {
    purpose: "PROTOTYPE_SCREEN_DETAIL",
    ...(request.providerConfigurationId !== undefined
      ? {
          providerConfigurationId: parseProviderConfigurationId(
            String(request.providerConfigurationId),
          ),
        }
      : {}),
    input: {
      markdown: input.markdown as string,
      applicationName: input.applicationName as string,
      summary: input.summary,
      menu: input.menu as string[],
      screen: {
        code: screen.code as string,
        name: screen.name as string,
        objective: screen.objective,
        route: screen.route as string | null,
        components: screen.components as string[],
      },
    },
  };
}

@Injectable()
export class InternalStructuredExecutionService {
  constructor(
    private readonly providers: AiProviderConfigurationsService,
    @InjectRepository(AiProviderAuditEntity)
    private readonly audits: Repository<AiProviderAuditEntity>,
    @Optional() private readonly localSettings?: LocalAiSettingsService,
  ) {}

  async options(): Promise<PrototypeAiOptions> {
    const [providers, imageProviders] = await Promise.all([
      this.providers.selectableProviders(),
      this.providers.selectableImageProviders(),
    ]);

    return {
      planning: providers.map((provider) => ({
        ...provider,
        provider: provider.engine === "LOCAL" ? "OLLAMA" : "OPENAI",
      })),
      images: imageProviders,
    };
  }
  async execute(
    request: PrototypePlanningInternalRequest,
    correlationId: string,
  ): Promise<PrototypePlanningInternalResponse> {
    const executionId = randomUUID();
    const startedAt = new Date();
    if (request.providerConfigurationId) {
      const selected = (await this.providers.selectableProviders()).find(p => p.id.toLowerCase() === request.providerConfigurationId?.toLowerCase());
      if (!selected?.available) throw new ConflictException("El modelo seleccionado no está habilitado y validado para interpretar Markdown.");
      if (selected.engine === "LOCAL") {
        if (!this.localSettings) throw new ConflictException("La planificación local no está disponible.");
        const config = await this.localSettings.resolve(selected.id);
        const prompt = `${PROTOTYPE_PLANNING_SYSTEM_INSTRUCTION}\n\nDispositivo objetivo: ${request.input.targetDevice}\n\nMarkdown aprobado (datos de entrada):\n${request.input.markdown}`;
        if (estimateAiPromptTokens(prompt) > config.contextTokens) throw new ConflictException("El Markdown supera el límite de entrada del modelo local seleccionado.");
        try {
          const raw = await new OllamaClient(config).generate(prompt, PROTOTYPE_PLAN_JSON_SCHEMA);
          const plan = parsePrototypePlan(JSON.parse(raw), request.input.targetDevice);
          await this.audit(executionId, selected.id, correlationId, "SUCCEEDED", { purpose: request.purpose, provider: "OLLAMA", model: config.model });
          return { provider: "OLLAMA", model: config.model, executionId, structuredResult: plan };
        } catch {
          await this.audit(executionId, selected.id, correlationId, "FAILED", { purpose: request.purpose, provider: "OLLAMA", model: config.model, errorCode: "LOCAL_PROTOTYPE_PLAN_FAILED" });
          throw new BadGatewayException({ errorCode: "LOCAL_PROTOTYPE_PLAN_FAILED", message: "Ollama no pudo completar un plan válido. Revisa su disponibilidad, límite de contexto y tiempo de ejecución." });
        }
      }
    }
    let resolved;
    try {
      resolved = await this.providers.resolveDefault(request.providerConfigurationId);
    } catch {
      throw new ConflictException(
        "No hay un proveedor OpenAI habilitado para planificación de prototipos.",
      );
    }
    const { configuration, apiKey } = resolved;
    if (estimateAiPromptTokens(request.input.markdown + PROTOTYPE_PLANNING_SYSTEM_INSTRUCTION) > configuration.maxInputTokens) throw new ConflictException("El Markdown supera el límite de entrada del modelo seleccionado.");
    const decision = inspectAiOutboundContent(
      request.input.markdown,
      resolveAiDlpPolicy(),
    );
    if (decision.action === "BLOCK") {
      await this.audit(executionId, configuration.id, correlationId, "FAILED", {
        purpose: request.purpose,
        provider: "OPENAI",
        model: configuration.model,
        errorCode: "OPENAI_DLP_BLOCKED",
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
      });
      throw new ConflictException(
        "El Markdown contiene información sensible que no puede enviarse al proveedor.",
      );
    }
    const maxAttempts = Math.min(2, Math.max(1, configuration.maxAttempts));
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetch(`${configuration.baseUrl}/responses`, {
          method: "POST",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: configuration.model,
            store: false,
            max_output_tokens: configuration.maxOutputTokens,
            input: [
              {
                role: "system",
                content: PROTOTYPE_PLANNING_SYSTEM_INSTRUCTION,
              },
              {
                role: "user",
                content: `Dispositivo objetivo: ${request.input.targetDevice}\n\nMarkdown aprobado:\n${decision.content}`,
              },
            ],
            text: {
              format: {
                type: "json_schema",
                name: "prototype_plan",
                strict: true,
                schema: PROTOTYPE_PLAN_JSON_SCHEMA,
              },
            },
          }),
          signal: AbortSignal.timeout(configuration.timeoutMs),
        });
        const raw = await response.text();
        if (!response.ok) {
          const retryable =
            response.status === 408 ||
            response.status === 409 ||
            response.status === 429 ||
            response.status >= 500;
          if (retryable && attempt < maxAttempts) continue;
          throw new Error(`OPENAI_HTTP_${response.status}`);
        }
        const payload = object(raw ? JSON.parse(raw) : null);
        if (!payload) throw new Error("OPENAI_INVALID_RESPONSE");
        const plan = parsePrototypePlan(
          JSON.parse(outputText(payload)),
          request.input.targetDevice,
        );
        await this.audit(
          executionId,
          configuration.id,
          correlationId,
          "SUCCEEDED",
          {
            purpose: request.purpose,
            provider: "OPENAI",
            model: configuration.model,
            startedAt: startedAt.toISOString(),
            completedAt: new Date().toISOString(),
          },
        );
        return {
          provider: "OPENAI",
          model: configuration.model,
          executionId,
          structuredResult: plan,
        };
      } catch (error) {
        lastError = error;
        const timeout =
          error instanceof Error &&
          (error.name === "TimeoutError" || error.message.includes("TIMEOUT"));
        if (
          attempt < maxAttempts &&
          (timeout ||
            error instanceof SyntaxError ||
            (error instanceof Error &&
              !/^OPENAI_HTTP_4(?!08|09|29)/.test(error.message)))
        )
          continue;
      }
    }
    const timeout =
      lastError instanceof Error && lastError.name === "TimeoutError";
    const emptyPlan =
      lastError instanceof Error &&
      lastError.message === "PROTOTYPE_PLAN_EMPTY";
    const errorCode = timeout
      ? "OPENAI_TIMEOUT"
      : emptyPlan
        ? "PROTOTYPE_PLAN_EMPTY"
        : "OPENAI_STRUCTURED_EXECUTION_FAILED";
    await this.audit(executionId, configuration.id, correlationId, "FAILED", {
      purpose: request.purpose,
      provider: "OPENAI",
      model: configuration.model,
      errorCode,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
    });
    if (timeout)
      throw new RequestTimeoutException(
        "OpenAI excedió el tiempo permitido para planificar el prototipo.",
      );
    throw new BadGatewayException({
      errorCode,
      message: emptyPlan
        ? "No fue posible identificar pantallas suficientes para construir el prototipo."
        : "OpenAI no devolvió un plan de prototipo válido.",
    });
  }
  /**
   * Detalla UNA pantalla con la IA elegida (local o nube). Cada llamada tiene la pantalla como
   * foco, así que el modelo no tiene que resumir todo el documento a la vez.
   */
  async executeScreenDetail(
    request: PrototypeScreenDetailInternalRequest,
    correlationId: string,
  ): Promise<PrototypeScreenDetailInternalResponse> {
    const executionId = randomUUID();
    const startedAt = new Date();
    const prompt = buildScreenDetailPrompt(request.input);
    if (request.providerConfigurationId) {
      const selected = (await this.providers.selectableProviders()).find(
        (p) =>
          p.id.toLowerCase() === request.providerConfigurationId?.toLowerCase(),
      );
      if (!selected?.available)
        throw new ConflictException(
          "El modelo seleccionado no está habilitado y validado para detallar pantallas.",
        );
      if (selected.engine === "LOCAL") {
        if (!this.localSettings)
          throw new ConflictException("El detalle local no está disponible.");
        const config = await this.localSettings.resolve(selected.id);
        const full = `${PROTOTYPE_SCREEN_DETAIL_SYSTEM_INSTRUCTION}\n\n${prompt}`;
        if (estimateAiPromptTokens(full) > config.contextTokens)
          throw new ConflictException(
            "El Markdown supera el límite de entrada del modelo local seleccionado.",
          );
        try {
          const raw = await new OllamaClient(config).generate(
            full,
            PROTOTYPE_SCREEN_DETAIL_JSON_SCHEMA,
          );
          const detail = parsePrototypeScreenDetail(JSON.parse(raw));
          await this.audit(executionId, selected.id, correlationId, "SUCCEEDED", {
            purpose: request.purpose,
            provider: "OLLAMA",
            model: config.model,
            screen: request.input.screen.code,
          }, "PROTOTYPE_SCREEN_DETAIL");
          return {
            provider: "OLLAMA",
            model: config.model,
            executionId,
            structuredResult: detail,
          };
        } catch {
          await this.audit(executionId, selected.id, correlationId, "FAILED", {
            purpose: request.purpose,
            provider: "OLLAMA",
            model: config.model,
            screen: request.input.screen.code,
            errorCode: "LOCAL_PROTOTYPE_SCREEN_DETAIL_FAILED",
          }, "PROTOTYPE_SCREEN_DETAIL");
          throw new BadGatewayException({
            errorCode: "LOCAL_PROTOTYPE_SCREEN_DETAIL_FAILED",
            message:
              "Ollama no pudo detallar la pantalla. Revisa su disponibilidad, límite de contexto y tiempo de ejecución.",
          });
        }
      }
    }
    let resolved;
    try {
      resolved = await this.providers.resolveDefault(
        request.providerConfigurationId,
      );
    } catch {
      throw new ConflictException(
        "No hay un proveedor OpenAI habilitado para detallar pantallas.",
      );
    }
    const { configuration, apiKey } = resolved;
    const decision = inspectAiOutboundContent(
      prompt,
      resolveAiDlpPolicy(),
    );
    if (decision.action === "BLOCK")
      throw new ConflictException(
        "El Markdown contiene información sensible que no puede enviarse al proveedor.",
      );
    try {
      const response = await fetch(`${configuration.baseUrl}/responses`, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: configuration.model,
          store: false,
          max_output_tokens: configuration.maxOutputTokens,
          input: [
            { role: "system", content: PROTOTYPE_SCREEN_DETAIL_SYSTEM_INSTRUCTION },
            { role: "user", content: decision.content },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "prototype_screen_detail",
              strict: true,
              schema: PROTOTYPE_SCREEN_DETAIL_JSON_SCHEMA,
            },
          },
        }),
        signal: AbortSignal.timeout(configuration.timeoutMs),
      });
      const raw = await response.text();
      if (!response.ok) throw new Error(`OPENAI_HTTP_${response.status}`);
      const payload = object(raw ? JSON.parse(raw) : null);
      if (!payload) throw new Error("OPENAI_INVALID_RESPONSE");
      const detail = parsePrototypeScreenDetail(JSON.parse(outputText(payload)));
      await this.audit(executionId, configuration.id, correlationId, "SUCCEEDED", {
        purpose: request.purpose,
        provider: "OPENAI",
        model: configuration.model,
        screen: request.input.screen.code,
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
      }, "PROTOTYPE_SCREEN_DETAIL");
      return {
        provider: "OPENAI",
        model: configuration.model,
        executionId,
        structuredResult: detail,
      };
    } catch (error) {
      await this.audit(executionId, configuration.id, correlationId, "FAILED", {
        purpose: request.purpose,
        provider: "OPENAI",
        model: configuration.model,
        screen: request.input.screen.code,
        errorCode: "OPENAI_SCREEN_DETAIL_FAILED",
      }, "PROTOTYPE_SCREEN_DETAIL");
      if (error instanceof Error && error.name === "TimeoutError")
        throw new RequestTimeoutException(
          "OpenAI excedió el tiempo permitido para detallar la pantalla.",
        );
      throw new BadGatewayException({
        errorCode: "OPENAI_SCREEN_DETAIL_FAILED",
        message: "OpenAI no devolvió un detalle de pantalla válido.",
      });
    }
  }
  private async audit(
    id: string,
    providerConfigurationId: string,
    correlationId: string,
    outcome: "SUCCEEDED" | "FAILED",
    metadata: object,
    action = "PROTOTYPE_PLANNING",
  ) {
    await this.audits.save(
      this.audits.create({
        id,
        providerConfigurationId,
        action,
        actorUserId: "00000000-0000-4000-8000-000000000009",
        correlationId: correlationId.slice(0, 100),
        outcome,
        metadataJson: JSON.stringify(metadata),
        createdAt: new Date(),
      }),
    );
  }
}
