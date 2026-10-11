import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

import {
  BlockDuration,
  StallNotice,
  formatBlockDuration,
  formatGenerationElapsed,
} from "../../apps/web/src/app/workspace/sources/live-clock";
import { runWithConcurrency } from "../../apps/web/src/app/workspace/concurrency";
import { jsonEqual } from "../../apps/web/src/app/workspace/documents/[documentId]/json-equal";
import { readDocumentSectionPresenterSource } from "../support/document-section-presenter-source";
import { readStylesSync } from "../support/read-styles";

test("jsonEqual: misma referencia al instante y diferencias profundas detectadas", () => {
  const value = { a: [1, { b: "x" }], c: null };
  assert.equal(jsonEqual(value, value), true);
  assert.equal(jsonEqual(value, JSON.parse(JSON.stringify(value))), true);
  assert.equal(jsonEqual({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
  assert.equal(jsonEqual(value, { a: [1, { b: "y" }], c: null }), false);
  assert.equal(jsonEqual([1, 2], [1, 2, 3]), false);
  assert.equal(jsonEqual([], {}), false);
  assert.equal(jsonEqual(null, undefined), false);
  assert.equal(jsonEqual("a", "a"), true);
  assert.equal(jsonEqual({ a: 1 }, { b: 1 }), false);
});

test("runWithConcurrency respeta el límite, procesa todo y puede detenerse", async () => {
  let running = 0;
  let peak = 0;
  const done: number[] = [];
  await runWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8, 9], 3, async (item) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    done.push(item);
    running -= 1;
  });
  assert.equal(peak, 3);
  assert.deepEqual([...done].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9]);

  const processed: number[] = [];
  let stop = false;
  await runWithConcurrency([1, 2, 3, 4, 5], 1, async (item) => {
    processed.push(item);
    if (item === 2) stop = true;
  }, () => stop);
  assert.deepEqual(processed, [1, 2]);
  await runWithConcurrency([], 4, async () => assert.fail("no debe ejecutarse"));
});

test("Inicio limita las solicitudes y el editor no serializa el contenido en cada pulsación", () => {
  const home = readFileSync("apps/web/src/app/workspace/home-workspace.tsx", "utf8");
  assert.match(home, /runWithConcurrency\(\s*projects,\s*4,/u);
  assert.match(home, /const statusesRequest = fetchExecutionStatuses\(project\.id\)/u);
  const editor = readFileSync("apps/web/src/app/workspace/documents/[documentId]/requirement-document-editor.tsx", "utf8");
  assert.doesNotMatch(editor, /JSON\.stringify\(draftContent\) !== JSON\.stringify\(activeSection/u);
  assert.match(editor, /!jsonEqual\(draftContent, activeSection\?\.content\)/u);
  assert.match(editor, /useDeferredValue\(\s*requirementsPresentationContent/u);
  assert.match(editor, /context=\{businessEditorContext\}/u);
});

test("Documentos pide versiones y análisis de IA a la vez", () => {
  const page = readFileSync("apps/web/src/app/workspace/documents/page.tsx", "utf8");
  assert.match(page, /const \[versionResponses, analysesResponse\] = await Promise\.all\(\[/u);
});

test("los relojes de Fuentes viven en componentes propios y formatean igual que antes", () => {
  assert.equal(formatBlockDuration(65_000), "01:05");
  assert.equal(formatBlockDuration(3_725_000), "1:02:05");
  assert.equal(formatGenerationElapsed("2026-10-10T10:00:00Z", Date.parse("2026-10-10T10:01:05Z")), "01:05");
  assert.equal(formatGenerationElapsed("2026-10-10T10:00:00Z", Date.parse("2026-10-10T11:02:05Z")), "01:02:05");
  assert.equal(formatGenerationElapsed(null), "—");
  // Punto terminado: tiempo fijo; sin dato válido no se pinta nada.
  assert.match(renderToStaticMarkup(createElement(BlockDuration, { endStamp: 15_000, live: false, previousStamp: 10_000 })), />00:05</u);
  assert.equal(renderToStaticMarkup(createElement(BlockDuration, { endStamp: Number.NaN, live: false, previousStamp: 0 })), "");
  assert.equal(renderToStaticMarkup(createElement(StallNotice, { active: false, updatedAt: "2020-01-01T00:00:00Z" })), "");
  assert.match(renderToStaticMarkup(createElement(StallNotice, { active: true, updatedAt: "2020-01-01T00:00:00Z" })), /no se ha recibido un nuevo punto de control/u);
  const workspace = readFileSync("apps/web/src/app/workspace/sources/sources-workspace.tsx", "utf8");
  assert.doesNotMatch(workspace, /visualNow/u);
  const presenter = readDocumentSectionPresenterSource();
  assert.match(presenter, /^const PendingItems = \(/mu);
  assert.doesNotMatch(presenter, /^ {2}const PendingItems = /mu);
  assert.match(readStylesSync(), /\.rq-exec-tree > li > ul > li \{\s+content-visibility: auto;/u);
});

import {
  PROGRESS_CACHE_TTL_MS,
  clearCachedProgress,
  readCachedProgress,
  writeCachedProgress,
  type ProgressCacheStorage,
} from "../../apps/web/src/app/workspace/home-progress-cache";

function fakeStorage(): ProgressCacheStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

test("el avance guardado se muestra solo si es reciente y el proyecto no cambió de estado", () => {
  const storage = fakeStorage();
  const project = { id: "p1", status: "APPROVED" };
  const progress = { stageIndex: 5, stagePercentages: [100, 100, 100, 100, 100, 57] };
  assert.equal(readCachedProgress(storage, project, 1_000), null);

  writeCachedProgress(storage, project, progress, 1_000);
  assert.deepEqual(readCachedProgress(storage, project, 1_000 + 60_000), progress);

  // Cambia el estado del proyecto: se descarta.
  assert.equal(readCachedProgress(storage, { id: "p1", status: "EXECUTION" }, 2_000), null);
  assert.equal(storage.data.size, 0);

  // Caduca pasado el TTL.
  writeCachedProgress(storage, project, progress, 1_000);
  assert.equal(readCachedProgress(storage, project, 1_000 + PROGRESS_CACHE_TTL_MS + 1), null);

  // Un reloj atrasado o datos corruptos no devuelven nada ni lanzan.
  writeCachedProgress(storage, project, progress, 10_000);
  assert.equal(readCachedProgress(storage, project, 5_000), null);
  storage.setItem("rq-home-progress-v1:p1", "no es json");
  assert.equal(readCachedProgress(storage, project, 10_000), null);

  // Descartar tras marcar tareas en Ejecución.
  writeCachedProgress(storage, project, progress, 10_000);
  clearCachedProgress(storage, "p1");
  assert.equal(readCachedProgress(storage, project, 10_001), null);
});

test("sin almacenamiento disponible la caché no hace nada y no falla", () => {
  assert.equal(readCachedProgress(null, { id: "p", status: "DRAFT" }), null);
  writeCachedProgress(null, { id: "p", status: "DRAFT" }, { a: 1 });
  clearCachedProgress(null, "p");
  const lleno: ProgressCacheStorage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => undefined,
  };
  assert.doesNotThrow(() => writeCachedProgress(lleno, { id: "p", status: "DRAFT" }, { a: 1 }));
});

test("Inicio siembra el avance con la caché y Ejecución la invalida al guardar", () => {
  const home = readFileSync("apps/web/src/app/workspace/home-workspace.tsx", "utf8");
  assert.match(home, /readCachedProgress<ProjectProgress>\(storage, project\)/u);
  assert.match(home, /setProjectProgressById\(cached\)/u);
  assert.match(home, /writeCachedProgress\(storage, project, entry\)/u);
  const execution = readFileSync("apps/web/src/app/workspace/execution/execution-workspace.tsx", "utf8");
  assert.match(execution, /clearCachedProgress\(browserProgressStorage\(\), projectId\)/u);
});

import {
  readQueryParam,
  withQueryParam,
} from "../../apps/web/src/app/workspace/use-query-state";

test("los filtros de los listados se leen y escriben en la URL conservando los demás parámetros", () => {
  assert.equal(readQueryParam("?q=soat&estado=APPROVED", "q"), "soat");
  assert.equal(readQueryParam("?q=soat", "estado"), null);
  assert.equal(readQueryParam("?q=" + "a".repeat(201), "q"), null);
  assert.equal(readQueryParam("?q=%0Ainyeccion", "q"), null);

  // Al fijar un valor se conserva lo demás; al volver al valor por defecto se quita el parámetro.
  assert.equal(withQueryParam("?projectId=abc", "q", "soat", ""), "?projectId=abc&q=soat");
  assert.equal(withQueryParam("?projectId=abc&q=soat", "q", "", ""), "?projectId=abc");
  assert.equal(withQueryParam("?orden=CREATED_ASC", "orden", "CREATED_DESC", "CREATED_DESC"), "");
  assert.equal(withQueryParam("", "q", "a b&c", ""), "?q=a+b%26c");
});

test("los listados guardan su búsqueda, estado, área y orden en la URL", () => {
  for (const [file, keys] of [
    ["projects-workspace.tsx", ['"q"', '"estado"', '"area"', '"orden"']],
    ["discussion/discussion-project-list.tsx", ['"q"', '"estado"', '"area"', '"orden"']],
    ["sources/sources-project-list.tsx", ['"q"', '"estado"', '"area"', '"orden"']],
    ["documents/documents-workspace.tsx", ['"q"', '"estado"', '"area"', '"orden"']],
    ["validation/validation-workspace.tsx", ['"proyecto"', '"estado"', '"area"', '"orden"']],
    ["execution/execution-workspace.tsx", ['"q"', '"estado"', '"area"', '"orden"']],
    ["prototype/prototype-workspace.tsx", ['"q"', '"estado"', '"desde"', '"hasta"', '"orden"']],
  ] as const) {
    const source = readFileSync(`apps/web/src/app/workspace/${file}`, "utf8");
    for (const key of keys) {
      assert.match(source, new RegExp(`useQueryState<[^>]*>\\(\\s*${key}`, "u"), `${file} ${key}`);
    }
  }
});
