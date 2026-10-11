import assert from "node:assert/strict";
import test from "node:test";
import type {
  ProjectSummary,
  RequirementDocumentDetail,
  SourceListResponse,
} from "@levantamiento-rq/shared-contracts";
import {
  PROJECT_DAY_LIMIT,
  PROJECT_DAY_SCALE,
  projectStageDays,
  projectProgress,
} from "../../apps/web/src/app/workspace/home-workspace";
import { calculateValidationStageProgress } from "../../apps/web/src/app/workspace/home-stage-progress";

const sources = { items: [] } as unknown as SourceListResponse;
const draft = {
  id: "document",
  status: "DRAFT",
  currentVersionDetail: { sections: [], fields: [], requirements: [] },
} as unknown as RequirementDocumentDetail;

test("un nuevo borrador reabre la etapa documental tras aprobar o ejecutar", () => {
  for (const status of [
    "APPROVED",
    "VALIDATION",
    "EXECUTION",
    "COMPLETED",
  ] as const) {
    const project = {
      id: "project",
      description: "",
      status,
    } as ProjectSummary;
    const result = projectProgress(project, sources, draft);
    assert.equal(result.stageIndex, 3);
    assert.equal(result.stageLabel, "Generar documento");
    assert.equal(result.stagePercentages[4], 0);
    assert.equal(draft.status, "DRAFT");
  }
});

test("el nuevo borrador no reabre un proyecto archivado", () => {
  const result = projectProgress(
    { id: "project", description: "", status: "ARCHIVED" } as ProjectSummary,
    sources,
    draft,
  );
  assert.equal(result.stageLabel, "Archivado");
});

test("un primer borrador no adquiere una aprobación inexistente", () => {
  assert.equal(
    calculateValidationStageProgress("DRAFT", "DOCUMENT_GENERATED"),
    0,
  );
});

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-09T12:00:00Z");
const isoDaysAgo = (days: number) => new Date(NOW - days * DAY).toISOString();
const daysOf = (result: ReturnType<typeof projectStageDays>) =>
  result.stages.map((stage) => [stage.key, stage.days, stage.reached]);

test("el avance del proyecto guarda las fechas que miden cada etapa", () => {
  const project = { id: "project", description: "", status: "DRAFT" } as ProjectSummary;
  const withSources = {
    items: [
      { id: "discussion", createdAt: "2026-09-20T10:00:00.000Z" },
      { id: "other", createdAt: "2026-09-10T10:00:00.000Z" },
    ],
  } as unknown as SourceListResponse;
  const document = {
    ...draft,
    status: "IN_REVIEW",
    createdAt: "2026-09-25T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
  } as unknown as RequirementDocumentDetail;

  assert.deepEqual(projectProgress(project, withSources, document).stats, {
    firstSourceAt: "2026-09-10T10:00:00.000Z",
    discussionSourceAt: null,
    documentCreatedAt: "2026-09-25T10:00:00.000Z",
    validationStartedAt: "2026-10-01T10:00:00.000Z",
  });
  assert.deepEqual(projectProgress(project, sources, null).stats, {
    firstSourceAt: null,
    discussionSourceAt: null,
    documentCreatedAt: null,
    validationStartedAt: null,
  });
  // Un borrador todavía no entró a validación.
  assert.equal(
    projectProgress(project, sources, {
      ...draft,
      updatedAt: "2026-10-01T10:00:00.000Z",
    } as unknown as RequirementDocumentDetail).stats?.validationStartedAt,
    null,
  );
});

test("los días se miden por etapa hasta la actual y suman el total", () => {
  const result = projectStageDays(
    isoDaysAgo(30),
    {
      firstSourceAt: isoDaysAgo(18),
      discussionSourceAt: isoDaysAgo(20),
      documentCreatedAt: isoDaysAgo(10),
      validationStartedAt: isoDaysAgo(4),
    },
    4,
    NOW,
  );
  assert.equal(result.totalDays, 30);
  assert.deepEqual(daysOf(result), [
    ["creation", 0, true],
    ["discussion", 10, true],
    ["sources", 10, true],
    ["document", 6, true],
    ["validation", 4, true],
  ]);
  assert.equal(result.stages.at(-1)?.current, true);
  assert.equal(
    result.stages.reduce((total, stage) => total + stage.days, 0),
    30,
  );
});

test("la medición se detiene en la etapa actual aunque existan las cinco", () => {
  const result = projectStageDays(
    isoDaysAgo(12),
    {
      firstSourceAt: isoDaysAgo(6),
      discussionSourceAt: null,
      documentCreatedAt: null,
      validationStartedAt: null,
    },
    2,
    NOW,
  );
  assert.deepEqual(daysOf(result), [
    ["creation", 0, true],
    ["discussion", 6, true],
    ["sources", 6, true],
    ["document", 0, false],
    ["validation", 0, false],
  ]);
  assert.deepEqual(
    result.stages.map((stage) => stage.current),
    [false, false, true, false, false],
  );
});

test("la ejecución no cuenta: la etapa 6 queda en validación y un proyecto de hoy vale cero", () => {
  const stats = {
    firstSourceAt: isoDaysAgo(8),
    discussionSourceAt: null,
    documentCreatedAt: isoDaysAgo(5),
    validationStartedAt: isoDaysAgo(2),
  };
  const execution = projectStageDays(isoDaysAgo(10), stats, 5, NOW);
  assert.equal(execution.stages.length, 5);
  assert.equal(execution.stages.at(-1)?.current, true);

  const today = projectStageDays(new Date(NOW).toISOString(), undefined, 0, NOW);
  assert.equal(today.totalDays, 0);
  assert.deepEqual(daysOf(today)[0], ["creation", 0, true]);

  const invalid = projectStageDays("no-es-fecha", undefined, 3, NOW);
  assert.equal(invalid.totalDays, 0);
  assert.equal(invalid.stages.filter((stage) => stage.reached).length, 1);
});

test("el límite es de 15 días y la escala base de 30", () => {
  assert.equal(PROJECT_DAY_LIMIT, 15);
  assert.equal(PROJECT_DAY_SCALE, 30);
});

test("Ejecución solo se completa con el 100 % de las tareas aunque el proyecto figure completado", () => {
  const tasks = Array.from({ length: 7 }, (_, index) => ({
    code: `TA-00${index + 1}`,
    title: `Tarea ${index + 1}`,
  }));
  const approved = {
    id: "document",
    title: "Documento",
    projectId: "project",
    status: "APPROVED",
    currentVersionDetail: {
      sections: [
        {
          key: "backlogStructure",
          content: {
            epics: [
              {
                code: "EP-001",
                title: "Épica",
                features: [
                  { code: "FE-001", title: "F", userStories: [{ code: "HU-001", title: "H", tasks }] },
                ],
              },
            ],
          },
        },
      ],
      fields: [],
      requirements: [],
    },
  } as unknown as RequirementDocumentDetail;
  const project = { id: "project", description: "x", status: "COMPLETED" } as ProjectSummary;
  const statuses = (done: number) =>
    tasks.map((task, index) => ({
      taskCode: task.code,
      state: index < done ? "DONE" : "PENDING",
    })) as never;

  const partial = projectProgress(project, sources, approved, statuses(4));
  assert.equal(partial.stagePercentages[5], 57);
  assert.ok(partial.stagePercentages.slice(0, 5).some((value) => value < 100));
  assert.equal(partial.stageIndex, 5);
  assert.equal(partial.stageLabel, "Ejecución");

  const full = projectProgress(project, sources, approved, statuses(7));
  assert.equal(full.stagePercentages[5], 100);
  assert.equal(full.stageLabel, "Ejecución finalizada");
});
