import type { LocalDraftBlockCheckpointEntity } from "../analysis/local-draft-block-checkpoint.entity";
import type { LocalDraftBlockProgress } from "./local-draft-block-map";

/** Evidence caches share the table, but are not document generation points. */
export function checkpointProgress(
  rows: readonly LocalDraftBlockCheckpointEntity[],
): LocalDraftBlockProgress[] {
  return rows.flatMap((row) => {
    let completedUnits: number | undefined;
    let totalUnits: number | undefined;
    if (row.schemaVersion === "LOCAL_ONLY_V2:1") {
      let value: unknown;
      try {
        value = JSON.parse(row.stageValuesJson ?? "null");
      } catch {
        return [];
      }
      if (
        !value ||
        typeof value !== "object" ||
        !("pipelineId" in value) ||
        value.pipelineId !== "LOCAL_ONLY_V2" ||
        !("blockId" in value) ||
        typeof value.blockId !== "string" ||
        !("units" in value) ||
        !Array.isArray(value.units)
      ) {
        return [];
      }
      completedUnits = value.units.length;
      const firstUnit: unknown = value.units[0];
      if (
        firstUnit &&
        typeof firstUnit === "object" &&
        "unitTotal" in firstUnit &&
        typeof firstUnit.unitTotal === "number" &&
        Number.isInteger(firstUnit.unitTotal) &&
        firstUnit.unitTotal > 0
      ) {
        totalUnits = firstUnit.unitTotal;
      }
    }
    return [
      {
        blockNumber: row.blockNumber,
        blockTotal: row.blockTotal,
        blockKey: row.blockKey,
        blockLabel: row.blockLabel,
        status: row.status,
        updatedAt: row.updatedAt.toISOString(),
        completedUnits,
        totalUnits,
      },
    ];
  });
}
