import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const uiStylesUrl = new URL(
  "../../libs/shared/ui/src/styles.css",
  import.meta.url,
);

test("las alertas del workspace flotan sin desplazar el contenido", async () => {
  const styles = await readFile(uiStylesUrl, "utf8");
  const cleanInterface = styles.slice(
    styles.indexOf("RQ INTERFAZ LIMPIA Y ALERTAS FLOTANTES V1"),
  );

  assert.match(cleanInterface, /\.rq-inline-alert/u);
  assert.match(cleanInterface, /position:\s*fixed;/u);
  assert.match(cleanInterface, /z-index:\s*1200;/u);
  assert.match(cleanInterface, /@media \(prefers-reduced-motion: reduce\)/u);
});

test("la interfaz conserva un solo marco para datos y controles", async () => {
  const styles = await readFile(uiStylesUrl, "utf8");
  const cleanInterface = styles.slice(
    styles.indexOf("RQ INTERFAZ LIMPIA Y ALERTAS FLOTANTES V1"),
  );

  assert.match(cleanInterface, /\.rq-filter-bar\s*\{[\s\S]*?border:\s*0;/u);
  assert.match(cleanInterface, /\.rq-table-shell\s*\{[\s\S]*?border:\s*0;/u);
  assert.match(
    cleanInterface,
    /\.rq-table-shell__scroll\s*\{[\s\S]*?border:\s*1px solid/u,
  );
});
