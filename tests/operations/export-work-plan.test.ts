import assert from "node:assert/strict";
import test from "node:test";
import { buildExportEpicTimeline } from "../../apps/operations-service/src/operations/export-work-plan";

const backlog = { epics: [{ code: "EP-001", title: "Gestión", features: [{ code: "FE-001", userStories: [{ code: "HU-P-001", tasks: [{ code: "T-001" }, { code: "T-002" }] }] }] }, { code: "EP-002", title: "Sin asignación", features: [] }] };

test("las barras de épicas usan las tareas y no todo el Sprint", () => {
  const timeline = buildExportEpicTimeline({ sprints: [{ startDay: 1, endDay: 15, tasks: [{ code: "T-001", userStoryCode: "HU-P-001", startDay: 1, endDay: 6 }] }] }, backlog);
  assert.deepEqual(timeline?.rows[0], { code: "EP-001", title: "Gestión", start: 1, end: 6 });
  assert.equal(timeline?.rows[1].start, null);
  assert.equal(timeline?.end, 15);
});

test("el cierre usa el mayor final aunque las tareas se solapen", () => {
  const timeline = buildExportEpicTimeline({ sprints: [{ startDay: 1, endDay: 60, tasks: [{ code: "T-001", startDay: 1, endDay: 50 }, { code: "T-002", startDay: 20, endDay: 25 }] }] }, backlog);
  assert.equal(timeline?.rows[0].end, 50);
});

test("sin fechas de tareas usa el Sprint vinculado por feature o historia", () => {
  const timeline = buildExportEpicTimeline({ sprints: [{ startDay: 16, endDay: 30, featureCodes: ["fe-001"], tasks: [] }] }, backlog);
  assert.equal(timeline?.rows[0].start, 16);
  assert.equal(timeline?.rows[0].end, 30);
});

test("respeta fechas calendario de tareas y los intervalos de un día", () => {
  const day = Date.parse("2026-09-14T00:00:00Z") / 86400000;
  const timeline = buildExportEpicTimeline({ sprints: [{ startDay: 1, endDay: 15, startDate: "2026-09-14", endDate: "2026-09-28", tasks: [{ code: "T-001", startDate: "2026-09-14", endDate: "2026-09-14" }] }] }, backlog);
  assert.equal(timeline?.calendar, true);
  assert.equal(timeline?.rows[0].start, day);
  assert.equal(timeline?.rows[0].end, day);
});

test("no inventa épicas o fechas cuando no hay planificación", () => {
  assert.equal(buildExportEpicTimeline({ sprints: [] }, backlog), null);
  assert.equal(buildExportEpicTimeline({ sprints: [{ startDay: 1, endDay: 15 }] }, {}), null);
  const timeline = buildExportEpicTimeline({ sprints: [{ startDay: 1, endDay: 15, tasks: [{ code: "T-001", startDay: 6, endDay: 2 }] }] }, backlog);
  // The task has no valid range, but its explicit sprint assignment is retained.
  assert.equal(timeline?.rows[0].end, 15);
});
