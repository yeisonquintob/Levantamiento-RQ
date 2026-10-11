// LOCAL_ONLY_V2_01_PIPELINE_CONTRACT
// LOCAL_ONLY_V2 es un pipeline interno, no un cuarto modo documental.
// Este archivo solo formaliza su contrato de entrada; no cambia la orquestación actual.

import type { AiDocumentGenerationMode } from "./ai-document-generation-mode";

export const LOCAL_ONLY_V2_PIPELINE_ID = "LOCAL_ONLY_V2" as const;
export const LOCAL_ONLY_V2_ENTRY_MODE = "LOCAL_ONLY" as const;

export type LocalOnlyV2PipelineId = typeof LOCAL_ONLY_V2_PIPELINE_ID;
export type LocalOnlyV2EntryMode = typeof LOCAL_ONLY_V2_ENTRY_MODE;

export interface LocalOnlyV2PipelineContract {
  readonly pipelineId: LocalOnlyV2PipelineId;
  readonly generationMode: LocalOnlyV2EntryMode;
  readonly contractVersion: 1;
}

const LOCAL_ONLY_V2_CONTRACT: LocalOnlyV2PipelineContract = Object.freeze({
  pipelineId: LOCAL_ONLY_V2_PIPELINE_ID,
  generationMode: LOCAL_ONLY_V2_ENTRY_MODE,
  contractVersion: 1,
});

export function isLocalOnlyV2EligibleGenerationMode(
  mode: AiDocumentGenerationMode,
): mode is LocalOnlyV2EntryMode {
  return mode === LOCAL_ONLY_V2_ENTRY_MODE;
}

export function resolveLocalOnlyV2Pipeline(
  mode: AiDocumentGenerationMode,
): LocalOnlyV2PipelineContract | null {
  return isLocalOnlyV2EligibleGenerationMode(mode)
    ? LOCAL_ONLY_V2_CONTRACT
    : null;
}

export function requireLocalOnlyV2Pipeline(
  mode: AiDocumentGenerationMode,
): LocalOnlyV2PipelineContract {
  const contract = resolveLocalOnlyV2Pipeline(mode);
  if (!contract) {
    throw new Error(
      `LOCAL_ONLY_V2 admite únicamente LOCAL_ONLY. Modo recibido: ${mode}.`,
    );
  }
  return contract;
}
