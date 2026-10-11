import assert from "node:assert/strict";
import test from "node:test";

import { advanceProjectLifecycleStatus } from "../../libs/shared/contracts/src/lib/projects";

test("las transiciones automáticas nunca retroceden", () => {
  assert.equal(
    advanceProjectLifecycleStatus("EXECUTION", "SOURCES"),
    "EXECUTION",
  );
  assert.equal(
    advanceProjectLifecycleStatus("DRAFT", "DISCUSSION"),
    "DISCUSSION",
  );
  assert.equal(
    advanceProjectLifecycleStatus("ARCHIVED", "COMPLETED"),
    "ARCHIVED",
  );
});


test("una nueva versión vuelve a Documento generado incluso después de aprobar", () => {
  for (const status of ["VALIDATION", "APPROVED", "EXECUTION", "COMPLETED"] as const) {
    assert.equal(advanceProjectLifecycleStatus(status, "DOCUMENT_GENERATED"), "DOCUMENT_GENERATED");
  }
  assert.equal(advanceProjectLifecycleStatus("ARCHIVED", "DOCUMENT_GENERATED"), "ARCHIVED");
  assert.equal(advanceProjectLifecycleStatus("APPROVED", "SOURCES"), "APPROVED");
});
