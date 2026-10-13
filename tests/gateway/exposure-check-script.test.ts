import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

/** Ejecuta el script real; la validación del filtro ocurre antes de cualquier petición de red. */
function run(environment: Record<string, string>) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/exposure-check.ts"],
    {
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        TSX_TSCONFIG_PATH: "tsconfig.scripts.json",
        ...environment,
      },
      encoding: "utf8",
      timeout: 60_000,
    },
  );
}

test("un servicio desconocido en EXPOSURE_SERVICES es un error, no un éxito vacío", () => {
  const result = run({ EXPOSURE_SERVICES: "servicio-inexistente" });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /desconocidos: servicio-inexistente/u);
  assert.doesNotMatch(result.stdout, /Toda ruta no pública/u);
});

test("se valida cada nombre aunque otros sean correctos", () => {
  const result = run({ EXPOSURE_SERVICES: "gateway servicio-inexistente" });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /desconocidos: servicio-inexistente/u);
});

test("una lista de servicios vacía es un error", () => {
  for (const value of ["", "   "]) {
    const result = run({ EXPOSURE_SERVICES: value });

    assert.equal(result.status, 1, JSON.stringify(value));
    assert.match(result.stderr, /está vacío/u);
  }
});

test("si el servicio no responde, la comprobación falla y no se da por buena", () => {
  // Un puerto sin nadie escuchando: no se puede leer el contrato, así que no hay nada que dar por válido.
  const result = run({
    EXPOSURE_SERVICES: "gateway",
    EXPOSURE_BASE_PORT: "1",
  });

  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout, /Toda ruta no pública/u);
});
