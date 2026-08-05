import { createHash, randomUUID } from "node:crypto";

import { BlobServiceClient } from "@azure/storage-blob";

import {
  loadEnvironmentFiles,
} from "../libs/shared/config/src/index.js";

loadEnvironmentFiles({
  paths: [
    ".env",
    "infrastructure/docker/.env",
    "apps/sources-service/.env",
  ],
});

function requiredText(
  value: string | undefined,
  name: string,
): string {
  const resolved = value?.trim();

  if (!resolved) {
    throw new Error(`${name} no está configurado.`);
  }

  return resolved;
}

async function main(): Promise<void> {
  const connectionString = requiredText(
    process.env.AZURE_STORAGE_CONNECTION_STRING ??
      process.env.AZURE_STORAGE_CONNECTION_STRING_HOST,
    "AZURE_STORAGE_CONNECTION_STRING",
  );
  const containerName =
    process.env.SOURCES_STORAGE_CONTAINER?.trim() || "rq-sources";

  const service = BlobServiceClient.fromConnectionString(
    connectionString,
  );
  const container = service.getContainerClient(containerName);

  await container.createIfNotExists();

  const properties = await container.getProperties();

  if (properties.blobPublicAccess) {
    throw new Error(
      "El contenedor de fuentes tiene acceso público habilitado.",
    );
  }

  const blobPath = `_verification/${randomUUID()}.txt`;
  const content = Buffer.from(
    "Levantamiento RQ - verificación de Azurite",
    "utf8",
  );
  const blob = container.getBlockBlobClient(blobPath);

  try {
    await blob.uploadData(content, {
      blobHTTPHeaders: {
        blobContentType: "text/plain; charset=utf-8",
      },
    });

    const blobProperties = await blob.getProperties();

    if (blobProperties.contentLength !== content.length) {
      throw new Error("Content-Length no coincide con el Buffer cargado.");
    }

    const downloaded = await blob.downloadToBuffer();

    const expectedSha256 = createHash("sha256").update(content).digest("hex");
    const actualSha256 = createHash("sha256")
      .update(downloaded)
      .digest("hex");

    if (!downloaded.equals(content) || actualSha256 !== expectedSha256) {
      throw new Error(
        "El archivo descargado no coincide con el archivo cargado.",
      );
    }
  } finally {
    await blob.deleteIfExists();
  }

  console.log("Azurite Blob verificado correctamente.");
  console.log(`Contenedor privado confirmado: ${containerName}`);
  console.log("Carga, tamaño, SHA-256, descarga y eliminación correctos.");
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`No se pudo verificar Azurite: ${message}`);
  process.exitCode = 1;
});
