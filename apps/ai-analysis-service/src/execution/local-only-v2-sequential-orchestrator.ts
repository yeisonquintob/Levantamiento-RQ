import type { AiDraftGenerationPurpose } from "@levantamiento-rq/shared-contracts";
import type { OllamaClient } from "../local-ai/ollama.client";
import {
  buildLocalOnlyV2PointUnitPlan,
  buildLocalOnlyV2ResumePlan,
  createLocalOnlyV2CompletedCheckpoint,
  type LocalOnlyV2PointCheckpointStore,
  type LocalOnlyV2PointCheckpoint,
  type LocalOnlyV2CompletedCheckpoint,
} from "./local-only-v2-checkpoint-resume";
import {
  LOCAL_ONLY_V2_DEFAULT_EVIDENCE_SELECTION_POLICY,
  type LocalOnlyV2BlockEvidencePacket,
} from "./local-only-v2-evidence-selector";
import type { LocalOnlyV2InferenceBudget } from "./local-only-v2-inference-budget";
import type { LocalOnlyV2KnowledgeIndex } from "./local-only-v2-knowledge-index";
import { validateLocalOnlyV2MicroDraft } from "./local-only-v2-localized-repair";
import type { LocalOnlyV2MicroDraft } from "./local-only-v2-micro-draft";
import {
  createLocalOnlyV2SequentialBlockExecution,
  beginLocalOnlyV2Block,
  completeLocalOnlyV2Block,
  failLocalOnlyV2Block,
  cancelLocalOnlyV2Block,
} from "./local-only-v2-sequential-block-contract";
import { prepareLocalOnlyV2EvidenceForProcessingBlock } from "./local-only-v2-sequential-block-evidence";
import {
  planLocalOnlyV2ProcessingUnits,
  generateLocalOnlyV2ProcessingBlock,
  localOnlyV2Fingerprint,
} from "./local-only-v2-sequential-block-generator";
import { localOnlyV2PriorCodesContext } from "./local-only-v2-prior-codes";
import type { LocalOnlyV2TemplateGenerationPlan } from "./local-only-v2-template-planner";

export interface LocalOnlyV2CompletedPoint {
  readonly blockId: string;
  readonly packet: LocalOnlyV2BlockEvidencePacket;
  readonly drafts: readonly LocalOnlyV2MicroDraft[];
  readonly checkpoint: LocalOnlyV2PointCheckpoint;
}

export async function runLocalOnlyV2SequentialOrchestrator(input: {
  plan: LocalOnlyV2TemplateGenerationPlan;
  knowledge: LocalOnlyV2KnowledgeIndex;
  budget: LocalOnlyV2InferenceBudget;
  client: Pick<OllamaClient, "generate">;
  store: LocalOnlyV2PointCheckpointStore;
  checkCancelled: () => Promise<void>;
  instruction?: string | null;
  purpose?: AiDraftGenerationPurpose;
}) {
  const {
    plan,
    knowledge,
    budget,
    client,
    store,
    checkCancelled,
    instruction,
    purpose,
  } = input;
  let execution = createLocalOnlyV2SequentialBlockExecution(plan);
  const points: LocalOnlyV2CompletedPoint[] = [];
  for (const block of plan.blocks) {
    await checkCancelled();
    execution = beginLocalOnlyV2Block(execution, block.blockId);
    let state: LocalOnlyV2PointCheckpoint = {
      pipelineId: "LOCAL_ONLY_V2",
      projectId: knowledge.projectId,
      templatePlanFingerprint: plan.planFingerprint,
      blockId: block.blockId,
      blockNumber: block.blockNumber,
      blockTotal: block.blockTotal,
      sectionKey: block.sectionKey,
      status: "PROCESSING",
      inputFingerprint: "",
      outputFingerprint: null,
      payload: [],
      completedAt: null,
      units: [],
      title: block.title,
    };
    try {
      const packet = prepareLocalOnlyV2EvidenceForProcessingBlock(
        execution,
        plan,
        knowledge,
        {
          ...LOCAL_ONLY_V2_DEFAULT_EVIDENCE_SELECTION_POLICY,
        },
      );
      const units = planLocalOnlyV2ProcessingUnits(
        execution,
        plan,
        packet,
        budget,
        {
          instruction,
          purpose,
          priorCodes: localOnlyV2PriorCodesContext(block.sectionKey, points),
        },
      );
      const unitPlan = buildLocalOnlyV2PointUnitPlan(
        plan,
        block,
        units.map((unit) => unit.unitFingerprint),
      );
      const inputFingerprint = localOnlyV2Fingerprint([
        packet.fingerprint,
        unitPlan.fingerprint,
      ]);
      const saved = await store.load(block.blockId);
      const compatible =
        saved?.pipelineId === "LOCAL_ONLY_V2" &&
        saved.projectId === knowledge.projectId &&
        saved.templatePlanFingerprint === plan.planFingerprint &&
        saved.blockId === block.blockId &&
        saved.blockNumber === block.blockNumber &&
        saved.blockTotal === block.blockTotal &&
        saved.sectionKey === block.sectionKey &&
        saved.inputFingerprint === inputFingerprint;
      if (compatible && saved.status === "CANCELLED")
        throw new Error("AI_CANCELLED");
      const resume = buildLocalOnlyV2ResumePlan(
        unitPlan,
        compatible ? saved.units : [],
      );
      const checkpoints: LocalOnlyV2CompletedCheckpoint[] = [];
      const drafts: LocalOnlyV2MicroDraft[] = [];
      state = { ...state, inputFingerprint };
      for (const unit of units) {
        await checkCancelled();
        const descriptor = unitPlan.units[unit.unitNumber - 1];
        if (!descriptor) throw new Error("Falta descriptor de subunidad.");
        const resumed = resume.resumedUnits[unit.unitNumber - 1];
        let draft: LocalOnlyV2MicroDraft;
        if (resumed) {
          draft = resumed.payload as LocalOnlyV2MicroDraft;
          const validation = validateLocalOnlyV2MicroDraft(
            draft,
            plan,
            unit.packet,
          );
          if (
            !validation.valid ||
            draft.fingerprint !== resumed.checkpoint.outputFingerprint
          ) {
            throw new Error("Checkpoint de subunidad inválido.");
          }
          checkpoints.push(resumed.checkpoint);
        } else {
          // Persist PROCESSING before the inference, preserving the valid prefix.
          await store.save({
            ...state,
            units: [...checkpoints],
            payload: [...drafts],
          });
          draft = await generateLocalOnlyV2ProcessingBlock(
            client,
            execution,
            plan,
            unit,
          );
          await checkCancelled();
          checkpoints.push(
            createLocalOnlyV2CompletedCheckpoint(
              unitPlan,
              descriptor,
              draft,
              draft.fingerprint,
              new Date().toISOString(),
            ),
          );
        }
        drafts.push(draft);
        state = { ...state, units: [...checkpoints], payload: [...drafts] };
        await store.save(state);
      }
      const outputFingerprint = localOnlyV2Fingerprint(
        drafts.map((draft) => draft.fingerprint),
      );
      if (
        compatible &&
        saved.status === "COMPLETED" &&
        saved.outputFingerprint !== outputFingerprint
      ) {
        throw new Error("Fingerprint de punto completado inconsistente.");
      }
      await checkCancelled();
      state = {
        ...state,
        status: "COMPLETED",
        outputFingerprint,
        completedAt:
          compatible && saved.status === "COMPLETED"
            ? saved.completedAt
            : new Date().toISOString(),
      };
      await store.save(state);
      execution = completeLocalOnlyV2Block(execution, block.blockId);
      points.push({
        blockId: block.blockId,
        packet,
        drafts,
        checkpoint: state,
      });
    } catch (error) {
      const cancelled =
        error instanceof Error &&
        (error.message.includes("AI_CANCELLED") ||
          ("code" in error && error.code === "AI_CANCELLED"));
      execution = cancelled
        ? cancelLocalOnlyV2Block(execution, block.blockId)
        : failLocalOnlyV2Block(execution, block.blockId);
      await store.save({
        ...state,
        status: cancelled ? "CANCELLED" : "FAILED",
        completedAt: null,
      });
      throw error;
    }
  }
  return { execution, points };
}
