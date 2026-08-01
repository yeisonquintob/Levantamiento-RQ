export type RuntimeEnvironment = "development" | "test" | "production";

export interface BaseServiceConfig {
  serviceName: string;
  environment: RuntimeEnvironment;
  host: string;
  port: number;
}

export interface BaseServiceConfigInput {
  serviceName: string;
  defaultPort: number;
}

const VALID_ENVIRONMENTS = new Set<RuntimeEnvironment>([
  "development",
  "test",
  "production",
]);

function readRequiredText(
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

function readEnvironment(value: string | undefined): RuntimeEnvironment {
  const resolved = (value?.trim() || "development") as RuntimeEnvironment;

  if (!VALID_ENVIRONMENTS.has(resolved)) {
    throw new Error(
      `NODE_ENV debe ser development, test o production. Valor: ${resolved}`,
    );
  }

  return resolved;
}

function readPort(value: string | undefined, fallback: number): number {
  const resolved = value?.trim() ? Number(value) : fallback;

  if (!Number.isInteger(resolved) || resolved < 1 || resolved > 65_535) {
    throw new Error(`PORT debe estar entre 1 y 65535. Valor: ${String(value)}`);
  }

  return resolved;
}

export function loadBaseServiceConfig(
  input: BaseServiceConfigInput,
  environment: NodeJS.ProcessEnv = process.env,
): BaseServiceConfig {
  return {
    serviceName: readRequiredText(
      environment.SERVICE_NAME,
      input.serviceName,
      "SERVICE_NAME",
    ),
    environment: readEnvironment(environment.NODE_ENV),
    host: readRequiredText(environment.HOST, "127.0.0.1", "HOST"),
    port: readPort(environment.PORT, input.defaultPort),
  };
}
