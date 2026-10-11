import assert from "node:assert/strict";
import test from "node:test";

import { appendAiValidationRetryGuidance } from "../../apps/ai-analysis-service/src/execution/ai-prompt-builder";

test("el reintento por KPI sin objetivo trae la regla exacta de relatedObjective", () => {
  const prompt = appendAiValidationRetryGuidance(
    "PROMPT",
    "OPENAI_STRUCTURED_OUTPUT_INVALID",
    "OpenAI devolvió una salida estructurada inconsistente: scope.kpis[0].relatedObjective no referencia de forma inequívoca un objetivo específico cualitativo o cuantitativo generado.",
  );
  assert.match(prompt, /CORRECCIÓN OBLIGATORIA DEL REINTENTO/u);
  assert.match(prompt, /copia exacta, carácter por carácter/u);
  assert.match(prompt, /no uses el objetivo general/u);
});

test("otros errores conservan la guía genérica y sin código no se agrega nada", () => {
  const generic = appendAiValidationRetryGuidance(
    "PROMPT",
    "OPENAI_STRUCTURED_OUTPUT_INVALID",
    "otro motivo",
  );
  assert.match(generic, /contradijo una regla semántica/u);
  assert.doesNotMatch(generic, /carácter por carácter/u);
  assert.equal(appendAiValidationRetryGuidance("PROMPT", null), "PROMPT");
  assert.equal(
    appendAiValidationRetryGuidance("PROMPT", "CODIGO_DESCONOCIDO", "x"),
    "PROMPT",
  );
});
