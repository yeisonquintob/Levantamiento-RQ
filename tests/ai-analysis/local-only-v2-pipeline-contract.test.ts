// LOCAL_ONLY_V2_01_PIPELINE_CONTRACT
import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_DOCUMENT_GENERATION_MODES,
  resolveAiDocumentGenerationMode,
} from "../../apps/ai-analysis-service/src/execution/ai-document-generation-mode.js";
import {
  isLocalOnlyV2EligibleGenerationMode,
  LOCAL_ONLY_V2_ENTRY_MODE,
  LOCAL_ONLY_V2_PIPELINE_ID,
  requireLocalOnlyV2Pipeline,
  resolveLocalOnlyV2Pipeline,
} from "../../apps/ai-analysis-service/src/execution/local-only-v2-pipeline.js";

test("Paso 1 formaliza LOCAL_ONLY_V2 sin convertirlo en un cuarto modo documental", () => {
  assert.equal(LOCAL_ONLY_V2_PIPELINE_ID, "LOCAL_ONLY_V2");
  assert.equal(LOCAL_ONLY_V2_ENTRY_MODE, "LOCAL_ONLY");
  assert.deepEqual(AI_DOCUMENT_GENERATION_MODES, [
    "LOCAL_ONLY",
    "LOCAL_CLOUD",
    "CLOUD_ONLY",
  ]);
  assert.equal(
    (AI_DOCUMENT_GENERATION_MODES as readonly string[]).includes(
      LOCAL_ONLY_V2_PIPELINE_ID,
    ),
    false,
  );
});

test("solo LOCAL_ONLY es elegible para entrar a LOCAL_ONLY_V2", () => {
  const localOnly = resolveAiDocumentGenerationMode(true, false);
  const localCloud = resolveAiDocumentGenerationMode(true, true);
  const cloudOnly = resolveAiDocumentGenerationMode(false, true);

  assert.equal(isLocalOnlyV2EligibleGenerationMode(localOnly), true);
  assert.equal(isLocalOnlyV2EligibleGenerationMode(localCloud), false);
  assert.equal(isLocalOnlyV2EligibleGenerationMode(cloudOnly), false);

  const contract = resolveLocalOnlyV2Pipeline(localOnly);
  assert.deepEqual(contract, {
    pipelineId: "LOCAL_ONLY_V2",
    generationMode: "LOCAL_ONLY",
    contractVersion: 1,
  });
  assert.equal(Object.isFrozen(contract), true);
});

test("LOCAL_CLOUD y CLOUD_ONLY permanecen fuera del nuevo pipeline", () => {
  assert.equal(resolveLocalOnlyV2Pipeline("LOCAL_CLOUD"), null);
  assert.equal(resolveLocalOnlyV2Pipeline("CLOUD_ONLY"), null);
});

test("el guard de entrada rechaza cualquier modo distinto de LOCAL_ONLY", () => {
  assert.doesNotThrow(() => requireLocalOnlyV2Pipeline("LOCAL_ONLY"));
  assert.throws(
    () => requireLocalOnlyV2Pipeline("LOCAL_CLOUD"),
    /admite únicamente LOCAL_ONLY/u,
  );
  assert.throws(
    () => requireLocalOnlyV2Pipeline("CLOUD_ONLY"),
    /admite únicamente LOCAL_ONLY/u,
  );
});
