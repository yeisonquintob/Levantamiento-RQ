import { extname } from "node:path";
import { TextDecoder } from "node:util";

import { BadRequestException } from "@nestjs/common";

import {
  SOURCE_FILE_EXTENSIONS,
  type SourceFileExtension,
} from "@levantamiento-rq/shared-contracts";

const MEDIA_TYPES: Readonly<Record<SourceFileExtension, string>> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain; charset=utf-8",
  vtt: "text/vtt; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const OOXML_LIMITS = {
  maxEntries: 2_000,
  maxUncompressedBytes: 100 * 1024 * 1024,
  maxCompressionRatio: 100,
  maxPathDepth: 12,
} as const;

export interface ValidatedSourceFile {
  originalFileName: string;
  extension: SourceFileExtension;
  mediaType: string;
  buffer: Buffer;
}

function normalizeFileName(value: string): string {
  const withoutControlCharacters = Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0);

      return codePoint !== undefined && codePoint > 0x1f && codePoint !== 0x7f;
    })
    .join("");

  const resolved = withoutControlCharacters.replace(/[\\/]/g, "-").trim();

  if (!resolved || resolved.length > 260) {
    throw new BadRequestException(
      "El nombre del archivo debe tener entre 1 y 260 caracteres.",
    );
  }

  return resolved;
}

function extensionOf(fileName: string): SourceFileExtension {
  const extension = extname(fileName).slice(1).toLowerCase();

  if (!SOURCE_FILE_EXTENSIONS.includes(extension as SourceFileExtension)) {
    throw new BadRequestException(
      `El formato .${extension || "(sin extensión)"} no está permitido.`,
    );
  }

  return extension as SourceFileExtension;
}

function startsWith(buffer: Buffer, signature: readonly number[]): boolean {
  return signature.every((value, index) => buffer[index] === value);
}

function isZip(buffer: Buffer): boolean {
  return (
    startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(buffer, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(buffer, [0x50, 0x4b, 0x07, 0x08])
  );
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new BadRequestException("El contenedor OOXML no tiene un directorio ZIP válido.");
}

export function assertSafeOoxml(
  extension: "docx" | "xlsx",
  buffer: Buffer,
): void {
  const eocd = findEndOfCentralDirectory(buffer);
  const entries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (entries < 1 || entries > OOXML_LIMITS.maxEntries) {
    throw new BadRequestException("El OOXML contiene una cantidad sospechosa de archivos internos.");
  }
  if (centralOffset + centralSize > eocd || centralOffset < 0) {
    throw new BadRequestException("El directorio ZIP del OOXML es inconsistente.");
  }

  let offset = centralOffset;
  let totalCompressed = 0;
  let totalUncompressed = 0;
  let hasContentTypes = false;
  let hasApplicationRoot = false;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > eocd || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new BadRequestException("El directorio ZIP del OOXML está dañado.");
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const uncompressed = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > eocd || compressed === 0xffffffff || uncompressed === 0xffffffff) {
      throw new BadRequestException("El OOXML usa una estructura ZIP no permitida.");
    }
    if ((flags & 0x1) !== 0 || (method !== 0 && method !== 8)) {
      throw new BadRequestException("El OOXML está cifrado o usa una compresión no permitida.");
    }
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (
      !name ||
      name.includes("\\") ||
      name.startsWith("/") ||
      /^[a-zA-Z]:/.test(name) ||
      name.split("/").includes("..") ||
      name.split("/").filter(Boolean).length > OOXML_LIMITS.maxPathDepth
    ) {
      throw new BadRequestException("El OOXML contiene una ruta interna no segura.");
    }
    hasContentTypes ||= name === "[Content_Types].xml";
    hasApplicationRoot ||= name.startsWith(extension === "docx" ? "word/" : "xl/");
    totalCompressed += compressed;
    totalUncompressed += uncompressed;
    if (totalUncompressed > OOXML_LIMITS.maxUncompressedBytes) {
      throw new BadRequestException("El OOXML supera el tamaño expandido permitido.");
    }
    offset = next;
  }
  const ratio = totalUncompressed / Math.max(1, totalCompressed);
  if (ratio > OOXML_LIMITS.maxCompressionRatio) {
    throw new BadRequestException("El OOXML presenta un ratio de compresión sospechoso.");
  }
  if (!hasContentTypes || !hasApplicationRoot) {
    throw new BadRequestException(`El archivo no contiene la estructura interna de un ${extension.toUpperCase()} válido.`);
  }
}

function isWebp(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

function assertUtf8Text(buffer: Buffer, fileName: string): void {
  if (buffer.includes(0)) {
    throw new BadRequestException(
      `${fileName} contiene datos binarios y no corresponde a texto.`,
    );
  }

  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new BadRequestException(
      `${fileName} no contiene texto UTF-8 válido.`,
    );
  }
}

function assertWebVtt(buffer: Buffer, fileName: string): void {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");

  if (!/^WEBVTT(?:[ \t].*)?(?:\r?\n|$)/.test(text)) {
    throw new BadRequestException(
      `${fileName} no contiene una cabecera WEBVTT válida.`,
    );
  }
}

function assertSignature(
  extension: SourceFileExtension,
  buffer: Buffer,
  fileName: string,
): void {
  const valid =
    extension === "pdf"
      ? buffer.subarray(0, 5).toString("ascii") === "%PDF-"
      : extension === "docx" || extension === "xlsx"
        ? isZip(buffer)
        : extension === "png"
          ? startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
          : extension === "jpg" || extension === "jpeg"
            ? startsWith(buffer, [0xff, 0xd8, 0xff])
            : extension === "webp"
              ? isWebp(buffer)
              : true;

  if (!valid) {
    throw new BadRequestException(
      `${fileName} no coincide con la firma del formato .${extension}.`,
    );
  }

  if (extension === "txt" || extension === "csv" || extension === "vtt") {
    assertUtf8Text(buffer, fileName);
  }

  if (extension === "vtt") {
    assertWebVtt(buffer, fileName);
  }

  if (extension === "docx" || extension === "xlsx") {
    assertSafeOoxml(extension, buffer);
  }
}

export function validateSourceFile(
  fileName: string,
  buffer: Buffer,
  maxFileBytes: number,
): ValidatedSourceFile {
  const originalFileName = normalizeFileName(fileName);

  if (buffer.length === 0) {
    throw new BadRequestException(`${originalFileName} está vacío.`);
  }

  if (buffer.length > maxFileBytes) {
    throw new BadRequestException(
      `${originalFileName} supera el tamaño máximo permitido.`,
    );
  }

  const extension = extensionOf(originalFileName);
  assertSignature(extension, buffer, originalFileName);

  return {
    originalFileName,
    extension,
    mediaType: MEDIA_TYPES[extension],
    buffer,
  };
}

export function titleFromFileName(fileName: string): string {
  const extension = extname(fileName);
  const title = fileName.slice(
    0,
    Math.max(0, fileName.length - extension.length),
  );

  return title.trim().slice(0, 240) || fileName.slice(0, 240);
}
