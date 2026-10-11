import type { AiAnalysisRequestSummary } from "@levantamiento-rq/shared-contracts";

import {
  aiGenerationModeLabel,
  resolveAiGenerationMode,
} from "./ai-generation-mode";

/**
 * Etiqueta corta usada, entre otros, en la columna "IA utilizada" de la
 * tabla de proyectos. Usa siempre el nombre del modo canónico ("IA local",
 * "Híbrido", "IA nube") en vez de listar interruptores encendidos/apagados
 * o concatenar "IA local · modelo + IA nube · modelo" para el híbrido.
 *
 * Ejemplos:
 * - "IA local · qwen3.5:9b"
 * - "Híbrido · qwen3.5:9b + gpt-5.4"
 * - "IA nube · gpt-5.4"
 */
export function aiGenerationLabel(
  analysis: Pick<AiAnalysisRequestSummary, "engines" | "models" | "model">,
): string {
  const engines = analysis.engines ?? [];
  const mode = resolveAiGenerationMode(engines);

  if (!mode) {
    return analysis.model ? `IA · ${analysis.model}` : "IA no registrada";
  }

  const models = engines
    .map((engine) => analysis.models?.[engine])
    .filter((model): model is string => Boolean(model));

  const modelSuffix = models.length > 0 ? models.join(" + ") : null;
  const modeLabel = aiGenerationModeLabel(mode);
  return modelSuffix ? `${modeLabel} · ${modelSuffix}` : modeLabel;
}
