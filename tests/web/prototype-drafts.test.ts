import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ensureApprovedPrototypeDrafts } from "../../apps/web/src/app/workspace/prototype/prototype-drafts";

const workspace = readFileSync(
  "apps/web/src/app/workspace/prototype/prototype-workspace.tsx",
  "utf8",
);

const reply = (body: unknown, ok = true) =>
  ({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  }) as unknown as Response;

test("al abrir el módulo se crea un borrador para cada proyecto aprobado con prototipo y sin borrador", async () => {
  const created: Array<Record<string, unknown>> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/v1/projects?")) {
      return reply({
        items: [
          { id: "11111111-1111-4111-8111-111111111111", title: "SOAT", status: "COMPLETED", activityState: "ACTIVE" },
          { id: "22222222-2222-4222-8222-222222222222", title: "Con borrador", status: "APPROVED", activityState: "ACTIVE" },
          { id: "33333333-3333-4333-8333-333333333333", title: "Sin aprobar", status: "DOCUMENT_GENERATED", activityState: "ACTIVE" },
          { id: "44444444-4444-4444-8444-444444444444", title: "Sin prototipo", status: "APPROVED", activityState: "ACTIVE" },
        ],
      });
    }
    if (url.includes("11111111") && url.endsWith("/documents")) {
      return reply({ items: [{ id: "d1", status: "APPROVED", currentVersionNumber: 24, hasPrototype: true }] });
    }
    if (url.includes("44444444") && url.endsWith("/documents")) {
      return reply({ items: [{ id: "d4", status: "APPROVED", currentVersionNumber: 1, hasPrototype: false }] });
    }
    if (url.endsWith("/documents/d1/exports")) {
      return reply({
        items: [{ id: "e1", format: "MARKDOWN", status: "COMPLETED", versionNumber: 24, artifact: { id: "a" } }],
      });
    }
    if (url.endsWith("/exports/e1/download")) return reply("# Documento aprobado");
    if (url.endsWith("/api/v1/prototypes/generations") && init?.method === "POST") {
      created.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return reply({ id: "g1" });
    }
    return reply({}, false);
  }) as typeof fetch;
  try {
    const total = await ensureApprovedPrototypeDrafts([
      { projectId: "22222222-2222-4222-8222-222222222222" } as never,
    ]);
    assert.equal(total, 1);
    assert.equal(created.length, 1);
    assert.equal(created[0]?.projectId, "11111111-1111-4111-8111-111111111111");
    assert.equal(created[0]?.markdown, "# Documento aprobado");
    assert.equal(created[0]?.sourceFileName, "soat.md");
    assert.equal(created[0]?.targetDevice, "RESPONSIVE");
  } finally {
    globalThis.fetch = original;
  }
});

test("el historial de prototipos no filtra por formato y agrupa Desde sobre Hasta en una sola línea", () => {
  assert.doesNotMatch(workspace, /<span>Formato:<\/span>/u);
  assert.doesNotMatch(workspace, /historyFormat/u);
  const order = ["Buscar prototipo:", "Estado:", "Desde:", "Hasta:", "Ordenar:", "Limpiar", "Actualizar"].map(
    (label) => workspace.indexOf(label, workspace.indexOf("rq-prototype-filters")),
  );
  assert.ok(order.every((value, index) => value > 0 && (index === 0 || value > order[index - 1]!)), String(order));
  assert.match(workspace, /rq-prototype-filters__dates/u);
  assert.match(workspace, /ensureApprovedPrototypeDrafts/u);
});
