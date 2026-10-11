import { BadRequestException } from "@nestjs/common";

import type {
  CreateAiProviderConfiguration,
  DuplicateAiProviderConfiguration,
  RotateAiProviderCredential,
  UpdateAiProviderConfiguration,
} from "@levantamiento-rq/shared-contracts";
import { parseOllamaBaseUrl } from "../local-ai/ollama.config";

export const OPENAI_BASE_URL = "https://api.openai.com/v1";
export const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
export const GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta";
export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1";
export const COMFYUI_DEFAULT_BASE_URL = "http://127.0.0.1:8188";
export const OLLAMA_IMAGES_DEFAULT_BASE_URL = "http://127.0.0.1:11435";

type ConfiguredProviderType =
  | "OPENAI"
  | "ANTHROPIC"
  | "GEMINI"
  | "GROQ"
  | "CEREBRAS"
  | "OLLAMA"
  | "OPENAI_COMPATIBLE"
  | "COMFYUI"
  | "OLLAMA_IMAGES";

/** Proveedores de nube que exigen API key guardada en la bóveda. */
export function isCredentialProviderType(providerType: string): boolean {
  return (
    providerType === "OPENAI" ||
    providerType === "ANTHROPIC" ||
    providerType === "GEMINI" ||
    providerType === "GROQ" ||
    providerType === "CEREBRAS"
  );
}
type ConfiguredProviderPurpose = "TEXT" | "IMAGE";

export function providerLabel(providerType: string): string {
  if (providerType === "ANTHROPIC") return "Claude (Anthropic)";
  if (providerType === "GEMINI") return "Gemini (Google AI Studio)";
  if (providerType === "GROQ") return "Groq";
  if (providerType === "CEREBRAS") return "Cerebras";
  return "OpenAI";
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("El cuerpo de la solicitud no es válido.");
  }
  return value as Readonly<Record<string, unknown>>;
}

function text(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): string {
  if (typeof value !== "string") {
    throw new BadRequestException(`${name} es obligatorio.`);
  }
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new BadRequestException(
      `${name} debe contener entre ${minimum} y ${maximum} caracteres.`,
    );
  }
  return normalized;
}

function integer(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
  fallback?: number,
): number {
  const candidate = value === undefined ? fallback : Number(value);
  if (
    candidate === undefined ||
    !Number.isInteger(candidate) ||
    candidate < minimum ||
    candidate > maximum
  ) {
    throw new BadRequestException(
      `${name} debe estar entre ${minimum} y ${maximum}.`,
    );
  }
  return candidate;
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new BadRequestException(`${name} debe ser booleano.`);
  }
  return value;
}

function configuredProviderType(value: unknown): ConfiguredProviderType {
  if (
    value === "OPENAI" ||
    value === "ANTHROPIC" ||
    value === "GEMINI" ||
    value === "GROQ" ||
    value === "CEREBRAS" ||
    value === "OLLAMA" ||
    value === "OPENAI_COMPATIBLE" ||
    value === "COMFYUI" ||
    value === "OLLAMA_IMAGES"
  ) {
    return value;
  }
  throw new BadRequestException(
    "providerType debe ser OPENAI, ANTHROPIC, GEMINI, GROQ, CEREBRAS, OLLAMA, OPENAI_COMPATIBLE, COMFYUI u OLLAMA_IMAGES.",
  );
}

function configuredPurpose(value: unknown): ConfiguredProviderPurpose {
  if (value === "TEXT" || value === "IMAGE") return value;
  throw new BadRequestException("purpose debe ser TEXT o IMAGE.");
}

function validatePurposeProvider(
  purpose: ConfiguredProviderPurpose,
  providerType: ConfiguredProviderType,
): void {
  const valid =
    (purpose === "TEXT" &&
      (providerType === "OPENAI" ||
        providerType === "ANTHROPIC" ||
        providerType === "GEMINI" ||
        providerType === "GROQ" ||
        providerType === "CEREBRAS" ||
        providerType === "OLLAMA" ||
        providerType === "OPENAI_COMPATIBLE")) ||
    (purpose === "IMAGE" &&
      (providerType === "OPENAI" ||
        providerType === "COMFYUI" ||
        providerType === "OLLAMA_IMAGES"));
  if (!valid) {
    throw new BadRequestException(
      purpose === "TEXT"
        ? "Los generadores de texto admiten OpenAI, Claude (Anthropic), Gemini, Groq, Cerebras, Ollama o un servidor compatible con OpenAI."
        : "Los generadores de imágenes admiten OpenAI, ComfyUI u Ollama Images.",
    );
  }
}

function parseComfyUiBaseUrl(value: unknown): string {
  const raw =
    value === undefined
      ? COMFYUI_DEFAULT_BASE_URL
      : text(value, "baseUrl", 10, 300);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestException(
      "El endpoint de ComfyUI no es una URL válida.",
    );
  }
  const hosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (process.env.LOCAL_AI_ALLOW_DOCKER_HOST === "true") {
    hosts.add("host.docker.internal");
  }
  if (
    url.protocol !== "http:" ||
    !hosts.has(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new BadRequestException(
      "ComfyUI debe apuntar por HTTP a 127.0.0.1, localhost o un host local autorizado.",
    );
  }
  return url.origin;
}

function baseUrl(value: unknown, providerType: ConfiguredProviderType): string {
  if (
    providerType === "OLLAMA" ||
    providerType === "OLLAMA_IMAGES" ||
    providerType === "OPENAI_COMPATIBLE"
  ) {
    const requested =
      value === undefined
        ? providerType === "OLLAMA_IMAGES"
          ? OLLAMA_IMAGES_DEFAULT_BASE_URL
          : undefined
        : text(value, "baseUrl", 10, 300);
    // La URL la escribe un administrador: se admite un equipo de la red local.
    return parseOllamaBaseUrl(
      requested,
      process.env.LOCAL_AI_ALLOW_DOCKER_HOST === "true",
      undefined,
      true,
    );
  }
  if (providerType === "COMFYUI") return parseComfyUiBaseUrl(value);

  const official =
    providerType === "ANTHROPIC"
      ? ANTHROPIC_BASE_URL
      : providerType === "GEMINI"
        ? GEMINI_BASE_URL
        : providerType === "GROQ"
          ? GROQ_BASE_URL
          : providerType === "CEREBRAS"
            ? CEREBRAS_BASE_URL
            : OPENAI_BASE_URL;
  const normalized =
    value === undefined
      ? official
      : text(value, "baseUrl", 10, 300).replace(/\/$/, "");

  if (normalized !== official) {
    throw new BadRequestException(
      `baseUrl solo puede apuntar al endpoint oficial de ${
        providerType === "ANTHROPIC"
          ? "Anthropic"
          : providerType === "GEMINI"
            ? "Google Gemini"
            : providerType === "GROQ"
              ? "Groq"
              : providerType === "CEREBRAS"
                ? "Cerebras"
                : "OpenAI"
      }.`,
    );
  }

  return normalized;
}

function timeoutDefault(providerType: ConfiguredProviderType): number {
  if (providerType === "OLLAMA" || providerType === "OPENAI_COMPATIBLE")
    return 600000;
  if (providerType === "OLLAMA_IMAGES") return 900000;
  if (providerType === "COMFYUI") return 300000;
  return 60000;
}

function timeoutMaximum(providerType: ConfiguredProviderType): number {
  return isCredentialProviderType(providerType) ? 600000 : 900000;
}

function apiKey(value: unknown): string {
  return text(value, "apiKey", 20, 4096);
}

export function parseProviderConfigurationId(value: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.trim(),
    )
  ) {
    throw new BadRequestException(
      "providerConfigurationId debe ser un UUID válido.",
    );
  }
  return value.trim().toLowerCase();
}

export function parseCreateAiProviderConfiguration(
  value: unknown,
): CreateAiProviderConfiguration {
  const input = record(value);
  const providerType = configuredProviderType(input.providerType);
  const purpose = configuredPurpose(input.purpose);
  validatePurposeProvider(purpose, providerType);

  return {
    name: text(input.name, "name", 3, 120),
    providerType,
    purpose,
    model: text(input.model, "model", 2, 120),
    baseUrl: baseUrl(input.baseUrl, providerType),
    timeoutMs: integer(
      input.timeoutMs,
      "timeoutMs",
      1000,
      timeoutMaximum(providerType),
      timeoutDefault(providerType),
    ),
    maxInputTokens: integer(
      input.maxInputTokens,
      "maxInputTokens",
      1000,
      1048576,
      purpose === "IMAGE"
        ? 32000
        : providerType === "OLLAMA" || providerType === "OPENAI_COMPATIBLE"
          ? 131072
          : 120000,
    ),
    maxOutputTokens: integer(
      input.maxOutputTokens,
      "maxOutputTokens",
      100,
      128000,
      purpose === "IMAGE" ? 1000 : 12000,
    ),
    maxAttempts: integer(input.maxAttempts, "maxAttempts", 1, 10, 3),
    ...(isCredentialProviderType(providerType)
      ? { apiKey: apiKey(input.apiKey) }
      : {}),
    isEnabled: optionalBoolean(input.isEnabled, "isEnabled") ?? false,
    isDefault: optionalBoolean(input.isDefault, "isDefault") ?? false,
  };
}

export function parseDuplicateAiProviderConfiguration(
  value: unknown,
): DuplicateAiProviderConfiguration {
  const input = record(value);
  const providerType = configuredProviderType(input.providerType);
  const purpose = configuredPurpose(input.purpose);
  validatePurposeProvider(purpose, providerType);

  return {
    name: text(input.name, "name", 3, 120),
    providerType,
    purpose,
    model: text(input.model, "model", 2, 120),
    baseUrl: baseUrl(input.baseUrl, providerType),
    timeoutMs: integer(
      input.timeoutMs,
      "timeoutMs",
      1000,
      timeoutMaximum(providerType),
      timeoutDefault(providerType),
    ),
    maxInputTokens: integer(
      input.maxInputTokens,
      "maxInputTokens",
      1000,
      1048576,
      purpose === "IMAGE"
        ? 32000
        : providerType === "OLLAMA" || providerType === "OPENAI_COMPATIBLE"
          ? 131072
          : 120000,
    ),
    maxOutputTokens: integer(
      input.maxOutputTokens,
      "maxOutputTokens",
      100,
      128000,
      purpose === "IMAGE" ? 1000 : 12000,
    ),
    maxAttempts: integer(input.maxAttempts, "maxAttempts", 1, 10, 3),
  };
}

export function parseUpdateAiProviderConfiguration(
  value: unknown,
): UpdateAiProviderConfiguration {
  const input = record(value);
  const providerType = configuredProviderType(input.providerType ?? "OPENAI");
  const result: UpdateAiProviderConfiguration = {};

  if (input.name !== undefined) result.name = text(input.name, "name", 3, 120);
  if (input.model !== undefined)
    result.model = text(input.model, "model", 2, 120);
  if (input.baseUrl !== undefined)
    result.baseUrl = baseUrl(input.baseUrl, providerType);
  if (input.timeoutMs !== undefined) {
    result.timeoutMs = integer(
      input.timeoutMs,
      "timeoutMs",
      1000,
      timeoutMaximum(providerType),
    );
  }
  if (input.maxInputTokens !== undefined) {
    result.maxInputTokens = integer(
      input.maxInputTokens,
      "maxInputTokens",
      1000,
      1048576,
    );
  }
  if (input.maxOutputTokens !== undefined) {
    result.maxOutputTokens = integer(
      input.maxOutputTokens,
      "maxOutputTokens",
      100,
      128000,
    );
  }
  if (input.maxAttempts !== undefined) {
    result.maxAttempts = integer(input.maxAttempts, "maxAttempts", 1, 10);
  }
  result.isEnabled = optionalBoolean(input.isEnabled, "isEnabled");
  result.isDefault = optionalBoolean(input.isDefault, "isDefault");

  if (Object.values(result).every((item) => item === undefined)) {
    throw new BadRequestException("Debes enviar al menos un cambio.");
  }

  return result;
}

export function parseRotateAiProviderCredential(
  value: unknown,
): RotateAiProviderCredential {
  return { apiKey: apiKey(record(value).apiKey) };
}
