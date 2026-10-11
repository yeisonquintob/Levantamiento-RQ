import assert from "node:assert/strict";
import test from "node:test";

import type {
  DocumentJsonValue,
  RequirementDocumentDetail,
} from "@levantamiento-rq/shared-contracts";

import { buildExecutionPlan } from "../../apps/web/src/app/workspace/execution/azure-devops-csv";
import {
  computeWorkPlanTimeline,
  workPlanAxisLabels,
} from "../../apps/web/src/app/workspace/work-plan-timeline";

const story = (code: string, tasks: string[]) => ({
  code,
  title: `Historia ${code}`,
  tasks: tasks.map((taskCode) => ({ code: taskCode, title: `Tarea ${taskCode}` })),
});
const backlog = {
  epics: [
    { code: "EP-001", title: "Base", features: [{ code: "FE-001", title: "F1", userStories: [story("HU-001", ["TA-001", "TA-002"])] }] },
    { code: "EP-002", title: "Núcleo", features: [{ code: "FE-002", title: "F2", userStories: [story("HU-002", ["TA-003"])] }] },
    { code: "EP-003", title: "Cierre", features: [{ code: "FE-003", title: "F3", userStories: [story("HU-003", ["TA-004"])] }] },
  ],
} as unknown as DocumentJsonValue;
// TA-004 no trae fechas propias: debe ubicarse por su sprint, no quedar en el día 0.
const scrum = {
  sprints: [
    {
      code: "SP-001", startDate: "2026-09-21", endDate: "2026-10-04", startDay: 1, endDay: 14,
      featureCodes: ["FE-001", "FE-002"], userStoryCodes: ["HU-001", "HU-002"],
      tasks: [
        { code: "TA-001", userStoryCode: "HU-001", startDay: 1, endDay: 14, startDate: "2026-09-21", endDate: "2026-10-04" },
        { code: "TA-002", userStoryCode: "HU-001", startDay: 1, endDay: 14, startDate: "2026-09-21", endDate: "2026-10-04" },
        { code: "TA-003", userStoryCode: "HU-002", startDay: 4, endDay: 9, startDate: "2026-09-24", endDate: "2026-10-03" },
      ],
    },
    {
      code: "SP-002", startDate: "2026-10-05", endDate: "2026-10-20", startDay: 15, endDay: 30,
      featureCodes: ["FE-003"], userStoryCodes: ["HU-003"],
      tasks: [{ code: "TA-004", userStoryCode: "HU-003", startDay: 15, endDay: 30 }],
    },
  ],
} as unknown as DocumentJsonValue;

const document = {
  id: "d",
  title: "Proyecto",
  projectId: "p",
  currentVersionDetail: {
    sections: [
      { key: "backlogStructure", content: backlog },
      { key: "scrumPlan", content: scrum },
    ],
  },
} as unknown as RequirementDocumentDetail;

test("Ejecución calcula la programación con las mismas épicas y ejes que el documento", () => {
  const shared = computeWorkPlanTimeline(scrum, backlog, "EPIC");
  const plan = buildExecutionPlan(document);

  assert.equal(plan.timelineStart, shared.timelineStart);
  assert.equal(plan.timelineEnd, shared.timelineEnd);
  assert.equal(plan.usesDates, shared.hasCalendar);
  assert.equal(shared.items.length, 3);
  for (const item of shared.items) {
    const epic = plan.epics.find((candidate) => candidate.code === item.code);
    assert.ok(epic, `falta ${item.code}`);
    assert.equal(epic.start, item.start);
    assert.equal(epic.end, item.end);
    assert.equal(epic.startLabel, item.startLabel);
    assert.equal(epic.endLabel, item.endLabel);
  }
  assert.deepEqual(
    workPlanAxisLabels(plan.timelineStart, plan.timelineEnd),
    workPlanAxisLabels(shared.timelineStart, shared.timelineEnd),
  );
});

test("El eje va del primer al último sprint y una tarea sin fechas usa su sprint", () => {
  const plan = buildExecutionPlan(document);
  assert.equal(plan.timelineStart, Date.parse("2026-09-21T12:00:00Z"));
  assert.equal(plan.timelineEnd, Date.parse("2026-10-20T12:00:00Z"));
  const unscheduled = plan.tasks.find((item) => item.code === "TA-004");
  assert.equal(unscheduled?.start, Date.parse("2026-10-05T12:00:00Z"));
  assert.equal(unscheduled?.end, Date.parse("2026-10-20T12:00:00Z"));
  const epic = plan.epics.find((item) => item.code === "EP-003");
  assert.equal(epic?.end, Date.parse("2026-10-20T12:00:00Z"));
});
