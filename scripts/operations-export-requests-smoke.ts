import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import dataSource from "../apps/operations-service/src/database/data-source.js";
import {
  ExportArtifactEntity,
  ExportRequestEntity,
} from "../apps/operations-service/src/operations/operation.entities.js";
import { ExportRequestsService } from "../apps/operations-service/src/operations/export-requests.service.js";

async function main(): Promise<void> {
  await dataSource.initialize();
  const exports = dataSource.getRepository(ExportRequestEntity);
  const artifacts = dataSource.getRepository(ExportArtifactEntity);
  const projectId = randomUUID();
  const documentId = randomUUID();
  const versionId = randomUUID();
  const actorId = randomUUID();
  let queueCalls = 0;
  let eventCalls = 0;
  const service = new ExportRequestsService(
    exports,
    artifacts,
    dataSource,
    { requireRead: async () => ({}) } as never,
    {
      requireApprovedVersion: async () => ({
        document: {},
        version: { id: versionId, versionNumber: 1, status: "APPROVED" },
      }),
    } as never,
    {
      enqueue: async () => {
        queueCalls += 1;
      },
    } as never,
    {
      publish: async () => {
        eventCalls += 1;
        return false;
      },
    } as never,
  );
  const context = {
    actor: {
      id: actorId,
      email: "operations-smoke@example.test",
      displayName: "Operations Smoke",
      roles: ["ADMIN"],
      permissions: ["system.admin"],
      mustChangePassword: false,
    },
    accessToken: "temporary-smoke-token",
    correlationId: randomUUID(),
    idempotencyKey: `operations-smoke-${randomUUID()}`,
  };
  let exportId: string | null = null;
  try {
    const created = await service.create(context, projectId, documentId, 1, {
      format: "PDF",
    });
    exportId = created.id;
    assert.equal(created.status, "PENDING");
    assert.equal(created.documentVersionId, versionId);
    const repeated = await service.create(context, projectId, documentId, 1, {
      format: "PDF",
    });
    assert.equal(repeated.id, created.id);
    assert.equal(queueCalls, 1);
    assert.equal(eventCalls, 1);
    const listed = await service.list(context, projectId, documentId);
    assert.equal(listed.totalItems, 1);
    assert.equal(listed.items[0]?.artifact, null);
    console.log("✓ Solicitud PENDING persistida y encolada una sola vez.");
    console.log("✓ Idempotencia y referencias externas verificadas.");
  } finally {
    if (exportId) await exports.delete(exportId);
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(
    `No se pudo validar Operations: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
