export const AI_PRICING_VERSION = "openai-2026-08-20";

interface TokenPrice {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  longContextThreshold?: number;
  longContextInputMultiplier?: number;
  longContextOutputMultiplier?: number;
}

const OPENAI_TOKEN_PRICES: Readonly<Record<string, TokenPrice>> = {
  "gpt-5.4": {
    inputUsdPerMillion: 2.5,
    outputUsdPerMillion: 15,
    longContextThreshold: 272_000,
    longContextInputMultiplier: 2,
    longContextOutputMultiplier: 1.5,
  },
  "gpt-5.4-mini": { inputUsdPerMillion: 0.75, outputUsdPerMillion: 4.5 },
  "gpt-5.4-nano": { inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.25 },
  "gpt-5": { inputUsdPerMillion: 1.25, outputUsdPerMillion: 10 },
  "gpt-5-mini": { inputUsdPerMillion: 0.25, outputUsdPerMillion: 2 },
  "gpt-5-nano": { inputUsdPerMillion: 0.05, outputUsdPerMillion: 0.4 },
};

function canonicalModel(model: string): string | null {
  const normalized = model.trim().toLowerCase();
  return Object.keys(OPENAI_TOKEN_PRICES)
    .sort((left, right) => right.length - left.length)
    .find((candidate) =>
      normalized === candidate || normalized.startsWith(`${candidate}-`),
    ) ?? null;
}

export interface AiCostCalculation {
  pricingVersion: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: string;
}

export function calculateOpenAiTokenCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): AiCostCalculation {
  if (!Number.isInteger(inputTokens) || inputTokens < 0) {
    throw new Error("inputTokens debe ser un entero no negativo.");
  }
  if (!Number.isInteger(outputTokens) || outputTokens < 0) {
    throw new Error("outputTokens debe ser un entero no negativo.");
  }

  const canonical = canonicalModel(model);
  if (!canonical) {
    throw new Error(`No existe precio versionado para el modelo ${model}.`);
  }
  const price = OPENAI_TOKEN_PRICES[canonical];
  if (!price) throw new Error(`No existe precio para ${canonical}.`);

  const longContext =
    price.longContextThreshold !== undefined &&
    inputTokens > price.longContextThreshold;
  const inputRate =
    price.inputUsdPerMillion *
    (longContext ? price.longContextInputMultiplier ?? 1 : 1);
  const outputRate =
    price.outputUsdPerMillion *
    (longContext ? price.longContextOutputMultiplier ?? 1 : 1);
  const cost =
    (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000;

  return {
    pricingVersion: AI_PRICING_VERSION,
    model: canonical,
    inputTokens,
    outputTokens,
    costUsd: cost.toFixed(8),
  };
}
