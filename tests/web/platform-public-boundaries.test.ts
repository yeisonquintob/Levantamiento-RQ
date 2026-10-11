import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROBOTS = "apps/web/src/app/robots.ts";
const NOT_FOUND = "apps/web/src/app/not-found.tsx";
const NOT_FOUND_CSS = "apps/web/src/app/not-found.module.css";

test("límites públicos: robots bloquea todo rastreo sin sitemap", async () => {
  const source = await readFile(ROBOTS, "utf8");

  assert.match(source, /MetadataRoute\.Robots/);
  assert.match(source, /userAgent:\s*"\*"/);
  assert.match(source, /disallow:\s*"\/"/);
  assert.doesNotMatch(source, /sitemap|host/i);
});

test("límites públicos: la 404 conserva enlace al inicio y semántica principal", async () => {
  const source = await readFile(NOT_FOUND, "utf8");

  assert.match(source, /<main\b/);
  assert.match(source, /<h1\b/);
  assert.match(source, /404/);
  assert.match(source, /<Link href="\/"/);
  assert.doesNotMatch(source, /"use client"|fetch\(|cookies\(|headers\(/);
});

test("límites públicos: el CSS de la 404 es responsive y usa tokens del sistema", async () => {
  const css = await readFile(NOT_FOUND_CSS, "utf8");

  assert.match(css, /@media \(max-width: \d+px\)/);
  assert.match(css, /var\(--rq-color-[a-z-]+\)/);
  assert.match(css, /var\(--rq-space-\d\)/);
});
