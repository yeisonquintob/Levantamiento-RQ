import assert from "node:assert/strict";
import test from "node:test";

import { hasCompletedPrototypePlan } from "../../apps/web/src/app/workspace/prototype/prototype-plan-state";

const base = { totalScreens: 0 };

test("un plan interpretado sigue vigente en los estados posteriores a planificar", () => {
  for (const status of [
    "PLANNED",
    "VISUAL_SPEC_BUILDING",
    "VISUAL_SPEC_READY",
    "IMAGE_GENERATING",
    "COMPLETED",
    "PARTIALLY_COMPLETED",
  ] as const) {
    assert.equal(hasCompletedPrototypePlan({ ...base, status }), true, status);
  }
});

test("FAILED con pantallas conserva el plan: falló algo posterior (imágenes, especificación visual)", () => {
  // Caso real: 5 pantallas y las 10 imágenes fallaron (modelo sin memoria suficiente).
  assert.equal(
    hasCompletedPrototypePlan({ status: "FAILED", totalScreens: 5 }),
    true,
  );
});

test("FAILED sin pantallas significa que falló la interpretación del Markdown", () => {
  assert.equal(
    hasCompletedPrototypePlan({ status: "FAILED", totalScreens: 0 }),
    false,
  );
});

test("antes de interpretar no hay plan", () => {
  assert.equal(
    hasCompletedPrototypePlan({ ...base, status: "SOURCE_READY" }),
    false,
  );
  assert.equal(
    hasCompletedPrototypePlan({ ...base, status: "PLANNING" }),
    false,
  );
});
