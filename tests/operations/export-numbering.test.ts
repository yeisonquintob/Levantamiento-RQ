import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExportDocumentSections,
  renderMarkdown,
} from "../../apps/operations-service/src/operations/export-document.renderer.js";
import { buildExportFixture } from "./export-document.fixture.js";

test("la numeración visible de las secciones es consecutiva", () => {
  const input = buildExportFixture("LARGE_REQUIREMENT", true);
  const numbers = buildExportDocumentSections(input)
    .filter((section) => !section.headingNumber)
    .map((section) => section.displayNumber ?? section.number);
  const unique = [...new Set(numbers)];
  assert.deepEqual(
    unique,
    unique.map((_, index) => index + 1),
    `numeración con huecos: ${unique.join(", ")}`,
  );
});

test("Markdown numera Alcance y sus KPIs con el mismo capítulo y no deja secciones vacías", async () => {
  const input = buildExportFixture("LARGE_REQUIREMENT", true);
  const markdown = (await renderMarkdown(input)).buffer.toString("utf8");
  const headings = [...markdown.matchAll(/^## (\d+)\. /gmu)].map((match) =>
    Number(match[1]),
  );
  assert.deepEqual(
    headings,
    headings.map((_, index) => index + 1),
  );
  const scope = /^## (\d+)\. Alcance/mu.exec(markdown)?.[1];
  const kpis = /^### (\d+)\.4\. KPIs de estado/mu.exec(markdown)?.[1];
  if (kpis) assert.equal(kpis, scope);
  assert.doesNotMatch(markdown, /### 2\.4\. KPIs de estado/u);
});

test("Control de cambios sin cambios muestra un texto y no una tabla vacía", async () => {
  const input = buildExportFixture("LARGE_REQUIREMENT", true);
  const sections = buildExportDocumentSections(input);
  const changes = sections.find((section) => section.title === "Control de cambios");
  assert.ok(changes);
  for (const table of changes.tables) assert.ok(table.rows.length > 0);
  if (changes.tables.length === 0) {
    assert.match(changes.lines[0]?.text ?? "", /No hay cambios registrados/u);
  }
});
