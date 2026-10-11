import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  executionStatusPresentation,
  projectStatusLabel,
  projectStatusTone,
} from "../../apps/web/src/app/workspace/project-status-badge";

const css = readFileSync("libs/shared/ui/src/styles.css", "utf8");
const read = (path: string) =>
  readFileSync(`apps/web/src/app/workspace/${path}`, "utf8");

test("fuera de Ejecución un proyecto aprobado, en ejecución o completado figura «Aprobado» en verde", () => {
  for (const status of ["APPROVED", "EXECUTION", "COMPLETED"] as const) {
    assert.equal(projectStatusLabel(status), "Aprobado");
    assert.equal(projectStatusTone(status), "success");
  }
  assert.equal(projectStatusTone("DOCUMENT_GENERATED"), "pending");
  assert.equal(projectStatusLabel("DOCUMENT_GENERATED"), "Documento generado");
  assert.equal(projectStatusTone("ARCHIVED"), "inactive");
});

test("dentro de Ejecución: en ejecución morado y completado verde", () => {
  assert.deepEqual(executionStatusPresentation("EXECUTION"), {
    label: "En ejecución",
    tone: "process",
  });
  assert.deepEqual(executionStatusPresentation("COMPLETED"), {
    label: "Completado",
    tone: "success",
  });
  assert.equal(executionStatusPresentation("DOCUMENT_GENERATED").tone, "pending");
});

test("Discusión, Fuentes, Documentos, Validación y Ejecución muestran la misma insignia", () => {
  for (const file of [
    "discussion/discussion-project-list.tsx",
    "sources/sources-project-list.tsx",
    "documents/documents-workspace.tsx",
    "validation/validation-workspace.tsx",
    "execution/execution-workspace.tsx",
  ]) {
    assert.match(read(file), /<ProjectStatusBadge/u, file);
  }
  assert.match(read("discussion/discussion-project-list.tsx"), /Estado del proyecto/u);
  assert.match(read("sources/sources-project-list.tsx"), /Estado del proyecto/u);
});

test("la insignia unificada se pinta con el relleno suave de Proyectos", () => {
  const scope = ".rq-status.rq-project-status.rq-project-status.rq-project-status";
  assert.ok(
    css.includes(
      `${scope}[data-rq-status="success"] {\n  background: color-mix(in srgb, var(--rq-action-affirmative) 16%, var(--rq-color-surface));`,
    ),
  );
  assert.ok(
    css.includes(
      `${scope}[data-rq-status="pending"] {\n  background: color-mix(in srgb, var(--rq-action-warning) 18%, var(--rq-color-surface));`,
    ),
  );
});

test("el estado «en ejecución» se pinta de morado", () => {
  assert.ok(
    css.includes(
      '.rq-status.rq-project-status.rq-project-status.rq-project-status[data-rq-status="process"] {\n  background: color-mix(in srgb, var(--rq-action-operation) 16%',
    ),
  );
});
