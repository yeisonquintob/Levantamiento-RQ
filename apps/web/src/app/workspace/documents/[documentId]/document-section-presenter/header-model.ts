import { type DocumentJsonValue } from "@levantamiento-rq/shared-contracts";
import {
  PENDING,
  type JsonRecord,
  recordValue,
  stringValue,
  cleanDocumentText,
} from "./shared";

export const HEADER_CORE_KEYS = [
  "title",
  "projectCode",
  "documentVersion",
  "createdDate",
  "requestingArea",
  "status",
] as const;

const HEADER_PEOPLE = [
  ["preparedBy", "Elaborado por"],
  ["reviewedBy", "Revisado por"],
  ["approvedBy", "Aprobado por"],
] as const;

type HeaderCoreKey = (typeof HEADER_CORE_KEYS)[number];

type HeaderPersonKey = (typeof HEADER_PEOPLE)[number][0];

type HeaderStandardKey = HeaderCoreKey | HeaderPersonKey;

export function normalizedHeaderLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/\([^)]*\)/gu, " ")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/u, "")
    .replace(/[*_]/gu, "")
    .replace(/[^a-z0-9]+/giu, " ")
    .trim()
    .toLowerCase();
}

function headerKeyFromLabel(value: string): HeaderStandardKey | null {
  const label = normalizedHeaderLabel(value);
  const aliases: Readonly<Record<string, HeaderStandardKey>> = {
    titulo: "title",
    codigo: "projectCode",
    "codigo del proyecto": "projectCode",
    "codigo del documento": "projectCode",
    version: "documentVersion",
    "version del documento": "documentVersion",
    "version documento": "documentVersion",
    fecha: "createdDate",
    "fecha de creacion": "createdDate",
    "fecha del documento": "createdDate",
    "area solicitante": "requestingArea",
    area: "requestingArea",
    solicitante: "requestingArea",
    estado: "status",
    "estado del documento": "status",
    "elaborado por": "preparedBy",
    "preparado por": "preparedBy",
    "revisado por": "reviewedBy",
    "aprobado por": "approvedBy",
  };
  return aliases[label] ?? null;
}

export function headerPersonFromText(value: string): JsonRecord {
  const text = value.trim();
  if (!text) return { name: "", position: "" };

  const labeled = text.match(
    /^(?:nombre\s*:\s*)?(.+?)\s*[,;]\s*cargo\s*:\s*(.+)$/iu,
  );
  if (labeled?.[1] && labeled[2]) {
    return { name: labeled[1].trim(), position: labeled[2].trim() };
  }

  const parenthesized = text.match(/^(.+?)\s+\(([^()]+)\)$/u);
  if (parenthesized?.[1] && parenthesized[2]) {
    return {
      name: parenthesized[1].trim(),
      position: parenthesized[2].trim(),
    };
  }

  const separated = text.match(/^(.+?)\s+(?:—|–|-|\||\/)\s+(.+)$/u);
  if (separated?.[1] && separated[2]) {
    return { name: separated[1].trim(), position: separated[2].trim() };
  }

  return { name: text, position: PENDING };
}

function emptyHeaderRecord(): JsonRecord {
  return {
    title: "",
    projectCode: "",
    documentVersion: "",
    createdDate: "",
    requestingArea: "",
    status: "",
    preparedBy: { name: "", position: "" },
    reviewedBy: { name: "", position: "" },
    approvedBy: { name: "", position: "" },
  };
}

function headerWithoutPeople(value: JsonRecord): JsonRecord {
  return Object.fromEntries(
    HEADER_CORE_KEYS.map((key) => [key, stringValue(value[key])]),
  );
}

function normalizedHeaderPerson(value: DocumentJsonValue | undefined) {
  if (typeof value === "string") return headerPersonFromText(value);
  const person = recordValue(value);
  return {
    name: stringValue(person?.name ?? person?.fullName),
    position: stringValue(person?.position ?? person?.role ?? person?.jobTitle),
  };
}

export function normalizeHeaderRecord(
  value: DocumentJsonValue,
): JsonRecord | null {
  const existing = recordValue(value);
  if (existing) {
    const normalized: JsonRecord = {
      title: stringValue(existing.title ?? existing.documentTitle),
      projectCode: stringValue(
        existing.projectCode ?? existing.documentCode ?? existing.code,
      ),
      documentVersion: stringValue(
        existing.documentVersion ?? existing.version,
      ),
      createdDate: stringValue(
        existing.createdDate ?? existing.creationDate ?? existing.date,
      ),
      requestingArea: stringValue(
        existing.requestingArea ?? existing.area ?? existing.requester,
      ),
      status: stringValue(existing.status ?? existing.documentStatus),
      preparedBy: normalizedHeaderPerson(
        existing.preparedBy ?? existing.elaboratedBy,
      ),
      reviewedBy: normalizedHeaderPerson(existing.reviewedBy),
      approvedBy: normalizedHeaderPerson(existing.approvedBy),
    };
    const hasCanonicalValue = Object.values(normalized).some((item) =>
      typeof item === "string"
        ? Boolean(item.trim())
        : Boolean(stringValue(recordValue(item)?.name).trim()),
    );
    const narrative = stringValue(
      existing.narrative ?? existing.content ?? existing.description,
    );
    return !hasCanonicalValue && narrative
      ? normalizeHeaderRecord(narrative)
      : headerWithoutPeople(normalized);
  }
  if (typeof value !== "string") return null;

  const lines = value
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean);
  const normalized = emptyHeaderRecord();
  let populatedFields = 0;

  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const rawLabel = line.slice(0, separator);
    const normalizedLabel = normalizedHeaderLabel(rawLabel);
    const fieldValue = line.slice(separator + 1).trim();
    const positionMatch =
      /^(?:cargo|carga)\s+(elaborador|revisor|aprobador)$/u.exec(
        normalizedLabel,
      );
    if (positionMatch) {
      const personKey =
        positionMatch[1] === "elaborador"
          ? "preparedBy"
          : positionMatch[1] === "revisor"
            ? "reviewedBy"
            : "approvedBy";
      const person = normalizedHeaderPerson(normalized[personKey]);
      normalized[personKey] = { ...person, position: fieldValue };
      if (fieldValue) populatedFields += 1;
      continue;
    }
    const key = headerKeyFromLabel(rawLabel);
    if (!key) continue;

    normalized[key] = HEADER_PEOPLE.some(([personKey]) => personKey === key)
      ? headerPersonFromText(fieldValue)
      : fieldValue;
    if (fieldValue) populatedFields += 1;
  }

  if (populatedFields === 0 && lines.length > 0) {
    normalized.title = cleanDocumentText(value).trim();
    populatedFields = normalized.title ? 1 : 0;
  }

  return populatedFields > 0 ? headerWithoutPeople(normalized) : null;
}
