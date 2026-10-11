import assert from "node:assert/strict";
import test from "node:test";

import { normalizeLocalOnlyV2Sections } from "../../apps/ai-analysis-service/src/execution/local-only-v2-backlog-alignment";
import {
  buildPrototypeRequestBrief,
  isPrototypeRequested,
  PROTOTYPE_STYLE_LINES,
} from "../../apps/ai-analysis-service/src/execution/prototype-request-brief";
import { CORPORATE_DEFAULT_V1 } from "../../apps/prototypes-service/src/visual/prototype-design-system";

const story = (n: number, milestone: string, functionality: string) => ({
  code: `HU-F-00${n}`,
  title: `Función ${n}`,
  want: `capacidad ${n}`,
  role: n % 2 ? "Solicitante" : "Aprobador",
  milestone,
  functionality,
  impactedSystems: ["ERP X"],
  fields: [
    { name: "Placa", required: true },
    { name: "Nota", required: false },
  ],
});
const milestones = {
  functionalRequirements: [
    story(1, "H-001", "Registro"),
    story(2, "H-001", "Registro"),
    story(3, "H-002", "Aprobación"),
  ],
};

test("el estilo del punto 13 coincide con el sistema de diseño de la aplicación", () => {
  const style = PROTOTYPE_STYLE_LINES.join("\n");
  for (const color of [
    CORPORATE_DEFAULT_V1.colors.primary,
    CORPORATE_DEFAULT_V1.colors.primaryDark,
    CORPORATE_DEFAULT_V1.colors.background,
    CORPORATE_DEFAULT_V1.colors.text,
    CORPORATE_DEFAULT_V1.colors.danger,
  ]) {
    assert.ok(style.includes(color), `falta el color ${color}`);
  }
  assert.ok(
    style.includes(`${CORPORATE_DEFAULT_V1.navigation.sidebarWidth} px`),
  );
  assert.ok(style.includes(`${CORPORATE_DEFAULT_V1.tables.rowHeight} px`));
  assert.ok(style.includes(`${CORPORATE_DEFAULT_V1.buttons.minHeight} px`));
  assert.ok(
    style.includes(`${CORPORATE_DEFAULT_V1.buttons.mobileMinHeight} px`),
  );
});

test("lista todos los módulos y funciones del documento y el estilo", () => {
  const brief = buildPrototypeRequestBrief({
    header: { title: "Proyecto Demo" },
    objectives: { general: "Digitalizar la solicitud." },
    scope: { involvedSystems: ["ERP X", "[PENDIENTE POR DEFINIR]"] },
    milestones,
  })!;
  assert.match(brief, /Aplicación: Proyecto Demo\./u);
  assert.match(brief, /Módulo: Registro/u);
  assert.match(brief, /Módulo: Aprobación/u);
  for (const code of ["HU-F-001", "HU-F-002", "HU-F-003"]) {
    assert.ok(brief.includes(code), code);
  }
  assert.match(brief, /Campos: Placa \(obligatorio\), Nota\./u);
  assert.match(brief, /Actores: Solicitante; Aprobador\./u);
  assert.match(brief, /Sistemas e integraciones visibles: ERP X\./u);
  assert.doesNotMatch(brief, /PENDIENTE POR DEFINIR/u);
  assert.match(brief, /ESTILO VISUAL/u);
});

test("sin Requerimientos funcionales no inventa nada", () => {
  assert.equal(
    buildPrototypeRequestBrief({ milestones: { functionalRequirements: [] } }),
    null,
  );
  assert.equal(buildPrototypeRequestBrief({}), null);
});

test("la generación local reemplaza el punto 13 por la solicitud de prototipo", () => {
  const sections = [
    { key: "header", content: { title: "Proyecto Demo" } },
    { key: "milestones", content: milestones },
    { key: "visualFormat", content: "texto corto del modelo" },
  ];
  const result = normalizeLocalOnlyV2Sections(sections, () => undefined, true);
  const visual = result.find((item) => item.key === "visualFormat")!.content;
  assert.equal(typeof visual, "string");
  assert.match(String(visual), /SOLICITUD DE PROTOTIPO/u);
});

test("con Prototipo desactivado el punto 13 no se genera", () => {
  const sections = [
    { key: "header", content: { title: "Proyecto Demo" } },
    { key: "milestones", content: milestones },
    { key: "visualFormat", content: "texto corto del modelo" },
  ];
  const result = normalizeLocalOnlyV2Sections(sections, () => undefined);
  const visual = result.find((item) => item.key === "visualFormat")!.content;
  assert.match(String(visual), /Prototipo no solicitado/u);
  assert.doesNotMatch(String(visual), /SOLICITUD DE PROTOTIPO/u);
});

test("solo se considera solicitado si la instrucción trae la marca de Prototipo", () => {
  assert.equal(isPrototypeRequested("PROTOTYPE_MARKDOWN_V1=ENABLED"), true);
  assert.equal(isPrototypeRequested("otra instrucción"), false);
  assert.equal(isPrototypeRequested(null), false);
});
