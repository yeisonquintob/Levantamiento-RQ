import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const uiStylesUrl = new URL(
  "../../libs/shared/ui/src/styles.css",
  import.meta.url,
);

const marker = "RQ ACCIONES COMPACTAS RESPONSIVE V1";

async function readMobileFix(): Promise<string> {
  const styles = await readFile(uiStylesUrl, "utf8");
  const start = styles.indexOf(marker);
  assert.notEqual(start, -1, "falta el bloque de acciones compactas responsive");
  const block = styles.slice(start);
  const mediaStart = block.indexOf("@media (max-width: 760px)");
  assert.notEqual(mediaStart, -1, "falta el breakpoint móvil de 760px");
  return block.slice(mediaStart);
}

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "u").exec(css);
  assert.ok(match, `falta la regla ${selector}`);
  return match[1];
}

const footer = ".rq-validation-project-card > footer";
const footerActions = `${footer} > div`;
const actionsSelector = `${footerActions} > .rq-document-open,\n  ${footerActions} > .rq-action.rq-action--compact`;

test("las acciones compactas no se estiran en móvil", async () => {
  const css = await readMobileFix();
  const body = rule(css, ".rq-action.rq-action--compact");

  assert.match(body, /width:\s*auto;/u);
  assert.match(body, /min-width:\s*0;/u);
  assert.match(body, /height:\s*32px;/u);
  assert.match(body, /max-height:\s*32px;/u);
});

test("el footer de Validación pone la fecha en su propia fila", async () => {
  const css = await readMobileFix();

  assert.match(rule(css, footer), /display:\s*grid;/u);
  assert.match(
    rule(css, footer),
    /grid-template-columns:\s*minmax\(0,\s*1fr\);/u,
  );
  assert.match(rule(css, `${footer} > small`), /grid-column:\s*1 \/ -1;/u);
});

test("las tres acciones de Validación usan tres columnas iguales", async () => {
  const css = await readMobileFix();
  const body = rule(css, footerActions);

  assert.match(body, /display:\s*grid;/u);
  assert.match(
    body,
    /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/u,
  );
  assert.match(body, /width:\s*100%;/u);
  assert.match(body, /min-width:\s*0;/u);
});

test("las acciones de Validación miden 32px, se contraen y no saltan de línea", async () => {
  const css = await readMobileFix();
  const body = rule(css, actionsSelector);

  assert.match(body, /width:\s*100%;/u);
  assert.match(body, /min-width:\s*0;/u);
  assert.match(body, /max-width:\s*100%;/u);
  assert.match(body, /height:\s*32px;/u);
  assert.match(body, /min-height:\s*32px;/u);
  assert.match(body, /max-height:\s*32px;/u);
  assert.match(body, /white-space:\s*nowrap;/u);
  assert.doesNotMatch(body, /display:\s*none/u);
  assert.doesNotMatch(body, /overflow(?:-x)?:\s*(?:hidden|clip)/u);
  assert.doesNotMatch(body, /text-overflow:/u);
  assert.doesNotMatch(body, /visibility:\s*hidden/u);
  assert.doesNotMatch(body, /font-size:\s*0/u);
});
