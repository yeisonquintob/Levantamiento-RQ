import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  EXPORT_FORMATS,
  EXPORT_STATUSES,
} from "../../libs/shared/contracts/src/index.js";
import {
  parseCreateExport,
  parseVersionNumber,
} from "../../apps/operations-service/src/operations/operations-input.js";
import { loadOperationsAuthConfig } from "../../apps/operations-service/src/operations/operations-auth.config.js";
import { loadOperationsProcessingConfig } from "../../apps/operations-service/src/operations/operations-processing.config.js";

test("el contrato define formatos y estados de exportación", () => {
  assert.deepEqual(EXPORT_FORMATS, ["PDF", "DOCX"]);
  assert.deepEqual(EXPORT_STATUSES, [
    "PENDING",
    "PROCESSING",
    "COMPLETED",
    "FAILED",
    "CANCELLED",
  ]);
  assert.deepEqual(parseCreateExport({ format: "PDF" }), { format: "PDF" });
  assert.throws(() => parseCreateExport({ format: "XLSX" }), /PDF o DOCX/i);
  assert.equal(parseVersionNumber("3"), 3);
  assert.throws(() => parseVersionNumber("0"), /versionNumber/i);
});

test("Operations valida autenticación, servicios y Redis", () => {
  const auth = loadOperationsAuthConfig({
    JWT_ACCESS_SECRET: "operations-test-secret-with-32-characters",
  });
  assert.equal(auth.projectsServiceUrl, "http://127.0.0.1:3002");
  assert.equal(auth.documentsServiceUrl, "http://127.0.0.1:3004");
  assert.throws(() => loadOperationsAuthConfig({}), /32 caracteres/i);
  const processing = loadOperationsProcessingConfig({
    REDIS_PASSWORD: "local-test-password",
  });
  assert.equal(processing.queueName, "rq-exports-v1");
  assert.equal(processing.attempts, 3);
  assert.throws(() => loadOperationsProcessingConfig({}), /REDIS_PASSWORD/);
});

test("RqOperationsDb conserva propiedad y referencias externas sin FK", async () => {
  const migration = await readFile(
    "apps/operations-service/src/database/migrations/1786752000000-CreateOperationsFoundation.ts",
    "utf8",
  );
  for (const table of [
    "ExportRequests",
    "ExportArtifacts",
    "NotificationRequests",
    "NotificationDeliveries",
    "AuditEvents",
    "IntegrationEventInbox",
  ]) {
    assert.match(migration, new RegExp(`dbo\\.${table}`));
  }
  assert.match(migration, /UQ_ExportRequests_Requester_IdempotencyKey/);
  assert.match(migration, /UQ_IntegrationEventInbox_EventId/);
  assert.doesNotMatch(migration, /RqDocumentsDb|RqProjectsDb|RqIdentityDb/);
});

test("la cola no persiste JWT y el servicio exige aprobación e idempotencia", async () => {
  const [queue, service, documentsClient] = await Promise.all([
    readFile(
      "apps/operations-service/src/operations/export-processing.queue.ts",
      "utf8",
    ),
    readFile(
      "apps/operations-service/src/operations/export-requests.service.ts",
      "utf8",
    ),
    readFile(
      "apps/operations-service/src/operations/documents-access.client.ts",
      "utf8",
    ),
  ]);
  assert.doesNotMatch(queue, /accessToken|authorization|Bearer/);
  assert.match(queue, /jobId: exportRequestId/);
  assert.match(service, /x-idempotency-key es obligatorio/);
  assert.match(service, /EXPORT_REQUESTED/);
  assert.match(documentsClient, /version\.status !== "APPROVED"/);
});

test("Operations y Gateway publican las rutas de exportación", async () => {
  const [controller, gateway] = await Promise.all([
    readFile(
      "apps/operations-service/src/operations/export-requests.controller.ts",
      "utf8",
    ),
    readFile(
      "apps/gateway/src/operations/operations-gateway.controller.ts",
      "utf8",
    ),
  ]);
  for (const fragment of [
    "projects/:projectId/documents/:documentId/versions/:versionNumber/exports",
    "projects/:projectId/documents/:documentId/exports",
    "exports/:exportRequestId",
  ]) {
    assert.match(controller, new RegExp(fragment.replaceAll("/", "\\/")));
    assert.match(gateway, new RegExp(fragment.replaceAll("/", "\\/")));
  }
});
