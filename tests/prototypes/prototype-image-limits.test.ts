import assert from "node:assert/strict";
import test from "node:test";

import {
  PROTOTYPE_IMAGE_DEFAULT_MAX_BYTES,
  base64Size,
  resolvePrototypeImageBodyLimit,
  resolvePrototypeImageMaxBytes,
} from "../../libs/shared/config/src/lib/prototype-image-limits";

const MB = 1024 * 1024;

test("base64 ocupa 4 caracteres por cada 3 bytes", () => {
  assert.equal(base64Size(3), 4);
  assert.equal(base64Size(4), 8);
  assert.equal(base64Size(20 * MB), Math.ceil((20 * MB) / 3) * 4);
  assert.equal(
    base64Size(20 * MB),
    Buffer.alloc(20 * MB).toString("base64").length,
  );
});

test("el límite HTTP por defecto admite un PNG del tamaño máximo en base64", () => {
  const limit = resolvePrototypeImageBodyLimit({});
  const envelope = JSON.stringify({
    fileName: "01-pantalla-web.png",
    imageBase64: "",
  }).length;
  assert.ok(limit >= base64Size(PROTOTYPE_IMAGE_DEFAULT_MAX_BYTES) + envelope);
  // Antes quedaba en 20 MB fijos: un PNG de 20 MB (26,7 MB en base64) fallaba antes de validarse.
  assert.ok(limit > 20 * MB);
});

test("el límite HTTP sigue a PROTOTYPE_IMAGE_MAX_BYTES y nunca baja de 20 MB", () => {
  assert.ok(
    resolvePrototypeImageBodyLimit({
      PROTOTYPE_IMAGE_MAX_BYTES: String(50 * MB),
    }) >= base64Size(50 * MB),
  );
  assert.equal(
    resolvePrototypeImageBodyLimit({ PROTOTYPE_IMAGE_MAX_BYTES: "1024" }),
    20 * MB,
  );
});

test("un valor inválido de PROTOTYPE_IMAGE_MAX_BYTES usa el valor por defecto", () => {
  for (const value of ["", "abc", "-5", "100", String(51 * MB)]) {
    assert.equal(
      resolvePrototypeImageMaxBytes({ PROTOTYPE_IMAGE_MAX_BYTES: value }),
      PROTOTYPE_IMAGE_DEFAULT_MAX_BYTES,
      value,
    );
  }
  assert.equal(
    resolvePrototypeImageMaxBytes({
      PROTOTYPE_IMAGE_MAX_BYTES: String(10 * MB),
    }),
    10 * MB,
  );
});

test("solo la ruta de importación acepta un cuerpo mayor que el límite general", async () => {
  const { default: Fastify } = await import("fastify");
  const { limitBodyForPrototypeImport } =
    await import("../../libs/shared/config/src/lib/prototype-image-limits");
  const app = Fastify({ bodyLimit: 1024 });
  const importLimit = limitBodyForPrototypeImport(app as never, {});
  app.post("/api/v1/prototypes/generations/:id/images/import", async () => ({
    ok: true,
  }));
  app.post("/api/v1/prototypes/generations", async () => ({ ok: true }));
  app.post("/api/v1/otra/images/import", async () => ({ ok: true }));
  app.get("/api/v1/prototypes/generations/:id/images/import", async () => ({
    ok: true,
  }));
  await app.ready();

  const body = JSON.stringify({
    fileName: "01-login-web.png",
    imageBase64: "A".repeat(4096),
  });
  const headers = { "content-type": "application/json" };
  const send = (url: string) =>
    app.inject({ method: "POST", url, headers, payload: body });

  assert.ok(importLimit > 20 * MB);
  // Importación: pasa el cuerpo de 4 KB aunque el límite general sea de 1 KB.
  assert.equal(
    (await send("/api/v1/prototypes/generations/abc/images/import")).statusCode,
    200,
  );
  // El resto de rutas conserva el límite general.
  assert.equal((await send("/api/v1/prototypes/generations")).statusCode, 413);
  assert.equal((await send("/api/v1/otra/images/import")).statusCode, 413);
  await app.close();
});

test("el límite de importación sigue a PROTOTYPE_IMAGE_MAX_BYTES", async () => {
  const { default: Fastify } = await import("fastify");
  const { limitBodyForPrototypeImport } =
    await import("../../libs/shared/config/src/lib/prototype-image-limits");
  const app = Fastify();
  const limit = limitBodyForPrototypeImport(app as never, {
    PROTOTYPE_IMAGE_MAX_BYTES: String(50 * MB),
  });
  assert.ok(limit >= base64Size(50 * MB));
  await app.close();
});
