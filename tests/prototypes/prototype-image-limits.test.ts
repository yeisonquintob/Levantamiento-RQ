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
