import assert from "node:assert/strict";
import test from "node:test";

import type { AiAnalysisTokenEstimateResponse } from "@levantamiento-rq/shared-contracts";

import { buildTokenBreakdownRows } from "../../apps/web/src/app/workspace/sources/source-token-breakdown";

const base: AiAnalysisTokenEstimateResponse = {
  sourceCount: 1,
  promptCharacters: 24_000,
  estimatedInputTokens: 6_000,
  maxInputTokens: 100_000,
  remainingTokens: 94_000,
  usagePercentage: 6,
  canProcess: true,
  model: "modelo-nube",
  estimateMethod: "CHARACTERS_DIVIDED_BY_4",
  originalTokens: 5_420,
  localAnalysisTokens: null,
  consolidatedTokens: null,
  reductionPercentage: null,
  openAiInputTokens: 6_000,
  openAiOutputTokens: null,
};

const row = (rows: ReturnType<typeof buildTokenBreakdownRows>, key: string) =>
  rows.find((item) => item.key === key)!;

test("antes de consolidar: local conocido, reducción y contexto pendientes", () => {
  const rows = buildTokenBreakdownRows(base, { usesCloud: true });
  assert.deepEqual(
    rows.map((item) => item.key),
    [
      "local",
      "local-result",
      "reduced",
      "remaining",
      "cloud",
      "cloud-available",
    ],
  );
  assert.match(row(rows, "local").value, /^5\.420 tokens$/u);
  assert.equal(row(rows, "reduced").value, "pendiente");
  assert.equal(row(rows, "reduced").tone, "muted");
  assert.equal(row(rows, "remaining").value, "pendiente");
  assert.match(row(rows, "cloud").value, /^6\.000 tokens$/u);
  assert.match(
    row(rows, "cloud-available").value,
    /^94\.000 tokens de 100\.000$/u,
  );
});

test("después de consolidar: muestra lo reducido, lo que queda y la nube", () => {
  const rows = buildTokenBreakdownRows(
    {
      ...base,
      localAnalysisTokens: 3_100,
      consolidatedTokens: 2_000,
      reductionPercentage: 63.1,
      openAiInputTokens: 2_700,
      estimatedInputTokens: 2_700,
      remainingTokens: 97_300,
    },
    { usesCloud: true },
  );
  assert.equal(row(rows, "local-result").value, "3.100 tokens");
  assert.equal(row(rows, "reduced").value, "3.420 tokens (63.1 %)");
  assert.equal(row(rows, "remaining").value, "2.000 tokens");
  assert.equal(row(rows, "cloud").value, "2.700 tokens");
});

test("si el contexto consolidado crece no se afirma una reducción", () => {
  const rows = buildTokenBreakdownRows(
    { ...base, consolidatedTokens: 6_500, reductionPercentage: -19.9 },
    { usesCloud: true },
  );
  assert.equal(row(rows, "reduced").value, "sin reducción");
  assert.equal(row(rows, "reduced").tone, "warning");
});

test("la entrada a la nube sobre el límite se marca como advertencia", () => {
  const rows = buildTokenBreakdownRows(
    {
      ...base,
      canProcess: false,
      remainingTokens: 0,
      openAiInputTokens: 120_000,
    },
    { usesCloud: true },
  );
  assert.equal(row(rows, "cloud").tone, "warning");
  assert.equal(row(rows, "cloud-available").tone, "warning");
});

test("sin nube (solo local) no se muestran filas de nube", () => {
  const rows = buildTokenBreakdownRows(base, { usesCloud: false });
  assert.deepEqual(
    rows.map((item) => item.key),
    ["local", "local-result", "reduced", "remaining"],
  );
});
