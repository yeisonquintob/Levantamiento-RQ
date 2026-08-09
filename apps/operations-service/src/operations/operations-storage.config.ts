export const OPERATIONS_STORAGE_CONFIG = Symbol("OPERATIONS_STORAGE_CONFIG");

export interface OperationsStorageConfig {
  connectionString: string;
  containerName: string;
}

function requiredText(value: string | undefined, name: string): string {
  const resolved = value?.trim();
  if (!resolved) throw new Error(`${name} es obligatoria.`);
  return resolved;
}

function containerName(value: string | undefined): string {
  const resolved = value?.trim() || "rq-exports";
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(resolved)) {
    throw new Error(
      "OPERATIONS_STORAGE_CONTAINER debe ser un nombre válido de contenedor Blob.",
    );
  }
  return resolved;
}

export function loadOperationsStorageConfig(
  environment: NodeJS.ProcessEnv = process.env,
): OperationsStorageConfig {
  return {
    connectionString: requiredText(
      environment.AZURE_STORAGE_CONNECTION_STRING ??
        environment.AZURE_STORAGE_CONNECTION_STRING_HOST,
      "AZURE_STORAGE_CONNECTION_STRING",
    ),
    containerName: containerName(environment.OPERATIONS_STORAGE_CONTAINER),
  };
}
