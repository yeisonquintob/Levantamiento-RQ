import { randomUUID } from "node:crypto";
import type { Repository } from "typeorm";
import { LocalDraftBlockCheckpointEntity } from "../analysis/local-draft-block-checkpoint.entity";
import type { LocalOnlyV2PointCheckpoint, LocalOnlyV2PointCheckpointStore } from "./local-only-v2-checkpoint-resume";
import { localOnlyV2Fingerprint } from "./local-only-v2-sequential-block-generator";

/** Uses existing JSON/text columns; V2 rows never share legacy block keys. */
export class LocalOnlyV2PersistentStore implements LocalOnlyV2PointCheckpointStore {
  constructor(private readonly rows: Repository<LocalDraftBlockCheckpointEntity>, private readonly requestId: string) {}

  async read(key: string): Promise<unknown | null> {
    const row = await this.rows.findOneBy({ analysisRequestId: this.requestId, blockKey: `v2:${localOnlyV2Fingerprint(key)}` });
    if (!row?.stageValuesJson || row.schemaVersion !== "LOCAL_ONLY_V2:1") return null;
    return JSON.parse(row.stageValuesJson) as unknown;
  }

  async write(key: string, value: unknown, point?: LocalOnlyV2PointCheckpoint): Promise<void> {
    const blockKey = `v2:${localOnlyV2Fingerprint(key)}`;
    const existing = await this.rows.findOneBy({ analysisRequestId: this.requestId, blockKey });
    const now = new Date();
    await this.rows.save({
      id: existing?.id ?? randomUUID(), analysisRequestId: this.requestId, blockKey,
      blockNumber: point?.blockNumber ?? 1, blockTotal: point?.blockTotal ?? 1,
      blockLabel: point?.title ?? point?.sectionKey ?? "LOCAL_ONLY_V2 evidence cache",
      status: point?.status ?? "COMPLETED", schemaVersion: "LOCAL_ONLY_V2:1",
      stageValuesJson: JSON.stringify(value), completedAt: point ? (point.completedAt ? new Date(point.completedAt) : null) : now,
      createdAt: existing?.createdAt ?? now, updatedAt: now,
    });
  }

  async load(blockId: string): Promise<LocalOnlyV2PointCheckpoint | null> {
    const value = await this.read(`point:${blockId}`);
    if (value === null) return null;
    if (typeof value !== "object" || !("pipelineId" in value) || value.pipelineId !== "LOCAL_ONLY_V2" ||
        !("blockId" in value) || value.blockId !== blockId || !("units" in value) || !Array.isArray(value.units)) {
      throw new Error("Checkpoint LOCAL_ONLY_V2 corrupto.");
    }
    return value as LocalOnlyV2PointCheckpoint;
  }

  async save(checkpoint: LocalOnlyV2PointCheckpoint): Promise<void> {
    await this.write(`point:${checkpoint.blockId}`, checkpoint, checkpoint);
  }
}
