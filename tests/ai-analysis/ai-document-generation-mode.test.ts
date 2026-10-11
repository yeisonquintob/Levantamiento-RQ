// PASO_0_DOCUMENT_GENERATION_MODE_V1

import assert from "node:assert/strict";
import test from "node:test";

import { resolveAiDocumentGenerationMode } from "../../apps/ai-analysis-service/src/execution/ai-document-generation-mode";

test("resuelve LOCAL_ONLY cuando solo está activa la IA local", () => {
  assert.equal(resolveAiDocumentGenerationMode(true, false), "LOCAL_ONLY");
});

test("resuelve LOCAL_CLOUD cuando están activas IA local y nube", () => {
  assert.equal(resolveAiDocumentGenerationMode(true, true), "LOCAL_CLOUD");
});

test("resuelve CLOUD_ONLY cuando solo está activa la IA nube", () => {
  assert.equal(resolveAiDocumentGenerationMode(false, true), "CLOUD_ONLY");
});

test("rechaza una solicitud sin ningún motor de IA", () => {
  assert.throws(
    () => resolveAiDocumentGenerationMode(false, false),
    /requiere IA local, IA nube o ambas/u,
  );
});
