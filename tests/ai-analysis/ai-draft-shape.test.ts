import assert from "node:assert/strict";
import test from "node:test";

import { summarizeDraftShape } from "../../apps/ai-analysis-service/src/execution/ai-draft-shape";

test("el resumen estructural cuenta elementos y nunca incluye texto del documento", () => {
  const secret = "TEXTO CONFIDENCIAL DEL CLIENTE";
  const shape = summarizeDraftShape({
    schemaVersion: "4.1.0",
    structuredAnalysis: {
      backlogStructure: {
        structureStatus: "AI_SUGGESTED",
        epics: [],
      },
      functionalUserStories: [
        { title: secret, acceptanceCriteria: [{ given: secret }, { given: secret }] },
        { title: secret, acceptanceCriteria: [] },
      ],
    },
    sections: [{ content: secret }],
  });
  assert.equal(shape.schemaVersion, "4.1.0");
  assert.equal(shape["structuredAnalysis.backlogStructure.structureStatus"], "AI_SUGGESTED");
  assert.equal(shape["structuredAnalysis.backlogStructure.epics"], 0);
  assert.equal(shape["structuredAnalysis.functionalUserStories"], 2);
  assert.equal(
    shape["structuredAnalysis.functionalUserStories[].acceptanceCriteria"],
    2,
  );
  assert.equal(shape.sections, 1);
  assert.ok(!JSON.stringify(shape).includes(secret));
});
