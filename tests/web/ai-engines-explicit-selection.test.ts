import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const EDITOR =
  "apps/web/src/app/workspace/documents/[documentId]/requirement-document-editor.tsx";
const ANALYSIS = "apps/web/src/app/workspace/analysis/analysis-workspace.tsx";
const SOURCES = "apps/web/src/app/workspace/sources/sources-workspace.tsx";
const SELECTOR = "apps/web/src/app/workspace/ai-engine-selection.tsx";

function postBodyAfter(source: string, endpointFragment: string): string {
  const start = source.indexOf(endpointFragment);
  assert.notEqual(start, -1, `No se encontró ${endpointFragment}`);
  const bodyStart = source.indexOf("JSON.stringify(", start);
  return source.slice(bodyStart, bodyStart + 700);
}

test("(e) «Nueva versión con IA» envía engines explícitos del selector y deshabilita sin selección", async () => {
  const editor = await readFile(EDITOR, "utf8");
  assert.match(editor, /useAiEngineSelection\(/u);
  assert.match(editor, /<AiEngineChips/u);
  const body = postBodyAfter(
    editor,
    "${encodeURIComponent(project.id)}/analysis-requests`,\n        {\n          method: \"POST\"",
  );
  assert.match(body, /engines:\s*aiEngines\.engines/u);
  assert.match(body, /providerSelections:\s*aiEngines\.providerSelections/u);
  assert.match(editor, /aiEnginesMissing\s*=\s*aiEngines\.engines\.length === 0/u);
  assert.match(editor, /aiEnginesMissing\s*\|\|/u);
  assert.match(editor, /id="ai-engines-required"/u);
  assert.match(editor, /aria-describedby=\{\s*aiEnginesMissing \? "ai-engines-required"/u);
  assert.doesNotMatch(editor, /engines:\s*\[\s*"CLOUD"/u);
});

test("(e) el análisis manual envía engines explícitos y exige selección", async () => {
  const analysis = await readFile(ANALYSIS, "utf8");
  const body = postBodyAfter(analysis, "/analysis-requests`,\n        {\n          method: \"POST\"");
  assert.match(body, /engines:\s*aiEngines\.engines/u);
  assert.match(analysis, /<AiEngineChips/u);
  assert.match(analysis, /aiEnginesMissing\s*\|\|/u);
  assert.doesNotMatch(analysis, /engines:\s*\[\s*"CLOUD"/u);
});

test("(e) Fuentes sigue enviando engines en creación y estimación", async () => {
  const sources = await readFile(SOURCES, "utf8");
  assert.match(postBodyAfter(sources, "analysis-requests/token-estimate"), /engines:\s*aiEngines\.engines/u);
  assert.match(
    postBodyAfter(sources, "/analysis-requests`,\n        {\n          method: \"POST\""),
    /engines:\s*aiEngines\.engines/u,
  );
});

test("(e) los scripts E2E que crean solicitudes declaran engines", async () => {
  for (const file of [
    "scripts/ai-analysis-gateway-e2e.ts",
    "scripts/v1-complete-e2e.ts",
    "scripts/ai-analysis-requests-smoke.ts",
  ]) {
    const text = await readFile(file, "utf8");
    assert.match(text, /engines:\s*\["CLOUD"\]/u, file);
  }
});

test("(f) el selector no preselecciona nube sin un gesto explícito previo", async () => {
  const selector = await readFile(SELECTOR, "utf8");
  assert.doesNotMatch(selector, /\?\?\s*result\.cloud\.enabled/u);
  assert.match(
    selector,
    /cloud:\s*stored\?\.explicit === true && stored\.cloud && result\.cloud\.enabled/u,
  );
  // Solo un toggle de la persona marca la selección como explícita.
  assert.match(selector, /explicit:\s*true/u);
  // La accesibilidad del selector se conserva.
  assert.match(selector, /role="switch"/u);
  assert.match(selector, /aria-checked=\{/u);
});
