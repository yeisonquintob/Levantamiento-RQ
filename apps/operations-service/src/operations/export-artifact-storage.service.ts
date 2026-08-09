import { Inject, Injectable } from "@nestjs/common";
import { BlobServiceClient, type ContainerClient } from "@azure/storage-blob";

import {
  OPERATIONS_STORAGE_CONFIG,
  type OperationsStorageConfig,
} from "./operations-storage.config";

export class ExportArtifactNotFoundError extends Error {
  constructor() {
    super("El artefacto exportado no existe en el almacenamiento.");
    this.name = "ExportArtifactNotFoundError";
  }
}

@Injectable()
export class ExportArtifactStorage {
  private readonly container: ContainerClient;

  constructor(
    @Inject(OPERATIONS_STORAGE_CONFIG)
    private readonly config: OperationsStorageConfig,
  ) {
    this.container = BlobServiceClient.fromConnectionString(
      config.connectionString,
    ).getContainerClient(config.containerName);
  }

  get containerName(): string {
    return this.config.containerName;
  }

  async ensureContainer(): Promise<void> {
    await this.container.createIfNotExists();
    const properties = await this.container.getProperties();
    if (properties.blobPublicAccess) {
      throw new Error(
        "El contenedor de exportaciones no puede tener acceso público.",
      );
    }
  }

  async upload(
    blobPath: string,
    buffer: Buffer,
    mediaType: string,
    fileName: string,
    sha256: string,
  ): Promise<void> {
    await this.ensureContainer();
    const blob = this.container.getBlockBlobClient(blobPath);
    await blob.upload(buffer, buffer.length, {
      blobHTTPHeaders: {
        blobContentType: mediaType,
        blobContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
      metadata: {
        filename: Buffer.from(fileName, "utf8").toString("base64url"),
        sha256,
      },
    });
  }

  async download(blobPath: string): Promise<Buffer> {
    const blob = this.container.getBlobClient(blobPath);
    if (!(await blob.exists())) throw new ExportArtifactNotFoundError();
    return blob.downloadToBuffer();
  }

  exists(blobPath: string): Promise<boolean> {
    return this.container.getBlobClient(blobPath).exists();
  }

  async deleteIfExists(blobPath: string): Promise<void> {
    await this.container.getBlobClient(blobPath).deleteIfExists();
  }
}
