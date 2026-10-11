import assert from "node:assert/strict";
import test from "node:test";
import { DocumentsService } from "../../apps/documents-service/src/documents/documents.service.js";

test("el historial incluye versiones existentes con huecos y no carga su contenido", async () => {
  const now = new Date("2026-09-14T12:00:00Z");
  const versions = [7, 5, 1].map((versionNumber) => ({
    id: `version-${versionNumber}`, versionNumber, version: `1.0.${versionNumber - 1}`,
    status: versionNumber === 5 ? "APPROVED" : "DRAFT", revision: 1,
    changeSummary: "Cambio", createdByUserId: "actor", createdAt: now,
    updatedAt: now, approvedByUserId: null, approvedAt: null,
  }));
  const calls: unknown[] = [];
  const service = {
    requireDocument: async (id: string) => { assert.equal(id, "document"); return { projectId: "project" }; },
    projectAccess: async (...args: unknown[]) => { calls.push(args); },
    versions: { find: async (query: unknown) => { calls.push(query); return versions; } },
  };
  const context = { actor: { id: "actor" } };
  const result = await DocumentsService.prototype.listVersions.call(service as never, context as never, "document");
  assert.deepEqual(result.map((version) => version.versionNumber), [7, 5, 1]);
  assert.equal(result[1].status, "APPROVED");
  assert.deepEqual(calls, [[context, "project"], { where: { documentId: "document" }, order: { versionNumber: "DESC" } }]);
});

test("el listado no consulta versiones cuando el usuario no tiene acceso al proyecto", async () => {
  let queried = false;
  const service = {
    requireDocument: async () => ({ projectId: "project" }),
    projectAccess: async () => { throw new Error("Acceso denegado"); },
    versions: { find: async () => { queried = true; return []; } },
  };
  await assert.rejects(DocumentsService.prototype.listVersions.call(service as never, {} as never, "document"), /Acceso denegado/);
  assert.equal(queried, false);
});

test("el total cuenta versiones existentes aunque el consecutivo actual tenga huecos", async () => {
  const service = {
    projectAccess: async () => undefined,
    documents: { find: async () => [{ id: "document", currentVersionNumber: 7 }] },
    loadSummary: async () => ({ id: "document", currentVersionNumber: 7 }),
    versions: { countBy: async (where: unknown) => {
      assert.deepEqual(where, { documentId: "document" });
      return 3;
    } },
  };
  const result = await DocumentsService.prototype.list.call(service as never, {} as never, "project");
  assert.equal(result.items[0]?.currentVersionNumber, 7);
  assert.equal((result.items[0] as { versionCount?: number }).versionCount, 3);
});
