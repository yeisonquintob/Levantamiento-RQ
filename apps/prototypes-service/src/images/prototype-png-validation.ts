export class PrototypeImageValidationError extends Error {
  constructor(public readonly code: string) {
    super("La respuesta del proveedor no contiene un PNG válido.");
    this.name = "PrototypeImageValidationError";
  }
}
export interface ValidatedPrototypePng {
  buffer: Buffer;
  width: number;
  height: number;
}
export function validatePrototypePng(
  imageBase64: string,
  mediaType: string,
  maxBytes: number,
): ValidatedPrototypePng {
  if (mediaType !== "image/png")
    throw new PrototypeImageValidationError(
      "PROTOTYPE_IMAGE_MEDIA_TYPE_INVALID",
    );
  const compact = imageBase64.replace(/\s/g, "");
  if (
    !compact ||
    compact.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)
  )
    throw new PrototypeImageValidationError("PROTOTYPE_IMAGE_BASE64_INVALID");
  const buffer = Buffer.from(compact, "base64");
  if (!buffer.length || buffer.length > maxBytes)
    throw new PrototypeImageValidationError(
      buffer.length ? "PROTOTYPE_IMAGE_TOO_LARGE" : "PROTOTYPE_IMAGE_EMPTY",
    );
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (
    buffer.length < 33 ||
    !buffer.subarray(0, 8).equals(signature) ||
    buffer.readUInt32BE(8) !== 13 ||
    buffer.toString("ascii", 12, 16) !== "IHDR"
  )
    throw new PrototypeImageValidationError("PROTOTYPE_IMAGE_PNG_INVALID");
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 3840 || height > 3840)
    throw new PrototypeImageValidationError(
      "PROTOTYPE_IMAGE_DIMENSIONS_INVALID",
    );
  let offset = 8;
  let ended = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const next = offset + 12 + length;
    if (next > buffer.length)
      throw new PrototypeImageValidationError("PROTOTYPE_IMAGE_PNG_INVALID");
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    offset = next;
    if (type === "IEND") {
      ended = length === 0 && offset === buffer.length;
      break;
    }
  }
  if (!ended)
    throw new PrototypeImageValidationError("PROTOTYPE_IMAGE_PNG_INVALID");
  return { buffer, width, height };
}
