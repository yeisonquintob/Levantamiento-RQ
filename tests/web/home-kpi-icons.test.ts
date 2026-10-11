import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync("libs/shared/ui/src/styles.css", "utf8");
const start = css.indexOf("/* HOME_KPI_ICONS_V2");
const end = css.indexOf("@media (prefers-reduced-motion", start);
const block = css.slice(start, end);
const rules = block.replace(/\/\*[\s\S]*?\*\//g, "");

test("los iconos KPI de Inicio están acotados a Inicio y a sus tres variantes", () => {
  assert.ok(start >= 0 && end > start);

  const selectors = [...rules.matchAll(/^([^{}@\s][^{}]*)\{/gm)].map((m) =>
    m[1].trim(),
  );
  for (const selector of selectors) {
    assert.match(selector, /^\.rq-home-workspace /);
  }

  const variants = selectors
    .map((s) => s.match(/\.rq-home-icon--(\w+)/)?.[1])
    .filter(Boolean);
  assert.deepEqual(variants, ["projects", "drafts", "progress"]);
});

test("el icono KPI de Inicio es de tamaño fijo, con borde sutil y trazo 2", () => {
  assert.match(block, /width: 40px;\s*height: 40px;/);
  assert.match(block, /box-sizing: border-box;/);
  assert.match(block, /flex: 0 0 40px;/);
  assert.match(block, /stroke-width: 2;/);
  assert.equal(block.match(/border: 1px solid color-mix/g)?.length, 3);
});

test("el KPI genérico no se modifica en el bloque de Inicio", () => {
  assert.doesNotMatch(rules, /^\.rq-kpi(-grid)?\s*[{,]/);
  assert.doesNotMatch(rules, /^\.rq-kpi__icon/m);
});
