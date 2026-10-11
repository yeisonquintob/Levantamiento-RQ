import assert from "node:assert/strict";
import test from "node:test";

import {
  sanitizeVisualFormatContent,
  VISUAL_FORMAT_NOT_APPLICABLE,
} from "../../apps/ai-analysis-service/src/execution/visual-format-content";

test("quita la frase con nombres internos y conserva el resto", () => {
  assert.equal(
    sanitizeVisualFormatContent(
      "No aplica prototipo visual en esta etapa; prototypeMarkdown permanece en null.",
    ),
    VISUAL_FORMAT_NOT_APPLICABLE,
  );
  assert.equal(
    sanitizeVisualFormatContent(
      "Usar tablas compactas. El campo prototypeMarkdown es null. Mantener jerarquía visual.",
    ),
    "Usar tablas compactas. Mantener jerarquía visual.",
  );
});

test("no modifica un texto limpio ni un valor que no es texto", () => {
  assert.equal(
    sanitizeVisualFormatContent("Prototipo: flujo de solicitud en tres pantallas."),
    "Prototipo: flujo de solicitud en tres pantallas.",
  );
  const value = { a: 1 };
  assert.equal(sanitizeVisualFormatContent(value), value);
});
