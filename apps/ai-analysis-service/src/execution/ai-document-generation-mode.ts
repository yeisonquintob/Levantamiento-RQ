// PASO_0_DOCUMENT_GENERATION_MODE_V1

export const AI_DOCUMENT_GENERATION_MODES = [
  "LOCAL_ONLY",
  "LOCAL_CLOUD",
  "CLOUD_ONLY",
] as const;

export type AiDocumentGenerationMode =
  (typeof AI_DOCUMENT_GENERATION_MODES)[number];

export function resolveAiDocumentGenerationMode(
  useLocalAi: boolean,
  useCloudAi: boolean,
): AiDocumentGenerationMode {
  if (useLocalAi && useCloudAi) return "LOCAL_CLOUD";
  if (useLocalAi) return "LOCAL_ONLY";
  if (useCloudAi) return "CLOUD_ONLY";

  throw new Error(
    "La generación documental requiere IA local, IA nube o ambas.",
  );
}

// PASO_4_BLINDAJE_FRONTERAS_TRES_MODOS_V2
export type AiDocumentFinalProvider =
  "OLLAMA" | "OPENAI" | "ANTHROPIC" | "GEMINI" | "GROQ" | "CEREBRAS";

export interface AiDocumentGenerationBoundaryState {
  mode: AiDocumentGenerationMode;
  provider: string;
  hasKnowledgeSnapshot: boolean;
  snapshotPromptReady: boolean;
}

export function assertAiDocumentGenerationBoundary(
  state: AiDocumentGenerationBoundaryState,
): void {
  const expectedProviders: readonly AiDocumentFinalProvider[] =
    state.mode === "LOCAL_ONLY"
      ? ["OLLAMA"]
      : ["OPENAI", "ANTHROPIC", "GEMINI", "GROQ", "CEREBRAS"];

  if (!(expectedProviders as readonly string[]).includes(state.provider)) {
    throw new Error(
      `Frontera de generación inválida: ${state.mode} requiere proveedor final ${expectedProviders.join(" o ")}, no ${state.provider}.`,
    );
  }

  const requiresLocalSnapshot = state.mode !== "CLOUD_ONLY";

  if (requiresLocalSnapshot && !state.hasKnowledgeSnapshot) {
    throw new Error(
      `Frontera de generación inválida: ${state.mode} requiere snapshot local.`,
    );
  }

  if (!requiresLocalSnapshot && state.hasKnowledgeSnapshot) {
    throw new Error(
      "Frontera de generación inválida: CLOUD_ONLY no debe construir ni consumir snapshot local.",
    );
  }

  if (requiresLocalSnapshot && !state.snapshotPromptReady) {
    throw new Error(
      `Frontera de generación inválida: ${state.mode} debe generar el documento desde el snapshot local.`,
    );
  }
}
