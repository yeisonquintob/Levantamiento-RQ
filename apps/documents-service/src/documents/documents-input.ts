import { BadRequestException } from "@nestjs/common";

import {
  AI_BACKLOG_CODE_PATTERNS,
  AI_FUNCTIONAL_CODE_PATTERNS,
  AI_PLANNING_CODE_PATTERNS,
  DOCUMENT_SCRUM_SECTION_DEFINITION,
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

const SECTION_KEYS = new Set<string>([
  ...DOCUMENT_SECTION_DEFINITIONS.map((section) => section.key),
  DOCUMENT_SCRUM_SECTION_DEFINITION.key,
  "nonFunctionalRequirements",
]);
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

function optionalIdempotencyKey(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9._:-]{8,120}$/.test(value.trim())
  ) {
    throw new BadRequestException(
      "idempotencyKey debe tener entre 8 y 120 caracteres seguros.",
    );
  }
  return value.trim();
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
    return {
      ...(record.changeSummary === undefined
        ? {}
        : {
            changeSummary: text(record.changeSummary, "changeSummary", 3, 1000),
          }),
      ...(optionalIdempotencyKey(record.idempotencyKey)
        ? { idempotencyKey: optionalIdempotencyKey(record.idempotencyKey) }
        : {}),
    };
  }

  return {
    title: text(record.title, "title", 3, 240),
    ...(record.changeSummary === undefined
      ? {}
      : {
          changeSummary: text(record.changeSummary, "changeSummary", 3, 1000),
        }),
    ...(optionalIdempotencyKey(record.idempotencyKey)
      ? { idempotencyKey: optionalIdempotencyKey(record.idempotencyKey) }
      : {}),
  };
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
    ...(optionalIdempotencyKey(record.idempotencyKey)
      ? { idempotencyKey: optionalIdempotencyKey(record.idempotencyKey) }
      : {}),
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

function backlogCode(value: unknown, field: string, pattern: RegExp): string {
  const code = text(value, field, 2, 80);
  if (!pattern.test(code)) {
    throw new BadRequestException(
      `${field} no tiene el formato canónico esperado.`,
    );
  }
  return code;
}

/**
 * Protects the canonical Epic -> Feature -> HU -> Task tree when a human edits
 * section 7. The AI path performs the same semantic checks before persistence;
 * this guard prevents the editor API from becoming a weaker write path.
 */
export function validateDocumentSectionContent(
  key: DocumentSectionKey,
  content: DocumentJsonValue,
): void {
  if (key === "header") {
    if (!content || typeof content !== "object" || Array.isArray(content)) return;
    const header = asRecord(content);
    for (const personKey of ["preparedBy", "reviewedBy", "approvedBy"]) {
      if (header[personKey] !== undefined) {
        throw new BadRequestException(
          "Los responsables se registran en Aprobaciones, no en el encabezado.",
        );
      }
    }
    return;
  }
  if (key === "solutionProposal") {
    if (!content || typeof content !== "object" || Array.isArray(content)) return;
    const proposal = asRecord(content);
    text(proposal.objective, "content.objective", 2, 2_000);
    text(proposal.description, "content.description", 2, 3_000);
    array(proposal.involvedElements, "content.involvedElements", 12).forEach(
      (item, index) =>
        text(item, `content.involvedElements[${index}]`, 2, 500),
    );
    const alignment = asRecord(proposal.flowAlignment);
    text(alignment.currentState, "content.flowAlignment.currentState", 2, 2_000);
    text(alignment.evaluation, "content.flowAlignment.evaluation", 2, 2_000);
    text(
      alignment.expectedResult,
      "content.flowAlignment.expectedResult",
      2,
      2_000,
    );
    return;
  }
  if (key === "approvalsAndChangeControl") {
    if (!content || typeof content !== "object" || Array.isArray(content)) return;
    const approvals = asRecord(content);
    const rows = array(approvals.approvals, "content.approvals", 3);
    if (rows.length !== 3) {
      throw new BadRequestException(
        "content.approvals debe incluir elaboración, revisión y aprobación.",
      );
    }
    const expected = ["Elaboración", "Revisión", "Aprobación"];
    rows.forEach((item, index) => {
      const approval = asRecord(item);
      if (approval.responsibility !== expected[index]) {
        throw new BadRequestException(
          "content.approvals debe conservar el orden Elaboración, Revisión y Aprobación.",
        );
      }
    });
    array(approvals.changeControl, "content.changeControl", 1);
    return;
  }
  if (key !== "backlogStructure") return;

  const root = asRecord(content);
  const epics = array(root.epics, "content.epics", 200);
  const allCodes = new Set<string>();
  const taskCodes = new Set<string>();
  const dependencies = new Map<string, readonly string[]>();

  const unique = (code: string, field: string) => {
    if (allCodes.has(code)) {
      throw new BadRequestException(`${field} está duplicado: ${code}.`);
    }
    allCodes.add(code);
  };

  const planningNode = (node: Record<string, unknown>, path: string) => {
    // Historical drafts may predate these presentation fields. New AI output
    // requires them in its strict schema; manual writes validate them whenever
    // they are present without making old document versions unreadable.
    if (node.title !== undefined) {
      text(node.title, `${path}.title`, 2, 300);
    }
    if (node.description !== undefined) {
      text(node.description, `${path}.description`, 2, 5_000);
    }
    nullableText(node.sourceNumber, `${path}.sourceNumber`, 120);
  };

  epics.forEach((rawEpic, epicIndex) => {
    const epic = asRecord(rawEpic);
    const epicPath = `content.epics[${epicIndex}]`;
    const epicCode = backlogCode(
      epic.code,
      `${epicPath}.code`,
      new RegExp(AI_BACKLOG_CODE_PATTERNS.EPIC),
    );
    unique(epicCode, `${epicPath}.code`);
    planningNode(epic, epicPath);

    array(epic.features, `${epicPath}.features`, 500).forEach(
      (rawFeature, featureIndex) => {
        const feature = asRecord(rawFeature);
        const featurePath = `${epicPath}.features[${featureIndex}]`;
        const featureCode = backlogCode(
          feature.code,
          `${featurePath}.code`,
          new RegExp(AI_BACKLOG_CODE_PATTERNS.FEATURE),
        );
        unique(featureCode, `${featurePath}.code`);
        planningNode(feature, featurePath);

        array(feature.userStories, `${featurePath}.userStories`, 2_000).forEach(
          (rawStory, storyIndex) => {
            const story = asRecord(rawStory);
            const storyPath = `${featurePath}.userStories[${storyIndex}]`;
            const independentPlanningStory =
              typeof story.code === "string" &&
              (story.code.trim().toUpperCase().startsWith("HU-P-") ||
                Array.isArray(story.functionalRequirementCodes));
            const storyCode = backlogCode(
              story.code,
              `${storyPath}.code`,
              new RegExp(
                independentPlanningStory
                  ? AI_PLANNING_CODE_PATTERNS.USER_STORY
                  : AI_BACKLOG_CODE_PATTERNS.USER_STORY,
              ),
            );
            unique(storyCode, `${storyPath}.code`);
            planningNode(story, storyPath);

            if (independentPlanningStory) {
              nullableText(story.sourceNumber, `${storyPath}.sourceNumber`, 120);
              array(
                story.functionalRequirementCodes,
                `${storyPath}.functionalRequirementCodes`,
                500,
              ).forEach((rawCode, functionalIndex) => {
                backlogCode(
                  rawCode,
                  `${storyPath}.functionalRequirementCodes[${functionalIndex}]`,
                  new RegExp(AI_FUNCTIONAL_CODE_PATTERNS.USER_STORY),
                );
              });
            } else {
              if (
                story.featureCode !== undefined &&
                story.featureCode !== featureCode
              ) {
                throw new BadRequestException(
                  `${storyPath}.featureCode debe referenciar a ${featureCode}.`,
                );
              }

              array(
                story.acceptanceCriteria,
                `${storyPath}.acceptanceCriteria`,
                500,
              ).forEach((rawCriterion, criterionIndex) => {
                const criterion = asRecord(rawCriterion);
                const criterionPath = `${storyPath}.acceptanceCriteria[${criterionIndex}]`;
                unique(
                  backlogCode(
                    criterion.code,
                    `${criterionPath}.code`,
                    new RegExp(AI_BACKLOG_CODE_PATTERNS.ACCEPTANCE_CRITERION),
                  ),
                  `${criterionPath}.code`,
                );
              });
            }

            array(story.tasks, `${storyPath}.tasks`, 1_000).forEach(
              (rawTask, taskIndex) => {
                const task = asRecord(rawTask);
                const taskPath = `${storyPath}.tasks[${taskIndex}]`;
                const taskCode = backlogCode(
                  task.code,
                  `${taskPath}.code`,
                  new RegExp(AI_BACKLOG_CODE_PATTERNS.TASK),
                );
                unique(taskCode, `${taskPath}.code`);
                planningNode(task, taskPath);
                taskCodes.add(taskCode);
                const taskSourceNumber = nullableText(
                  task.sourceNumber,
                  `${taskPath}.sourceNumber`,
                  120,
                );
                if (
                  task.origin !== "EVIDENCE" &&
                  task.origin !== "IMPLEMENTATION_PROPOSAL"
                ) {
                  throw new BadRequestException(
                    `${taskPath}.origin debe ser EVIDENCE o IMPLEMENTATION_PROPOSAL.`,
                  );
                }
                if (taskSourceNumber && task.origin !== "EVIDENCE") {
                  throw new BadRequestException(
                    `${taskPath}.origin debe ser EVIDENCE cuando sourceNumber proviene de la fuente.`,
                  );
                }
                dependencies.set(
                  taskCode,
                  array(
                    task.dependencyCodes,
                    `${taskPath}.dependencyCodes`,
                    200,
                  ).map((dependency, dependencyIndex) =>
                    backlogCode(
                      dependency,
                      `${taskPath}.dependencyCodes[${dependencyIndex}]`,
                      new RegExp(AI_BACKLOG_CODE_PATTERNS.TASK),
                    ),
                  ),
                );
              },
            );
          },
        );
      },
    );
  });

  dependencies.forEach((items, taskCode) => {
    items.forEach((dependencyCode) => {
      if (!taskCodes.has(dependencyCode)) {
        throw new BadRequestException(
          `${taskCode} referencia una tarea inexistente: ${dependencyCode}.`,
        );
      }
      if (dependencyCode === taskCode) {
        throw new BadRequestException(
          `${taskCode} no puede depender de sí misma.`,
        );
      }
    });
  });

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (code: string) => {
    if (visiting.has(code)) {
      throw new BadRequestException(
        `El backlog contiene un ciclo de tareas en ${code}.`,
      );
    }
    if (visited.has(code)) return;
    visiting.add(code);
    (dependencies.get(code) ?? []).forEach(visit);
    visiting.delete(code);
    visited.add(code);
  };
  taskCodes.forEach(visit);
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
  parseKey: (value: unknown, field: string) => string = sectionKey,
): DocumentRequirementInput {
  const record = asRecord(value);
  const rawClientId = record.clientId;

  return {
    clientId:
      rawClientId === undefined
        ? undefined
        : text(rawClientId, `requirements[${index}].clientId`, 1, 80),
    sectionKey: parseKey(
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

function parseEvidence(value: unknown, index: number, parseKey: (value: unknown, field: string) => string = sectionKey): DocumentEvidenceInput {
  const record = asRecord(value);

  return {
    sourceId: uuid(record.sourceId, `evidence[${index}].sourceId`),
    sectionKey:
      record.sectionKey === undefined || record.sectionKey === null
        ? null
        : parseKey(record.sectionKey, `evidence[${index}].sectionKey`),
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
  templateDirected = false,
): ReplaceDocumentFieldsRequest {
  const record = asRecord(value);
  const fields = array(record.fields, "fields", 1000).map(parseField);
  const requirements = array(record.requirements, "requirements", 500).map(
    (item, index) => parseRequirement(item, index, templateDirected ? templateSectionKey : sectionKey),
  );
  const evidence = array(record.evidence, "evidence", 1000).map((item, index) => parseEvidence(item, index, templateDirected ? templateSectionKey : sectionKey));

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

function templateSectionKey(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-z][a-zA-Z0-9]{2,63}$/.test(value)) {
    throw new BadRequestException(`${field} no es una clave válida de plantilla.`);
  }
  return value;
}

export function parseApplyAiDraft(value: unknown): ApplyAiAnalysisDraftRequest {
  const record = asRecord(value);
  const sectionInputs = array(record.sections, "sections", 50);
  if (sectionInputs.length === 0) {
    throw new BadRequestException("sections no puede estar vacío.");
  }
  const keys = new Set<string>();
  const sections = sectionInputs.map((value, index) => {
    const item = asRecord(value);
    const key = templateSectionKey(item.key, `sections[${index}].key`);
    if (keys.has(key)) throw new BadRequestException(`Sección duplicada: ${key}.`);
    keys.add(key);
    return { key, content: jsonValue(item.content, `sections[${index}].content`) };
  });

  const structured = parseReplaceFields({
    expectedRevision: record.expectedRevision,
    fields: [],
    requirements: record.requirements,
    evidence: record.evidence,
  }, true);

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
