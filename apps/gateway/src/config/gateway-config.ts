import {
  loadBaseServiceConfig,
  type BaseServiceConfig,
} from "@levantamiento-rq/shared-config";

export const GATEWAY_CONFIG = Symbol("GATEWAY_CONFIG");

export interface GatewayConfig extends BaseServiceConfig {
  globalPrefix: string;
  version: string;
  identityServiceUrl: string;
  projectsServiceUrl: string;
  sourcesServiceUrl: string;
  documentsServiceUrl: string;
  aiAnalysisServiceUrl: string;
  workflowServiceUrl: string;
  operationsServiceUrl: string;
  prototypesServiceUrl: string;
  webOrigins: readonly string[];
  identityTimeoutMs: number;
  projectsTimeoutMs: number;
  sourcesTimeoutMs: number;
  documentsTimeoutMs: number;
  aiAnalysisTimeoutMs: number;
  workflowTimeoutMs: number;
  operationsTimeoutMs: number;
  prototypesTimeoutMs: number;
  sourcesUploadTimeoutMs: number;
  sourcesMaxFileBytes: number;
  sourcesMaxFilesPerUpload: number;
  sourcesMaxBatchBytes: number;
  cookieSecure: boolean;
  authSignInRateLimit: number;
  authSignInRateWindowSeconds: number;
  rateLimitRedisHost: string;
  rateLimitRedisPort: number;
  rateLimitRedisPassword: string | null;
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

function readUrl(
  value: string | undefined,
  fallback: string,
  name: string,
): string {
  const resolved = readText(value, fallback, name);

  try {
    return new URL(resolved).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${name} debe ser una URL absoluta válida.`);
  }
}

export function parseWebOrigins(
  value: string,
  variableName = "WEB_ORIGINS",
): string[] {
  const origins = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (entry === "*" || entry.toLowerCase() === "null") {
        throw new Error(`${variableName} no admite '${entry}'.`);
      }

      let parsed: URL;
      try {
        parsed = new URL(entry);
      } catch {
        throw new Error(
          `${variableName} contiene un origen inválido: ${entry}`,
        );
      }

      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password ||
        parsed.pathname !== "/" ||
        parsed.search ||
        parsed.hash
      ) {
        throw new Error(
          `${variableName} contiene un origen inválido: ${entry}`,
        );
      }

      return parsed.origin;
    });

  const uniqueOrigins = [...new Set(origins)];
  if (uniqueOrigins.length === 0) {
    throw new Error(`${variableName} debe contener al menos un origen.`);
  }

  return uniqueOrigins;
}

function readBoolean(
  value: string | undefined,
  fallback: boolean,
  name: string,
): boolean {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) return fallback;
  if (normalized === "true") return true;
  if (normalized === "false") return false;

  throw new Error(`${name} debe ser true o false.`);
}

function readInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const resolved = value?.trim() ? Number(value) : fallback;

  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${name} debe estar entre ${minimum} y ${maximum}.`);
  }

  return resolved;
}

export function loadGatewayConfig(
  environment: NodeJS.ProcessEnv = process.env,
): GatewayConfig {
  const baseConfig = loadBaseServiceConfig(
    {
      serviceName: "gateway",
      defaultPort: 3000,
    },
    environment,
  );
  const configuredWebOrigins =
    environment.WEB_ORIGINS?.trim() || environment.WEB_ORIGIN?.trim();
  if (baseConfig.environment === "production" && !configuredWebOrigins) {
    throw new Error("WEB_ORIGINS es obligatorio en producción.");
  }
  const webOrigins = parseWebOrigins(
    configuredWebOrigins || "http://127.0.0.1:4200,http://localhost:4200",
    environment.WEB_ORIGINS?.trim() ? "WEB_ORIGINS" : "WEB_ORIGIN",
  );
  const cookieSecure = readBoolean(
    environment.AUTH_COOKIE_SECURE,
    baseConfig.environment === "production",
    "AUTH_COOKIE_SECURE",
  );
  if (baseConfig.environment === "production" && !cookieSecure) {
    throw new Error("AUTH_COOKIE_SECURE debe ser true en producción.");
  }
  if (
    baseConfig.environment === "production" &&
    webOrigins.some((origin) => !origin.startsWith("https://"))
  ) {
    throw new Error("WEB_ORIGINS solo admite HTTPS en producción.");
  }
  const sourcesMaxFileBytes = readInteger(
    environment.SOURCES_MAX_FILE_BYTES,
    20 * 1024 * 1024,
    1024,
    100 * 1024 * 1024,
    "SOURCES_MAX_FILE_BYTES",
  );
  const sourcesMaxFilesPerUpload = readInteger(
    environment.SOURCES_MAX_FILES_PER_UPLOAD,
    20,
    1,
    50,
    "SOURCES_MAX_FILES_PER_UPLOAD",
  );

  return {
    ...baseConfig,
    globalPrefix: readGlobalPrefix(environment.API_GLOBAL_PREFIX),
    version: readText(environment.APP_VERSION, "0.0.0", "APP_VERSION"),
    identityServiceUrl: readUrl(
      environment.IDENTITY_SERVICE_URL,
      "http://127.0.0.1:3001",
      "IDENTITY_SERVICE_URL",
    ),
    projectsServiceUrl: readUrl(
      environment.PROJECTS_SERVICE_URL,
      "http://127.0.0.1:3002",
      "PROJECTS_SERVICE_URL",
    ),
    sourcesServiceUrl: readUrl(
      environment.SOURCES_SERVICE_URL,
      "http://127.0.0.1:3003",
      "SOURCES_SERVICE_URL",
    ),
    documentsServiceUrl: readUrl(
      environment.DOCUMENTS_SERVICE_URL,
      "http://127.0.0.1:3004",
      "DOCUMENTS_SERVICE_URL",
    ),
    aiAnalysisServiceUrl: readUrl(
      environment.AI_ANALYSIS_SERVICE_URL,
      "http://127.0.0.1:3005",
      "AI_ANALYSIS_SERVICE_URL",
    ),
    workflowServiceUrl: readUrl(
      environment.WORKFLOW_SERVICE_URL,
      "http://127.0.0.1:3007",
      "WORKFLOW_SERVICE_URL",
    ),
    operationsServiceUrl: readUrl(
      environment.OPERATIONS_SERVICE_URL,
      "http://127.0.0.1:3008",
      "OPERATIONS_SERVICE_URL",
    ),
    prototypesServiceUrl: readUrl(
      environment.PROTOTYPES_SERVICE_URL,
      "http://127.0.0.1:3009",
      "PROTOTYPES_SERVICE_URL",
    ),
    webOrigins,
    identityTimeoutMs: readInteger(
      environment.IDENTITY_TIMEOUT_MS,
      5000,
      500,
      30000,
      "IDENTITY_TIMEOUT_MS",
    ),
    projectsTimeoutMs: readInteger(
      environment.PROJECTS_TIMEOUT_MS,
      8000,
      500,
      30000,
      "PROJECTS_TIMEOUT_MS",
    ),
    sourcesTimeoutMs: readInteger(
      environment.SOURCES_TIMEOUT_MS,
      8000,
      500,
      30000,
      "SOURCES_TIMEOUT_MS",
    ),
    documentsTimeoutMs: readInteger(
      environment.DOCUMENTS_TIMEOUT_MS,
      8000,
      500,
      30000,
      "DOCUMENTS_TIMEOUT_MS",
    ),
    aiAnalysisTimeoutMs: readInteger(
      environment.AI_ANALYSIS_TIMEOUT_MS,
      15000,
      500,
      60000,
      "AI_ANALYSIS_TIMEOUT_MS",
    ),
    workflowTimeoutMs: readInteger(
      environment.WORKFLOW_TIMEOUT_MS,
      15000,
      500,
      60000,
      "WORKFLOW_TIMEOUT_MS",
    ),
    operationsTimeoutMs: readInteger(
      environment.OPERATIONS_TIMEOUT_MS,
      120000,
      500,
      300000,
      "OPERATIONS_TIMEOUT_MS",
    ),
    prototypesTimeoutMs: readInteger(
      environment.PROTOTYPES_TIMEOUT_MS,
      600000,
      500,
      600000,
      "PROTOTYPES_TIMEOUT_MS",
    ),
    sourcesUploadTimeoutMs: readInteger(
      environment.SOURCES_UPLOAD_TIMEOUT_MS,
      300000,
      5000,
      600000,
      "SOURCES_UPLOAD_TIMEOUT_MS",
    ),
    sourcesMaxFileBytes,
    sourcesMaxFilesPerUpload,
    sourcesMaxBatchBytes: readInteger(
      environment.SOURCES_MAX_BATCH_BYTES,
      100 * 1024 * 1024,
      sourcesMaxFileBytes,
      500 * 1024 * 1024,
      "SOURCES_MAX_BATCH_BYTES",
    ),
    cookieSecure,
    authSignInRateLimit: readInteger(
      environment.AUTH_SIGN_IN_RATE_LIMIT,
      10,
      1,
      100,
      "AUTH_SIGN_IN_RATE_LIMIT",
    ),
    authSignInRateWindowSeconds: readInteger(
      environment.AUTH_SIGN_IN_RATE_WINDOW_SECONDS,
      900,
      60,
      86_400,
      "AUTH_SIGN_IN_RATE_WINDOW_SECONDS",
    ),
    rateLimitRedisHost: readText(
      environment.GATEWAY_REDIS_HOST,
      "127.0.0.1",
      "GATEWAY_REDIS_HOST",
    ),
    rateLimitRedisPort: readInteger(
      environment.GATEWAY_REDIS_PORT ?? environment.RQ_REDIS_PORT,
      6381,
      1,
      65535,
      "GATEWAY_REDIS_PORT",
    ),
    rateLimitRedisPassword:
      environment.GATEWAY_REDIS_PASSWORD?.trim() ||
      environment.REDIS_PASSWORD?.trim() ||
      null,
  };
}
