import { BadRequestException } from "@nestjs/common";

import {
  DOCUMENT_TEMPLATE_STATUSES,
  DOCUMENT_TEMPLATE_TYPES,
  type CloneDocumentTemplateRequest,
  type CreateDocumentTemplateRequest,
  type DocumentTemplateSection,
  type DocumentTemplateStatus,
  type DocumentTemplateType,
  type UpdateDocumentTemplateRequest,
} from "@levantamiento-rq/shared-contracts";

export interface DocumentTemplateListQuery {
  search: string;
  status: DocumentTemplateStatus | null;
  templateType: DocumentTemplateType | null;
  page: number;
  pageSize: number;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEMVER_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const CODE_PATTERN = /^[A-Z][A-Z0-9-]{2,39}$/;
const SECTION_KEY_PATTERN = /^[a-z][a-zA-Z0-9]{2,63}$/;
const MAX_TEMPLATE_SECTIONS = 50;

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("El cuerpo de la solicitud no es válido.");
  }

  return value as Readonly<Record<string, unknown>>;
}

function requiredText(
  record: Readonly<Record<string, unknown>>,
  field: string,
  minimum: number,
  maximum: number,
): string {
  const value = record[field];

  if (
    typeof value !== "string" ||
    value.trim().length < minimum ||
    value.trim().length > maximum
  ) {
    throw new BadRequestException(
      `${field} debe tener entre ${minimum} y ${maximum} caracteres.`,
    );
  }

  return value.trim();
}

function optionalText(
  record: Readonly<Record<string, unknown>>,
  field: string,
  maximum: number,
): string | null | undefined {
  const value = record[field];

  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string" || value.trim().length > maximum) {
    throw new BadRequestException(
      `${field} debe tener máximo ${maximum} caracteres.`,
    );
  }

  return value.trim() || null;
}

function requiredBoolean(
  record: Readonly<Record<string, unknown>>,
  field: string,
): boolean {
  const value = record[field];

  if (typeof value !== "boolean") {
    throw new BadRequestException(`${field} debe ser booleano.`);
  }

  return value;
}

function optionalBoolean(
  record: Readonly<Record<string, unknown>>,
  field: string,
): boolean | undefined {
  const value = record[field];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new BadRequestException(`${field} debe ser booleano.`);
  }

  return value;
}

function optionalSections(
  value: unknown,
): readonly DocumentTemplateSection[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAX_TEMPLATE_SECTIONS
  ) {
    throw new BadRequestException(
      `sections debe contener entre 1 y ${MAX_TEMPLATE_SECTIONS} puntos.`,
    );
  }

  const keys = new Set<string>();

  return value.map((item, index) => {
    const record = asRecord(item);
    const key = requiredText(record, "key", 3, 64);

    if (!SECTION_KEY_PATTERN.test(key)) {
      throw new BadRequestException(
        "Cada key de sección debe iniciar con letra minúscula y usar solo letras o números.",
      );
    }

    if (keys.has(key)) {
      throw new BadRequestException(
        `La key de sección ${key} está repetida.`,
      );
    }

    keys.add(key);

    return {
      key,
      order: index + 1,
      title: requiredText(record, "title", 1, 200),
      required: requiredBoolean(record, "required"),
      guidance: requiredText(record, "guidance", 1, 2000),
    };
  });
}

function templateType(value: unknown): DocumentTemplateType {
  if (
    typeof value !== "string" ||
    !DOCUMENT_TEMPLATE_TYPES.includes(value as DocumentTemplateType)
  ) {
    throw new BadRequestException("El tipo de plantilla no es válido.");
  }

  return value as DocumentTemplateType;
}

function optionalTemplateType(
  value: unknown,
): DocumentTemplateType | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return templateType(value);
}

function optionalStatus(
  value: unknown,
): DocumentTemplateStatus | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (
    typeof value !== "string" ||
    !DOCUMENT_TEMPLATE_STATUSES.includes(
      value as DocumentTemplateStatus,
    )
  ) {
    throw new BadRequestException("El estado de plantilla no es válido.");
  }

  return value as DocumentTemplateStatus;
}

function normalizedCode(value: unknown): string {
  if (typeof value !== "string") {
    throw new BadRequestException("code debe ser texto.");
  }

  const resolved = value.trim().toUpperCase();

  if (!CODE_PATTERN.test(resolved)) {
    throw new BadRequestException(
      "code debe tener entre 3 y 40 caracteres, iniciar con letra y usar solo letras, números o guiones.",
    );
  }

  return resolved;
}

function semanticVersion(value: unknown): string {
  if (
    typeof value !== "string" ||
    !SEMVER_PATTERN.test(value.trim())
  ) {
    throw new BadRequestException(
      "version debe usar SemVer sin sufijos, por ejemplo 1.0.0.",
    );
  }

  return value.trim();
}

function requiredUuid(value: string, field: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new BadRequestException(`${field} debe ser un UUID válido.`);
  }

  return value.toLowerCase();
}

function readInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  field: string,
): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const resolved = Number(value);

  if (
    !Number.isInteger(resolved) ||
    resolved < minimum ||
    resolved > maximum
  ) {
    throw new BadRequestException(
      `${field} debe estar entre ${minimum} y ${maximum}.`,
    );
  }

  return resolved;
}

function validateScrumRule(
  type: DocumentTemplateType,
  includesScrum: boolean,
): void {
  if (type !== "ERP_FDD" && !includesScrum) {
    throw new BadRequestException(
      "Las plantillas pequeñas, medianas y grandes deben incluir Epic, Feature, historias de usuario y criterios de aceptación.",
    );
  }
}

export function parseCreateDocumentTemplate(
  value: unknown,
): CreateDocumentTemplateRequest {
  const record = asRecord(value);
  const resolvedType = templateType(record.templateType);
  const includesScrum = requiredBoolean(record, "includesScrum");

  validateScrumRule(resolvedType, includesScrum);

  return {
    code: normalizedCode(record.code),
    name: requiredText(record, "name", 3, 200),
    description: optionalText(record, "description", 2000),
    templateType: resolvedType,
    version: semanticVersion(record.version),
    includesScrum,
    sections: optionalSections(record.sections),
  };
}

export function parseUpdateDocumentTemplate(
  value: unknown,
): UpdateDocumentTemplateRequest {
  const record = asRecord(value);
  const result: UpdateDocumentTemplateRequest = {};

  if (record.name !== undefined) {
    result.name = requiredText(record, "name", 3, 200);
  }

  if (record.description !== undefined) {
    result.description = optionalText(record, "description", 2000);
  }

  if (record.includesScrum !== undefined) {
    result.includesScrum = optionalBoolean(record, "includesScrum");
  }

  if (record.sections !== undefined) {
    result.sections = optionalSections(record.sections);
  }

  if (Object.keys(result).length === 0) {
    throw new BadRequestException(
      "Debes enviar al menos un campo para actualizar.",
    );
  }

  return result;
}

export function parseCloneDocumentTemplate(
  value: unknown,
): CloneDocumentTemplateRequest {
  const record = asRecord(value);

  return {
    version: semanticVersion(record.version),
    name:
      record.name === undefined
        ? undefined
        : requiredText(record, "name", 3, 200),
    description: optionalText(record, "description", 2000),
    includesScrum: optionalBoolean(record, "includesScrum"),
    sections: optionalSections(record.sections),
  };
}

export function parseDocumentTemplateListQuery(
  value: unknown,
): DocumentTemplateListQuery {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Readonly<Record<string, unknown>>)
      : {};

  const rawSearch = record.search;
  const search =
    typeof rawSearch === "string" ? rawSearch.trim().slice(0, 200) : "";

  return {
    search,
    status: optionalStatus(record.status),
    templateType: optionalTemplateType(record.templateType),
    page: readInteger(record.page, 1, 1, 100000, "page"),
    pageSize: readInteger(record.pageSize, 20, 1, 50, "pageSize"),
  };
}

export function parseDocumentTemplateId(value: string): string {
  return requiredUuid(value, "templateId");
}

export function assertScrumRule(
  type: DocumentTemplateType,
  includesScrum: boolean,
): void {
  validateScrumRule(type, includesScrum);
}

export function compareSemanticVersions(
  left: string,
  right: string,
): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);

  for (let index = 0; index < 3; index += 1) {
    const difference =
      (leftParts[index] ?? 0) - (rightParts[index] ?? 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}
