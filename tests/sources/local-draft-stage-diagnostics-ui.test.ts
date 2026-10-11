import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Paso 10: contrato público expone diagnóstico opcional sin contenido", async () => {
  const contract = await readFile(
    "libs/shared/contracts/src/lib/ai-analysis.ts",
    "utf8",
  );

  assert.match(
    contract,
    /AiAnalysisLocalDraftBlockOperation[\s\S]*?"GENERATING"[\s\S]*?"REPAIRING"/u,
  );
  assert.match(contract, /currentStagePath\?: string \| null/u);
  assert.match(
    contract,
    /operation\?: AiAnalysisLocalDraftBlockOperation \| null/u,
  );
  assert.match(contract, /repairAttempt\?: number \| null/u);

  assert.doesNotMatch(
    contract,
    /AiAnalysisLocalDraftBlockProgress[\s\S]{0,500}(prompt|response|evidence|context):/u,
  );
});

test("Paso 10: Fuentes muestra stage y reparación dentro del progreso existente", async () => {
  const source = await readFile(
    "apps/web/src/app/workspace/sources/sources-workspace.tsx",
    "utf8",
  );

  assert.match(source, /currentLocalDraftBlock\?\.currentStagePath/u);
  assert.match(source, /currentLocalDraftBlock\.operation === "REPAIRING"/u);
  assert.match(source, /currentLocalDraftBlock\.repairAttempt/u);
  assert.match(source, /currentLocalDraftBlock\.currentStagePath/u);

  // No crea una segunda tarjeta o endpoint de diagnóstico.
  assert.doesNotMatch(source, /local-draft-diagnostics/u);
});

test("Paso 10: Gateway continúa usando el GET existente", async () => {
  const controller = await readFile(
    "apps/gateway/src/analysis/ai-analysis-gateway.controller.ts",
    "utf8",
  );

  assert.match(controller, /@Get\(":analysisRequestId"\)/u);
  assert.doesNotMatch(controller, /local-draft-diagnostics/u);
  assert.doesNotMatch(controller, /stage-diagnostics/u);
});
