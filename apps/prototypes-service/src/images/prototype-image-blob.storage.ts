import { Inject, Injectable } from "@nestjs/common";
import {
  BlobSASPermissions,
  BlobServiceClient,
  ContainerSASPermissions,
  type ContainerClient,
} from "@azure/storage-blob";
import {
  PROTOTYPE_IMAGE_CONFIG,
  type PrototypeImageConfig,
} from "./prototype-image.config";

export class PrototypeImageBlobNotFoundError extends Error {}
@Injectable()
export class PrototypeImageBlobStorage {
  private readonly container: ContainerClient;
  private readonly maxImageBytes: number;
  constructor(@Inject(PROTOTYPE_IMAGE_CONFIG) config: PrototypeImageConfig) {
    this.container = BlobServiceClient.fromConnectionString(
      config.storageConnectionString,
    ).getContainerClient(config.storageContainer);
    this.maxImageBytes = config.maxImageBytes;
  }
  async upload(storageKey: string, image: Buffer): Promise<void> {
    await this.container.createIfNotExists();
    const properties = await this.container.getProperties();
    if (properties.blobPublicAccess)
      throw new Error("El contenedor de prototipos no puede ser público.");
    const blob = this.container.getBlockBlobClient(storageKey);

    /*
     * PUT directo con SAS:
     *
     * @azure/storage-blob 12.33.0 está enviando la carga de estos PNG locales
     * con Content-Length: 0 y Content-Type: application/xml, por lo que
     * Azurite rechaza el request antes de persistir el blob.
     *
     * El SAS permanece dentro del servicio. fetch recibe el Buffer PNG real y
     * x-ms-blob-type=BlockBlob, evitando el cuerpo estructurado del SDK.
     */
    const uploadUrl = await blob.generateSasUrl({
      permissions: BlobSASPermissions.parse("cw"),
      expiresOn: new Date(Date.now() + 5 * 60_000),
    });

    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "content-type": "image/png",
        "x-ms-blob-type": "BlockBlob",
      },
      body: image,
    });

    if (!uploadResponse.ok) {
      throw new Error(
        `No fue posible almacenar la imagen generada (HTTP ${uploadResponse.status}).`,
      );
    }

    /*
     * Verificación real por HTTP. No usamos blob.exists() porque en el
     * diagnóstico local devolvió un resultado inconsistente frente al HEAD
     * recibido por Azurite.
     */
    const verifyUrl = await blob.generateSasUrl({
      permissions: BlobSASPermissions.parse("r"),
      expiresOn: new Date(Date.now() + 5 * 60_000),
    });

    // El fetch global de Node no tiene caché HTTP: no hace falta `cache`, que
    // además no existe en el tipo RequestInit de Node.
    const verifyResponse = await fetch(verifyUrl, { method: "HEAD" });

    if (!verifyResponse.ok) {
      throw new Error(
        `La imagen fue enviada pero no quedó disponible en almacenamiento (HTTP ${verifyResponse.status}).`,
      );
    }
  }
  async download(storageKey: string): Promise<Buffer> {
    const blob = this.container.getBlobClient(storageKey);
    try {
      /*
       * Azurite puede responder sin un Content-Length utilizable para las
       * descargas del SDK de @azure/storage-blob 12.33.0. Tanto
       * downloadToBuffer() como download(0) pasan por esa validación interna.
       *
       * Generamos un SAS de lectura de vida corta y dejamos que fetch lea el
       * cuerpo HTTP directamente. El SAS nunca sale del servicio.
       */
      if (!(await blob.exists())) throw new PrototypeImageBlobNotFoundError();

      const url = await blob.generateSasUrl({
        permissions: BlobSASPermissions.parse("r"),
        expiresOn: new Date(Date.now() + 5 * 60_000),
      });

      const response = await fetch(url);
      if (response.status === 404) throw new PrototypeImageBlobNotFoundError();
      if (!response.ok) {
        throw new Error(
          `No fue posible descargar la imagen almacenada (HTTP ${response.status}).`,
        );
      }

      const content = Buffer.from(await response.arrayBuffer());
      if (!content.length) throw new PrototypeImageBlobNotFoundError();
      if (content.length > this.maxImageBytes) {
        throw new Error(
          `La imagen almacenada supera el máximo permitido de ${this.maxImageBytes} bytes.`,
        );
      }

      return content;
    } catch (error) {
      if (
        error instanceof PrototypeImageBlobNotFoundError ||
        this.isBlobNotFound(error)
      ) {
        throw new PrototypeImageBlobNotFoundError();
      }
      throw error;
    }
  }
  private isBlobNotFound(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const value = error as {
      statusCode?: number;
      code?: string;
      details?: { errorCode?: string };
    };
    return (
      value.statusCode === 404 ||
      value.code === "BlobNotFound" ||
      value.details?.errorCode === "BlobNotFound"
    );
  }
  /**
   * Archivos del contenedor con su fecha de modificación (para reconciliar contra SQL).
   *
   * Igual que upload/download, el listado va por REST con un SAS de vida corta: el listado del SDK
   * (`listBlobsFlat`) falla contra Azurite al leer la respuesta (`blobItems` indefinido).
   */
  async *list(): AsyncGenerator<{ name: string; lastModified: Date }> {
    const sas = await this.container.generateSasUrl({
      permissions: ContainerSASPermissions.parse("l"),
      expiresOn: new Date(Date.now() + 5 * 60_000),
    });
    let marker = "";
    do {
      const url = new URL(sas);
      url.searchParams.set("restype", "container");
      url.searchParams.set("comp", "list");
      url.searchParams.set("maxresults", "1000");
      if (marker) url.searchParams.set("marker", marker);
      const response = await fetch(url);
      // Contenedor aún inexistente: no hay nada que reconciliar.
      if (response.status === 404) return;
      if (!response.ok)
        throw new Error(
          `No fue posible listar el almacenamiento de prototipos (HTTP ${response.status}).`,
        );
      const xml = await response.text();
      for (const blob of xml.matchAll(/<Blob>([\s\S]*?)<\/Blob>/gu)) {
        const name = /<Name>([\s\S]*?)<\/Name>/u.exec(blob[1] ?? "")?.[1];
        const modified = /<Last-Modified>([\s\S]*?)<\/Last-Modified>/u.exec(
          blob[1] ?? "",
        )?.[1];
        if (name && modified)
          yield { name: decodeXml(name), lastModified: new Date(modified) };
      }
      marker = /<NextMarker>([\s\S]*?)<\/NextMarker>/u.exec(xml)?.[1] ?? "";
    } while (marker);
  }
  async delete(storageKey: string): Promise<void> {
    await this.container.getBlobClient(storageKey).deleteIfExists();
  }
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&");
}
