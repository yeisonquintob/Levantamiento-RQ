import assert from "node:assert/strict";
import test from "node:test";
import { checkpointProgress } from "../../apps/ai-analysis-service/src/execution/local-draft-checkpoint-progress";
import type { LocalDraftBlockCheckpointEntity } from "../../apps/ai-analysis-service/src/analysis/local-draft-block-checkpoint.entity";

const row = (value: unknown, overrides = {}) =>
  ({
    blockNumber: 2,
    blockTotal: 12,
    blockKey: "v2:test",
    blockLabel: "Alcance",
    status: "PROCESSING",
    schemaVersion: "LOCAL_ONLY_V2:1",
    stageValuesJson: JSON.stringify(value),
    updatedAt: new Date("2026-09-23T14:00:00Z"),
    ...overrides,
  }) as LocalDraftBlockCheckpointEntity;

test("evidence cache rows cannot inflate completed document points", () => {
  const result = checkpointProgress([
    row({ findings: [] }, { status: "COMPLETED" }),
    row({
      pipelineId: "LOCAL_ONLY_V2",
      blockId: "scope",
      units: [{ unitTotal: 5 }],
    }),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].status, "PROCESSING");
  assert.equal(result[0].completedUnits, 1);
  assert.equal(result[0].totalUnits, 5);
  assert.equal(result[0].updatedAt, "2026-09-23T14:00:00.000Z");
});
test("legacy checkpoints remain visible and malformed V2 rows do not become points", () => {
  const result = checkpointProgress([
    row(null, { schemaVersion: "4.1.0" }),
    row(null, { stageValuesJson: "{" }),
    row({ pipelineId: "LOCAL_ONLY_V2", blockId: "scope", units: [] }),
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[1].completedUnits, 0);
  assert.equal(result[1].totalUnits, undefined);
});
