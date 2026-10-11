import assert from "node:assert/strict";
import test from "node:test";

import { splitLocalSourceText } from "../../apps/ai-analysis-service/src/local-ai/ollama-source-analyzer.service.js";

test("el preanálisis local divide una fuente usando segmentos máximos de 8.000 caracteres", () => {
  assert.deepEqual(
    splitLocalSourceText("x".repeat(7_999)).map((part) => part.length),
    [7_999],
  );

  assert.deepEqual(
    splitLocalSourceText("x".repeat(8_000)).map((part) => part.length),
    [8_000],
  );

  assert.deepEqual(
    splitLocalSourceText("x".repeat(8_001)).map((part) => part.length),
    [8_000, 1],
  );

  const parts = splitLocalSourceText("x".repeat(21_680));

  assert.deepEqual(
    parts.map((part) => part.length),
    [8_000, 8_000, 5_680],
  );

  assert.equal(parts.join("").length, 21_680);
});

test("la reducción de segmento no cambia el contenido total de la fuente", () => {
  const source =
    "Primera línea\nSegunda línea\n\n" + "contenido ".repeat(2_000);

  const parts = splitLocalSourceText(source);

  assert.equal(parts.join(""), source);
  assert.ok(parts.every((part) => part.length <= 8_000));
});
