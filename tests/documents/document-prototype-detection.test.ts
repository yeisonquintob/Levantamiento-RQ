import assert from "node:assert/strict";
import test from "node:test";
import { hasPrototypeContent, hasSolutionPrototypeMarkdown } from "../../apps/documents-service/src/documents/documents.service.js";

test("detecta prototipo solo con contenido real en visualFormat", () => {
  assert.equal(hasPrototypeContent(""), false);
  assert.equal(hasPrototypeContent("  "), false);
  assert.equal(hasPrototypeContent("[PENDIENTE POR DEFINIR]"), false);
  assert.equal(hasPrototypeContent("Pendiente de definición"), false);
  assert.equal(hasPrototypeContent("Prototipo no solicitado en esta generación. Actívalo en «Procesamiento IA» para generarlo."), false);
  assert.equal(hasPrototypeContent({ text: "Prototipo no solicitado en esta generación. Actívalo." }), false);
  assert.equal(hasPrototypeContent("Pantalla de listado con filtros y acción principal."), true);
  assert.equal(hasPrototypeContent({ blocks: ["", "Wireframe de captura"] }), true);
});

test("detecta prototipo histórico en solutionProposal.prototypeMarkdown y excluye marcadores", () => {
  assert.equal(hasSolutionPrototypeMarkdown({ prototypeMarkdown: "## Pantalla de pólizas" }), true);
  assert.equal(hasSolutionPrototypeMarkdown({ prototypeMarkdown: "" }), false);
  assert.equal(hasSolutionPrototypeMarkdown({ prototypeMarkdown: "[PENDIENTE POR DEFINIR]" }), false);
  assert.equal(hasSolutionPrototypeMarkdown({ prototypeMarkdown: "Pendiente de definición" }), false);
  assert.equal(hasSolutionPrototypeMarkdown({ prototypeMarkdown: "Prototipo no solicitado en esta generación." }), false);
  assert.equal(hasSolutionPrototypeMarkdown({ content: { prototypeMarkdown: "Pantalla" } }), false);
  assert.equal(hasSolutionPrototypeMarkdown("texto"), false);
});
