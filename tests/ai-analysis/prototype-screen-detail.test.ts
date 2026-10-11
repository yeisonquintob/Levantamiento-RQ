import assert from "node:assert/strict";
import test from "node:test";

import { parsePrototypeScreenDetail } from "../../libs/shared/contracts/src/lib/prototypes";
import { parsePrototypeScreenDetailInternalRequest } from "../../apps/ai-analysis-service/src/internal/internal-structured-execution.service";
import {
  PROTOTYPE_SCREEN_DETAIL_SYSTEM_INSTRUCTION,
  buildScreenDetailPrompt,
} from "../../apps/ai-analysis-service/src/internal/prototype-screen-detail-instruction";

const valid = {
  purpose: "PROTOTYPE_SCREEN_DETAIL",
  input: {
    markdown: "# Portal\n## Reportes\n| Código | Periodo |",
    applicationName: "Portal",
    summary: "Consulta operativa",
    menu: ["Inicio", "Reportes"],
    screen: { code: "reportes", name: "Reportes", objective: "Consultar", route: "/reportes", components: ["Tabla"] },
  },
};

test("la solicitud de detalle exige pantalla, menú y Markdown", () => {
  assert.equal(parsePrototypeScreenDetailInternalRequest(valid).input.screen.code, "reportes");
  assert.throws(() => parsePrototypeScreenDetailInternalRequest({ ...valid, purpose: "PROTOTYPE_PLANNING" }), /no es válida/u);
  assert.throws(() => parsePrototypeScreenDetailInternalRequest({ ...valid, input: { ...valid.input, screen: undefined } }), /no es válida/u);
  assert.throws(() => parsePrototypeScreenDetailInternalRequest({ ...valid, input: { ...valid.input, markdown: " " } }), /no es válida/u);
});

test("el resultado de la IA se valida: objetivo y al menos un componente de texto", () => {
  assert.deepEqual(parsePrototypeScreenDetail({ objective: " Flujo ", components: [" Tabla: a "] }), { objective: "Flujo", components: ["Tabla: a"] });
  assert.throws(() => parsePrototypeScreenDetail({ objective: "x", components: [] }));
  assert.throws(() => parsePrototypeScreenDetail({ objective: "", components: ["a"] }));
  assert.throws(() => parsePrototypeScreenDetail({ objective: "x", components: ["a"], extra: 1 }));
});

test("el prompt pone la pantalla como foco y la instrucción no deja inventar", () => {
  const prompt = buildScreenDetailPrompt(valid.input);
  assert.match(prompt, /PANTALLA A DETALLAR\r?\nCódigo: reportes\r?\nNombre: Reportes\r?\nRuta: \/reportes/u);
  assert.match(prompt, /Menú de la aplicación \(otras pantallas\): Inicio \| Reportes/u);
  assert.ok(prompt.endsWith(valid.input.markdown));
  assert.match(PROTOTYPE_SCREEN_DETAIL_SYSTEM_INSTRUCTION, /no inventes/iu);
  assert.match(PROTOTYPE_SCREEN_DETAIL_SYSTEM_INSTRUCTION, /TODAS las columnas/u);
  assert.match(PROTOTYPE_SCREEN_DETAIL_SYSTEM_INSTRUCTION, /pendiente por definir/u);
});
