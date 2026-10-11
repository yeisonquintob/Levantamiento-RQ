import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { conciseFunctionalStoryDescription } from "../../libs/shared/contracts/src/lib/ai-analysis.js";

test("separa la descripción funcional de la narrativa Como Quiero Para", () => {
  const description = conciseFunctionalStoryDescription({
    title: "Estandarizar proceso compra de herramientas",
    description:
      "COMO responsable del proceso de compra de herramientas, QUIERO estandarizar el proceso de compra de herramientas, incluyendo catálogo, códigos, aprobaciones y definición de recepción, PARA contar con un flujo uniforme y controlado para compras de herramientas.",
    want: "estandarizar el proceso de compra de herramientas, incluyendo catálogo, códigos, aprobaciones y definición de recepción",
  });

  assert.equal(
    description,
    "Estandarizar el proceso de compra de herramientas, incluyendo catálogo, códigos, aprobaciones y definición de recepción.",
  );
  assert.doesNotMatch(description, /\bCOMO\b|\bQUIERO\b|\bPARA\b/iu);
});

test("conserva una descripción correcta y la limita a una oración breve", () => {
  assert.equal(
    conciseFunctionalStoryDescription({
      description: "Permite registrar la solicitud desde el portal",
      title: "Registrar solicitud",
      want: "registrar una solicitud",
    }),
    "Permite registrar la solicitud desde el portal.",
  );

  const longDescription = conciseFunctionalStoryDescription({
    description: "Validar ".repeat(80),
    title: "Validar información",
    want: "validar información",
  });
  assert.ok(longDescription.length <= 221);
  assert.match(longDescription, /…$/u);
});

test("el prompt exige una descripción corta distinta de Como Quiero Para", async () => {
  const promptBuilder = await readFile(
    "apps/ai-analysis-service/src/execution/ai-prompt-builder.ts",
    "utf8",
  );

  assert.match(
    promptBuilder,
    /description debe ser una descripción funcional corta/u,
  );
  assert.match(
    promptBuilder,
    /nunca debe incluir ni concatenar COMO, QUIERO o PARA/u,
  );
  assert.match(promptBuilder, /idealmente hasta 180 caracteres/u);
});
