// LOCAL_ONLY_V2_02_MANDATORY_QUESTIONNAIRE_EVIDENCE
//
// Paso 2 NO modifica Discusión. Consume la fuente que Discusión ya persiste:
//   - sourceType: CONVERSATION
//   - título: "Preguntas de análisis · <código>"
//   - encabezado: "RESPUESTAS SELECCIONADAS PARA EL LEVANTAMIENTO"
//
// La preparación usa preferentemente el cuestionario estructurado. Cuando no
// existe, admite una conversación textual seleccionada explícitamente.

import type { AnalysisRequestSourceEntity } from "../analysis/analysis-request-source.entity";
import type { AiDocumentGenerationMode } from "./ai-document-generation-mode";
import {
  requireLocalOnlyV2Pipeline,
  resolveLocalOnlyV2Pipeline,
  type LocalOnlyV2PipelineContract,
} from "./local-only-v2-pipeline";

export const LOCAL_ONLY_V2_QUESTIONNAIRE_TITLE_PREFIX =
  "Preguntas de análisis ·" as const;

export const LOCAL_ONLY_V2_QUESTIONNAIRE_HEADER =
  "RESPUESTAS SELECCIONADAS PARA EL LEVANTAMIENTO" as const;

export type LocalOnlyV2EvidenceSource = Pick<
  AnalysisRequestSourceEntity,
  "sourceId" | "sourceTitle" | "snapshotText" | "position"
>;

export interface LocalOnlyV2QuestionnaireEvidence {
  readonly sourceId: string;
  readonly sourceTitle: string;
  readonly snapshotText: string;
  readonly questionCount: number;
  readonly answerCount: number;
}

export interface LocalOnlyV2PreparedEvidenceInput {
  readonly pipeline: LocalOnlyV2PipelineContract;
  readonly sources: readonly LocalOnlyV2EvidenceSource[];
  readonly selectedQuestionnaire: LocalOnlyV2QuestionnaireEvidence;
}

function meaningfulLines(value: string): readonly string[] {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function prefixedContentCount(
  lines: readonly string[],
  prefix: string,
): number {
  return lines.filter(
    (line) =>
      line.startsWith(prefix) && line.slice(prefix.length).trim().length > 0,
  ).length;
}

function hasQuestionnaireTitle(source: LocalOnlyV2EvidenceSource): boolean {
  return (source.sourceTitle?.trim() ?? "")
    .toLocaleLowerCase("es")
    .startsWith(
      LOCAL_ONLY_V2_QUESTIONNAIRE_TITLE_PREFIX.toLocaleLowerCase("es"),
    );
}

export function isLocalOnlyV2QuestionnaireEvidence(
  source: LocalOnlyV2EvidenceSource,
): boolean {
  const snapshotText = source.snapshotText?.trim() ?? "";

  if (!hasQuestionnaireTitle(source)) {
    return false;
  }

  const lines = meaningfulLines(snapshotText);
  if (lines[0] !== LOCAL_ONLY_V2_QUESTIONNAIRE_HEADER) {
    return false;
  }

  const questionCount = prefixedContentCount(lines, "Pregunta:");
  const answerCount = prefixedContentCount(lines, "Respuesta:");

  return questionCount > 0 && questionCount === answerCount;
}

export function requireLocalOnlyV2QuestionnaireEvidence(
  mode: AiDocumentGenerationMode,
  sources: readonly LocalOnlyV2EvidenceSource[],
): LocalOnlyV2QuestionnaireEvidence | null {
  if (!resolveLocalOnlyV2Pipeline(mode)) {
    return null;
  }

  const source =
    sources.find(isLocalOnlyV2QuestionnaireEvidence) ??
    sources.find(
      (candidate) =>
        !hasQuestionnaireTitle(candidate) &&
        Boolean(candidate.sourceTitle?.trim()) &&
        Boolean(candidate.snapshotText?.trim()),
    );
  if (!source) {
    throw new Error(
      "LOCAL_ONLY_V2 requiere preguntas de análisis o una conversación textual antes de generar el borrador.",
    );
  }

  const snapshotText = source.snapshotText?.trim();
  const sourceTitle = source.sourceTitle?.trim();
  if (!snapshotText || !sourceTitle) {
    throw new Error(
      "LOCAL_ONLY_V2 recibió una evidencia de cuestionario incompleta.",
    );
  }

  const lines = meaningfulLines(snapshotText);
  const evidence: LocalOnlyV2QuestionnaireEvidence = {
    sourceId: source.sourceId,
    sourceTitle,
    snapshotText,
    questionCount: prefixedContentCount(lines, "Pregunta:"),
    answerCount: prefixedContentCount(lines, "Respuesta:"),
  };

  return Object.freeze(evidence);
}

export function prepareLocalOnlyV2EvidenceInput(
  mode: AiDocumentGenerationMode,
  sources: readonly LocalOnlyV2EvidenceSource[],
): LocalOnlyV2PreparedEvidenceInput {
  const pipeline = requireLocalOnlyV2Pipeline(mode);
  const selectedQuestionnaire = requireLocalOnlyV2QuestionnaireEvidence(
    mode,
    sources,
  );

  if (!selectedQuestionnaire) {
    throw new Error(
      "LOCAL_ONLY_V2 no pudo preparar la evidencia obligatoria del cuestionario.",
    );
  }

  return Object.freeze({
    pipeline,
    sources: Object.freeze([...sources]),
    selectedQuestionnaire,
  });
}
