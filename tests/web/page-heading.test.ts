import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readStylesSync } from "../support/read-styles";

test("el título de la página de la barra superior es un h1 y conserva su estilo", () => {
  const shell = readFileSync("apps/web/src/app/app-shell.tsx", "utf8");
  assert.match(shell, /<h1>\{pageContext\.title\}<\/h1>/u);
  assert.doesNotMatch(shell, /<strong>\{pageContext\.title\}<\/strong>/u);
  const css = readStylesSync();
  assert.doesNotMatch(css, /\.rq-topbar__page > strong/u);
  assert.match(css, /\.rq-topbar__page > h1 \{\n  overflow: hidden;\n  margin: 2px 0 0;\n  font-weight: 700;/u);
});

test("los encabezados se balancean y las imágenes del prototipo declaran sus dimensiones", () => {
  const css = readStylesSync();
  assert.match(css, /\.rq-main :is\(h1, h2, h3\) \{\n  text-wrap: balance;/u);
  const prototype = readFileSync("apps/web/src/app/workspace/prototype/prototype-workspace.tsx", "utf8");
  assert.match(prototype, /height=\{image\.height \?\? undefined\}/u);
  assert.match(prototype, /width=\{selectedImage\.width \?\? undefined\}/u);
});

test("el catálogo de modelos no se desborda con identificadores largos", () => {
  const css = readStylesSync();
  assert.match(css, /\.rq-ai-providers-workspace \.rq-ai-cat > \* \{\n  min-width: 0;/u);
  assert.match(css, /\.rq-ai-cat__model strong,\n\.rq-ai-providers-workspace \.rq-ai-cat__model small \{\n  overflow-wrap: anywhere;/u);
});
