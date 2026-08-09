import { BadRequestException } from "@nestjs/common";

export interface IntegrationEventsConfig {
  enabled: boolean;
  serviceName: string;
  url: string | null;
  exchange: string;
  publishTimeoutMs: number;
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 100 || parsed > 60_000) {
    throw new BadRequestException(`${name} debe estar entre 100 y 60000.`);
  }
  return parsed;
}

export function loadIntegrationEventsConfig(
  serviceName: string,
  environment: NodeJS.ProcessEnv = process.env,
): IntegrationEventsConfig {
  const enabled = environment.RABBITMQ_ENABLED?.toLowerCase() === "true";
  const rawUrl = environment.RABBITMQ_URL?.trim() || null;
  if (enabled && !rawUrl) {
    throw new BadRequestException(
      "RABBITMQ_URL es obligatoria cuando RABBITMQ_ENABLED=true.",
    );
  }
  if (rawUrl) {
    const url = new URL(rawUrl);
    if (url.protocol !== "amqp:" && url.protocol !== "amqps:") {
      throw new BadRequestException(
        "RABBITMQ_URL debe usar el protocolo amqp o amqps.",
      );
    }
  }
  const exchange = environment.RABBITMQ_EXCHANGE?.trim() || "rq.integration.v1";
  if (!/^[a-zA-Z0-9._-]{3,120}$/.test(exchange)) {
    throw new BadRequestException("RABBITMQ_EXCHANGE no es válido.");
  }
  return {
    enabled,
    serviceName,
    url: rawUrl,
    exchange,
    publishTimeoutMs: positiveInteger(
      environment.RABBITMQ_PUBLISH_TIMEOUT_MS,
      5000,
      "RABBITMQ_PUBLISH_TIMEOUT_MS",
    ),
  };
}
