import assert from "node:assert/strict";
import test from "node:test";

import { PrototypeImageBlobReconciler } from "../../apps/prototypes-service/src/images/prototype-image-blob.reconciler";
import { loadPrototypeImageConfig } from "../../apps/prototypes-service/src/images/prototype-image.config";

const HOUR = 60 * 60_000;
const NOW = new Date("2026-10-12T12:00:00.000Z");
const ago = (milliseconds: number) => new Date(NOW.getTime() - milliseconds);

function build(options: {
  mode: "OFF" | "REPORT" | "DELETE";
  blobs: Array<{ name: string; lastModified: Date }>;
  rows: Array<{ storageKey: string | null; previousStorageKey: string | null }>;
  maxDeletes?: number;
  failDelete?: string;
}) {
  const deleted: string[] = [];
  const storage = {
    async *list() {
      for (const blob of options.blobs) yield blob;
    },
    delete: async (name: string) => {
      if (name === options.failDelete) throw new Error("Blob no disponible");
      deleted.push(name);
    },
  };
  const images = { find: async () => options.rows };
  const reconciler = new PrototypeImageBlobReconciler(
    storage as never,
    images as never,
    {
      blobReconcile: {
        mode: options.mode,
        intervalMs: HOUR,
        graceMs: 24 * HOUR,
        maxDeletesPerRun: options.maxDeletes ?? 200,
      },
    } as never,
  );
  return { reconciler, deleted };
}

const rows = [
  {
    storageKey: "prototypes/g1/web/001-a-v3.png",
    previousStorageKey: "prototypes/g1/web/001-a-v2.png",
  },
  { storageKey: "prototypes/g1/mobile/001-a.png", previousStorageKey: null },
];

test("por defecto la configuración solo informa y no borra", () => {
  const config = loadPrototypeImageConfig({
    AZURE_STORAGE_CONNECTION_STRING: "UseDevelopmentStorage=true",
  });
  assert.equal(config.blobReconcile.mode, "REPORT");
  assert.equal(config.blobReconcile.graceMs, 24 * HOUR);
  assert.throws(
    () =>
      loadPrototypeImageConfig({
        AZURE_STORAGE_CONNECTION_STRING: "x",
        PROTOTYPE_BLOB_RECONCILE_MODE: "BORRAR",
      }),
    /OFF, REPORT o DELETE/u,
  );
  assert.throws(
    () =>
      loadPrototypeImageConfig({
        AZURE_STORAGE_CONNECTION_STRING: "x",
        PROTOTYPE_BLOB_RECONCILE_GRACE_MS: "1000",
      }),
    /PROTOTYPE_BLOB_RECONCILE_GRACE_MS/u,
  );
});

test("REPORT detecta huérfanos antiguos pero no borra nada", async () => {
  const { reconciler, deleted } = build({
    mode: "REPORT",
    rows,
    blobs: [
      { name: "prototypes/g1/web/001-a-v3.png", lastModified: ago(48 * HOUR) },
      { name: "prototypes/g1/web/001-a-v1.png", lastModified: ago(48 * HOUR) },
      { name: "prototypes/g9/web/001-b.png", lastModified: ago(72 * HOUR) },
    ],
  });
  const result = await reconciler.reconcile(NOW);
  assert.deepEqual(
    {
      scanned: result.scanned,
      orphans: result.orphans,
      deleted: result.deleted,
    },
    { scanned: 3, orphans: 2, deleted: 0 },
  );
  assert.deepEqual(deleted, []);
});

test("DELETE borra solo lo no referenciado, antiguo y dentro del tope", async () => {
  const { reconciler, deleted } = build({
    mode: "DELETE",
    rows,
    maxDeletes: 1,
    blobs: [
      { name: "prototypes/g1/web/001-a-v3.png", lastModified: ago(48 * HOUR) }, // actual: se conserva
      { name: "prototypes/g1/web/001-a-v2.png", lastModified: ago(48 * HOUR) }, // anterior: se conserva
      { name: "prototypes/g1/web/001-a-v1.png", lastModified: ago(48 * HOUR) }, // huérfano
      { name: "prototypes/g2/web/002-x.png", lastModified: ago(30 * HOUR) }, // huérfano (excede el tope)
      { name: "prototypes/g3/web/003-y.png", lastModified: ago(2 * HOUR) }, // reciente: subida en curso
    ],
  });
  const result = await reconciler.reconcile(NOW);
  assert.equal(result.orphans, 2);
  assert.equal(result.skippedRecent, 1);
  assert.equal(result.deleted, 1, "respeta el tope por ejecución");
  assert.deepEqual(deleted, ["prototypes/g1/web/001-a-v1.png"]);
});

test("DELETE se detiene si SQL no devuelve referencias y hay archivos", async () => {
  const { reconciler, deleted } = build({
    mode: "DELETE",
    rows: [],
    blobs: [
      { name: "prototypes/g1/web/001-a.png", lastModified: ago(99 * HOUR) },
    ],
  });
  const result = await reconciler.reconcile(NOW);
  assert.match(result.aborted ?? "", /SQL no devolvió referencias/u);
  assert.deepEqual(deleted, []);
});

test("OFF no consulta nada y un borrado fallido no detiene la pasada", async () => {
  const off = build({ mode: "OFF", rows, blobs: [] });
  assert.equal((await off.reconciler.reconcile(NOW)).scanned, 0);

  const { reconciler, deleted } = build({
    mode: "DELETE",
    rows,
    failDelete: "prototypes/g2/web/002-x.png",
    blobs: [
      { name: "prototypes/g2/web/002-x.png", lastModified: ago(48 * HOUR) },
      { name: "prototypes/g4/web/004-z.png", lastModified: ago(48 * HOUR) },
    ],
  });
  const result = await reconciler.reconcile(NOW);
  assert.equal(result.orphans, 2);
  assert.equal(result.deleted, 1);
  assert.deepEqual(deleted, ["prototypes/g4/web/004-z.png"]);
});
