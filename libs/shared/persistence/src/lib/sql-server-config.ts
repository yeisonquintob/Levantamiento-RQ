export interface SqlServerDatabaseConfigInput {
  serviceName: string;
  defaultDatabaseName: string;
}

export interface DisabledSqlServerDatabaseConfig {
  enabled: false;
  serviceName: string;
  databaseName: string;
}

export interface EnabledSqlServerDatabaseConfig {
  enabled: true;
  serviceName: string;
  databaseName: string;
  host: string;
  port: number;
  username: string;
  password: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
  poolMin: number;
  poolMax: number;
  connectionTimeoutMs: number;
  requestTimeoutMs: number;
  logging: boolean;
}

export type SqlServerDatabaseConfig =
  DisabledSqlServerDatabaseConfig | EnabledSqlServerDatabaseConfig;

function readBoolean(
  value: string | undefined,
  fallback: boolean,
  variableName: string,
): boolean {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return fallback;
  }

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  throw new Error(
    `${variableName} debe ser true o false. Valor: ${String(value)}`,
  );
}

function readInteger(
  value: string | undefined,
  fallback: number,
  variableName: string,
  minimum: number,
  maximum: number,
): number {
  const resolved = value?.trim() ? Number(value) : fallback;

  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(
      `${variableName} debe estar entre ${minimum} y ${maximum}. ` +
        `Valor: ${String(value)}`,
    );
  }

  return resolved;
}

function readRequiredText(
  value: string | undefined,
  variableName: string,
): string {
  const resolved = value?.trim();

  if (!resolved) {
    throw new Error(
      `${variableName} es obligatorio cuando DATABASE_ENABLED=true.`,
    );
  }

  return resolved;
}

export function loadSqlServerDatabaseConfig(
  input: SqlServerDatabaseConfigInput,
  environment: NodeJS.ProcessEnv = process.env,
): SqlServerDatabaseConfig {
  const enabled = readBoolean(
    environment.DATABASE_ENABLED,
    false,
    "DATABASE_ENABLED",
  );

  const databaseName =
    environment.DB_NAME?.trim() || input.defaultDatabaseName.trim();

  if (!databaseName) {
    throw new Error("DB_NAME no puede estar vacío.");
  }

  if (!enabled) {
    return {
      enabled: false,
      serviceName: input.serviceName,
      databaseName,
    };
  }

  const poolMin = readInteger(
    environment.DB_POOL_MIN,
    0,
    "DB_POOL_MIN",
    0,
    100,
  );
  const poolMax = readInteger(
    environment.DB_POOL_MAX,
    10,
    "DB_POOL_MAX",
    1,
    100,
  );

  if (poolMin > poolMax) {
    throw new Error(
      `DB_POOL_MIN (${poolMin}) no puede ser mayor que ` +
        `DB_POOL_MAX (${poolMax}).`,
    );
  }

  return {
    enabled: true,
    serviceName: input.serviceName,
    databaseName,
    host: readRequiredText(environment.DB_HOST, "DB_HOST"),
    port: readInteger(environment.DB_PORT, 1433, "DB_PORT", 1, 65_535),
    username: readRequiredText(environment.DB_USERNAME, "DB_USERNAME"),
    password: readRequiredText(environment.DB_PASSWORD, "DB_PASSWORD"),
    encrypt: readBoolean(environment.DB_ENCRYPT, true, "DB_ENCRYPT"),
    trustServerCertificate: readBoolean(
      environment.DB_TRUST_SERVER_CERTIFICATE,
      false,
      "DB_TRUST_SERVER_CERTIFICATE",
    ),
    poolMin,
    poolMax,
    connectionTimeoutMs: readInteger(
      environment.DB_CONNECTION_TIMEOUT_MS,
      15_000,
      "DB_CONNECTION_TIMEOUT_MS",
      1_000,
      300_000,
    ),
    requestTimeoutMs: readInteger(
      environment.DB_REQUEST_TIMEOUT_MS,
      30_000,
      "DB_REQUEST_TIMEOUT_MS",
      1_000,
      600_000,
    ),
    logging: readBoolean(environment.DB_LOGGING, false, "DB_LOGGING"),
  };
}
