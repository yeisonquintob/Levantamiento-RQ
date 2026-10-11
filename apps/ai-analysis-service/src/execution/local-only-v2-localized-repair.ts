// LOCAL_ONLY_V2_12_LOCALIZED_VALIDATION_REPAIR
//
// Valida unidades V2 y repara solamente el micro-borrador que falló.
//
// Reglas:
// - corrupción estructural/trazabilidad => FAIL CLOSED, nunca se pide a IA;
// - contenido reparable => UNA llamada localizada usando la misma evidencia;
// - la IA solo devuelve { content };
// - TypeScript reconstruye toda la metadata/trazabilidad;
// - no se regeneran otros bloques ni dependientes;
// - no existe bucle de reparación dentro de este módulo.

import { omitKey } from "../common/require-defined";
import { createHash } from "node:crypto";

import type { OllamaClient } from "../local-ai/ollama.client";
import type { LocalOnlyV2ArrayBatchPlan } from "./local-only-v2-array-batches";
import type { LocalOnlyV2BlockEvidencePacket } from "./local-only-v2-evidence-selector";
import {
  buildLocalOnlyV2MicroDraftSchema,
  LOCAL_ONLY_V2_MICRO_DRAFT_MAX_CONTENT_CHARACTERS,
  LOCAL_ONLY_V2_MICRO_DRAFT_SCHEMA_VERSION,
  parseLocalOnlyV2MicroDraftModelOutput,
  type LocalOnlyV2MicroDraft,
} from "./local-only-v2-micro-draft";
import type { LocalOnlyV2TemplateGenerationPlan } from "./local-only-v2-template-planner";

export const LOCAL_ONLY_V2_LOCAL_REPAIR_SCHEMA_VERSION = "1.0.0" as const;

export type LocalOnlyV2ValidationIssueCode =
  | "PIPELINE_MISMATCH"
  | "BLOCK_MISMATCH"
  | "SECTION_MISMATCH"
  | "PLAN_MISMATCH"
  | "EVIDENCE_MISMATCH"
  | "TRACEABILITY_MISMATCH"
  | "QUESTIONNAIRE_MISMATCH"
  | "EMPTY_CONTENT"
  | "CONTENT_TOO_LARGE"
  | "CONTENT_METADATA_MISMATCH"
  | "FINGERPRINT_MISMATCH";

export interface LocalOnlyV2ValidationIssue {
  readonly code: LocalOnlyV2ValidationIssueCode;
  readonly message: string;
  readonly repairable: boolean;
}

export interface LocalOnlyV2ValidationResult {
  readonly valid: boolean;
  readonly repairable: boolean;
  readonly issues: readonly LocalOnlyV2ValidationIssue[];
}

export interface LocalOnlyV2LocalizedRepairResult {
  readonly pipelineId: "LOCAL_ONLY_V2";
  readonly schemaVersion: typeof LOCAL_ONLY_V2_LOCAL_REPAIR_SCHEMA_VERSION;
  readonly repairedUnitId: string;
  readonly issuesBeforeRepair: readonly LocalOnlyV2ValidationIssue[];
  readonly draft: LocalOnlyV2MicroDraft;
  readonly fingerprint: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function expectedDraftFingerprint(
  draft: Omit<LocalOnlyV2MicroDraft, "fingerprint">,
): string {
  return sha256(JSON.stringify(draft));
}

function issue(
  code: LocalOnlyV2ValidationIssueCode,
  message: string,
  repairable = false,
): LocalOnlyV2ValidationIssue {
  return Object.freeze({ code, message, repairable });
}

export function validateLocalOnlyV2MicroDraft(
  draft: LocalOnlyV2MicroDraft,
  plan: LocalOnlyV2TemplateGenerationPlan,
  packet: LocalOnlyV2BlockEvidencePacket,
): LocalOnlyV2ValidationResult {
  const issues: LocalOnlyV2ValidationIssue[] = [];

  if (
    draft.pipelineId !== "LOCAL_ONLY_V2" ||
    packet.pipelineId !== "LOCAL_ONLY_V2"
  ) {
    issues.push(
      issue("PIPELINE_MISMATCH", "La unidad no pertenece a LOCAL_ONLY_V2."),
    );
  }

  const block = plan.blocks.find(
    (candidate) => candidate.blockId === packet.blockId,
  );
  if (!block || draft.blockId !== packet.blockId) {
    issues.push(
      issue("BLOCK_MISMATCH", "El micro-borrador pertenece a otro bloque."),
    );
  }

  if (
    draft.sectionKey !== packet.sectionKey ||
    (block && draft.sectionKey !== block.sectionKey)
  ) {
    issues.push(
      issue("SECTION_MISMATCH", "La sección del micro-borrador no coincide."),
    );
  }

  if (
    packet.templatePlanFingerprint !== plan.planFingerprint ||
    draft.templatePlanFingerprint !== plan.planFingerprint
  ) {
    issues.push(
      issue("PLAN_MISMATCH", "El micro-borrador pertenece a otro plan."),
    );
  }

  if (draft.evidenceFingerprint !== packet.fingerprint) {
    issues.push(
      issue(
        "EVIDENCE_MISMATCH",
        "El micro-borrador referencia otra evidencia.",
      ),
    );
  }

  if (
    !sameStrings(draft.selectedFindingIds, packet.selectedFindingIds) ||
    !sameStrings(draft.sourceIds, packet.sourceIds) ||
    !sameStrings(draft.segmentIds, packet.segmentIds)
  ) {
    issues.push(
      issue(
        "TRACEABILITY_MISMATCH",
        "La trazabilidad del micro-borrador fue alterada.",
      ),
    );
  }

  if (
    draft.questionnaireFindingCount !== packet.metrics.questionnaireFindingCount
  ) {
    issues.push(
      issue(
        "QUESTIONNAIRE_MISMATCH",
        "Cambió la cobertura del cuestionario en el micro-borrador.",
      ),
    );
  }

  const trimmed = draft.content.trim();
  if (!trimmed) {
    issues.push(
      issue(
        "EMPTY_CONTENT",
        "El contenido del micro-borrador está vacío.",
        true,
      ),
    );
  }
  if (draft.content.length > LOCAL_ONLY_V2_MICRO_DRAFT_MAX_CONTENT_CHARACTERS) {
    issues.push(
      issue(
        "CONTENT_TOO_LARGE",
        "El contenido excede el máximo del micro-borrador.",
        true,
      ),
    );
  }

  const expectedCharacters = draft.content.length;
  const expectedTokens = Math.max(1, Math.ceil(expectedCharacters / 4));
  if (
    draft.contentCharacters !== expectedCharacters ||
    draft.estimatedContentTokens !== expectedTokens
  ) {
    issues.push(
      issue(
        "CONTENT_METADATA_MISMATCH",
        "La metadata de tamaño del contenido no coincide.",
      ),
    );
  }

  const withoutFingerprint = omitKey(draft, "fingerprint");
  if (draft.fingerprint !== expectedDraftFingerprint(withoutFingerprint)) {
    issues.push(
      issue(
        "FINGERPRINT_MISMATCH",
        "El fingerprint del micro-borrador no coincide.",
      ),
    );
  }

  return Object.freeze({
    valid: issues.length === 0,
    repairable:
      issues.length > 0 &&
      issues.every((currentIssue) => currentIssue.repairable),
    issues: Object.freeze(issues),
  });
}

export function validateLocalOnlyV2ArrayBatchPlan(
  batchPlan: LocalOnlyV2ArrayBatchPlan,
  plan: LocalOnlyV2TemplateGenerationPlan,
): LocalOnlyV2ValidationResult {
  const issues: LocalOnlyV2ValidationIssue[] = [];

  if (batchPlan.pipelineId !== "LOCAL_ONLY_V2") {
    issues.push(
      issue("PIPELINE_MISMATCH", "El plan de lotes no es LOCAL_ONLY_V2."),
    );
  }
  if (batchPlan.templatePlanFingerprint !== plan.planFingerprint) {
    issues.push(issue("PLAN_MISMATCH", "Los lotes pertenecen a otro plan."));
  }

  const knownBlocks = new Map(
    plan.blocks.map((block) => [block.blockId, block]),
  );

  for (const collection of batchPlan.collections) {
    const block = knownBlocks.get(collection.blockId);
    if (!block || block.sectionKey !== collection.sectionKey) {
      issues.push(
        issue(
          "BLOCK_MISMATCH",
          `La colección ${collection.blockId} no coincide con el plan.`,
        ),
      );
      continue;
    }

    if (
      collection.missingRelevantFindingIds.length > 0 ||
      collection.duplicateRelevantFindingIds.length > 0
    ) {
      issues.push(
        issue(
          "TRACEABILITY_MISMATCH",
          `La colección ${collection.blockId} perdió o duplicó evidencia.`,
        ),
      );
    }

    const ids: string[] = [];
    collection.batches.forEach((batch, index) => {
      if (
        batch.blockId !== collection.blockId ||
        batch.sectionKey !== collection.sectionKey ||
        batch.batchNumber !== index + 1 ||
        batch.batchTotal !== collection.batches.length
      ) {
        issues.push(
          issue(
            "BLOCK_MISMATCH",
            `La numeración del lote ${batch.batchId} es inconsistente.`,
          ),
        );
      }
      ids.push(...batch.relevantFindings.map((finding) => finding.canonicalId));
    });

    if (!sameStrings(ids, collection.coveredRelevantFindingIds)) {
      issues.push(
        issue(
          "TRACEABILITY_MISMATCH",
          `La cobertura declarada de ${collection.blockId} no coincide con sus lotes.`,
        ),
      );
    }
  }

  return Object.freeze({
    valid: issues.length === 0,
    repairable: false,
    issues: Object.freeze(issues),
  });
}

function repairPrompt(
  plan: LocalOnlyV2TemplateGenerationPlan,
  packet: LocalOnlyV2BlockEvidencePacket,
  invalidDraft: LocalOnlyV2MicroDraft,
  issues: readonly LocalOnlyV2ValidationIssue[],
): string {
  const block = plan.blocks.find(
    (candidate) => candidate.blockId === packet.blockId,
  );
  if (!block) {
    throw new Error(
      `LOCAL_ONLY_V2 no encontró ${packet.blockId} para reparar.`,
    );
  }

  const evidence = packet.relevantFindings.map((finding) => ({
    category: finding.category,
    description: finding.description,
    mandatoryQuestionnaireEvidence: finding.mandatoryQuestionnaireEvidence,
    evidence: finding.occurrences.map((occurrence) => ({
      sourceTitle: occurrence.sourceTitle,
      evidenceText: occurrence.evidenceText,
    })),
  }));
  const guards = packet.guardFindings.map((finding) => ({
    category: finding.category,
    description: finding.description,
    evidence: finding.occurrences.map((occurrence) => ({
      sourceTitle: occurrence.sourceTitle,
      evidenceText: occurrence.evidenceText,
    })),
  }));

  return [
    "LOCAL_ONLY_V2_LOCALIZED_REPAIR",
    "",
    "REPARA ÚNICAMENTE ESTE MICROBLOQUE.",
    "No regeneres otras secciones ni el documento completo.",
    "Usa exclusivamente la evidencia indicada.",
    "No inventes información ni resuelvas contradicciones.",
    "No generes IDs ni trazabilidad.",
    'Devuelve exclusivamente JSON válido con {"content":"..."}.',
    "",
    "BLOQUE",
    JSON.stringify({
      sectionKey: block.sectionKey,
      title: block.title,
      guidance: block.guidance,
      required: block.required,
    }),
    "",
    "PROBLEMAS A CORREGIR",
    JSON.stringify(
      issues.map((currentIssue) => ({
        code: currentIssue.code,
        message: currentIssue.message,
      })),
    ),
    "",
    "CONTENIDO INVÁLIDO",
    invalidDraft.content,
    "",
    "EVIDENCIA RELEVANTE (DATA)",
    JSON.stringify(evidence),
    "",
    "GUARDAS TRANSVERSALES (DATA)",
    JSON.stringify(guards),
    "",
    "REGLA DE FALTANTES",
    plan.aiPrompt.missingInformationInstruction,
    "",
    "REGLA DE CONFLICTOS",
    plan.aiPrompt.conflictInstruction,
  ].join("\n");
}

function materializeRepairedDraft(
  original: LocalOnlyV2MicroDraft,
  packet: LocalOnlyV2BlockEvidencePacket,
  content: string,
): LocalOnlyV2MicroDraft {
  const contentCharacters = content.length;
  const estimatedContentTokens = Math.max(1, Math.ceil(contentCharacters / 4));
  const withoutFingerprint = {
    pipelineId: "LOCAL_ONLY_V2" as const,
    schemaVersion: LOCAL_ONLY_V2_MICRO_DRAFT_SCHEMA_VERSION,
    taskId: original.taskId,
    blockId: packet.blockId,
    sectionKey: packet.sectionKey,
    blockNumber: packet.blockNumber,
    blockTotal: packet.blockTotal,
    required: packet.required,
    content,
    contentCharacters,
    estimatedContentTokens,
    evidenceFingerprint: packet.fingerprint,
    templatePlanFingerprint: packet.templatePlanFingerprint,
    selectedFindingIds: packet.selectedFindingIds,
    sourceIds: packet.sourceIds,
    segmentIds: packet.segmentIds,
    questionnaireFindingCount: packet.metrics.questionnaireFindingCount,
  };
  return Object.freeze({
    ...withoutFingerprint,
    fingerprint: expectedDraftFingerprint(withoutFingerprint),
  });
}

export async function repairLocalOnlyV2MicroDraftWithOllama(
  client: Pick<OllamaClient, "generate">,
  plan: LocalOnlyV2TemplateGenerationPlan,
  packet: LocalOnlyV2BlockEvidencePacket,
  invalidDraft: LocalOnlyV2MicroDraft,
  cancellationSignal?: AbortSignal,
): Promise<LocalOnlyV2LocalizedRepairResult> {
  const validation = validateLocalOnlyV2MicroDraft(invalidDraft, plan, packet);

  if (validation.valid) {
    throw new Error(
      "LOCAL_ONLY_V2 no ejecuta reparación sobre un micro-borrador válido.",
    );
  }
  if (!validation.repairable) {
    throw new Error(
      `LOCAL_ONLY_V2 rechazó reparación IA por error estructural: ${validation.issues
        .map((currentIssue) => currentIssue.code)
        .join(", ")}.`,
    );
  }

  const raw = await client.generate(
    repairPrompt(plan, packet, invalidDraft, validation.issues),
    buildLocalOnlyV2MicroDraftSchema(),
    undefined,
    {
      sourceId: packet.blockId,
      sourceTitle: packet.title,
      sourceClassification: "LOCAL_ONLY_V2_LOCAL_REPAIR",
    },
    cancellationSignal,
    { profile: "LOCAL_DOCUMENT" },
  );

  const parsed = parseLocalOnlyV2MicroDraftModelOutput(raw);
  const repaired = materializeRepairedDraft(
    invalidDraft,
    packet,
    parsed.content,
  );
  const after = validateLocalOnlyV2MicroDraft(repaired, plan, packet);
  if (!after.valid) {
    throw new Error(
      `LOCAL_ONLY_V2 produjo una reparación todavía inválida: ${after.issues
        .map((currentIssue) => currentIssue.code)
        .join(", ")}.`,
    );
  }

  const withoutFingerprint = {
    pipelineId: "LOCAL_ONLY_V2" as const,
    schemaVersion: LOCAL_ONLY_V2_LOCAL_REPAIR_SCHEMA_VERSION,
    repairedUnitId: invalidDraft.taskId,
    issuesBeforeRepair: validation.issues,
    draft: repaired,
  };

  return Object.freeze({
    ...withoutFingerprint,
    fingerprint: sha256(
      JSON.stringify({
        repairedUnitId: withoutFingerprint.repairedUnitId,
        issueCodes: validation.issues.map((currentIssue) => currentIssue.code),
        draftFingerprint: repaired.fingerprint,
      }),
    ),
  });
}
