export const SOURCES_STORAGE_CONFIG = Symbol("SOURCES_STORAGE_CONFIG");

export interface SourcesStorageConfig {
  connectionString: string;
  containerName: string;
  maxFileBytes: number;
  maxFilesPerUpload: number;
  maxBatchBytes: number;
  maxExtractedTextChars: number;
}

function requiredText(value: string | undefined, name: string): string {
  const resolved = value?.trim();

  if (!resolved) {
    throw new Error(`${name} es obligatorio.`);
  }

  return resolved;
}

function readPositiveInteger(
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

function readContainerName(value: string | undefined): string {
  const resolved = value?.trim() || "rq-sources";

  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(resolved)) {
    throw new Error(
      "SOURCES_STORAGE_CONTAINER debe ser un nombre válido de contenedor Blob.",
    );
  }

  return resolved;
}

export function loadSourcesStorageConfig(
  environment: NodeJS.ProcessEnv = process.env,
): SourcesStorageConfig {
  const maxFileBytes = readPositiveInteger(
    environment.SOURCES_MAX_FILE_BYTES,
    20 * 1024 * 1024,
    1024,
    100 * 1024 * 1024,
    "SOURCES_MAX_FILE_BYTES",
  );
  const maxFilesPerUpload = readPositiveInteger(
    environment.SOURCES_MAX_FILES_PER_UPLOAD,
    20,
    1,
    50,
    "SOURCES_MAX_FILES_PER_UPLOAD",
  );
  const maxBatchBytes = readPositiveInteger(
    environment.SOURCES_MAX_BATCH_BYTES,
    100 * 1024 * 1024,
    maxFileBytes,
    500 * 1024 * 1024,
    "SOURCES_MAX_BATCH_BYTES",
  );

  return {
    connectionString: requiredText(
      environment.AZURE_STORAGE_CONNECTION_STRING ??
        environment.AZURE_STORAGE_CONNECTION_STRING_HOST,
      "AZURE_STORAGE_CONNECTION_STRING",
    ),
    containerName: readContainerName(environment.SOURCES_STORAGE_CONTAINER),
    maxFileBytes,
    maxFilesPerUpload,
    maxBatchBytes,
    maxExtractedTextChars: readPositiveInteger(
      environment.SOURCES_MAX_EXTRACTED_TEXT_CHARS,
      2_000_000,
      10_000,
      10_000_000,
      "SOURCES_MAX_EXTRACTED_TEXT_CHARS",
    ),
  };
}
