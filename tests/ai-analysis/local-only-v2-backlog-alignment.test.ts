import assert from "node:assert/strict";
import test from "node:test";

import { alignBacklogWithRequirements } from "../../apps/ai-analysis-service/src/execution/local-only-v2-backlog-alignment";

const story = (n: number, milestone: string, title: string) => ({
  code: `HU-F-${String(n).padStart(3, "0")}`,
  title: `Historia ${n}`,
  milestone,
  functionality: title,
  milestoneDescription: `Descripción ${title}`,
});
const requirements = {
  functionalRequirements: [
    story(1, "H-001", "Registro"),
    story(2, "H-001", "Registro"),
    story(3, "H-002", "Aprobación"),
  ],
};
const planning = (n: number, refs: string[]) => ({
  code: `HU-P-${n}`,
  title: `Plan ${n}`,
  description: `Detalle ${n}`,
  sourceNumber: null,
  functionalRequirementCodes: refs,
  sourceIds: [],
  tasks: [{ code: `T-00${n}`, title: "t", description: "d" }],
});

test("una Épica por Hito y una HU-P por HU-F aunque el modelo se equivoque", () => {
  const backlog = {
    structureStatus: "AI_SUGGESTED",
    epics: [
      {
        code: "EP-001",
        title: "Otro",
        features: [
          {
            code: "FE-001",
            title: "F",
            description: "f",
            userStories: [
              planning(1, ["HU-F-025"]),
              planning(2, ["HU-F-001"]),
              planning(3, ["HU-F-099"]),
              planning(4, []),
            ],
          },
        ],
      },
    ],
  };
  const aligned = alignBacklogWithRequirements(requirements, backlog) as {
    epics: Array<{
      code: string;
      title: string;
      features: Array<{ userStories: Array<Record<string, unknown>> }>;
    }>;
  };
  assert.deepEqual(
    aligned.epics.map((epic) => [epic.code, epic.title]),
    [
      ["EP-001", "Registro"],
      ["EP-002", "Aprobación"],
    ],
  );
  const perEpic = aligned.epics.map((epic) =>
    epic.features.flatMap((feature) => feature.userStories),
  );
  assert.deepEqual(perEpic.map((list) => list.length), [2, 1]);
  const refs = perEpic.flat().map((item) => item.functionalRequirementCodes);
  assert.deepEqual(refs, [["HU-F-001"], ["HU-F-002"], ["HU-F-003"]]);
  const codes = perEpic.flat().map((item) => item.code);
  assert.equal(new Set(codes).size, 3);
});

test("crea la HU-P faltante con el título de la HU-F y sin tareas inventadas", () => {
  const aligned = alignBacklogWithRequirements(requirements, {
    epics: [],
  }) as { epics: Array<{ features: Array<{ userStories: Array<Record<string, unknown>> }> }> };
  const all = aligned.epics.flatMap((epic) =>
    epic.features.flatMap((feature) => feature.userStories),
  );
  assert.equal(all.length, 3);
  assert.equal(all[0]!.title, "Historia 1");
  assert.deepEqual(all[0]!.tasks, []);
});

test("sin Requerimientos utilizables deja el Esquema intacto", () => {
  const backlog = { epics: [{ code: "EP-001" }] };
  assert.equal(
    alignBacklogWithRequirements({ functionalRequirements: [] }, backlog),
    backlog,
  );
});

import { buildScrumPlanFromBacklog } from "../../apps/ai-analysis-service/src/execution/local-only-v2-backlog-alignment";

test("el plan de trabajo programa cada HU-P una vez y en Sprints consecutivos", () => {
  const stories = Array.from({ length: 6 }, (_, index) => ({
    code: `HU-P-00${index + 1}`,
    title: `Plan ${index + 1}`,
    description: `Detalle ${index + 1}`,
    tasks:
      index === 5
        ? []
        : Array.from({ length: 3 }, (_, task) => ({
            code: `T-${index}${task}`,
            title: `Tarea ${index}${task}`,
            description: "d",
            type: "DEVELOPMENT",
            dependencyCodes: task > 0 ? [`T-${index}${task - 1}`] : [],
          })),
  }));
  const backlog = {
    epics: [
      { code: "EP-001", features: [{ code: "FE-001", userStories: stories }] },
    ],
  };
  const plan = buildScrumPlanFromBacklog(backlog, undefined, {}) as {
    sprints: Array<{
      number: number;
      userStoryCodes: string[];
      tasks: Array<{ startDay: number; endDay: number; userStoryCode: string }>;
    }>;
  };
  assert.deepEqual(
    plan.sprints.map((sprint) => sprint.number),
    [1, 2, 3],
  );
  const planned = plan.sprints.flatMap((sprint) => sprint.userStoryCodes);
  assert.deepEqual(planned, stories.map((item) => item.code));
  for (const sprint of plan.sprints) {
    const low = (sprint.number - 1) * 15 + 1;
    for (const task of sprint.tasks) {
      assert.ok(task.startDay >= low && task.endDay <= low + 14);
    }
  }
  // La HU-P sin tareas queda programada con una tarea de detalle.
  assert.ok(plan.sprints[2]!.tasks.some((task) => task.userStoryCode === "HU-P-006"));
});

test("una HU-F sin funcionalidad no reintroduce 'Requerimientos por agrupar'", () => {
  const aligned = alignBacklogWithRequirements(
    {
      functionalRequirements: [
        {
          code: "HU-F-001",
          title: "Historia 1",
          milestone: "H-001",
          functionality: "",
          milestoneDescription: "",
        },
      ],
    },
    { epics: [] },
  ) as { epics: Array<{ title: string }> };
  assert.equal(aligned.epics[0]!.title, "Necesidades funcionales identificadas");
  assert.doesNotMatch(JSON.stringify(aligned), /Requerimientos por agrupar/u);
});
