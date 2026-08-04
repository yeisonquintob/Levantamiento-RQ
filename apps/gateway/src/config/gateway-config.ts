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
  webOrigin: string;
  identityTimeoutMs: number;
  projectsTimeoutMs: number;
  sourcesTimeoutMs: number;
  documentsTimeoutMs: number;
  sourcesUploadTimeoutMs: number;
  sourcesMaxFileBytes: number;
  sourcesMaxFilesPerUpload: number;
  sourcesMaxBatchBytes: number;
  cookieSecure: boolean;
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
    ...loadBaseServiceConfig(
      {
        serviceName: "gateway",
        defaultPort: 3000,
      },
      environment,
    ),
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
    webOrigin: readUrl(
      environment.WEB_ORIGIN,
      "http://127.0.0.1:4200",
      "WEB_ORIGIN",
    ),
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
    cookieSecure: readBoolean(
      environment.AUTH_COOKIE_SECURE,
      false,
      "AUTH_COOKIE_SECURE",
    ),
  };
}
