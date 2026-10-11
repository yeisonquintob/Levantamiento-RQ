import { BadRequestException } from "@nestjs/common";
import { parseProviderSelections } from "../providers/provider-selection";

import {
  AI_DRAFT_GENERATION_PURPOSES,
  AI_ANALYSIS_STATUSES,
  AI_ANALYSIS_TYPES,
  DOCUMENT_SCRUM_SECTION_DEFINITION,
  DOCUMENT_SECTION_DEFINITIONS,
  type AiAnalysisStatus,
  type AiAnalysisTokenEstimateRequest,
  type CreateAiAnalysisRequest,
  type ProcessRequirementDiscussionRequest,
  type ReviewAiAnalysisResult,
} from "@levantamiento-rq/shared-contracts";

const VALID_SECTION_KEYS = new Set<string>([
  ...DOCUMENT_SECTION_DEFINITIONS.map((section) => section.key),
  DOCUMENT_SCRUM_SECTION_DEFINITION.key,
  "nonFunctionalRequirements",
]);

function structuredInstruction(
  generalInstruction: string | null,
  sectionInstructions: readonly {
    readonly sectionKey: string;
    readonly instruction: string;
  }[],
): string | null {
  if (sectionInstructions.length === 0) return generalInstruction;
  return [
    "SOLICITUD_ESTRUCTURADA_DE_CAMBIO_V1",
    JSON.stringify({
      generalInstruction,
      sectionInstructions,
    }),
    "Cada cambio por sección es obligatorio para su sectionKey. Aplica también sus consecuencias coherentes en las demás secciones, conserva lo no afectado y no traslades el contenido a una sección distinta.",
  ].join("\n");
}

export interface AiAnalysisRequestListQuery {
  status: AiAnalysisStatus | null;
  page: number;
  pageSize: number;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("El cuerpo de la solicitud no es válido.");
  }

  return value as Readonly<Record<string, unknown>>;
}

function uuid(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.trim(),
    )
  ) {
    throw new BadRequestException(`${name} debe ser un UUID válido.`);
  }

  return value.trim().toLowerCase();
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function integer(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const raw = first(value);

  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new BadRequestException(
      `${name} debe estar entre ${minimum} y ${maximum}.`,
    );
  }

  return parsed;
}

export function parseProjectId(value: string): string {
  return uuid(value, "projectId");
}

export function parseAnalysisRequestId(value: string): string {
  return uuid(value, "analysisRequestId");
}

export const AI_ENGINES_REQUIRED_CODE = "AI_ENGINES_REQUIRED";

/**
 * Política única para crear solicitudes y estimar tokens: la persona debe elegir
 * motores de forma explícita. Omitir `engines` nunca activa IA nube (ni local)
 * de manera implícita.
 */
export function requireExplicitAiEngines(
  value: unknown,
): ("LOCAL" | "CLOUD")[] {
  if (
    value === undefined ||
    value === null ||
    (Array.isArray(value) && value.length === 0)
  ) {
    throw new BadRequestException({
      code: AI_ENGINES_REQUIRED_CODE,
      message:
        "El campo engines es obligatorio: selecciona explícitamente al menos un motor de IA (LOCAL, CLOUD o ambos) para continuar. No se activa ningún motor de forma implícita.",
    });
  }
  if (
    !Array.isArray(value) ||
    value.length > 2 ||
    value.some((engine) => engine !== "LOCAL" && engine !== "CLOUD") ||
    new Set(value).size !== value.length
  ) {
    throw new BadRequestException({
      code: "AI_ENGINES_INVALID",
      message: "engines debe contener LOCAL, CLOUD o ambos sin duplicados.",
    });
  }
  return value as ("LOCAL" | "CLOUD")[];
}

export function parseCreateAiAnalysisRequest(
  value: unknown,
): CreateAiAnalysisRequest {
  const record = asRecord(value);
  const analysisType = record.analysisType ?? "REQUIREMENT_DOCUMENT";

  if (
    typeof analysisType !== "string" ||
    !AI_ANALYSIS_TYPES.includes(
      analysisType as (typeof AI_ANALYSIS_TYPES)[number],
    )
  ) {
    throw new BadRequestException(
      "analysisType debe ser REQUIREMENT_DOCUMENT.",
    );
  }

  if (
    !Array.isArray(record.sourceIds) ||
    record.sourceIds.length < 1 ||
    record.sourceIds.length > 100
  ) {
    throw new BadRequestException(
      "sourceIds debe contener entre 1 y 100 fuentes.",
    );
  }

  const sourceIds = record.sourceIds.map((item, index) =>
    uuid(item, `sourceIds[${index}]`),
  );

  if (new Set(sourceIds).size !== sourceIds.length) {
    throw new BadRequestException("sourceIds no puede contener duplicados.");
  }

  const engines = requireExplicitAiEngines(record.engines);

  const purpose = record.purpose ?? "INITIAL_DRAFT";
  if (
    typeof purpose !== "string" ||
    !AI_DRAFT_GENERATION_PURPOSES.includes(
      purpose as (typeof AI_DRAFT_GENERATION_PURPOSES)[number],
    )
  ) {
    throw new BadRequestException(
      "purpose debe ser INITIAL_DRAFT o AI_VERSION.",
    );
  }

  let instruction: string | null = null;
  if (
    record.instruction !== undefined &&
    record.instruction !== null &&
    record.instruction !== ""
  ) {
    if (
      typeof record.instruction !== "string" ||
      record.instruction.trim().length > 20000
    ) {
      throw new BadRequestException(
        "instruction no puede superar 20000 caracteres.",
      );
    }
    instruction = record.instruction.trim();
  }

  const rawSectionInstructions = record.sectionInstructions ?? [];
  if (
    !Array.isArray(rawSectionInstructions) ||
    rawSectionInstructions.length > 14
  ) {
    throw new BadRequestException(
      "sectionInstructions debe contener máximo 14 cambios por sección.",
    );
  }
  const sectionInstructions = rawSectionInstructions.map((item, index) => {
    const section = asRecord(item);
    if (
      typeof section.sectionKey !== "string" ||
      !VALID_SECTION_KEYS.has(section.sectionKey)
    ) {
      throw new BadRequestException(
        `sectionInstructions[${index}].sectionKey no es válido.`,
      );
    }
    if (
      typeof section.instruction !== "string" ||
      section.instruction.trim().length === 0 ||
      section.instruction.trim().length > 6000
    ) {
      throw new BadRequestException(
        `sectionInstructions[${index}].instruction debe contener entre 1 y 6000 caracteres.`,
      );
    }
    return {
      sectionKey: section.sectionKey,
      instruction: section.instruction.trim(),
    };
  });
  if (
    new Set(sectionInstructions.map((item) => item.sectionKey)).size !==
    sectionInstructions.length
  ) {
    throw new BadRequestException(
      "sectionInstructions no puede repetir una sección.",
    );
  }
  const normalizedInstruction = structuredInstruction(
    instruction,
    sectionInstructions,
  );
  if ((normalizedInstruction?.length ?? 0) > 60000) {
    throw new BadRequestException(
      "La solicitud estructurada no puede superar 60000 caracteres.",
    );
  }
  if (
    record.includePrototype !== undefined &&
    typeof record.includePrototype !== "boolean"
  ) {
    throw new BadRequestException("includePrototype debe ser booleano.");
  }
  const effectiveInstruction = record.includePrototype
    ? [normalizedInstruction, "PROTOTYPE_MARKDOWN_V1=ENABLED"]
        .filter(Boolean)
        .join("\n\n")
    : normalizedInstruction;

  let idempotencyKey: string | undefined;
  if (record.idempotencyKey !== undefined) {
    if (
      typeof record.idempotencyKey !== "string" ||
      !/^[A-Za-z0-9._:-]{8,120}$/.test(record.idempotencyKey.trim())
    ) {
      throw new BadRequestException(
        "idempotencyKey debe tener entre 8 y 120 caracteres seguros.",
      );
    }
    idempotencyKey = record.idempotencyKey.trim();
  }

  return {
    analysisType: "REQUIREMENT_DOCUMENT",
    ...(record.providerSelections !== undefined
      ? {
          providerSelections: parseProviderSelections(
            record.providerSelections,
          ),
        }
      : {}),
    documentId: uuid(record.documentId, "documentId"),
    documentVersionId: uuid(record.documentVersionId, "documentVersionId"),
    sourceIds,
    engines,
    purpose: purpose as (typeof AI_DRAFT_GENERATION_PURPOSES)[number],
    instruction: effectiveInstruction || null,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}

export function parseAiAnalysisTokenEstimateRequest(
  value: unknown,
): AiAnalysisTokenEstimateRequest {
  const record = asRecord(value);

  if (
    !Array.isArray(record.sourceIds) ||
    record.sourceIds.length < 1 ||
    record.sourceIds.length > 100
  ) {
    throw new BadRequestException(
      "sourceIds debe contener entre 1 y 100 fuentes.",
    );
  }

  const sourceIds = record.sourceIds.map((item, index) =>
    uuid(item, `sourceIds[${index}]`),
  );

  if (new Set(sourceIds).size !== sourceIds.length) {
    throw new BadRequestException("sourceIds no puede contener duplicados.");
  }

  const engines = requireExplicitAiEngines(record.engines);

  const purpose = record.purpose ?? "AI_VERSION";
  if (
    typeof purpose !== "string" ||
    !AI_DRAFT_GENERATION_PURPOSES.includes(
      purpose as (typeof AI_DRAFT_GENERATION_PURPOSES)[number],
    )
  ) {
    throw new BadRequestException(
      "purpose debe ser INITIAL_DRAFT o AI_VERSION.",
    );
  }

  return {
    documentId: uuid(record.documentId, "documentId"),
    sourceIds,
    ...(record.providerSelections !== undefined
      ? {
          providerSelections: parseProviderSelections(
            record.providerSelections,
          ),
        }
      : {}),
    engines,
    purpose: purpose as (typeof AI_DRAFT_GENERATION_PURPOSES)[number],
  };
}

export function parseProcessRequirementDiscussionRequest(
  value: unknown,
): ProcessRequirementDiscussionRequest {
  const record = asRecord(value);
  if (
    !Array.isArray(record.answers) ||
    record.answers.length < 1 ||
    record.answers.length > 100
  ) {
    throw new BadRequestException(
      "answers debe contener entre 1 y 100 preguntas.",
    );
  }

  const answers = record.answers.map((item, index) => {
    const answer = asRecord(item);
    const questionId =
      typeof answer.questionId === "string" ? answer.questionId.trim() : "";
    const question =
      typeof answer.question === "string" ? answer.question.trim() : "";
    const response =
      typeof answer.answer === "string" ? answer.answer.trim() : "";
    const score = Number(answer.score);

    if (!/^[a-z0-9][a-z0-9-]{1,99}$/u.test(questionId)) {
      throw new BadRequestException(
        `answers[${index}].questionId no es válido.`,
      );
    }
    if (question.length < 3 || question.length > 1_000) {
      throw new BadRequestException(
        `answers[${index}].question debe contener entre 3 y 1000 caracteres.`,
      );
    }
    if (response.length > 20_000) {
      throw new BadRequestException(
        `answers[${index}].answer no puede superar 20000 caracteres.`,
      );
    }
    if (!Number.isInteger(score) || score < 1 || score > 10) {
      throw new BadRequestException(
        `answers[${index}].score debe estar entre 1 y 10.`,
      );
    }
    return { questionId, question, answer: response, score };
  });

  if (new Set(answers.map((item) => item.questionId)).size !== answers.length) {
    throw new BadRequestException("answers no puede repetir questionId.");
  }

  const conversation =
    typeof record.conversation === "string" ? record.conversation.trim() : "";
  if (conversation.length > 200_000) {
    throw new BadRequestException(
      "conversation no puede superar 200000 caracteres.",
    );
  }
  if (!conversation && answers.every((item) => !item.answer)) {
    throw new BadRequestException(
      "Escribe al menos una respuesta o una conversación para procesar.",
    );
  }

  const engine =
    typeof record.engine === "string" ? record.engine.trim().toUpperCase() : "";
  if (engine !== "LOCAL" && engine !== "CLOUD") {
    throw new BadRequestException("engine debe ser LOCAL o CLOUD.");
  }

  return {
    answers,
    conversation,
    engine,
    ...(record.providerConfigurationId !== undefined
      ? {
          providerConfigurationId: uuid(
            record.providerConfigurationId,
            "providerConfigurationId",
          ),
        }
      : {}),
  };
}

export function parseAiAnalysisRequestListQuery(
  value: unknown,
): AiAnalysisRequestListQuery {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Readonly<Record<string, unknown>>)
      : {};
  const rawStatus = first(record.status);
  let status: AiAnalysisStatus | null = null;

  if (rawStatus !== undefined && rawStatus !== null && rawStatus !== "") {
    if (
      typeof rawStatus !== "string" ||
      !AI_ANALYSIS_STATUSES.includes(
        rawStatus as (typeof AI_ANALYSIS_STATUSES)[number],
      )
    ) {
      throw new BadRequestException("status no es válido.");
    }

    status = rawStatus as AiAnalysisStatus;
  }

  return {
    status,
    page: integer(record.page, 1, 1, 100000, "page"),
    pageSize: integer(record.pageSize, 25, 1, 100, "pageSize"),
  };
}

export function parseReviewAiAnalysisResult(
  value: unknown,
): ReviewAiAnalysisResult {
  const record = asRecord(value);
  let expectedDocumentRevision: number | undefined;
  if (record.expectedDocumentRevision !== undefined) {
    expectedDocumentRevision = integer(
      record.expectedDocumentRevision,
      1,
      1,
      1_000_000,
      "expectedDocumentRevision",
    );
  }
  let comment: string | null = null;
  if (
    record.comment !== undefined &&
    record.comment !== null &&
    record.comment !== ""
  ) {
    if (
      typeof record.comment !== "string" ||
      record.comment.trim().length > 2000
    ) {
      throw new BadRequestException(
        "comment no puede superar 2000 caracteres.",
      );
    }
    comment = record.comment.trim();
  }
  return { expectedDocumentRevision, comment };
}
