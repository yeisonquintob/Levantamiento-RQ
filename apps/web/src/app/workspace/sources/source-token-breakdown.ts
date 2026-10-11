// AI_SOURCES_TOKEN_BREAKDOWN_V1
//
// Desglose del consumo de tokens para el resumen de ejecución en modo Híbrido
// (la IA local compacta las fuentes y la nube redacta con el contexto
// reducido). Solo ordena cifras que ya entrega la estimación del backend.
import type { AiAnalysisTokenEstimateResponse } from "@levantamiento-rq/shared-contracts";

export interface TokenBreakdownRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  // "warning" cuando la cifra supera un límite; "muted" cuando aún no existe.
  readonly tone?: "warning" | "muted";
}

const PENDING = "pendiente";

function tokens(value: number): string {
  return `${Math.round(value).toLocaleString("es-CO")} tokens`;
}

export function buildTokenBreakdownRows(
  estimate: AiAnalysisTokenEstimateResponse,
  options: { readonly usesCloud: boolean },
): readonly TokenBreakdownRow[] {
  const { originalTokens, consolidatedTokens, localAnalysisTokens } = estimate;
  const reduced =
    consolidatedTokens === null
      ? null
      : Math.max(0, originalTokens - consolidatedTokens);
  const grew =
    consolidatedTokens !== null && consolidatedTokens > originalTokens;

  const rows: TokenBreakdownRow[] = [
    {
      key: "local",
      label: "En local (fuentes a analizar)",
      value: tokens(originalTokens),
    },
    {
      key: "local-result",
      label: "Resultado del análisis local",
      value:
        localAnalysisTokens === null ? PENDING : tokens(localAnalysisTokens),
      ...(localAnalysisTokens === null ? { tone: "muted" as const } : {}),
    },
    {
      key: "reduced",
      label: "Tokens reducidos",
      value:
        reduced === null
          ? PENDING
          : grew
            ? "sin reducción"
            : `${tokens(reduced)}${
                estimate.reductionPercentage === null
                  ? ""
                  : ` (${estimate.reductionPercentage.toFixed(1)} %)`
              }`,
      ...(reduced === null ? { tone: "muted" as const } : {}),
      ...(grew ? { tone: "warning" as const } : {}),
    },
    {
      key: "remaining",
      label: "Quedan tras reducir (contexto consolidado)",
      value: consolidatedTokens === null ? PENDING : tokens(consolidatedTokens),
      ...(consolidatedTokens === null ? { tone: "muted" as const } : {}),
    },
  ];

  if (options.usesCloud) {
    rows.push(
      {
        key: "cloud",
        label: "Para la nube (entrada estimada)",
        value: tokens(estimate.openAiInputTokens),
        ...(estimate.canProcess ? {} : { tone: "warning" as const }),
      },
      {
        key: "cloud-available",
        label: "Disponible en la nube",
        value: `${tokens(estimate.remainingTokens)} de ${estimate.maxInputTokens.toLocaleString("es-CO")}`,
        ...(estimate.canProcess ? {} : { tone: "warning" as const }),
      },
    );
  }
  return rows;
}
