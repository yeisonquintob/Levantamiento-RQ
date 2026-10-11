// LOCAL_ONLY_V2_14_DETERMINISTIC_ASSEMBLY
//
// Ensambla el borrador V2 completo SIN otra llamada a IA.
//
// Entradas:
// - plan de plantilla (Paso 8);
// - selección/trazabilidad (Paso 9);
// - batches (Paso 11);
// - validación de batches (Paso 12);
// - plan de ejecución + resume COMPLETO (Paso 13).
//
// Salida:
// LocalOnlyV2AssembledDraft ordenado exactamente por plantilla.
//
// Importante:
// - no convierte todavía al AiAnalysisDraft 4.1 histórico;
// - no inventa un schema universal para HU/requisitos/tests/backlog;
// - un microbloque aporta texto;
// - una colección conserva cada payload de batch en orden;
// - trazabilidad proviene de evidencia/batches, nunca de la IA;
// - Paso 15 certificará cobertura global.

import { createHash } from "node:crypto";

import type {
  LocalOnlyV2ArrayBatch,
  LocalOnlyV2ArrayBatchPlan,
} from "./local-only-v2-array-batches";
import type {
  LocalOnlyV2ExecutionPlan,
  LocalOnlyV2ResumePlan,
  LocalOnlyV2ResumedUnit,
} from "./local-only-v2-checkpoint-resume";
import type {
  LocalOnlyV2BlockEvidencePacket,
  LocalOnlyV2EvidenceSelectionPlan,
} from "./local-only-v2-evidence-selector";
import {
  validateLocalOnlyV2ArrayBatchPlan,
  validateLocalOnlyV2MicroDraft,
} from "./local-only-v2-localized-repair";
import type { LocalOnlyV2MicroDraft } from "./local-only-v2-micro-draft";
import { localOnlyV2Diagnostic } from "./local-only-v2-diagnostics";
import { localOnlyV2SectionDraftPolicy } from "./local-only-v2-section-draft-policy";
import type {
  LocalOnlyV2TemplateGenerationBlock,
  LocalOnlyV2TemplateGenerationPlan,
} from "./local-only-v2-template-planner";

export const LOCAL_ONLY_V2_ASSEMBLED_DRAFT_SCHEMA_VERSION = "1.0.0" as const;

export type LocalOnlyV2JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly LocalOnlyV2JsonValue[]
  | { readonly [key: string]: LocalOnlyV2JsonValue };

export interface LocalOnlyV2AssembledBatchPart {
  readonly unitId: string;
  readonly batchNumber: number;
  readonly batchTotal: number;
  readonly inputFingerprint: string;
  readonly outputFingerprint: string;
  readonly payload: LocalOnlyV2JsonValue;
}

export interface LocalOnlyV2AssembledSection {
  readonly blockId: string;
  readonly sectionKey: string;
  readonly order: number;
  readonly title: string;
  readonly required: boolean;
  readonly guidance: string;
  readonly contentKind: "MICRO_BLOCK" | "BATCHED_COLLECTION";
  readonly content: LocalOnlyV2JsonValue;
  readonly unitIds: readonly string[];
  readonly selectedFindingIds: readonly string[];
  readonly sourceIds: readonly string[];
  readonly segmentIds: readonly string[];
  readonly questionnaireFindingCount: number;
  readonly fingerprint: string;
}

export interface LocalOnlyV2AssembledDraft {
  readonly pipelineId: "LOCAL_ONLY_V2";
  readonly schemaVersion: typeof LOCAL_ONLY_V2_ASSEMBLED_DRAFT_SCHEMA_VERSION;
  readonly projectId: string;
  readonly template: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly version: string;
    readonly templateType: string;
  };
  readonly templatePlanFingerprint: string;
  readonly executionPlanFingerprint: string;
  readonly sections: readonly LocalOnlyV2AssembledSection[];
  readonly unitCount: number;
  readonly sourceIds: readonly string[];
  readonly segmentIds: readonly string[];
  readonly selectedFindingIds: readonly string[];
  readonly questionnaireFindingCount: number;
  readonly fingerprint: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function uniqueInOrder(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)]);
}

function canonicalJson(value: unknown, path = "$"): LocalOnlyV2JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`LOCAL_ONLY_V2 encontró número no finito en ${path}.`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((item, index) => canonicalJson(item, `${path}[${index}]`)),
    );
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    const result: Record<string, LocalOnlyV2JsonValue> = {};
    for (const key of Object.keys(object).sort((left, right) =>
      left.localeCompare(right),
    )) {
      const item = object[key];
      if (
        item === undefined ||
        typeof item === "function" ||
        typeof item === "symbol" ||
        typeof item === "bigint"
      ) {
        throw new Error(
          `LOCAL_ONLY_V2 encontró valor no JSON en ${path}.${key}.`,
        );
      }
      result[key] = canonicalJson(item, `${path}.${key}`);
    }
    return Object.freeze(result);
  }

  throw new Error(`LOCAL_ONLY_V2 encontró valor no JSON en ${path}.`);
}

function resumedByUnit(
  resume: LocalOnlyV2ResumePlan,
): ReadonlyMap<string, LocalOnlyV2ResumedUnit> {
  const result = new Map<string, LocalOnlyV2ResumedUnit>();
  for (const resumed of resume.resumedUnits) {
    if (result.has(resumed.unit.unitId)) {
      throw new Error(
        `LOCAL_ONLY_V2 recibió unidad reanudada duplicada: ${resumed.unit.unitId}.`,
      );
    }
    result.set(resumed.unit.unitId, resumed);
  }
  return result;
}

function assertCompatibleInputs(
  plan: LocalOnlyV2TemplateGenerationPlan,
  evidence: LocalOnlyV2EvidenceSelectionPlan,
  batchPlan: LocalOnlyV2ArrayBatchPlan,
  executionPlan: LocalOnlyV2ExecutionPlan,
  resume: LocalOnlyV2ResumePlan,
): void {
  if (
    plan.pipelineId !== "LOCAL_ONLY_V2" ||
    evidence.pipelineId !== "LOCAL_ONLY_V2" ||
    batchPlan.pipelineId !== "LOCAL_ONLY_V2" ||
    executionPlan.pipelineId !== "LOCAL_ONLY_V2" ||
    resume.pipelineId !== "LOCAL_ONLY_V2"
  ) {
    throw new Error("Paso 14 acepta únicamente artefactos LOCAL_ONLY_V2.");
  }

  const projectId = plan.knowledge.projectId;
  if (
    evidence.projectId !== projectId ||
    batchPlan.projectId !== projectId ||
    executionPlan.projectId !== projectId ||
    resume.projectId !== projectId
  ) {
    throw new Error(
      "LOCAL_ONLY_V2 detectó projectId inconsistente en Paso 14.",
    );
  }

  const planFingerprint = plan.planFingerprint;
  if (
    evidence.templatePlanFingerprint !== planFingerprint ||
    batchPlan.templatePlanFingerprint !== planFingerprint ||
    executionPlan.templatePlanFingerprint !== planFingerprint ||
    resume.templatePlanFingerprint !== planFingerprint
  ) {
    throw new Error(
      "LOCAL_ONLY_V2 detectó templatePlanFingerprint inconsistente en Paso 14.",
    );
  }

  if (!resume.complete || resume.pendingUnits.length > 0) {
    throw new Error(
      `LOCAL_ONLY_V2 no puede ensamblar: aún hay ${resume.pendingUnits.length} unidad(es) pendiente(s).`,
    );
  }
  if (resume.completedPrefixCount !== executionPlan.units.length) {
    throw new Error(
      "LOCAL_ONLY_V2 requiere todas las unidades certificadas antes de ensamblar.",
    );
  }
  if (resume.invalidatedCheckpoints.length > 0) {
    throw new Error("LOCAL_ONLY_V2 no ensambla con checkpoints invalidados.");
  }

  const arrayValidation = validateLocalOnlyV2ArrayBatchPlan(batchPlan, plan);
  if (!arrayValidation.valid) {
    throw new Error(
      `LOCAL_ONLY_V2 no ensambla batches inválidos: ${arrayValidation.issues
        .map((item) => item.code)
        .join(", ")}.`,
    );
  }
}

function traceForPacket(packet: LocalOnlyV2BlockEvidencePacket): {
  readonly selectedFindingIds: readonly string[];
  readonly sourceIds: readonly string[];
  readonly segmentIds: readonly string[];
  readonly questionnaireFindingCount: number;
} {
  return {
    selectedFindingIds: packet.selectedFindingIds,
    sourceIds: packet.sourceIds,
    segmentIds: packet.segmentIds,
    questionnaireFindingCount: packet.metrics.questionnaireFindingCount,
  };
}

function traceForBatches(batches: readonly LocalOnlyV2ArrayBatch[]): {
  readonly selectedFindingIds: readonly string[];
  readonly sourceIds: readonly string[];
  readonly segmentIds: readonly string[];
  readonly questionnaireFindingCount: number;
} {
  const relevantFindings = batches.flatMap((batch) => batch.relevantFindings);
  const guardFindings = batches.flatMap((batch) => batch.guardFindings);

  return {
    selectedFindingIds: uniqueInOrder([
      ...relevantFindings.map((finding) => finding.canonicalId),
      ...guardFindings.map((finding) => finding.canonicalId),
    ]),
    sourceIds: uniqueInOrder(
      [...relevantFindings, ...guardFindings].flatMap(
        (finding) => finding.sourceIds,
      ),
    ),
    segmentIds: uniqueInOrder(
      [...relevantFindings, ...guardFindings].flatMap(
        (finding) => finding.segmentIds,
      ),
    ),
    questionnaireFindingCount: new Set(
      [...relevantFindings, ...guardFindings]
        .filter((finding) => finding.mandatoryQuestionnaireEvidence)
        .map((finding) => finding.canonicalId),
    ).size,
  };
}

function sectionFingerprint(
  value: Omit<LocalOnlyV2AssembledSection, "fingerprint">,
): string {
  return sha256(JSON.stringify(canonicalJson(value)));
}

function microSection(
  plan: LocalOnlyV2TemplateGenerationPlan,
  block: LocalOnlyV2TemplateGenerationBlock,
  packet: LocalOnlyV2BlockEvidencePacket,
  resumed: LocalOnlyV2ResumedUnit,
): LocalOnlyV2AssembledSection {
  if (resumed.unit.unitKind !== "MICRO_BLOCK") {
    throw new Error(
      `LOCAL_ONLY_V2 esperaba MICRO_BLOCK para ${block.blockId}.`,
    );
  }

  const payload = resumed.payload as LocalOnlyV2MicroDraft;
  const validation = validateLocalOnlyV2MicroDraft(payload, plan, packet);
  if (!validation.valid) {
    throw new Error(
      `LOCAL_ONLY_V2 no ensambla micro-borrador inválido ${block.blockId}: ${validation.issues
        .map((item) => item.code)
        .join(", ")}.`,
    );
  }
  if (payload.fingerprint !== resumed.checkpoint.outputFingerprint) {
    throw new Error(
      `LOCAL_ONLY_V2 detectó outputFingerprint inconsistente en ${resumed.unit.unitId}.`,
    );
  }

  const trace = traceForPacket(packet);
  const withoutFingerprint = {
    blockId: block.blockId,
    sectionKey: block.sectionKey,
    order: block.sectionOrder,
    title: block.title,
    required: block.required,
    guidance: block.guidance,
    contentKind: "MICRO_BLOCK" as const,
    content: payload.content,
    unitIds: Object.freeze([resumed.unit.unitId]),
    ...trace,
  };

  return Object.freeze({
    ...withoutFingerprint,
    fingerprint: sectionFingerprint(withoutFingerprint),
  });
}

function collectionSection(
  block: LocalOnlyV2TemplateGenerationBlock,
  batches: readonly LocalOnlyV2ArrayBatch[],
  resumedMap: ReadonlyMap<string, LocalOnlyV2ResumedUnit>,
): LocalOnlyV2AssembledSection {
  const ordered = [...batches].sort(
    (left, right) => left.batchNumber - right.batchNumber,
  );

  const parts: LocalOnlyV2AssembledBatchPart[] = ordered.map((batch) => {
    const resumed = resumedMap.get(batch.batchId);
    if (!resumed) {
      throw new Error(
        `LOCAL_ONLY_V2 no encontró checkpoint completo para ${batch.batchId}.`,
      );
    }
    if (resumed.unit.unitKind !== "ARRAY_BATCH") {
      throw new Error(
        `LOCAL_ONLY_V2 esperaba ARRAY_BATCH para ${batch.batchId}.`,
      );
    }
    if (
      resumed.unit.batchNumber !== batch.batchNumber ||
      resumed.unit.batchTotal !== batch.batchTotal ||
      resumed.unit.inputFingerprint !== batch.fingerprint
    ) {
      throw new Error(
        `LOCAL_ONLY_V2 detectó metadata de lote inconsistente en ${batch.batchId}.`,
      );
    }

    return Object.freeze({
      unitId: batch.batchId,
      batchNumber: batch.batchNumber,
      batchTotal: batch.batchTotal,
      inputFingerprint: batch.fingerprint,
      outputFingerprint: resumed.checkpoint.outputFingerprint,
      payload: canonicalJson(resumed.payload, `$.${batch.batchId}`),
    });
  });

  const trace = traceForBatches(ordered);
  const withoutFingerprint = {
    blockId: block.blockId,
    sectionKey: block.sectionKey,
    order: block.sectionOrder,
    title: block.title,
    required: block.required,
    guidance: block.guidance,
    contentKind: "BATCHED_COLLECTION" as const,
    content: Object.freeze(
      parts.map((part) =>
        Object.freeze({
          unitId: part.unitId,
          batchNumber: part.batchNumber,
          batchTotal: part.batchTotal,
          inputFingerprint: part.inputFingerprint,
          outputFingerprint: part.outputFingerprint,
          payload: part.payload,
        }),
      ),
    ),
    unitIds: Object.freeze(parts.map((part) => part.unitId)),
    ...trace,
  };

  return Object.freeze({
    ...withoutFingerprint,
    fingerprint: sectionFingerprint(withoutFingerprint),
  });
}

export function assembleLocalOnlyV2Draft(
  plan: LocalOnlyV2TemplateGenerationPlan,
  evidence: LocalOnlyV2EvidenceSelectionPlan,
  batchPlan: LocalOnlyV2ArrayBatchPlan,
  executionPlan: LocalOnlyV2ExecutionPlan,
  resume: LocalOnlyV2ResumePlan,
): LocalOnlyV2AssembledDraft {
  assertCompatibleInputs(plan, evidence, batchPlan, executionPlan, resume);

  const evidenceByBlock = new Map(
    evidence.blocks.map((packet) => [packet.blockId, packet]),
  );
  const collectionByBlock = new Map(
    batchPlan.collections.map((collection) => [collection.blockId, collection]),
  );
  const resumedMap = resumedByUnit(resume);

  if (resumedMap.size !== executionPlan.units.length) {
    throw new Error(
      "LOCAL_ONLY_V2 no ensambla si falta alguna unidad completada.",
    );
  }

  const sections = [...plan.blocks]
    .sort((left, right) => left.blockNumber - right.blockNumber)
    .map((block) => {
      const packet = evidenceByBlock.get(block.blockId);
      if (!packet) {
        throw new Error(
          `LOCAL_ONLY_V2 no encontró evidencia para ${block.blockId}.`,
        );
      }

      const collection = collectionByBlock.get(block.blockId);
      if (collection) {
        return collectionSection(block, collection.batches, resumedMap);
      }

      const unitId = `micro-draft:${block.blockId}`;
      const resumed = resumedMap.get(unitId);
      if (!resumed) {
        throw new Error(
          `LOCAL_ONLY_V2 no encontró micro-borrador completado para ${block.blockId}.`,
        );
      }
      return microSection(plan, block, packet, resumed);
    });

  const sourceIds = uniqueInOrder(
    sections.flatMap((section) => section.sourceIds),
  );
  const segmentIds = uniqueInOrder(
    sections.flatMap((section) => section.segmentIds),
  );
  const selectedFindingIds = uniqueInOrder(
    sections.flatMap((section) => section.selectedFindingIds),
  );

  const questionnaireFindingIds = uniqueInOrder(
    plan.blocks.flatMap((block) => {
      const collection = collectionByBlock.get(block.blockId);
      if (collection) {
        return collection.batches.flatMap((batch) =>
          [...batch.relevantFindings, ...batch.guardFindings]
            .filter((finding) => finding.mandatoryQuestionnaireEvidence)
            .map((finding) => finding.canonicalId),
        );
      }

      const packet = evidenceByBlock.get(block.blockId);
      if (!packet) return [];
      return [...packet.relevantFindings, ...packet.guardFindings]
        .filter((finding) => finding.mandatoryQuestionnaireEvidence)
        .map((finding) => finding.canonicalId);
    }),
  );

  const withoutFingerprint = {
    pipelineId: "LOCAL_ONLY_V2" as const,
    schemaVersion: LOCAL_ONLY_V2_ASSEMBLED_DRAFT_SCHEMA_VERSION,
    projectId: plan.knowledge.projectId,
    template: Object.freeze({
      id: plan.template.id,
      code: plan.template.code,
      name: plan.template.name,
      version: plan.template.version,
      templateType: plan.template.templateType,
    }),
    templatePlanFingerprint: plan.planFingerprint,
    executionPlanFingerprint: executionPlan.fingerprint,
    sections: Object.freeze(sections),
    unitCount: executionPlan.units.length,
    sourceIds,
    segmentIds,
    selectedFindingIds,
    questionnaireFindingCount: questionnaireFindingIds.length,
  };

  return Object.freeze({
    ...withoutFingerprint,
    fingerprint: sha256(JSON.stringify(canonicalJson(withoutFingerprint))),
  });
}

/** Consolidates validated subunits in template order; never calls a model. */
export function assembleLocalOnlyV2SequentialSections(
  plan: LocalOnlyV2TemplateGenerationPlan,
  points: readonly import("./local-only-v2-sequential-orchestrator").LocalOnlyV2CompletedPoint[],
): readonly LocalOnlyV2AssembledSection[] {
  if (
    points.length !== plan.blocks.length ||
    new Set(points.map((point) => point.blockId)).size !== points.length
  ) {
    throw new Error(
      "LOCAL_ONLY_V2 no ensambla puntos incompletos o duplicados.",
    );
  }
  return plan.blocks.map((block, index) => {
    const point = points[index];
    if (
      !point ||
      point.blockId !== block.blockId ||
      point.checkpoint.status !== "COMPLETED" ||
      !point.drafts.length
    ) {
      throw new Error(
        "LOCAL_ONLY_V2 requiere puntos COMPLETED en orden exacto.",
      );
    }
    const preserveRepeatedStructuredLines =
      block.sectionKey === "milestones" ||
      block.sectionKey === "backlogStructure";
    const seenContent = new Set<string>();
    const candidates = point.drafts
      .flatMap((draft) => draft.content.split(/\n+/u))
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((part) => {
        if (preserveRepeatedStructuredLines) return true;

        const normalized = part
          .normalize("NFD")
          .replace(/\p{M}+/gu, "")
          .toLocaleLowerCase("es")
          .replace(/\s+/gu, " ");
        if (seenContent.has(normalized)) return false;
        seenContent.add(normalized);
        return true;
      });
    const maxCharacters = localOnlyV2SectionDraftPolicy(
      block.sectionKey,
    ).maxCharacters;
    const selected: string[] = [];
    let selectedCharacters = 0;
    let droppedParts = 0;
    // Las secciones de contrato jerárquico (Requerimientos, Esquema, Pruebas,
    // Plan de trabajo) no pueden saltarse una línea larga y conservar las
    // siguientes: quedarían hijos sin padre. Al agotarse el tope se detiene el
    // consolidado en la última línea completa.
    const isHierarchicalContract =
      preserveRepeatedStructuredLines ||
      block.sectionKey === "tests" ||
      block.sectionKey === "scrumPlan";
    let exhausted = false;
    for (const candidate of candidates) {
      if (exhausted) {
        droppedParts += 1;
        continue;
      }
      const parts =
        candidate.length <= maxCharacters
          ? [candidate]
          : candidate
              .split(/(?<=[.!?;])\s+(?=[A-ZÁÉÍÓÚÑ])/gu)
              .map((part) => part.trim())
              .filter(Boolean);
      for (const part of parts) {
        if (exhausted) {
          droppedParts += 1;
          continue;
        }
        const separator = selected.length > 0 ? 1 : 0;
        if (selectedCharacters + separator + part.length > maxCharacters) {
          droppedParts += 1;
          if (isHierarchicalContract) exhausted = true;
          continue;
        }
        selected.push(part);
        selectedCharacters += separator + part.length;
      }
    }
    if (droppedParts > 0) {
      localOnlyV2Diagnostic("assembly_dropped_lines", {
        section: block.sectionKey,
        droppedParts,
        keptParts: selected.length,
        maxCharacters,
      });
    }
    const content = selected.join("\n") || "[PENDIENTE POR DEFINIR]";
    const value = {
      blockId: block.blockId,
      sectionKey: block.sectionKey,
      order: block.sectionOrder,
      title: block.title,
      required: block.required,
      guidance: block.guidance,
      contentKind: "MICRO_BLOCK" as const,
      content,
      unitIds: point.checkpoint.units.map((unit) => unit.unitId),
      selectedFindingIds: uniqueInOrder(
        point.drafts.flatMap((draft) => draft.selectedFindingIds),
      ),
      sourceIds: uniqueInOrder(
        point.drafts.flatMap((draft) => draft.sourceIds),
      ),
      segmentIds: uniqueInOrder(
        point.drafts.flatMap((draft) => draft.segmentIds),
      ),
      questionnaireFindingCount: point.packet.metrics.questionnaireFindingCount,
    };
    if (
      !content ||
      value.selectedFindingIds.length !==
        point.packet.selectedFindingIds.length ||
      point.packet.selectedFindingIds.some(
        (id) => !value.selectedFindingIds.includes(id),
      )
    ) {
      const missingFindingIds = point.packet.selectedFindingIds.filter(
        (id) => !value.selectedFindingIds.includes(id),
      );
      throw new Error(
        [
          "LOCAL_ONLY_V2 perdió contenido o trazabilidad al consolidar.",
          `sectionKey=${block.sectionKey}`,
          `expectedFindingCount=${point.packet.selectedFindingIds.length}`,
          `assembledFindingCount=${value.selectedFindingIds.length}`,
          `missingFindingCount=${missingFindingIds.length}`,
        ].join(" "),
      );
    }
    return { ...value, fingerprint: sectionFingerprint(value) };
  });
}
