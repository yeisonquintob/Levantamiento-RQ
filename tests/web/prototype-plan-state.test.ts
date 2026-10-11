import assert from "node:assert/strict";
import test from "node:test";

import { hasCompletedPrototypePlan } from "../../apps/web/src/app/workspace/prototype/prototype-plan-state";

test("un plan interpretado sigue vigente en los estados posteriores a planificar", () => {
  for (const status of [
    "PLANNED",
    "VISUAL_SPEC_BUILDING",
    "VISUAL_SPEC_READY",
    "IMAGE_GENERATING",
    "COMPLETED",
    "PARTIALLY_COMPLETED",
  ] as const) {
    assert.equal(
      hasCompletedPrototypePlan({ status, totalImages: 0 }),
      true,
      status,
    );
  }
});

test("FAILED con imágenes creadas conserva el plan: solo fallaron las imágenes", () => {
  // Caso real: 7 pantallas × web y móvil, las 14 imágenes fallaron (modelo de Ollama sin instalar).
  assert.equal(
    hasCompletedPrototypePlan({ status: "FAILED", totalImages: 14 }),
    true,
  );
});

test("FAILED sin imágenes significa que falló la interpretación del Markdown", () => {
  assert.equal(
    hasCompletedPrototypePlan({ status: "FAILED", totalImages: 0 }),
    false,
  );
});

test("antes de interpretar no hay plan", () => {
  assert.equal(
    hasCompletedPrototypePlan({ status: "SOURCE_READY", totalImages: 0 }),
    false,
  );
  assert.equal(
    hasCompletedPrototypePlan({ status: "PLANNING", totalImages: 0 }),
    false,
  );
});
