import { ConflictException } from "@nestjs/common";

import type { DocumentJsonValue } from "@levantamiento-rq/shared-contracts";

/**
 * Guarda de tipo para objetos JSON. `Array.isArray` no descarta bien las
 * uniones con arreglos de solo lectura, así que el estrechamiento se declara.
 */
export function isJsonObject(
  value: DocumentJsonValue | undefined,
): value is { readonly [key: string]: DocumentJsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toIso(value: Date): string {
  return value.toISOString();
}

export function parseJson(value: string): DocumentJsonValue {
  try {
    return JSON.parse(value) as DocumentJsonValue;
  } catch {
    // Un JSON corrupto en BD no debe filtrarse como un 500 con SyntaxError.
    throw new ConflictException(
      "El documento contiene datos almacenados con formato JSON inválido.",
    );
  }
}

const PROTOTYPE_PLACEHOLDERS = [
  "[pendiente por definir]",
  "pendiente de definición",
  "pendiente de definicion",
];
const PROTOTYPE_NOT_REQUESTED_PREFIX =
  "prototipo no solicitado en esta generación";

function collectText(value: DocumentJsonValue, out: string[]): void {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value))
    value.forEach((item) => collectText(item, out));
  else if (isJsonObject(value))
    Object.values(value).forEach((item) => collectText(item, out));
}

/** Un prototipo existe solo si hay texto real en visualFormat o en solutionProposal.prototypeMarkdown. */
export function hasPrototypeContent(content: DocumentJsonValue): boolean {
  const texts: string[] = [];
  collectText(content, texts);
  return texts.some((text) => {
    const normalized = text.trim().toLowerCase();
    return (
      normalized.length > 0 &&
      !PROTOTYPE_PLACEHOLDERS.includes(normalized) &&
      !normalized.startsWith(PROTOTYPE_NOT_REQUESTED_PREFIX)
    );
  });
}

/** Compatibilidad con versiones históricas: el prototipo quedó en solutionProposal.prototypeMarkdown. */
export function hasSolutionPrototypeMarkdown(
  content: DocumentJsonValue,
): boolean {
  return (
    isJsonObject(content) &&
    typeof content["prototypeMarkdown"] === "string" &&
    hasPrototypeContent(content["prototypeMarkdown"])
  );
}

export function serialize(value: DocumentJsonValue): string {
  return JSON.stringify(value);
}

export function documentRecord(
  value: DocumentJsonValue | undefined,
): Readonly<Record<string, DocumentJsonValue>> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Readonly<Record<string, DocumentJsonValue>>;
}

export function documentRecords(value: DocumentJsonValue | undefined) {
  return Array.isArray(value)
    ? value
        .map((item) => documentRecord(item))
        .filter(
          (item): item is Readonly<Record<string, DocumentJsonValue>> =>
            item !== null,
        )
    : [];
}
