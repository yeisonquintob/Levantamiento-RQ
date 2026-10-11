import assert from "node:assert/strict";
import test from "node:test";
import type { AiAnalysisRequestSummary } from "@levantamiento-rq/shared-contracts";
import { latestSourceGeneration } from "../../apps/web/src/app/workspace/sources/sources-project-metrics-cells";

test("el procesamiento muestra la ejecución más reciente aunque exista una anterior completada", () => {
  const previous = {
    analysisType: "REQUIREMENT_DOCUMENT",
    status: "COMPLETED",
    createdAt: "2026-09-14T10:00:00Z",
  } as AiAnalysisRequestSummary;
  for (const status of [
    "PROCESSING",
    "FAILED",
    "COMPLETED",
    "CANCELLED",
  ] as const) {
    const latest = { ...previous, status, createdAt: "2026-09-15T10:00:00Z" };
    assert.equal(latestSourceGeneration([previous, latest])?.status, status);
  }
  assert.equal(latestSourceGeneration([]), undefined);
});
