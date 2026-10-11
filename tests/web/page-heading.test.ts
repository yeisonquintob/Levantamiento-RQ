import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("el título de la página de la barra superior es un h1 y conserva su estilo", () => {
  const shell = readFileSync("apps/web/src/app/app-shell.tsx", "utf8");
  assert.match(shell, /<h1>\{pageContext\.title\}<\/h1>/u);
  assert.doesNotMatch(shell, /<strong>\{pageContext\.title\}<\/strong>/u);
  const css = readFileSync("libs/shared/ui/src/styles.css", "utf8");
  assert.doesNotMatch(css, /\.rq-topbar__page > strong/u);
  assert.match(css, /\.rq-topbar__page > h1 \{\n  overflow: hidden;\n  margin: 2px 0 0;\n  font-weight: 700;/u);
});

test("los encabezados se balancean y las imágenes del prototipo declaran sus dimensiones", () => {
  const css = readFileSync("libs/shared/ui/src/styles.css", "utf8");
  assert.match(css, /\.rq-main :is\(h1, h2, h3\) \{\n  text-wrap: balance;/u);
  const prototype = readFileSync("apps/web/src/app/workspace/prototype/prototype-workspace.tsx", "utf8");
  assert.match(prototype, /height=\{image\.height \?\? undefined\}/u);
  assert.match(prototype, /width=\{selectedImage\.width \?\? undefined\}/u);
});
