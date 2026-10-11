import assert from "node:assert/strict";
import test from "node:test";

import type { ExecutionTaskStatusDetail } from "@levantamiento-rq/shared-contracts";

import type {
  AzureExecutionImport,
  ExecutionPlan,
  ExecutionTask,
} from "../../apps/web/src/app/workspace/execution/azure-devops-csv";
import {
  azureStatusUpdates,
  computeExecutionKpis,
  doneCodesOf,
  normalizeTaskCode,
  planKpis,
  statusMapOf,
} from "../../apps/web/src/app/workspace/execution/execution-tracking";

const task = (
  code: string,
  epicCode: string,
  storyCode: string,
  title = `Tarea ${code}`,
): ExecutionTask => ({
  code,
  title,
  description: "",
  epicCode,
  epicTitle: epicCode,
  featureCode: "FE-1",
  featureTitle: "",
  storyCode,
  storyTitle: "",
  sprintCode: "SP-1",
  role: "Desarrollo",
  start: 1,
  end: 2,
  startLabel: "Día 1",
  endLabel: "Día 2",
  estimatedDays: 1,
});

// Dos hitos: EP-1 con dos historias (3 tareas) y EP-2 con una historia (1 tarea).
const tasks = [
  task("TA-001", "EP-1", "HU-1"),
  task("TA-002", "EP-1", "HU-1"),
  task("TA-003", "EP-1", "HU-2"),
  task("TA-004", "EP-2", "HU-3"),
];
const plan: ExecutionPlan = {
  documentId: "d",
  documentTitle: "Documento",
  projectId: "p",
  tasks,
  epics: ["EP-1", "EP-2"].map((code) => ({
    code,
    title: code,
    taskCodes: tasks.filter((item) => item.epicCode === code).map((item) => item.code),
    start: 1,
    end: 2,
    startLabel: "Día 1",
    endLabel: "Día 2",
  })),
  timelineStart: 1,
  timelineEnd: 2,
  usesDates: false,
};

test("sin tareas hechas todos los KPI valen cero", () => {
  const kpis = planKpis(plan, new Set());
  assert.deepEqual(
    [kpis.progress, kpis.objectiveCompliance, kpis.deliverableCompliance],
    [0, 0, 0],
  );
  assert.equal(kpis.totalTasks, 4);
  assert.equal(kpis.totalStories, 3);
  assert.equal(kpis.totalEpics, 2);
});

test("marcar tareas mueve los tres KPI con una sola fórmula", () => {
  // HU-1 completa (TA-001 y TA-002) y TA-003 sin hacer.
  const kpis = planKpis(plan, new Set(["TA-001", "TA-002"]));
  assert.equal(kpis.progress, 50); // 2 de 4 tareas
  assert.equal(kpis.objectiveCompliance, 33); // 1 de 3 historias
  assert.equal(kpis.deliverableCompliance, 0); // ningún hito completo

  const more = planKpis(plan, new Set(["TA-001", "TA-002", "TA-003"]));
  assert.equal(more.deliverableCompliance, 50); // EP-1 completo
  assert.equal(more.objectiveCompliance, 67);

  const all = planKpis(plan, new Set(tasks.map((item) => item.code)));
  assert.deepEqual(
    [all.progress, all.objectiveCompliance, all.deliverableCompliance],
    [100, 100, 100],
  );
});

test("los códigos se comparan sin importar mayúsculas ni espacios", () => {
  const done = doneCodesOf(
    statusMapOf([
      {
        taskCode: " ta-001 ",
        state: "DONE",
        source: "MANUAL",
        note: null,
        completedAt: null,
        updatedAt: "2026-10-09T12:00:00Z",
        updatedByUserId: "u",
      },
    ]),
  );
  assert.ok(done.has("TA-001"));
  assert.equal(normalizeTaskCode("  ta  001 "), "TA 001");
  assert.equal(planKpis(plan, done).doneTasks, 1);
});

test("una historia sin tareas no cuenta como objetivo y una tarea suelta cuenta como avance", () => {
  const kpis = computeExecutionKpis(
    [
      { stories: [[], ["A-1", "A-2"]], loose: ["S-1"] },
      { stories: [], loose: [] },
    ],
    new Set(["A-1", "A-2", "S-1"]),
  );
  assert.equal(kpis.totalStories, 1);
  assert.equal(kpis.objectiveCompliance, 100);
  assert.equal(kpis.totalTasks, 3);
  assert.equal(kpis.progress, 100);
  // El hito vacío cuenta como entregable pendiente.
  assert.equal(kpis.deliverableCompliance, 50);
});

const imported = (
  items: AzureExecutionImport["items"],
): AzureExecutionImport => ({
  fileName: "azure.csv",
  importedAt: "2026-10-09T08:00:00.000Z",
  items,
});
const azureItem = (
  code: string,
  state: string,
  completed: boolean,
  title = "",
  completedAt: string | null = null,
) => ({ id: code, code, title, type: "Task", state, completed, completedAt });

test("la importación de Azure marca hechas las tareas cerradas y respeta lo marcado a mano", () => {
  const manual: ExecutionTaskStatusDetail = {
    taskCode: "TA-002",
    state: "IN_PROGRESS",
    source: "MANUAL",
    note: "revisando",
    completedAt: null,
    updatedAt: "2026-10-08T00:00:00Z",
    updatedByUserId: "u",
  };
  const updates = azureStatusUpdates(
    plan,
    imported([
      azureItem("TA-001", "Done", true, "", "2026-10-07T10:00:00Z"),
      azureItem("TA-002", "New", false), // no pisa el «en curso» manual
      azureItem("TA-003", "Active", false),
      azureItem("TA-999", "Done", true), // no existe en el plan
    ]),
    statusMapOf([manual]),
  );
  assert.deepEqual(
    updates.map((update) => [update.taskCode, update.state, update.source]),
    [
      ["TA-001", "DONE", "AZURE_CSV"],
      ["TA-003", "IN_PROGRESS", "AZURE_CSV"],
    ],
  );
  assert.equal(updates[0]?.completedAt, "2026-10-07T10:00:00Z");
});

test("Azure también casa las tareas por título cuando el código no coincide", () => {
  const updates = azureStatusUpdates(
    plan,
    imported([azureItem("12345", "Done", true, "TA-004 · Tarea TA-004")]),
    new Map(),
  );
  assert.deepEqual(
    updates.map((update) => [update.taskCode, update.state]),
    [["TA-004", "DONE"]],
  );
  // Sin fecha de cierre usa la de importación.
  assert.equal(updates[0]?.completedAt, "2026-10-09T08:00:00.000Z");
});

test("Ejecución solo es «Completado» con el 100 % de las tareas, sin importar el estado guardado", async () => {
  const { effectiveExecutionStatus } = await import(
    "../../apps/web/src/app/workspace/execution/execution-tracking"
  );
  // El estado del proyecto solo avanza: puede seguir en COMPLETED aunque falten tareas.
  assert.equal(effectiveExecutionStatus("COMPLETED", { percentage: 57, started: true }), "EXECUTION");
  assert.equal(effectiveExecutionStatus("COMPLETED", { percentage: 100, started: true }), "COMPLETED");
  // Un proyecto aprobado ya está en la etapa de ejecución, aunque no tenga tareas hechas.
  assert.equal(effectiveExecutionStatus("APPROVED", { percentage: 0, started: false }), "EXECUTION");
  assert.equal(effectiveExecutionStatus("DOCUMENT_GENERATED", { percentage: 0, started: false }), "DOCUMENT_GENERATED");
  assert.equal(effectiveExecutionStatus("COMPLETED", undefined), "EXECUTION");
});
