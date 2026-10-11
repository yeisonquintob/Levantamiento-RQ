import { randomUUID } from "node:crypto";

import type { EntityManager } from "typeorm";

import type {
  DocumentJsonValue,
  DocumentStatus,
} from "@levantamiento-rq/shared-contracts";

import {
  DocumentHistoryEntity,
  DocumentVersionEntity,
  RequirementDocumentEntity,
} from "./document.entities";
import { stale } from "./documents-guards";
import { serialize } from "./documents-json";

export async function lockEditableVersion(
  manager: EntityManager,
  version: DocumentVersionEntity,
  expectedRevision: number,
  actorUserId: string,
  now: Date,
  status: "DRAFT" | "CHANGES_REQUESTED",
): Promise<void> {
  const result = await manager
    .createQueryBuilder()
    .update(DocumentVersionEntity)
    .set({
      revision: () => "Revision + 1",
      updatedByUserId: actorUserId,
      updatedAt: now,
    })
    .where("Id = :versionId", { versionId: version.id })
    .andWhere("Revision = :expectedRevision", { expectedRevision })
    .andWhere("Status = :status", { status })
    .execute();
  if (result.affected !== 1) stale();
}

export async function touchDocument(
  manager: EntityManager,
  document: RequirementDocumentEntity,
  actorUserId: string,
  now: Date,
  status: DocumentStatus,
): Promise<void> {
  await manager
    .createQueryBuilder()
    .update(RequirementDocumentEntity)
    .set({
      revision: () => "Revision + 1",
      status,
      updatedByUserId: actorUserId,
      updatedAt: now,
    })
    .where("Id = :documentId", { documentId: document.id })
    .execute();
}

export async function addHistory(
  manager: EntityManager,
  input: {
    documentId: string;
    versionId: string | null;
    eventType: string;
    actorUserId: string;
    details: DocumentJsonValue;
    now: Date;
  },
): Promise<void> {
  await manager.save(
    manager.create(DocumentHistoryEntity, {
      id: randomUUID(),
      documentId: input.documentId,
      versionId: input.versionId,
      eventType: input.eventType,
      actorUserId: input.actorUserId,
      detailsJson: serialize(input.details),
      createdAt: input.now,
    }),
  );
}
