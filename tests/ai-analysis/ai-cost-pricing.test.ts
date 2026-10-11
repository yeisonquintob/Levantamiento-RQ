import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_PRICING_VERSION,
  calculateOpenAiTokenCost,
} from "../../apps/ai-analysis-service/src/execution/ai-cost-pricing.js";

test("calcula costo real versionado de gpt-5-mini", () => {
  const result = calculateOpenAiTokenCost("gpt-5-mini", 1_000_000, 1_000_000);
  assert.equal(result.pricingVersion, AI_PRICING_VERSION);
  assert.equal(result.costUsd, "2.25000000");
});

test("acepta snapshots y aplica tarifa larga de gpt-5.4", () => {
  const result = calculateOpenAiTokenCost(
    "gpt-5.4-2026-03-05",
    300_000,
    100_000,
  );
  assert.equal(result.model, "gpt-5.4");
  assert.equal(result.costUsd, "3.75000000");
});

test("rechaza modelos sin precio y conteos inválidos", () => {
  assert.throws(() => calculateOpenAiTokenCost("modelo-desconocido", 1, 1));
  assert.throws(() => calculateOpenAiTokenCost("gpt-5-mini", -1, 1));
});
