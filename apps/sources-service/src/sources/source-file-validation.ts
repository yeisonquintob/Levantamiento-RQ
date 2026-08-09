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
  csv: "text/csv; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

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

  if (extension === "txt" || extension === "csv") {
    assertUtf8Text(buffer, fileName);
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
