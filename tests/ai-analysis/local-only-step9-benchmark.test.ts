import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { runLocalOnlyStep9Benchmark } from "../../scripts/local-only-step9-benchmark.js";

const benchmarkReport = runLocalOnlyStep9Benchmark({ writeReports: false });

test("Paso 9: benchmark determinístico aprueba todos los gates", async () => {
  const report = await benchmarkReport;

  assert.equal(report.schemaVersion, "LOCAL_ONLY_STEP9_BENCHMARK_V1");
  assert.equal(report.mode, "DETERMINISTIC_NO_NETWORK");
  assert.equal(report.status, "PASS");
  assert.ok(report.gates.length >= 10);
  assert.equal(report.gates.filter((gate) => !gate.pass).length, 0);
});

test("Paso 9: el benchmark demuestra reparación localizada con una sola llamada extra", async () => {
  const report = await benchmarkReport;

  assert.equal(report.deltas.backlogRepairExtraCalls, 1);
  assert.deepEqual(report.deltas.backlogRepairChangedPaths, {
    "structuredAnalysis.backlogStructure": 1,
  });

  assert.equal(report.deltas.scopeKpiRepairExtraCalls, 1);
  assert.deepEqual(report.deltas.scopeKpiRepairChangedPaths, {
    "sections.scope": 1,
  });
});

test("Paso 9: benchmark conserva calidad, trazabilidad y presupuesto de contexto", async () => {
  const report = await benchmarkReport;
  const baseline = report.scenarios.baseline;

  assert.equal(baseline.contractValid, true);
  assert.equal(baseline.exactFixtureMatch, true);
  assert.equal(baseline.traceabilityPercent, 100);
  assert.deepEqual(baseline.unknownSourceIds, []);
  assert.equal(baseline.functionalPlanningAligned, true);
  assert.ok(baseline.evidenceReductionPercent > 0);
  assert.ok(baseline.maxContextFootprintTokens <= report.codeState.contextCap);
});

test("Paso 9: no modifica las fronteras productivas de Pasos 6-8", async () => {
  const [pipeline, provider, stages, client, discussion] = await Promise.all([
    readFile(
      "apps/ai-analysis-service/src/local-ai/local-ai-pipeline.service.ts",
      "utf8",
    ),
    readFile(
      "apps/ai-analysis-service/src/execution/ollama-draft.provider.ts",
      "utf8",
    ),
    readFile(
      "apps/ai-analysis-service/src/execution/local-draft-stages.ts",
      "utf8",
    ),
    readFile("apps/ai-analysis-service/src/local-ai/ollama.client.ts", "utf8"),
    readFile(
      "apps/ai-analysis-service/src/discussion/requirement-discussion.service.ts",
      "utf8",
    ),
  ]);

  assert.match(pipeline, /PASO_6_SNAPSHOT_LOCAL_COMPACTO_VERIFICABLE_V1/u);
  assert.match(provider, /PASO_7_CONTEXTO_ESPECIALIZADO_POR_PUNTO_V2/u);
  assert.match(stages, /PASO_8_REPARACION_LOCALIZADA_V2/u);
  assert.doesNotMatch(stages, /regenerateDependents/u);
  assert.match(provider, /LOCAL_DRAFT_OUTPUT_CAP = 8192/u);
  assert.match(client, /OLLAMA_RUNTIME_CONTEXT_CAP = 65_536/u);
  assert.match(discussion, /structuredTransport:\s*"GENERATE"/u);
});
