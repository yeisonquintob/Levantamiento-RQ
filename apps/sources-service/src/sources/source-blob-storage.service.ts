import { Inject, Injectable } from "@nestjs/common";
import {
  BlobServiceClient,
  type BlobGetPropertiesResponse,
  type ContainerClient,
} from "@azure/storage-blob";

import {
  SOURCES_STORAGE_CONFIG,
  type SourcesStorageConfig,
} from "./sources-storage.config";

function metadataValue(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

@Injectable()
export class SourceBlobStorage {
  private readonly container: ContainerClient;

  constructor(
    @Inject(SOURCES_STORAGE_CONFIG)
    private readonly config: SourcesStorageConfig,
  ) {
    const service = BlobServiceClient.fromConnectionString(
      config.connectionString,
    );

    this.container = service.getContainerClient(config.containerName);
  }

  get containerName(): string {
    return this.config.containerName;
  }

  async ensureContainer(): Promise<void> {
    await this.container.createIfNotExists();

    const properties = await this.container.getProperties();

    if (properties.blobPublicAccess) {
      throw new Error(
        "El contenedor de fuentes no puede tener acceso público.",
      );
    }
  }

  async upload(
    blobPath: string,
    buffer: Buffer,
    mediaType: string,
    originalFileName: string,
    sha256: string,
  ): Promise<void> {
    await this.ensureContainer();

    const client = this.container.getBlockBlobClient(blobPath);

    await client.upload(buffer, buffer.length, {
      blobHTTPHeaders: {
        blobContentType: mediaType,
      },
      metadata: {
        originalfilename: metadataValue(originalFileName),
        sha256,
      },
    });
  }

  async download(blobPath: string): Promise<Buffer> {
    const client = this.container.getBlobClient(blobPath);

    if (!(await client.exists())) {
      throw new Error("El archivo almacenado no existe.");
    }

    return client.downloadToBuffer();
  }

  exists(blobPath: string): Promise<boolean> {
    return this.container.getBlobClient(blobPath).exists();
  }

  getProperties(blobPath: string): Promise<BlobGetPropertiesResponse> {
    return this.container.getBlobClient(blobPath).getProperties();
  }

  async deleteIfExists(blobPath: string): Promise<void> {
    const client = this.container.getBlobClient(blobPath);
    await client.deleteIfExists();
  }

  async verify(): Promise<void> {
    await this.ensureContainer();

    const probe = `_health/${Date.now()}-${process.pid}.txt`;
    const client = this.container.getBlockBlobClient(probe);

    const content = Buffer.from("ok", "utf8");

    await client.upload(content, content.length, {
      blobHTTPHeaders: {
        blobContentType: "text/plain; charset=utf-8",
      },
    });

    const downloaded = await client.downloadToBuffer();

    if (downloaded.toString("utf8") !== "ok") {
      throw new Error("Azurite no devolvió el contenido esperado.");
    }

    await client.deleteIfExists();
  }
}
