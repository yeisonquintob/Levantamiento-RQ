import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { ProjectStatus } from "@levantamiento-rq/shared-contracts";

import {
  canAccessExecution,
  executionAvailability,
} from "../../apps/web/src/app/workspace/execution/execution-workspace";

test("solo los proyectos aprobados, en ejecución o completados se trabajan; completado siempre se abre", () => {
  const allowed: ProjectStatus[] = ["APPROVED", "EXECUTION", "COMPLETED"];
  const blocked: ProjectStatus[] = [
    "DRAFT",
    "DISCUSSION",
    "SOURCES",
    "DOCUMENT_GENERATED",
    "VALIDATION",
    "ARCHIVED",
  ];
  for (const status of allowed) assert.equal(canAccessExecution(status), true, status);
  for (const status of blocked) {
    assert.equal(canAccessExecution(status), false, status);
    assert.equal(executionAvailability(status), "Pendiente de aprobación");
  }
  assert.equal(executionAvailability("COMPLETED"), "Ejecución finalizada");
});

test("el listado abre cualquier proyecto y el aviso solo ofrece regresar", async () => {
  const source = await readFile(
    "apps/web/src/app/workspace/execution/execution-workspace.tsx",
    "utf8",
  );
  // El botón «Abrir» y el selector ya no se deshabilitan por estado.
  assert.doesNotMatch(source, /disabled=\{!executionEnabled\}/u);
  assert.doesNotMatch(source, /disabled=\{!canAccessExecution\(project\.status\)\}/u);
  // El aviso: alertdialog con el texto pedido y un único botón de regreso.
  const dialog = source.slice(source.indexOf('role="alertdialog"'));
  assert.match(dialog, /Proyecto no aprobado/u);
  assert.match(dialog, /Valida su aprobación antes de empezar su\s+ejecución\./u);
  assert.equal((dialog.match(/<RqActionButton/gu) ?? []).length, 1);
  assert.match(dialog, /onClick=\{closeExecution\}[\s\S]*Regresar/u);
  // Sin aprobación no se carga el plan.
  assert.match(source, /!canAccessExecution\(target\.status\)[\s\S]{0,120}setPlan\(null\)/u);
});
