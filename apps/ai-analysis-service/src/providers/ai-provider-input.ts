import { BadRequestException } from "@nestjs/common";

import type {
  CreateAiProviderConfiguration,
  RotateAiProviderCredential,
  UpdateAiProviderConfiguration,
} from "@levantamiento-rq/shared-contracts";

export const OPENAI_BASE_URL = "https://api.openai.com/v1";

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

function baseUrl(value: unknown): string {
  const normalized =
    value === undefined
      ? OPENAI_BASE_URL
      : text(value, "baseUrl", 10, 300).replace(/\/$/, "");

  if (normalized !== OPENAI_BASE_URL) {
    throw new BadRequestException(
      "baseUrl solo puede apuntar al endpoint oficial de OpenAI.",
    );
  }

  return normalized;
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

  if (input.providerType !== "OPENAI") {
    throw new BadRequestException("providerType debe ser OPENAI.");
  }

  return {
    name: text(input.name, "name", 3, 120),
    providerType: "OPENAI",
    model: text(input.model, "model", 2, 120),
    baseUrl: baseUrl(input.baseUrl),
    timeoutMs: integer(input.timeoutMs, "timeoutMs", 1000, 300000, 60000),
    maxInputTokens: integer(
      input.maxInputTokens,
      "maxInputTokens",
      1000,
      1000000,
      120000,
    ),
    maxOutputTokens: integer(
      input.maxOutputTokens,
      "maxOutputTokens",
      100,
      128000,
      12000,
    ),
    maxAttempts: integer(input.maxAttempts, "maxAttempts", 1, 10, 3),
    apiKey: apiKey(input.apiKey),
    isEnabled: optionalBoolean(input.isEnabled, "isEnabled") ?? false,
    isDefault: optionalBoolean(input.isDefault, "isDefault") ?? false,
  };
}

export function parseUpdateAiProviderConfiguration(
  value: unknown,
): UpdateAiProviderConfiguration {
  const input = record(value);
  const result: UpdateAiProviderConfiguration = {};

  if (input.name !== undefined) result.name = text(input.name, "name", 3, 120);
  if (input.model !== undefined)
    result.model = text(input.model, "model", 2, 120);
  if (input.baseUrl !== undefined) result.baseUrl = baseUrl(input.baseUrl);
  if (input.timeoutMs !== undefined) {
    result.timeoutMs = integer(input.timeoutMs, "timeoutMs", 1000, 300000);
  }
  if (input.maxInputTokens !== undefined) {
    result.maxInputTokens = integer(
      input.maxInputTokens,
      "maxInputTokens",
      1000,
      1000000,
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
