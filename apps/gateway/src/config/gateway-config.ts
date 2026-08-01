import {
  loadBaseServiceConfig,
  type BaseServiceConfig,
} from "@levantamiento-rq/shared-config";

export const GATEWAY_CONFIG = Symbol("GATEWAY_CONFIG");

export interface GatewayConfig extends BaseServiceConfig {
  globalPrefix: string;
  version: string;
}

function readText(
  value: string | undefined,
  fallback: string,
  variableName: string,
): string {
  const resolved = value?.trim() || fallback.trim();

  if (!resolved) {
    throw new Error(`${variableName} no puede estar vacío.`);
  }

  return resolved;
}

function readGlobalPrefix(value: string | undefined): string {
  const resolved = readText(value, "api/v1", "API_GLOBAL_PREFIX").replace(
    /^\/+|\/+$/g,
    "",
  );

  if (
    !resolved ||
    resolved.includes("//") ||
    !/^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/.test(resolved)
  ) {
    throw new Error(`API_GLOBAL_PREFIX no es válido. Valor: ${String(value)}`);
  }

  return resolved;
}

export function loadGatewayConfig(
  environment: NodeJS.ProcessEnv = process.env,
): GatewayConfig {
  return {
    ...loadBaseServiceConfig(
      {
        serviceName: "gateway",
        defaultPort: 3000,
      },
      environment,
    ),
    globalPrefix: readGlobalPrefix(environment.API_GLOBAL_PREFIX),
    version: readText(environment.APP_VERSION, "0.0.0", "APP_VERSION"),
  };
}
