import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { readStyles } from "../support/read-styles";

const APP_ROOT = join(process.cwd(), "apps/web/src/app");

// Páginas de servidor: no tienen estado de cliente que limpiar; el respaldo CSS
// oculta su aviso a los 5 s.
const SERVER_RENDERED = new Set(["workspace/discussion/page.tsx"]);

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.tsx$/u.test(entry.name) ? [path] : [];
    }),
  );
  return nested.flat();
}

test("todo componente que muestra un aviso transitorio lo cierra a los 5 segundos", async () => {
  const files = await sourceFiles(APP_ROOT);
  const rendersToast =
    /className=["'{`][^"'`}]*\b(?:rq-project-alert|rq-inline-alert|rq-document-alert|rq-alert)\b/u;
  const offenders: string[] = [];
  let checked = 0;
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (!rendersToast.test(source)) continue;
    const relative = file.slice(APP_ROOT.length + 1);
    if (SERVER_RENDERED.has(relative)) continue;
    checked += 1;
    if (!/from "(?:\.\.\/)+use-auto-dismiss"/u.test(source)) {
      offenders.push(relative);
    }
  }
  assert.ok(checked >= 15, `se esperaban al menos 15 componentes: ${checked}`);
  assert.deepEqual(offenders, []);
});

test("el hook limpia el aviso con un tiempo de 5 segundos y reinicia con cada aviso nuevo", async () => {
  const source = await readFile(join(APP_ROOT, "use-auto-dismiss.ts"), "utf8");
  assert.match(source, /NOTIFICATION_AUTO_DISMISS_MS = 5_000/u);
  assert.match(source, /if \(!value\) return;/u);
  assert.match(
    source,
    /window\.setTimeout\(\(\) => clearRef\.current\(\), delayMs\)/u,
  );
  assert.match(source, /return \(\) => window\.clearTimeout\(timeout\)/u);
  assert.match(source, /\[value, delayMs\]/u);
});

test("el respaldo de estilos desvanece cualquier aviso a los 5 segundos", async () => {
  const css = await readStyles();
  assert.match(css, /@keyframes rq-toast-exit/u);
  assert.match(css, /rq-toast-exit 250ms ease-in 5s forwards/u);
});
