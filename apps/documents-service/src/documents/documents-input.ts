import { BadRequestException } from "@nestjs/common";

import {
  DOCUMENT_SECTION_DEFINITIONS,
  type AcceptanceCriterionInput,
  type ApplyAiAnalysisDraftRequest,
  type ArchiveRequirementDocumentRequest,
  type CreateDocumentVersionRequest,
  type CreateRequirementDocumentRequest,
  type DocumentEvidenceInput,
  type DocumentFieldInput,
  type DocumentJsonValue,
  type DocumentRequirementInput,
  type DocumentSectionKey,
  type DocumentTransitionRequest,
  type ReplaceDocumentFieldsRequest,
  type UpdateDocumentSectionRequest,
  type UpdateRequirementDocumentRequest,
} from "@levantamiento-rq/shared-contracts";

const SECTION_KEYS = new Set<string>(
  DOCUMENT_SECTION_DEFINITIONS.map((section) => section.key),
);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELD_KEY_PATTERN = /^[a-z][a-zA-Z0-9_.-]{1,99}$/;

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("El cuerpo de la solicitud no es válido.");
  }

  return value as Readonly<Record<string, unknown>>;
}

function text(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): string {
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

function nullableText(
  value: unknown,
  field: string,
  maximum: number,
): string | null {
  if (value === undefined || value === null || value === "") return null;
  return text(value, field, 1, maximum);
}

function integer(
  value: unknown,
  field: string,
  minimum = 1,
  maximum = 1_000_000,
): number {
  if (
    !Number.isInteger(value) ||
    Number(value) < minimum ||
    Number(value) > maximum
  ) {
    throw new BadRequestException(
      `${field} debe ser un entero entre ${minimum} y ${maximum}.`,
    );
  }

  return Number(value);
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new BadRequestException(`${field} debe ser un UUID válido.`);
  }

  return value.toLowerCase();
}

function sectionKey(value: unknown, field: string): DocumentSectionKey {
  if (typeof value !== "string" || !SECTION_KEYS.has(value)) {
    throw new BadRequestException(`${field} no es una sección canónica.`);
  }

  return value as DocumentSectionKey;
}

function jsonValue(value: unknown, field: string): DocumentJsonValue {
  try {
    const serialized = JSON.stringify(value);

    if (serialized === undefined || serialized.length > 500_000) {
      throw new Error("invalid");
    }

    return JSON.parse(serialized) as DocumentJsonValue;
  } catch {
    throw new BadRequestException(
      `${field} debe ser JSON válido y no superar 500000 caracteres.`,
    );
  }
}

function array(
  value: unknown,
  field: string,
  maximum: number,
): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new BadRequestException(
      `${field} debe ser un arreglo de máximo ${maximum} elementos.`,
    );
  }

  return value;
}

export function parseDocumentId(value: string): string {
  return uuid(value, "documentId");
}

export function parseProjectId(value: string): string {
  return uuid(value, "projectId");
}

export function parseVersionNumber(value: string): number {
  return integer(Number(value), "versionNumber", 1, 100000);
}

export function parseSectionKey(value: string): DocumentSectionKey {
  return sectionKey(value, "sectionKey");
}

export function parseCreateDocument(
  value: unknown,
): CreateRequirementDocumentRequest {
  const record = asRecord(value);

  if (
    record.title === undefined ||
    record.title === null ||
    record.title === ""
  ) {
    return {};
  }

  return { title: text(record.title, "title", 3, 240) };
}

export function parseUpdateDocument(
  value: unknown,
): UpdateRequirementDocumentRequest {
  const record = asRecord(value);

  return {
    title: text(record.title, "title", 3, 240),
    expectedRevision: integer(record.expectedRevision, "expectedRevision"),
  };
}

export function parseCreateVersion(
  value: unknown,
): CreateDocumentVersionRequest {
  const record = asRecord(value);

  return {
    expectedRevision: integer(record.expectedRevision, "expectedRevision"),
    changeSummary: text(record.changeSummary, "changeSummary", 3, 1000),
  };
}

export function parseUpdateSection(
  value: unknown,
): UpdateDocumentSectionRequest {
  const record = asRecord(value);

  return {
    expectedRevision: integer(record.expectedRevision, "expectedRevision"),
    content: jsonValue(record.content, "content"),
  };
}

function parseField(value: unknown, index: number): DocumentFieldInput {
  const record = asRecord(value);
  const key = text(record.key, `fields[${index}].key`, 2, 100);

  if (!FIELD_KEY_PATTERN.test(key)) {
    throw new BadRequestException(
      `fields[${index}].key debe iniciar en minúscula y usar caracteres válidos.`,
    );
  }

  return {
    sectionKey: sectionKey(record.sectionKey, `fields[${index}].sectionKey`),
    key,
    label: text(record.label, `fields[${index}].label`, 1, 200),
    valueType: text(record.valueType, `fields[${index}].valueType`, 1, 40),
    value: jsonValue(record.value, `fields[${index}].value`),
    order: integer(record.order, `fields[${index}].order`, 1, 10000),
  };
}

function parseCriterion(
  value: unknown,
  requirementIndex: number,
  criterionIndex: number,
): AcceptanceCriterionInput {
  const record = asRecord(value);
  const prefix = `requirements[${requirementIndex}].acceptanceCriteria[${criterionIndex}]`;

  return {
    description: text(record.description, `${prefix}.description`, 1, 2000),
    order: integer(record.order, `${prefix}.order`, 1, 1000),
  };
}

function parseRequirement(
  value: unknown,
  index: number,
): DocumentRequirementInput {
  const record = asRecord(value);
  const rawClientId = record.clientId;

  return {
    clientId:
      rawClientId === undefined
        ? undefined
        : text(rawClientId, `requirements[${index}].clientId`, 1, 80),
    sectionKey: sectionKey(
      record.sectionKey,
      `requirements[${index}].sectionKey`,
    ),
    code: text(record.code, `requirements[${index}].code`, 2, 40),
    title: text(record.title, `requirements[${index}].title`, 3, 240),
    description: text(
      record.description,
      `requirements[${index}].description`,
      1,
      100000,
    ),
    requirementType: text(
      record.requirementType,
      `requirements[${index}].requirementType`,
      1,
      40,
    ),
    status: text(record.status, `requirements[${index}].status`, 1, 40),
    order: integer(record.order, `requirements[${index}].order`, 1, 10000),
    acceptanceCriteria: array(
      record.acceptanceCriteria,
      `requirements[${index}].acceptanceCriteria`,
      100,
    ).map((criterion, criterionIndex) =>
      parseCriterion(criterion, index, criterionIndex),
    ),
  };
}

function parseEvidence(value: unknown, index: number): DocumentEvidenceInput {
  const record = asRecord(value);

  return {
    sourceId: uuid(record.sourceId, `evidence[${index}].sourceId`),
    sectionKey:
      record.sectionKey === undefined || record.sectionKey === null
        ? null
        : sectionKey(record.sectionKey, `evidence[${index}].sectionKey`),
    requirementClientId: nullableText(
      record.requirementClientId,
      `evidence[${index}].requirementClientId`,
      80,
    ),
    excerpt: nullableText(record.excerpt, `evidence[${index}].excerpt`, 4000),
    note: nullableText(record.note, `evidence[${index}].note`, 2000),
  };
}

export function parseReplaceFields(
  value: unknown,
): ReplaceDocumentFieldsRequest {
  const record = asRecord(value);
  const fields = array(record.fields, "fields", 1000).map(parseField);
  const requirements = array(record.requirements, "requirements", 500).map(
    parseRequirement,
  );
  const evidence = array(record.evidence, "evidence", 1000).map(parseEvidence);

  const fieldKeys = new Set<string>();
  for (const field of fields) {
    const unique = `${field.sectionKey}:${field.key.toLowerCase()}`;
    if (fieldKeys.has(unique)) {
      throw new BadRequestException(`El campo ${unique} está duplicado.`);
    }
    fieldKeys.add(unique);
  }

  const requirementCodes = new Set<string>();
  const clientIds = new Set<string>();
  for (const requirement of requirements) {
    const code = requirement.code.toLowerCase();
    if (requirementCodes.has(code)) {
      throw new BadRequestException(
        `El requisito ${requirement.code} está duplicado.`,
      );
    }
    requirementCodes.add(code);
    if (requirement.clientId) {
      if (clientIds.has(requirement.clientId)) {
        throw new BadRequestException(
          `El clientId ${requirement.clientId} está duplicado.`,
        );
      }
      clientIds.add(requirement.clientId);
    }
  }

  for (const item of evidence) {
    if (item.requirementClientId && !clientIds.has(item.requirementClientId)) {
      throw new BadRequestException(
        `La evidencia referencia el clientId inexistente ${item.requirementClientId}.`,
      );
    }
  }

  return {
    expectedRevision: integer(record.expectedRevision, "expectedRevision"),
    fields,
    requirements,
    evidence,
  };
}

export function parseApplyAiDraft(value: unknown): ApplyAiAnalysisDraftRequest {
  const record = asRecord(value);
  const sections = array(record.sections, "sections", 10).map(
    (value, index) => {
      const item = asRecord(value);
      const key = sectionKey(item.key, `sections[${index}].key`);
      const expected = DOCUMENT_SECTION_DEFINITIONS[index];
      if (!expected || index >= 10 || key !== expected.key) {
        throw new BadRequestException(
          "sections debe contener las diez secciones editables en orden canónico.",
        );
      }
      return {
        key,
        content: jsonValue(item.content, `sections[${index}].content`),
      };
    },
  );
  if (sections.length !== 10) {
    throw new BadRequestException(
      "sections debe contener exactamente las diez secciones editables.",
    );
  }

  const structured = parseReplaceFields({
    expectedRevision: record.expectedRevision,
    fields: [],
    requirements: record.requirements,
    evidence: record.evidence,
  });

  return {
    expectedRevision: integer(record.expectedRevision, "expectedRevision"),
    analysisRequestId: uuid(record.analysisRequestId, "analysisRequestId"),
    analysisResultId: uuid(record.analysisResultId, "analysisResultId"),
    sections,
    requirements: structured.requirements,
    evidence: structured.evidence,
  };
}

export function parseTransition(value: unknown): DocumentTransitionRequest {
  const record = asRecord(value);

  return {
    expectedRevision: integer(record.expectedRevision, "expectedRevision"),
    comment: nullableText(record.comment, "comment", 1000),
  };
}

export function parseArchive(
  value: unknown,
): ArchiveRequirementDocumentRequest {
  const record = asRecord(value);
  return {
    expectedRevision: integer(record.expectedRevision, "expectedRevision"),
  };
}
