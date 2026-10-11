import type { LocalOnlyV2KnowledgeIndex } from "./local-only-v2-knowledge-index";
import {
  LOCAL_ONLY_V2_DEFAULT_EVIDENCE_SELECTION_POLICY,
  selectLocalOnlyV2EvidenceByBlock,
  type LocalOnlyV2BlockEvidencePacket,
  type LocalOnlyV2EvidenceSelectionPolicy,
} from "./local-only-v2-evidence-selector";
import { getLocalOnlyV2NextExecutableBlock, type LocalOnlyV2SequentialBlockExecution } from "./local-only-v2-sequential-block-contract";
import type { LocalOnlyV2TemplateGenerationPlan } from "./local-only-v2-template-planner";

export function requireLocalOnlyV2ProcessingBlock(
  execution: LocalOnlyV2SequentialBlockExecution,
  plan: LocalOnlyV2TemplateGenerationPlan,
) {
  getLocalOnlyV2NextExecutableBlock(execution); // Validates the certified state contract.
  const active = execution.blocks.find((block) => block.blockId === execution.activeBlockId);
  const expected = plan.blocks.find((block) => block.blockId === active?.blockId);
  if (plan.pipelineId !== "LOCAL_ONLY_V2" || execution.templatePlanFingerprint !== plan.planFingerprint ||
      execution.blockTotal !== plan.blocks.length || !active || !expected || active.status !== "PROCESSING") {
    throw new Error("LOCAL_ONLY_V2 requiere un único punto PROCESSING del plan exacto.");
  }
  for (const key of ["blockId", "blockNumber", "blockTotal", "sectionKey", "sectionOrder", "title", "required", "guidance"] as const) {
    if (active[key] !== expected[key]) throw new Error(`LOCAL_ONLY_V2: metadata distinta: ${key}.`);
  }
  return expected;
}

export function prepareLocalOnlyV2EvidenceForProcessingBlock(
  execution: LocalOnlyV2SequentialBlockExecution,
  plan: LocalOnlyV2TemplateGenerationPlan,
  knowledge: LocalOnlyV2KnowledgeIndex,
  policy: LocalOnlyV2EvidenceSelectionPolicy = LOCAL_ONLY_V2_DEFAULT_EVIDENCE_SELECTION_POLICY,
): LocalOnlyV2BlockEvidencePacket {
  const active = requireLocalOnlyV2ProcessingBlock(execution, plan);
  const scopedPlan = { ...plan, blocks: [active] };
  const selected = selectLocalOnlyV2EvidenceByBlock(scopedPlan, knowledge, policy).blocks[0];
  if (!selected) throw new Error("LOCAL_ONLY_V2 no produjo el paquete del punto activo.");
  // No relevant evidence means no selected facts, including unrelated global guards.
  return selected.relevantFindings.length ? selected :
    selectLocalOnlyV2EvidenceByBlock(scopedPlan, knowledge, { ...policy, maxGuardFindingsPerBlock: 0 }).blocks[0] ?? selected;
}
