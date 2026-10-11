import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAiAnalysisOutputSchemaV41,
  parseAiAnalysisDraft,
} from "../../apps/ai-analysis-service/src/execution/ai-analysis-draft.js";
import { FakeAiProvider } from "../../apps/ai-analysis-service/src/execution/fake-ai.provider.js";
import {
  confirmedEpicMilestoneRoots,
  explicitPlanningFunctionalSeeds,
  explicitPlanningOutlines,
  reconcileAlignedFunctionalDocumentation,
  reconcileExplicitPlanningFunctionalLinks,
  reconcileExplicitPlanningFunctionalStoriesV479,
  reconcileExplicitPlanningStructure,
  validateExplicitPlanningCoverage,
  validateExplicitPlanningFunctionalAlignment,
} from "../../apps/ai-analysis-service/src/execution/ai-prompt-builder.js";
import {
  buildAiAnalysisPromptFromKnowledgeSnapshot,
  buildFunctionalCoverageManifest,
  reconcileFunctionalCoveragePendingNeeds,
  reconcileFunctionalCoverageSourceIds,
  validateFunctionalCoverage,
} from "../../apps/ai-analysis-service/src/local-ai/local-ai-pipeline.service.js";

const SOURCE_ID = "22222222-2222-4222-8222-222222222222";

function withoutRequiredStoryEnrichmentErrors(
  errors: readonly string[],
): string[] {
  return errors.filter(
    (error) =>
      !/debe contener al menos una (?:Feature enriquecida|HU-P completa)/u.test(
        error,
      ),
  );
}

async function rawV41(includesScrum = false): Promise<Record<string, any>> {
  const provider = new FakeAiProvider([
    {
      id: SOURCE_ID,
      title: "Fuente planificación",
      text: "3.2.1 Modelar mantenimiento; 3.2.1.1 Validar prototipo.",
    },
  ]);
  const generated = await provider.generate({
    systemInstruction: "system",
    userPrompt: "prompt",
    schema: buildAiAnalysisOutputSchemaV41(includesScrum),
  });
  const raw = JSON.parse(JSON.stringify(generated.draft)) as Record<
    string,
    any
  >;
  const oldStory =
    raw.structuredAnalysis.backlogStructure.epics[0].features[0].userStories[0];
  const oldCriterion = oldStory.acceptanceCriteria[0];
  const oldTask = oldStory.tasks[0];

  raw.schemaVersion = "4.1.0";
  raw.requirements = raw.requirements.filter(
    (item: Record<string, any>) =>
      item.sectionKey === "nonFunctionalRequirements",
  );
  raw.structuredAnalysis = {
    processFlows: raw.structuredAnalysis.processFlows,
    entityRelationship: raw.structuredAnalysis.entityRelationship,
    functionalUserStories: [
      {
        code: "HU-F-001",
        title: oldStory.title,
        description: oldStory.description,
        milestone: "H-001",
        functionality: "Mantenimiento",
        milestoneDescription: "Hito funcional de mantenimiento.",
        role: oldStory.role,
        want: oldStory.want,
        benefit: oldStory.benefit,
        context: oldStory.context,
        premises: oldStory.premises,
        impactedSystems: oldStory.impactedSystems,
        fields: oldStory.fields,
        acceptanceCriteria: [
          {
            ...oldCriterion,
            code: "CA-F-001-01",
          },
        ],
        sourceIds: oldStory.sourceIds,
      },
    ],
    backlogStructure: {
      epics: raw.structuredAnalysis.backlogStructure.epics.map(
        (epic: Record<string, any>) => ({
          code: epic.code,
          title: epic.title,
          description: epic.description,
          sourceNumber: "3",
          sourceIds: epic.sourceIds,
          features: epic.features.map((feature: Record<string, any>) => ({
            code: feature.code,
            title: feature.title,
            description: feature.description,
            sourceNumber: "3.2",
            sourceIds: feature.sourceIds,
            userStories: feature.userStories.map(() => ({
              code: "HU-P-001",
              title: "Modelar mantenimiento",
              description: "Planificación de implementación.",
              sourceNumber: "3.2.1",
              functionalRequirementCodes: ["HU-F-001"],
              sourceIds: oldStory.sourceIds,
              tasks: [
                {
                  ...oldTask,
                  sourceNumber: "3.2.1.1",
                  origin: "IMPLEMENTATION_PROPOSAL",
                },
              ],
            })),
          })),
        }),
      ),
    },
    tests: raw.structuredAnalysis.tests.map(
      (scenario: Record<string, any>) => ({
        ...scenario,
        userStoryCodes: ["HU-F-001"],
        acceptanceCriterionCodes: ["CA-F-999"],
        taskCodes: [oldTask.code],
      }),
    ),
    scrumPlan: includesScrum ? raw.structuredAnalysis.scrumPlan : null,
  };
  return raw;
}

async function rawV41WithScrumTasks(
  sprintTaskCodes: readonly (readonly string[])[],
): Promise<Record<string, any>> {
  const raw = await rawV41(true);
  const plan = raw.structuredAnalysis.scrumPlan;
  const baseSprint = plan.sprints[0];
  const baseTask = baseSprint.tasks[0];
  plan.sprints = sprintTaskCodes.map((codes, sprintIndex) => ({
    ...structuredClone(baseSprint),
    code: `SPRINT-${String(sprintIndex + 1).padStart(3, "0")}`,
    number: sprintIndex + 1,
    tasks: codes.map((code, taskIndex) => ({
      ...structuredClone(baseTask),
      code,
      description: `Task ${sprintIndex + 1}.${taskIndex + 1}`,
      dependencyCodes: [],
      estimatedDurationDays: 3,
      startDay: sprintIndex * 15 + Math.min(taskIndex * 3, 12) + 1,
      endDay: sprintIndex * 15 + Math.min(taskIndex * 3, 12) + 3,
      startDate: null,
      endDate: null,
    })),
  }));
  return raw;
}

test("V4.9.0 canonicaliza Tasks Scrum duplicadas sin perder nodos", async () => {
  const raw = await rawV41WithScrumTasks([
    ["T-001", "T-002"],
    ["T-001", "T-002"],
  ]);
  const parsed = parseAiAnalysisDraft(raw);
  assert.equal(parsed.schemaVersion, "4.1.0");
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");

  const tasks = parsed.structuredAnalysis.scrumPlan!.sprints.flatMap(
    (sprint) => sprint.tasks,
  );
  assert.deepEqual(
    tasks.map((task) => task.code),
    ["T-001", "T-002", "T-003", "T-004"],
  );
  assert.deepEqual(
    tasks.map((task) => task.description),
    ["Task 1.1", "Task 1.2", "Task 2.1", "Task 2.2"],
  );
  assert.match(parsed.warnings.join("\n"), /Scrum.*duplicado.*T-003/i);
});

test("V4.9.0 canonicaliza códigos de Sprint duplicados", async () => {
  const raw = await rawV41WithScrumTasks([["T-001"], ["T-002"]]);
  raw.structuredAnalysis.scrumPlan.sprints[1].code = "sprint-001";
  raw.structuredAnalysis.scrumPlan.sprints[1].dependencies = ["SPRINT-001"];
  const parsed = parseAiAnalysisDraft(raw);
  assert.equal(parsed.schemaVersion, "4.1.0");
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");
  assert.deepEqual(
    parsed.structuredAnalysis.scrumPlan!.sprints.map((sprint) => sprint.code),
    ["SPRINT-001", "SPRINT-002"],
  );
  assert.deepEqual(
    parsed.structuredAnalysis.scrumPlan!.sprints[1]!.dependencies,
    ["SPRINT-001"],
  );
});

test("V4.9.0 trata aliases Scrum como colisión y minimiza renumeración", async () => {
  const raw = await rawV41WithScrumTasks([["T-001", "t001", "T-003", "T-004"]]);
  const parsed = parseAiAnalysisDraft(raw);
  assert.equal(parsed.schemaVersion, "4.1.0");
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");
  assert.deepEqual(
    parsed.structuredAnalysis.scrumPlan!.sprints[0]!.tasks.map(
      (task) => task.code,
    ),
    ["T-001", "T-002", "T-003", "T-004"],
  );
});

test("V4.9.0 remapea dependencia Scrum por Sprint propietario", async () => {
  const raw = await rawV41WithScrumTasks([["T-001"], ["T-001", "T-009"]]);
  raw.structuredAnalysis.scrumPlan.sprints[1].tasks[1].dependencyCodes = [
    "t001",
  ];
  const parsed = parseAiAnalysisDraft(raw);
  assert.equal(parsed.schemaVersion, "4.1.0");
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");
  assert.deepEqual(
    parsed.structuredAnalysis.scrumPlan!.sprints[1]!.tasks[1]!.dependencyCodes,
    ["T-002"],
  );
});

test("V4.9.0 no inventa destino para dependencia Scrum ambigua", async () => {
  const raw = await rawV41WithScrumTasks([["T-001", "T-001", "T-009"]]);
  raw.structuredAnalysis.scrumPlan.sprints[0].tasks[2].dependencyCodes = [
    "T-001",
  ];
  assert.throws(() => parseAiAnalysisDraft(raw), /referencia ambigua T-001/i);
});

test("V4.9.0 conserva fail-closed para ciclos Scrum tras remapeo", async () => {
  const raw = await rawV41WithScrumTasks([["T-001", "T-002"]]);
  raw.structuredAnalysis.scrumPlan.sprints[0].tasks[0].dependencyCodes = [
    "T-002",
  ];
  raw.structuredAnalysis.scrumPlan.sprints[0].tasks[1].dependencyCodes = [
    "T-001",
  ];
  assert.throws(() => parseAiAnalysisDraft(raw), /Tasks Scrum.*ciclo/i);
});

test("V4.9.0 es determinista con 100 Tasks Scrum repetidas", async () => {
  const codes = Array.from(
    { length: 100 },
    (_, index) => `T-${String((index % 7) + 1).padStart(3, "0")}`,
  );
  const raw = await rawV41WithScrumTasks([codes]);
  const first = parseAiAnalysisDraft(structuredClone(raw));
  const second = parseAiAnalysisDraft(structuredClone(raw));
  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, "4.1.0");
  if (first.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");
  const tasks = first.structuredAnalysis.scrumPlan!.sprints[0]!.tasks;
  assert.equal(tasks.length, 100);
  assert.equal(new Set(tasks.map((task) => task.code)).size, 100);
  assert.deepEqual(
    tasks.map((task) => task.description),
    Array.from({ length: 100 }, (_, index) => `Task 1.${index + 1}`),
  );
});

test("V4.9.0 conserva nodos duplicados de HU-F, CA-F, FE, HU-P y Task", async () => {
  const raw = await rawV41();
  const source2 = "33333333-3333-4333-8333-333333333333";
  const functional = raw.structuredAnalysis.functionalUserStories[0];
  const epic = raw.structuredAnalysis.backlogStructure.epics[0];
  const feature = epic.features[0];
  const planningStory = feature.userStories[0];
  const scenario = raw.structuredAnalysis.tests[0];

  raw.structuredAnalysis.functionalUserStories.push({
    ...structuredClone(functional),
    title: "Segunda necesidad funcional",
    sourceIds: [source2],
    acceptanceCriteria: functional.acceptanceCriteria.map((criterion: any) => ({
      ...criterion,
      sourceIds: [source2],
    })),
  });
  epic.features.push({
    ...structuredClone(feature),
    title: "Segunda Feature explícita",
    sourceNumber: "3.3",
    sourceIds: [source2],
    userStories: [
      {
        ...structuredClone(planningStory),
        title: "Segunda HU-P explícita",
        sourceNumber: "3.3.1",
        sourceIds: [source2],
        tasks: planningStory.tasks.map((task: any) => ({
          ...task,
          title: "Segunda Task explícita",
          description: "Implementar segunda necesidad.",
          sourceNumber: "3.3.1.1",
          sourceIds: [source2],
        })),
      },
    ],
  });
  raw.structuredAnalysis.tests.push({
    ...structuredClone(scenario),
    code: scenario.code,
    title: "Prueba de segunda necesidad",
    sourceIds: [source2],
  });

  const parsed = parseAiAnalysisDraft(raw);
  assert.equal(parsed.schemaVersion, "4.1.0");
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");
  const stories = parsed.structuredAnalysis.functionalUserStories;
  const features =
    parsed.structuredAnalysis.backlogStructure.epics[0]!.features;
  const planningStories = features.flatMap((item) => item.userStories);
  const tasks = planningStories.flatMap((item) => item.tasks);

  assert.deepEqual(
    stories.map((item) => item.code),
    ["HU-F-001", "HU-F-002"],
  );
  assert.deepEqual(
    stories.flatMap((item) =>
      item.acceptanceCriteria.map((criterion) => criterion.code),
    ),
    ["CA-F-001-01", "CA-F-002-01"],
  );
  assert.deepEqual(
    features.map((item) => item.code),
    ["FE-001", "FE-002"],
  );
  assert.deepEqual(
    planningStories.map((item) => item.code),
    ["HU-P-001", "HU-P-002"],
  );
  assert.deepEqual(
    tasks.map((item) => item.code),
    ["T-001", "T-002"],
  );
  assert.deepEqual(
    planningStories.map((item) => item.sourceNumber),
    ["3.2.1", "3.3.1"],
  );
  assert.deepEqual(
    planningStories.map((item) => item.functionalRequirementCodes),
    [["HU-F-001"], ["HU-F-002"]],
  );
  assert.deepEqual(
    parsed.structuredAnalysis.tests.map((item) => ({
      code: item.code,
      stories: item.userStoryCodes,
      criteria: item.acceptanceCriterionCodes,
      tasks: item.taskCodes,
    })),
    [
      { code: "CP-001", stories: ["HU-F-001"], criteria: [], tasks: ["T-001"] },
      { code: "CP-002", stories: ["HU-F-002"], criteria: [], tasks: ["T-002"] },
    ],
  );
});

test("4.1 desacopla HU-F y HU-P, conserva sourceNumber y repara referencias no críticas", async () => {
  const schema = buildAiAnalysisOutputSchemaV41(false);
  assert.equal(schema.properties.schemaVersion.const, "4.1.0");

  const parsed = parseAiAnalysisDraft(await rawV41());
  assert.equal(parsed.schemaVersion, "4.1.0");
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");

  const functional = parsed.structuredAnalysis.functionalUserStories[0];
  const planning =
    parsed.structuredAnalysis.backlogStructure.epics[0]?.features[0]
      ?.userStories[0];
  const task = planning?.tasks[0];
  const scenario = parsed.structuredAnalysis.tests[0];

  assert.equal(functional?.code, "HU-F-001");
  assert.equal(planning?.code, "HU-P-001");
  assert.deepEqual(planning?.functionalRequirementCodes, ["HU-F-001"]);
  assert.equal(planning?.sourceNumber, "3.2.1");
  assert.equal(task?.sourceNumber, "3.2.1.1");
  assert.equal(task?.origin, "EVIDENCE");
  assert.deepEqual(scenario?.userStoryCodes, ["HU-F-001"]);
  assert.deepEqual(scenario?.acceptanceCriterionCodes, []);
  assert.match(parsed.warnings.join("\n"), /criterio inexistente o ajeno/i);

  const reparsed = parseAiAnalysisDraft(JSON.parse(JSON.stringify(parsed)));
  assert.equal(reparsed.schemaVersion, "4.1.0");
  if (reparsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");
  assert.equal(
    reparsed.sections.find((section) => section.key === "milestones")?.key,
    "milestones",
  );
  assert.equal(
    reparsed.structuredAnalysis.backlogStructure.epics[0]?.features[0]
      ?.userStories[0]?.code,
    "HU-P-001",
  );
});

test("V7.4.3 canonicaliza KPI a un objetivo inequívoco y mantiene fail-closed ante ambigüedad", async () => {
  const qualitativeObjective =
    "Fortalecer la trazabilidad de las asignaciones y devoluciones de herramientas.";
  const quantitativeObjective =
    "Reducir el tiempo promedio de aprobación de solicitudes de préstamo en 30%.";

  const raw = await rawV41();
  raw.sections = raw.sections.map((section: Record<string, any>) =>
    section.key === "objectives"
      ? {
          ...section,
          content: {
            general: "Mejorar la gestión de herramientas.",
            qualitative: [qualitativeObjective],
            quantitative: [quantitativeObjective],
          },
        }
      : section.key === "scope"
        ? {
            ...section,
            content: {
              included: ["Gestión de herramientas"],
              excluded: ["Procesos no documentados"],
              involvedSystems: ["NAVI"],
              kpis: [
                {
                  name: "Cobertura de trazabilidad",
                  relatedObjective:
                    "Trazabilidad de asignación y devolución de herramientas",
                  measurement:
                    "Movimientos trazables / total de movimientos × 100.",
                  target: "[PENDIENTE POR DEFINIR]",
                },
                {
                  name: "Integridad de trazabilidad",
                  relatedObjective: qualitativeObjective,
                  measurement:
                    "Movimientos completos / total de movimientos × 100.",
                  target: "[PENDIENTE POR DEFINIR]",
                },
                {
                  name: "Tiempo de aprobación",
                  relatedObjective: quantitativeObjective,
                  measurement:
                    "Promedio de minutos entre solicitud y aprobación.",
                  target: "Reducir 30%.",
                },
              ],
            },
          }
        : section,
  );

  const parsed = parseAiAnalysisDraft(raw);
  if (parsed.schemaVersion !== "4.1.0") {
    throw new Error("Se esperaba V4.1.");
  }

  const scope = parsed.sections.find((section) => section.key === "scope")
    ?.content as Record<string, any>;
  assert.equal(
    scope.kpis[0]?.relatedObjective,
    qualitativeObjective,
    "La paráfrasis inequívoca debe reemplazarse por el texto canónico exacto.",
  );
  assert.match(
    parsed.warnings.join("\n"),
    /KPI 1: relatedObjective se canonicalizó automáticamente.*coincidencia léxica inequívoca/u,
  );

  const ambiguous = await rawV41();
  const assignmentObjective =
    "Mejorar la trazabilidad de asignaciones de herramientas.";
  const returnObjective =
    "Mejorar la trazabilidad de devoluciones de herramientas.";

  ambiguous.sections = ambiguous.sections.map((section: Record<string, any>) =>
    section.key === "objectives"
      ? {
          ...section,
          content: {
            general: "Mejorar la gestión de herramientas.",
            qualitative: [assignmentObjective, returnObjective],
            quantitative: [quantitativeObjective],
          },
        }
      : section.key === "scope"
        ? {
            ...section,
            content: {
              included: ["Gestión de herramientas"],
              excluded: ["Procesos no documentados"],
              involvedSystems: ["NAVI"],
              kpis: [
                {
                  name: "Trazabilidad",
                  relatedObjective: "Mejorar la trazabilidad de herramientas.",
                  measurement:
                    "Movimientos trazables / total de movimientos × 100.",
                  target: "[PENDIENTE POR DEFINIR]",
                },
                {
                  name: "Asignaciones trazables",
                  relatedObjective: assignmentObjective,
                  measurement:
                    "Asignaciones trazables / total de asignaciones × 100.",
                  target: "[PENDIENTE POR DEFINIR]",
                },
                {
                  name: "Tiempo de aprobación",
                  relatedObjective: quantitativeObjective,
                  measurement:
                    "Promedio de minutos entre solicitud y aprobación.",
                  target: "Reducir 30%.",
                },
              ],
            },
          }
        : section,
  );

  assert.throws(
    () => parseAiAnalysisDraft(ambiguous),
    /relatedObjective no referencia de forma inequívoca un objetivo específico/u,
    "Si dos objetivos son igualmente plausibles el backend debe bloquear, no adivinar.",
  );
});

test("4.1 permite cero HU-F antes de reconciliar una estructura explícita", async () => {
  const raw = await rawV41();
  raw.structuredAnalysis.functionalUserStories = [];

  const parsed = parseAiAnalysisDraft(raw);
  assert.equal(parsed.schemaVersion, "4.1.0");
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");
  assert.deepEqual(parsed.structuredAnalysis.functionalUserStories, []);
});

test("4.1 rechaza una HU funcional infiltrada como RNF y acepta pendientes RNF explícitos", async () => {
  const contaminated = await rawV41();

  contaminated.requirements = [
    {
      sectionKey: "nonFunctionalRequirements",
      code: "HU-F-999",
      title: "Historia funcional infiltrada",
      description: "No debe aceptarse como RNF.",
      requirementType: "USER_STORY",
      acceptanceCriteria: ["Criterio funcional infiltrado."],
      sourceIds: [SOURCE_ID],
      milestone: null,
      functionality: null,
      category: null,
      measure: null,
      target: null,
    },
  ];

  assert.throws(
    () => parseAiAnalysisDraft(contaminated),
    /requirements solo admite RNF semánticos completos/u,
  );

  const valid = await rawV41();
  valid.requirements = [
    {
      sectionKey: "nonFunctionalRequirements",
      code: "RNF-001",
      title: "Trazabilidad",
      description: "La operación debe conservar trazabilidad verificable.",
      requirementType: "SECURITY",
      acceptanceCriteria: [
        "DADO un evento operativo, CUANDO se registra, ENTONCES queda disponible para trazabilidad.",
      ],
      sourceIds: [SOURCE_ID],
      milestone: null,
      functionality: null,
      category: "Seguridad",
      measure: "[PENDIENTE POR DEFINIR]",
      target: "[PENDIENTE POR DEFINIR]",
    },
  ];

  const parsed = parseAiAnalysisDraft(valid);
  assert.equal(parsed.schemaVersion, "4.1.0");
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");

  assert.equal(parsed.requirements.length, 1);
  assert.equal(parsed.requirements[0]?.code, "RNF-001");
  assert.equal(parsed.requirements[0]?.category, "Seguridad");
});

test("4.1 obliga al proveedor a devolver RNF documentables y no null", () => {
  const schema = buildAiAnalysisOutputSchemaV41(false) as any;
  const rnf = schema.properties.requirements.items;

  assert.equal(rnf.properties.sectionKey.const, "nonFunctionalRequirements");
  assert.equal(rnf.properties.milestone.type, "null");
  assert.equal(rnf.properties.functionality.type, "null");
  assert.equal(rnf.properties.category.type, "string");
  assert.equal(rnf.properties.measure.type, "string");
  assert.equal(rnf.properties.target.type, "string");
  assert.equal(rnf.properties.acceptanceCriteria.minItems, 1);
});

test("4.1 recupera códigos técnicos cuando la IA usa la numeración humana", async () => {
  const raw = await rawV41();
  const epic = raw.structuredAnalysis.backlogStructure.epics[0];
  const feature = epic.features[0];
  const story = feature.userStories[0];
  const task = story.tasks[0];
  epic.code = "Epic1";
  feature.code = "F1.1";
  story.code = "1.1.1";
  task.code = "Task1.1.1.1";
  raw.structuredAnalysis.tests = [];

  const parsed = parseAiAnalysisDraft(raw);
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");
  const parsedEpic = parsed.structuredAnalysis.backlogStructure.epics[0];
  const parsedFeature = parsedEpic?.features[0];
  const parsedStory = parsedFeature?.userStories[0];
  const parsedTask = parsedStory?.tasks[0];
  assert.equal(parsedEpic?.code, "EP-1");
  assert.equal(parsedFeature?.code, "FE-1-1");
  assert.equal(parsedStory?.code, "HU-P-1-1-1");
  assert.equal(parsedTask?.code, "T-1-1-1-1");
});

test("mantiene legibles los códigos históricos anteriores al formato canónico", async () => {
  const raw = await rawV41();
  const epic = raw.structuredAnalysis.backlogStructure.epics[0];
  epic.code = "E-001";

  const parsed = parseAiAnalysisDraft(raw);
  assert.equal(parsed.schemaVersion, "4.1.0");
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");
  assert.equal(
    parsed.structuredAnalysis.backlogStructure.epics[0]?.code,
    "EP-001",
  );

  epic.code = "[PENDIENTE POR DEFINIR]";
  const pending = parseAiAnalysisDraft(raw);
  if (pending.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");
  assert.equal(
    pending.structuredAnalysis.backlogStructure.epics[0]?.code,
    "EP-PENDIENTE-POR-DEFINIR",
  );
});

test("4.1 restringe todos los sourceIds al conjunto permitido", () => {
  const secondSourceId = "33333333-3333-4333-8333-333333333333";
  const schema = buildAiAnalysisOutputSchemaV41(true, "LARGE_REQUIREMENT", [
    SOURCE_ID,
    secondSourceId,
    SOURCE_ID.toUpperCase(),
  ]) as unknown as Record<string, unknown>;

  const sourceReferenceSchemas: Array<Record<string, unknown>> = [];
  const sourceReferenceKeys = new Set([
    "sourceIds",
    "sourceIdsA",
    "sourceIdsB",
  ]);

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;

    for (const [key, child] of Object.entries(value)) {
      if (
        sourceReferenceKeys.has(key) &&
        child &&
        typeof child === "object" &&
        !Array.isArray(child)
      ) {
        sourceReferenceSchemas.push(child as Record<string, unknown>);
      }
      visit(child);
    }
  };

  visit(schema);
  assert.ok(
    sourceReferenceSchemas.length >= 10,
    "El schema debe contener varias referencias de evidencia restringidas.",
  );

  for (const referenceSchema of sourceReferenceSchemas) {
    const items = referenceSchema.items as Record<string, unknown>;
    assert.equal(items.type, "string");
    assert.deepEqual(items.enum, [SOURCE_ID, secondSourceId]);
    assert.equal(items.pattern, undefined);
  }

  assert.throws(
    () =>
      buildAiAnalysisOutputSchemaV41(false, "MEDIUM_REQUIREMENT", [
        "source-id-no-uuid",
      ]),
    /UUID inválido/i,
  );
});

test("preserva y valida todas las filas de una estructura explícita de Azure DevOps", async () => {
  const source = {
    sourceId: SOURCE_ID,
    snapshotText: [
      "1",
      "Epic",
      "Compra AF",
      "1.1",
      "Feature",
      "Compra herramientas",
      "1.1.1",
      "HU",
      "Estandarizar compra",
      "1.1.1.1",
      "Task",
      "Definir catálogo",
      "2",
      "Epic",
      "Administración AF",
      "2.1",
      "Feature",
      "Administrar herramientas",
    ].join("\n"),
  };
  const outlines = explicitPlanningOutlines([source]);
  assert.equal(outlines[0]?.rows.length, 6);
  assert.deepEqual(
    outlines[0]?.rows.map((row) => `${row.sourceNumber}:${row.kind}`),
    [
      "1:EPIC",
      "1.1:FEATURE",
      "1.1.1:USER_STORY",
      "1.1.1.1:TASK",
      "2:EPIC",
      "2.1:FEATURE",
    ],
  );

  const parsed = parseAiAnalysisDraft(await rawV41());
  const missing = validateExplicitPlanningCoverage(parsed, [source]);

  assert.ok(missing.some((row) => row.startsWith("1 EPIC")));
  assert.ok(
    missing.some((row) =>
      /se esperaban exactamente 2 Epic explícitas/u.test(row),
    ),
    "El manifiesto debe seguir exigiendo exactamente las Epic explícitas del Punto 7.",
  );
  assert.ok(
    !missing.some((row) =>
      /falta H-002.*al menos una HU-F ASSIGNED/u.test(row),
    ),
    "La segunda Epic/Hito puede existir sin HU-F cuando no hay evidencia completa; no debe fabricarse una HU para rellenarla.",
  );
});

test("reconstruye determinísticamente filas explícitas omitidas por la IA", async () => {
  const source = {
    sourceId: SOURCE_ID,
    snapshotText: [
      "1 Epic Compra AF",
      "1.1 Feature Compra herramientas",
      "1.1.1 HU Estandarizar compra",
      "1.1.1.1 Task Definir catálogo",
      "2 Epic Administración AF",
      "2.1 Feature Administrar herramientas",
      "2.1.1 HU Configurar módulo",
    ].join(" "),
  };
  const parsed = parseAiAnalysisDraft(await rawV41());
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");

  const complete = structuredClone(parsed) as any;
  const baseStory = complete.structuredAnalysis.functionalUserStories[0];

  complete.structuredAnalysis.functionalUserStories = [
    {
      ...baseStory,
      code: "HU-F-001",
      milestone: "H-001",
      functionality: "Compra AF",
      milestoneDescription: "Hito Compra AF.",
    },
    {
      ...baseStory,
      code: "HU-F-002",
      milestone: "H-002",
      functionality: "Administración AF",
      milestoneDescription: "Hito Administración AF.",
      acceptanceCriteria: baseStory.acceptanceCriteria.map(
        (criterion: Record<string, any>, index: number) => ({
          ...criterion,
          code: `CA-F-002-${String(index + 1).padStart(2, "0")}`,
        }),
      ),
    },
  ];

  const reconciled = reconcileExplicitPlanningStructure(complete, [source]);

  assert.deepEqual(
    reconciled.structuredAnalysis.backlogStructure.epics.map(
      (epic) => epic.title,
    ),
    ["Compra AF", "Administración AF"],
  );
  assert.equal(
    reconciled.structuredAnalysis.backlogStructure.epics[0]?.features[0]
      ?.userStories[0]?.tasks[0]?.sourceNumber,
    "1.1.1.1",
  );
  /*
   * La prueba construye deliberadamente 2 HU-F antes de reconciliar
   * (H-001 y H-002). Por eso la referencia correcta no es `parsed`,
   * que todavía contiene solamente la HU-F original del fixture.
   *
   * Lo que realmente queremos demostrar es que reconciliar el Punto 7
   * NO fabrica, elimina ni altera las HU-F ya preparadas en Punto 6.
   */
  assert.deepEqual(
    reconciled.structuredAnalysis.functionalUserStories,
    complete.structuredAnalysis.functionalUserStories,
    "Reconstruir Punto 7 no debe fabricar ni eliminar HU-F en Punto 6.",
  );

  assert.equal(
    reconciled.structuredAnalysis.functionalUserStories.length,
    2,
    "La reconciliación debe conservar exactamente H-001 y H-002.",
  );

  assert.deepEqual(validateExplicitPlanningCoverage(reconciled, [source]), []);
});

test("Epic explícitas son conjunto cerrado y Epic equivale a Hito", async () => {
  const source = {
    sourceId: SOURCE_ID,
    snapshotText: [
      "1 Epic Estandarización proceso compra AF",
      "1.1 Feature Proceso compra de herramientas",
      "1.1.1 HU Estandarizar compra de herramientas",
      "2 Epic Implementación módulo Administración AF en ERP",
      "2.1 Feature Administración de Herramientas",
      "3 Epic Análisis Diseño y Desarrollo Herramienta Gestión AF",
      "3.1 Feature Documentar requerimiento",
    ].join(" "),
  };

  const parsed = parseAiAnalysisDraft(await rawV41());
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");

  const epicTitles = [
    "Estandarización proceso compra AF",
    "Implementación módulo Administración AF en ERP",
    "Análisis Diseño y Desarrollo Herramienta Gestión AF",
  ];

  const complete = structuredClone(parsed) as any;
  const baseStory = complete.structuredAnalysis.functionalUserStories[0];

  complete.structuredAnalysis.functionalUserStories = epicTitles.map(
    (title, index) => ({
      ...baseStory,
      code: `HU-F-${String(index + 1).padStart(3, "0")}`,
      milestone: `H-${String(index + 1).padStart(3, "0")}`,
      functionality: title,
      milestoneDescription: `Hito ${title}.`,
      acceptanceCriteria: baseStory.acceptanceCriteria.map(
        (criterion: Record<string, any>, criterionIndex: number) => ({
          ...criterion,
          code:
            `CA-F-${String(index + 1).padStart(3, "0")}-` +
            String(criterionIndex + 1).padStart(2, "0"),
        }),
      ),
    }),
  );

  const reconciled = reconcileExplicitPlanningStructure(complete, [source]);

  assert.deepEqual(
    reconciled.structuredAnalysis.backlogStructure.epics.map(
      (epic) => epic.title,
    ),
    epicTitles,
  );

  assert.deepEqual(
    withoutRequiredStoryEnrichmentErrors(
      validateExplicitPlanningCoverage(reconciled, [source]),
    ),
    [],
  );

  const partial = structuredClone(reconciled) as any;
  partial.structuredAnalysis.functionalUserStories =
    partial.structuredAnalysis.functionalUserStories.slice(0, 1);

  assert.deepEqual(
    withoutRequiredStoryEnrichmentErrors(
      validateExplicitPlanningCoverage(partial, [source]),
    ),
    [],
    "Una Epic/Hito explícita puede existir sin HU-F asignada mientras no haya evidencia completa; no se debe fabricar una HU para rellenarla.",
  );
});

test("Feature HU-P y Task explícitas son mínimo y se conservan ampliaciones dentro de la Epic", async () => {
  const source = {
    sourceId: SOURCE_ID,
    snapshotText: [
      "1 Epic Compra AF",
      "1.1 Feature Compra herramientas",
      "1.1.1 HU Estandarizar compra",
      "1.1.1.1 Task Definir catálogo",
    ].join(" "),
  };

  const parsed = parseAiAnalysisDraft(await rawV41());
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");

  const draft = structuredClone(parsed) as any;

  draft.structuredAnalysis.functionalUserStories =
    draft.structuredAnalysis.functionalUserStories.map(
      (story: Record<string, any>) => ({
        ...story,
        milestone: "H-001",
        functionality: "Compra AF",
        milestoneDescription: "Hito Compra AF.",
      }),
    );

  draft.structuredAnalysis.backlogStructure.epics = [
    {
      code: "EP-001",
      title: "Compra AF",
      description: "Epic explícita.",
      sourceNumber: "1",
      sourceIds: [SOURCE_ID],
      features: [
        {
          code: "FE-001",
          title: "Compra herramientas",
          description: "Feature explícita.",
          sourceNumber: "1.1",
          sourceIds: [SOURCE_ID],
          userStories: [
            {
              code: "HU-P-001",
              title: "Estandarizar compra",
              description: "HU explícita.",
              sourceNumber: "1.1.1",
              functionalRequirementCodes: [],
              sourceIds: [SOURCE_ID],
              tasks: [
                {
                  code: "T-001",
                  title: "Definir catálogo",
                  description: "Task explícita.",
                  sourceNumber: "1.1.1.1",
                  type: "ANALYSIS",
                  origin: "EVIDENCE",
                  dependencyCodes: [],
                  sourceIds: [SOURCE_ID],
                },
                {
                  code: "T-002",
                  title: "Documentar validaciones adicionales",
                  description: "Trabajo adicional identificado.",
                  sourceNumber: null,
                  type: "DOCUMENTATION",
                  origin: "IMPLEMENTATION_PROPOSAL",
                  dependencyCodes: [],
                  sourceIds: [SOURCE_ID],
                },
              ],
            },
            {
              code: "HU-P-002",
              title: "Gestionar aprobación de compra",
              description: "HU adicional respaldada.",
              sourceNumber: null,
              functionalRequirementCodes: [],
              sourceIds: [SOURCE_ID],
              tasks: [],
            },
          ],
        },
        {
          code: "FE-002",
          title: "Gestión complementaria de compra",
          description: "Feature adicional respaldada.",
          sourceNumber: null,
          sourceIds: [SOURCE_ID],
          userStories: [],
        },
      ],
    },
    {
      code: "EP-999",
      title: "Epic adicional no permitida",
      description: "Debe descartarse.",
      sourceNumber: null,
      sourceIds: [SOURCE_ID],
      features: [],
    },
  ];

  const reconciled = reconcileExplicitPlanningStructure(draft, [source]);

  assert.equal(
    reconciled.structuredAnalysis.backlogStructure.epics.length,
    1,
    "Las Epic explícitas forman un conjunto cerrado.",
  );

  const epic = reconciled.structuredAnalysis.backlogStructure.epics[0]!;
  assert.equal(epic.title, "Compra AF");

  assert.ok(
    epic.features.some(
      (feature) => feature.title === "Gestión complementaria de compra",
    ),
    "Las Features adicionales dentro de una Epic explícita se conservan.",
  );

  const explicitFeature = epic.features.find(
    (feature) => feature.title === "Compra herramientas",
  );
  assert.ok(explicitFeature);

  assert.ok(
    explicitFeature.userStories.some(
      (story) => story.title === "Gestionar aprobación de compra",
    ),
    "Las HU-P adicionales dentro de una Feature explícita se conservan.",
  );

  const explicitStory = explicitFeature.userStories.find(
    (story) => story.title === "Estandarizar compra",
  );
  assert.ok(explicitStory);

  assert.ok(
    explicitStory.tasks.some(
      (task) => task.title === "Documentar validaciones adicionales",
    ),
    "Las Tasks adicionales dentro de una HU-P explícita se conservan.",
  );

  assert.deepEqual(
    withoutRequiredStoryEnrichmentErrors(
      validateExplicitPlanningCoverage(reconciled, [source]),
    ),
    [],
  );
});

test("Punto 3 V4.7.3 crea una raíz común EP-### <-> H-### por posición y título", async () => {
  const source = {
    sourceId: SOURCE_ID,
    snapshotText: [
      "1 Epic Estandarización proceso compra AF",
      "1.1 Feature Proceso compra de herramientas",
      "2 Epic Implementación módulo Administración AF en ERP",
      "2.1 Feature Administración de Herramientas",
      "3 Epic Análisis, Diseño y Desarrollo e implementación Herramienta Gestión AF",
    ].join("\n"),
  };

  const parsed = parseAiAnalysisDraft(await rawV41());
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");

  // Simula códigos creativos devueltos por el modelo: la reconciliación no
  // debe conservarlos en las Epic explícitas.
  parsed.structuredAnalysis.backlogStructure.epics[0]!.code = "EP-999";

  const reconciled = reconcileExplicitPlanningStructure(parsed, [source]);
  if (reconciled.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");

  const roots = confirmedEpicMilestoneRoots(
    reconciled.structuredAnalysis.backlogStructure,
  );

  assert.deepEqual(
    roots.map((root) => ({
      epicCode: root.epicCode,
      milestoneCode: root.milestoneCode,
      title: root.title,
    })),
    [
      {
        epicCode: "EP-001",
        milestoneCode: "H-001",
        title: "Estandarización proceso compra AF",
      },
      {
        epicCode: "EP-002",
        milestoneCode: "H-002",
        title: "Implementación módulo Administración AF en ERP",
      },
      {
        epicCode: "EP-003",
        milestoneCode: "H-003",
        title:
          "Análisis, Diseño y Desarrollo e implementación Herramienta Gestión AF",
      },
    ],
  );

  assert.deepEqual(
    withoutRequiredStoryEnrichmentErrors(
      validateExplicitPlanningCoverage(reconciled, [source]),
    ),
    [],
  );
});

test("Punto 3 V4.7.3 conserva la raíz Hito aunque todavía no exista HU-F asignada", async () => {
  const source = {
    sourceId: SOURCE_ID,
    snapshotText: [
      "1 Epic Estandarización proceso compra AF",
      "2 Epic Implementación módulo Administración AF en ERP",
    ].join("\n"),
  };

  const parsed = parseAiAnalysisDraft(await rawV41());
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");
  parsed.structuredAnalysis.functionalUserStories = [];

  const reconciled = reconcileExplicitPlanningStructure(parsed, [source]);
  if (reconciled.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");

  const roots = confirmedEpicMilestoneRoots(
    reconciled.structuredAnalysis.backlogStructure,
  );

  assert.deepEqual(
    roots.map((root) => root.milestoneCode),
    ["H-001", "H-002"],
  );
  assert.equal(reconciled.structuredAnalysis.functionalUserStories.length, 0);
});

test("Punto 3 V4.7.3 rechaza una Epic cuyo código rompe la pareja EP-### <-> H-###", async () => {
  const source = {
    sourceId: SOURCE_ID,
    snapshotText: ["1 Epic Compra AF", "1.1 Feature Compra herramientas"].join(
      "\n",
    ),
  };

  const parsed = parseAiAnalysisDraft(await rawV41());
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");

  const reconciled = reconcileExplicitPlanningStructure(parsed, [source]);
  if (reconciled.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");

  const broken = structuredClone(reconciled) as any;
  broken.structuredAnalysis.backlogStructure.epics[0].code = "EP-777";

  assert.match(
    validateExplicitPlanningCoverage(broken, [source]).join("\n"),
    /EP-001.*H-001/u,
  );
});

test("Punto 4 V4.7.4 baja una HU-F con Hito inválido a PENDING_ASSIGNMENT sin perder contenido", async () => {
  const source = {
    sourceId: SOURCE_ID,
    snapshotText: ["1 Epic Compra AF", "1.1 Feature Compra herramientas"].join(
      "\n",
    ),
  };

  const parsed = parseAiAnalysisDraft(await rawV41());
  if (parsed.schemaVersion !== "4.1.0") {
    throw new Error("Se esperaba V4.1");
  }

  const before = parsed.structuredAnalysis.functionalUserStories[0]!;
  const draft = structuredClone(parsed) as any;

  draft.structuredAnalysis.functionalUserStories[0] = {
    ...before,
    assignmentStatus: "ASSIGNED",
    milestone: "H-999",
    functionality: "Hito inventado",
    milestoneDescription: "No pertenece al árbol explícito.",
    assignmentObservation: null,
  };

  const reconciled = reconcileExplicitPlanningStructure(draft, [source]);

  if (reconciled.schemaVersion !== "4.1.0") {
    throw new Error("Se esperaba V4.1");
  }

  const story = reconciled.structuredAnalysis.functionalUserStories[0]!;

  assert.equal(story.assignmentStatus, "PENDING_ASSIGNMENT");
  assert.equal(story.milestone, null);
  assert.equal(story.functionality, null);
  assert.equal(story.milestoneDescription, null);
  assert.match(story.assignmentObservation ?? "", /asignación humana/u);

  // La historia completa se conserva.
  assert.equal(story.title, before.title);
  assert.equal(story.want, before.want);
  assert.deepEqual(story.acceptanceCriteria, before.acceptanceCriteria);

  assert.deepEqual(
    withoutRequiredStoryEnrichmentErrors(
      validateExplicitPlanningCoverage(reconciled, [source]),
    ),
    [],
  );
});

test("Punto 4 V4.7.4 registra FN sin HU-F como pendiente de documentar y conserva su evidencia", async () => {
  const parsed = parseAiAnalysisDraft(await rawV41());
  if (parsed.schemaVersion !== "4.1.0") {
    throw new Error("Se esperaba V4.1");
  }

  const secondSourceId = "33333333-3333-4333-8333-333333333333";

  const snapshot = {
    projectId: "project",
    findings: {
      functionalRequirements: [
        {
          description: "Registrar la solicitud de compra.",
          sourceIds: [SOURCE_ID],
        },
        {
          description: "Aprobar la solicitud de compra.",
          sourceIds: [SOURCE_ID, secondSourceId],
        },
      ],
    },
  } as never;

  const draft = structuredClone(parsed) as any;
  draft.structuredAnalysis.functionalUserStories[0].functionalNeedCodes = [
    "FN-001",
  ];
  draft.structuredAnalysis.functionalUserStories[0].sourceIds = [SOURCE_ID];

  const withSources = reconcileFunctionalCoverageSourceIds(draft, snapshot);

  const reconciled = reconcileFunctionalCoveragePendingNeeds(
    withSources,
    snapshot,
  );

  const content = reconciled.sections.find(
    (section: Record<string, any>) => section.key === "milestones",
  )?.content as Record<string, any>;

  assert.equal(content.pendingFunctionalNeeds.length, 1);
  assert.equal(content.pendingFunctionalNeeds[0].code, "FN-002");
  assert.equal(
    content.pendingFunctionalNeeds[0].status,
    "PENDING_DOCUMENTATION",
  );
  assert.deepEqual(content.pendingFunctionalNeeds[0].sourceIds, [
    SOURCE_ID,
    secondSourceId,
  ]);

  assert.deepEqual(validateFunctionalCoverage(reconciled, snapshot), []);
});

test("el prompt distingue estructura Epic/Hito confirmada de propuesta IA", async () => {
  const promptSource = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      "apps/ai-analysis-service/src/execution/ai-prompt-builder.ts",
      "utf8",
    ),
  );

  assert.match(promptSource, /CONJUNTO CERRADO/u);
  assert.match(
    promptSource,
    /Cada Epic explícita define exactamente un Hito funcional/u,
  );
  assert.match(promptSource, /EP-001↔H-001/u);
  assert.match(promptSource, /No te limites al ejemplo inicial/u);
  assert.match(promptSource, /contraparte HU-F por cada HU-P final/u);
  assert.match(
    promptSource,
    /cantidad total de HU-P y HU-F debe ser idéntica/u,
  );
  assert.match(
    promptSource,
    /nunca dejes una HU solicitada vacía o PENDING_DOCUMENTATION/u,
  );
  assert.match(promptSource, /Features, HU-P y Tasks adicionales/u);
  assert.match(promptSource, /no crees Epic adicionales/u);
  assert.match(promptSource, /AI_SUGGESTED_STRUCTURE_V7_4_4/u);
  assert.match(promptSource, /structureStatus=AI_SUGGESTED/u);
  assert.match(promptSource, /structureStatus=CONFIRMED/u);
  assert.match(promptSource, /PENDING_ASSIGNMENT/u);
  assert.match(promptSource, /pendingAssignments/u);
  assert.match(promptSource, /Feature.*Epic padre inequívoca/u);
  assert.match(promptSource, /HU-P.*Feature padre inequívoca/u);
  assert.match(promptSource, /Task.*HU-P padre inequívoca/u);
  assert.match(promptSource, /RNF_STRICT_SEPARATION_V1/u);
  assert.match(
    promptSource,
    /requirementType nunca puede ser USER_STORY ni FUNCTIONAL/u,
  );
  assert.match(promptSource, /Nunca dupliques allí una HU-F/u);
});

test("la instrucción confiable admite tablas tabuladas o lineales y reemplaza el árbol anterior", () => {
  const previousSource = {
    sourceId: SOURCE_ID,
    snapshotText:
      "1 Epic Árbol anterior 1.1 Feature Feature anterior 1.1.1 HU HU anterior",
  };
  const instruction = [
    "No.\tTipo\tConcepto",
    "1\tEpic\tEstandarización proceso compra AF",
    "1.1\tFeature\tProceso compra de herramientas",
    "1.1.1\tHU\tEstandarizar proceso compra de Herramientas",
    "2\tEpic\tImplementación módulo Administración AF en ERP",
    "2.1\tFeature\tAdministración de Herramientas",
    "3\tEpic\tAnálisis, Diseño y Desarrollo e implementación Herramienta Gestión AF",
  ].join("\t");

  const outlines = explicitPlanningOutlines([previousSource], instruction);

  assert.equal(outlines.length, 1);
  assert.equal(outlines[0]?.sourceId, "TRUSTED_USER_INSTRUCTION");
  assert.deepEqual(
    outlines[0]?.rows
      .filter((row) => row.kind === "EPIC")
      .map((row) => row.title),
    [
      "Estandarización proceso compra AF",
      "Implementación módulo Administración AF en ERP",
      "Análisis, Diseño y Desarrollo e implementación Herramienta Gestión AF",
    ],
  );
  assert.ok(
    outlines[0]?.rows.some(
      (row) =>
        row.sourceNumber === "1.1.1" &&
        row.kind === "USER_STORY" &&
        row.title === "Estandarizar proceso compra de Herramientas",
    ),
  );
});

test("las HU-P de la instrucción confiable se convierten en semillas funcionales trazables", () => {
  const source = {
    sourceId: SOURCE_ID,
    snapshotText: "El proyecto debe registrar y consultar solicitudes.",
  };
  const instruction = [
    "1 Epic Gestión de solicitudes",
    "1.1 Feature Registro",
    "1.1.1 HU Registrar solicitud",
    "1.1.2 HU Consultar solicitud",
  ].join("\n");

  assert.deepEqual(explicitPlanningFunctionalSeeds([source], instruction), [
    {
      sourceId: SOURCE_ID,
      sourceNumber: "1.1.1",
      parentPath: "1/1.1",
      title: "Registrar solicitud",
    },
    {
      sourceId: SOURCE_ID,
      sourceNumber: "1.1.2",
      parentPath: "1/1.1",
      title: "Consultar solicitud",
    },
  ]);
});

test("una estructura explícita incompleta exige Feature y HU-P antes de aceptar el borrador", async () => {
  const parsed = parseAiAnalysisDraft(await rawV41());
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");

  const epicOnly = {
    sourceId: SOURCE_ID,
    snapshotText: "1 Epic Gestión de solicitudes",
  };
  const epicWithEmptyFeature = {
    sourceId: SOURCE_ID,
    snapshotText: [
      "1 Epic Gestión de solicitudes",
      "1.1 Feature Registro",
    ].join("\n"),
  };

  const epicErrors = validateExplicitPlanningCoverage(
    reconcileExplicitPlanningStructure(parsed, [epicOnly]),
    [epicOnly],
  );
  const featureErrors = validateExplicitPlanningCoverage(
    reconcileExplicitPlanningStructure(parsed, [epicWithEmptyFeature]),
    [epicWithEmptyFeature],
  );

  assert.match(epicErrors.join("\n"), /al menos una Feature enriquecida/u);
  assert.match(featureErrors.join("\n"), /al menos una HU-P completa/u);
});

test("Punto 7 admite títulos repetidos en ramas distintas sin fabricar HU-F en Punto 6", async () => {
  const source = {
    sourceId: SOURCE_ID,
    snapshotText: [
      "1 Epic Operación principal",
      "1.1 Feature Canal A",
      "1.1.1 HU Configuración del módulo",
      "1.2 Feature Canal B",
      "1.2.1 HU Configuración del módulo",
    ].join(" "),
  };
  const parsed = parseAiAnalysisDraft(await rawV41());
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");

  const compatible = structuredClone(parsed) as any;
  compatible.structuredAnalysis.functionalUserStories =
    compatible.structuredAnalysis.functionalUserStories.map(
      (story: Record<string, any>) => ({
        ...story,
        milestone: "H-001",
        functionality: "Operación principal",
        milestoneDescription: "Hito Operación principal.",
      }),
    );

  const functionalBefore = JSON.stringify(
    compatible.structuredAnalysis.functionalUserStories,
  );
  const reconciled = reconcileExplicitPlanningStructure(compatible, [source]);

  assert.equal(
    JSON.stringify(reconciled.structuredAnalysis.functionalUserStories),
    functionalBefore,
  );
  assert.deepEqual(validateExplicitPlanningCoverage(reconciled, [source]), []);

  const planningStories =
    reconciled.structuredAnalysis.backlogStructure.epics[0]?.features.flatMap(
      (feature) => feature.userStories,
    ) ?? [];
  assert.equal(planningStories.length, 2);
  assert.equal(planningStories[0]?.title, "Configuración del módulo");
  assert.equal(planningStories[1]?.title, "Configuración del módulo");
  assert.deepEqual(planningStories[0]?.functionalRequirementCodes, []);
  assert.deepEqual(planningStories[1]?.functionalRequirementCodes, []);
});

test("el prompt especializa títulos repetidos y marcadores de ejemplo sin alterar las Epics", async () => {
  const prompt = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      "apps/ai-analysis-service/src/execution/ai-prompt-builder.ts",
      "utf8",
    ),
  );

  assert.match(prompt, /Los títulos de Epic son decisiones literales/u);
  assert.match(prompt, /XX, XXX o XYZ/u);
  assert.match(prompt, /No copies mecánicamente el mismo título/u);
  assert.match(prompt, /Interpreta la intención de cambio de forma global/u);
});

test("la consolidación local conserva el manifiesto estructural", () => {
  const prompt = [
    "REGLAS",
    "FUENTES_NO_CONFIABLES",
    '[{"content":"texto completo"}]',
    "MANIFIESTO_ESTRUCTURA_EXPLICITA",
    '[{"rows":[{"sourceNumber":"1","kind":"EPIC"}]}]',
    "Devuelve ahora únicamente JSON.",
  ].join("\n");
  const consolidated = buildAiAnalysisPromptFromKnowledgeSnapshot(prompt, {
    projectId: "project",
    findings: {},
  } as never);
  assert.doesNotMatch(consolidated, /texto completo/u);
  assert.match(consolidated, /MANIFIESTO_ESTRUCTURA_EXPLICITA/u);
  assert.match(consolidated, /"sourceNumber":"1"/u);
  assert.match(consolidated, /Devuelve ahora únicamente JSON/u);
});

test("el snapshot local crea un manifiesto FN determinístico y el prompt exige una HU-F por necesidad", () => {
  const snapshot = {
    projectId: "project",
    findings: {
      functionalRequirements: [
        {
          description: "Registrar la solicitud de compra.",
          sourceIds: [SOURCE_ID],
        },
        {
          description: "Aprobar la solicitud de compra.",
          sourceIds: [SOURCE_ID],
        },
      ],
    },
  } as never;

  assert.deepEqual(buildFunctionalCoverageManifest(snapshot), [
    {
      code: "FN-001",
      description: "Registrar la solicitud de compra.",
      sourceIds: [SOURCE_ID],
    },
    {
      code: "FN-002",
      description: "Aprobar la solicitud de compra.",
      sourceIds: [SOURCE_ID],
    },
  ]);

  const consolidated = buildAiAnalysisPromptFromKnowledgeSnapshot(
    [
      "REGLAS",
      "FUENTES_NO_CONFIABLES",
      '[{"content":"texto completo"}]',
      "Devuelve ahora únicamente JSON.",
    ].join("\n"),
    snapshot,
  );

  assert.match(consolidated, /FUNCTIONAL_COVERAGE_MANIFEST_V1/u);
  assert.match(consolidated, /FN-001/u);
  assert.match(consolidated, /FN-002/u);
  assert.match(
    consolidated,
    /debe quedar cubierta por una HU-F o conservarse en pendingFunctionalNeeds/u,
  );
  assert.match(consolidated, /comportamiento funcional compatible/u);
});

test("Punto 2 V4.7.2 propaga sourceIds de FN a la HU-F que declara cubrirla", async () => {
  const parsed = parseAiAnalysisDraft(await rawV41());
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");

  const secondSourceId = "33333333-3333-4333-8333-333333333333";
  const snapshot = {
    projectId: "project",
    findings: {
      functionalRequirements: [
        {
          description: "Registrar la solicitud de compra.",
          sourceIds: [SOURCE_ID, secondSourceId],
        },
      ],
    },
  } as never;

  const draft = structuredClone(parsed) as any;
  draft.structuredAnalysis.functionalUserStories[0] = {
    ...draft.structuredAnalysis.functionalUserStories[0],
    functionalNeedCodes: ["FN-001"],
    sourceIds: [SOURCE_ID],
  };

  const reconciled = reconcileFunctionalCoverageSourceIds(draft, snapshot);

  assert.deepEqual(
    reconciled.structuredAnalysis.functionalUserStories[0]?.sourceIds,
    [SOURCE_ID, secondSourceId],
  );
  assert.deepEqual(validateFunctionalCoverage(reconciled, snapshot), []);
});

test("Punto 2 V4.7.2 no inventa cobertura ni oculta códigos FN desconocidos", async () => {
  const parsed = parseAiAnalysisDraft(await rawV41());
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");

  const snapshot = {
    projectId: "project",
    findings: {
      functionalRequirements: [
        {
          description: "Registrar la solicitud de compra.",
          sourceIds: [SOURCE_ID],
        },
      ],
    },
  } as never;

  const draft = structuredClone(parsed) as any;
  draft.structuredAnalysis.functionalUserStories[0] = {
    ...draft.structuredAnalysis.functionalUserStories[0],
    functionalNeedCodes: ["FN-999"],
    sourceIds: [SOURCE_ID],
  };

  const reconciled = reconcileFunctionalCoverageSourceIds(draft, snapshot);

  assert.deepEqual(
    reconciled.structuredAnalysis.functionalUserStories[0]?.functionalNeedCodes,
    ["FN-999"],
  );
  assert.match(
    validateFunctionalCoverage(reconciled, snapshot).join("\n"),
    /FN-999.*no existe/u,
  );
});

test("Punto 2 V4.7.2 se ejecuta antes de validar y persistir el borrador", async () => {
  const executionService = await import("node:fs/promises").then(
    ({ readFile }) =>
      readFile(
        "apps/ai-analysis-service/src/execution/ai-analysis-execution.service.ts",
        "utf8",
      ),
  );

  const planningLinkIndex = executionService.indexOf(
    "reconcileExplicitPlanningFunctionalStoriesV479(",
  );
  const reconcileIndex = executionService.indexOf(
    "reconcileFunctionalCoverageSourceIds(",
  );
  const pendingIndex = executionService.indexOf(
    "reconcileFunctionalCoveragePendingNeeds(",
  );
  const alignmentValidationIndex = executionService.indexOf(
    "validateExplicitPlanningFunctionalAlignment(",
  );
  const validationIndex = executionService.indexOf(
    "validateFunctionalCoverage(",
  );

  assert.ok(planningLinkIndex >= 0);
  assert.ok(reconcileIndex > planningLinkIndex);
  assert.ok(pendingIndex > reconcileIndex);
  assert.ok(alignmentValidationIndex > pendingIndex);
  assert.ok(validationIndex > alignmentValidationIndex);
  assert.match(executionService, /pendingFunctionalNeeds/u);
});

test("V7.1.2 exige cobertura completa FN y evita reutilizar una FN en varias HU-F", async () => {
  const parsed = parseAiAnalysisDraft(await rawV41());
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");

  const snapshot = {
    projectId: "project",
    findings: {
      functionalRequirements: [
        {
          description: "Registrar la solicitud de compra.",
          sourceIds: [SOURCE_ID],
        },
        {
          description: "Aprobar la solicitud de compra.",
          sourceIds: [SOURCE_ID],
        },
      ],
    },
  } as never;

  const baseStory = parsed.structuredAnalysis.functionalUserStories[0]!;
  const complete = structuredClone(parsed) as any;
  complete.structuredAnalysis.functionalUserStories = [
    {
      ...baseStory,
      code: "HU-F-001",
      functionalNeedCodes: ["FN-001"],
      assignmentStatus: "ASSIGNED",
      assignmentObservation: null,
      role: "Solicitante",
      want: "registrar una solicitud de compra",
      benefit: "iniciar el proceso de compra",
      context: "Radicación de la solicitud",
      sourceIds: [SOURCE_ID],
    },
    {
      ...baseStory,
      code: "HU-F-002",
      title: "Aprobar solicitud de compra",
      functionalNeedCodes: ["FN-002"],
      assignmentStatus: "ASSIGNED",
      assignmentObservation: null,
      role: "Aprobador",
      want: "aprobar una solicitud de compra",
      benefit: "autorizar la continuidad del proceso",
      context: "Aprobación de la solicitud",
      sourceIds: [SOURCE_ID],
      acceptanceCriteria: baseStory.acceptanceCriteria.map(
        (criterion: Record<string, any>, index: number) => ({
          ...criterion,
          code: `CA-F-002-${String(index + 1).padStart(2, "0")}`,
        }),
      ),
    },
  ];

  assert.deepEqual(validateFunctionalCoverage(complete, snapshot), []);

  const missing = structuredClone(complete) as any;
  missing.structuredAnalysis.functionalUserStories =
    missing.structuredAnalysis.functionalUserStories.slice(0, 1);

  assert.match(
    validateFunctionalCoverage(missing, snapshot).join("\n"),
    /FN-002.*ni registrada como pendiente/u,
  );

  const pending = reconcileFunctionalCoveragePendingNeeds(missing, snapshot);

  assert.deepEqual(validateFunctionalCoverage(pending, snapshot), []);

  const milestoneSection = pending.sections.find(
    (section: Record<string, any>) => section.key === "milestones",
  );

  assert.deepEqual(
    (
      milestoneSection?.content as Record<string, any>
    ).pendingFunctionalNeeds.map((need: Record<string, any>) => need.code),
    ["FN-002"],
  );

  const reused = structuredClone(complete) as any;
  reused.structuredAnalysis.functionalUserStories[0].functionalNeedCodes = [
    "FN-001",
    "FN-002",
  ];
  assert.match(
    validateFunctionalCoverage(reused, snapshot).join("\n"),
    /FN-002.*varias HU-F/u,
  );

  const unknown = structuredClone(complete) as any;
  unknown.structuredAnalysis.functionalUserStories[0].functionalNeedCodes = [
    "FN-999",
  ];
  assert.match(
    validateFunctionalCoverage(unknown, snapshot).join("\n"),
    /FN-999.*no existe/u,
  );
});

test("V7.1.2 permite consolidar varias FN en una HU cuando representan el mismo comportamiento", async () => {
  const parsed = parseAiAnalysisDraft(await rawV41());
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");

  const snapshot = {
    projectId: "project",
    findings: {
      functionalRequirements: [
        {
          description: "Registrar solicitud de herramienta.",
          sourceIds: [SOURCE_ID],
        },
        {
          description: "Crear solicitud de herramienta.",
          sourceIds: [SOURCE_ID],
        },
      ],
    },
  } as never;

  const draft = structuredClone(parsed) as any;
  draft.structuredAnalysis.functionalUserStories[0] = {
    ...draft.structuredAnalysis.functionalUserStories[0],
    functionalNeedCodes: ["FN-001", "FN-002"],
    assignmentStatus: "ASSIGNED",
    assignmentObservation: null,
    sourceIds: [SOURCE_ID],
  };

  assert.deepEqual(validateFunctionalCoverage(draft, snapshot), []);
});

test("V7.1.2 detecta duplicado por núcleo funcional pero permite títulos parecidos en contextos distintos", async () => {
  const parsed = parseAiAnalysisDraft(await rawV41());
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");

  const snapshot = {
    projectId: "project",
    findings: {
      functionalRequirements: [
        {
          description: "Documentar desarrollo 1.",
          sourceIds: [SOURCE_ID],
        },
        {
          description: "Documentar desarrollo 2.",
          sourceIds: [SOURCE_ID],
        },
      ],
    },
  } as never;

  const base = parsed.structuredAnalysis.functionalUserStories[0]!;
  const duplicated = structuredClone(parsed) as any;
  duplicated.structuredAnalysis.functionalUserStories = [
    {
      ...base,
      code: "HU-F-001",
      title: "Documentar desarrollo",
      functionalNeedCodes: ["FN-001"],
      assignmentStatus: "ASSIGNED",
      assignmentObservation: null,
      sourceIds: [SOURCE_ID],
    },
    {
      ...base,
      code: "HU-F-002",
      title: "Registrar documentación del desarrollo",
      functionalNeedCodes: ["FN-002"],
      assignmentStatus: "ASSIGNED",
      assignmentObservation: null,
      sourceIds: [SOURCE_ID],
      acceptanceCriteria: base.acceptanceCriteria.map(
        (criterion: Record<string, any>, index: number) => ({
          ...criterion,
          code: `CA-F-002-${String(index + 1).padStart(2, "0")}`,
        }),
      ),
    },
  ];

  assert.match(
    validateFunctionalCoverage(duplicated, snapshot).join("\n"),
    /mismo núcleo funcional y contexto/u,
  );

  const distinct = structuredClone(duplicated) as any;
  distinct.structuredAnalysis.functionalUserStories[1].milestone = "H-002";
  distinct.structuredAnalysis.functionalUserStories[1].functionality =
    "Desarrollo 2";
  distinct.structuredAnalysis.functionalUserStories[1].milestoneDescription =
    "Segundo desarrollo.";
  distinct.structuredAnalysis.functionalUserStories[1].context =
    "Desarrollo 2 de activos tecnológicos";
  distinct.structuredAnalysis.functionalUserStories[1].want =
    "documentar el desarrollo 2 de activos tecnológicos";

  assert.deepEqual(validateFunctionalCoverage(distinct, snapshot), []);
});

test("V4.1 conserva compatibilidad con resultados históricos sin functionalNeedCodes", async () => {
  const raw = await rawV41();
  for (const story of raw.structuredAnalysis.functionalUserStories) {
    delete story.functionalNeedCodes;
  }

  const parsed = parseAiAnalysisDraft(raw);
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");
  assert.deepEqual(
    parsed.structuredAnalysis.functionalUserStories[0]?.functionalNeedCodes,
    [],
  );

  const schema = buildAiAnalysisOutputSchemaV41(false) as any;
  const storySchema =
    schema.properties.structuredAnalysis.properties.functionalUserStories.items;
  assert.ok(storySchema.required.includes("functionalNeedCodes"));
  assert.equal(storySchema.properties.functionalNeedCodes.type, "array");
});

test("V7.4.4 sin estructura explícita propone Punto 7 y alinea Punto 6", async () => {
  const source = {
    sourceId: SOURCE_ID,
    snapshotText:
      "La persona requiere registrar, consultar y aprobar solicitudes de herramientas con trazabilidad.",
  };

  assert.equal(
    explicitPlanningOutlines([source]).length,
    0,
    "La fuente no debe interpretarse como una estructura Epic/Hito explícita.",
  );

  const generated = parseAiAnalysisDraft(await rawV41());
  if (generated.schemaVersion !== "4.1.0") {
    throw new Error("Se esperaba V4.1");
  }

  const planned = reconcileExplicitPlanningStructure(generated, [source]);
  const reconciled = reconcileExplicitPlanningFunctionalStoriesV479(planned, [
    source,
  ]);
  if (reconciled.schemaVersion !== "4.1.0") {
    throw new Error("Se esperaba V4.1");
  }

  assert.equal(
    reconciled.structuredAnalysis.backlogStructure.structureStatus,
    "AI_SUGGESTED",
  );
  assert.ok(
    reconciled.structuredAnalysis.backlogStructure.epics.length > 0,
    "La IA puede proponer Epic/Feature/HU-P/Task en Punto 7.",
  );

  for (const story of reconciled.structuredAnalysis.functionalUserStories) {
    assert.equal(story.assignmentStatus, "ASSIGNED");
    assert.match(story.milestone ?? "", /^H-[0-9]{3}$/u);
    assert.ok(story.functionality?.trim());
    assert.ok(story.milestoneDescription?.trim());
    assert.equal(story.assignmentObservation, null);
  }

  assert.deepEqual(validateExplicitPlanningCoverage(reconciled, [source]), []);
  assert.deepEqual(
    validateExplicitPlanningFunctionalAlignment(reconciled, [source]),
    [],
    "La reconciliación debe dejar completa la alineación sin consumir otro intento del proveedor.",
  );

  const falselyConfirmed = structuredClone(reconciled) as any;
  falselyConfirmed.structuredAnalysis.backlogStructure.structureStatus =
    "CONFIRMED";

  assert.match(
    validateExplicitPlanningCoverage(falselyConfirmed, [source]).join("\n"),
    /structureStatus debe ser AI_SUGGESTED/u,
  );
});

test("V7.4.4 una sola Epic explícita ya define estructura confirmada", () => {
  const source = {
    sourceId: SOURCE_ID,
    snapshotText: "1 Epic Gestión de solicitudes",
  };

  const outlines = explicitPlanningOutlines([source]);
  assert.equal(outlines.length, 1);
  assert.equal(outlines[0]?.rows.length, 1);
  assert.equal(outlines[0]?.rows[0]?.kind, "EPIC");
  assert.equal(outlines[0]?.rows[0]?.title, "Gestión de solicitudes");
});

test("V7.4.4/Punto 5 schema exige estado y permite cero Epic cuando todo queda pendiente", () => {
  const schema = buildAiAnalysisOutputSchemaV41(false) as any;
  const backlog =
    schema.properties.structuredAnalysis.properties.backlogStructure;

  assert.deepEqual(backlog.required, [
    "structureStatus",
    "epics",
    "pendingAssignments",
  ]);
  assert.deepEqual(backlog.properties.structureStatus.enum, [
    "CONFIRMED",
    "AI_SUGGESTED",
  ]);
  assert.equal(backlog.properties.epics.minItems, 0);
});

test("Punto 5 V4.7.5 conserva Feature, HU-P y Task sin padre como pendientes de asignación", async () => {
  const source = {
    sourceId: SOURCE_ID,
    snapshotText: [
      "1.1 Feature Feature sin Epic",
      "1.1.1 HU HU hija de Feature huérfana",
      "1.1.1.1 Task Task hija de HU huérfana",
      "1 Epic Epic confirmada",
      "1.2.1 HU HU sin Feature",
      "1.2.1.1 Task Task hija de HU sin Feature",
      "1.2 Feature Feature confirmada",
      "1.2.2.1 Task Task sin HU-P",
    ].join("\n"),
  };

  const parsed = parseAiAnalysisDraft(await rawV41());
  if (parsed.schemaVersion !== "4.1.0") {
    throw new Error("Se esperaba V4.1");
  }

  const reconciled = reconcileExplicitPlanningStructure(parsed, [source]);

  if (reconciled.schemaVersion !== "4.1.0") {
    throw new Error("Se esperaba V4.1");
  }

  const backlog = reconciled.structuredAnalysis.backlogStructure;
  const pending = backlog.pendingAssignments;

  assert.ok(pending);
  assert.equal(backlog.epics.length, 1);
  assert.equal(backlog.epics[0]?.title, "Epic confirmada");

  assert.equal(pending.features.length, 1);
  assert.equal(pending.features[0]?.assignmentStatus, "PENDING_ASSIGNMENT");
  assert.equal(pending.features[0]?.item.title, "Feature sin Epic");
  assert.equal(
    pending.features[0]?.item.userStories[0]?.title,
    "HU hija de Feature huérfana",
  );
  assert.equal(
    pending.features[0]?.item.userStories[0]?.tasks[0]?.title,
    "Task hija de HU huérfana",
  );

  assert.equal(pending.userStories.length, 1);
  assert.equal(pending.userStories[0]?.item.title, "HU sin Feature");
  assert.equal(
    pending.userStories[0]?.item.tasks[0]?.title,
    "Task hija de HU sin Feature",
  );

  assert.equal(pending.tasks.length, 1);
  assert.equal(pending.tasks[0]?.item.title, "Task sin HU-P");

  assert.deepEqual(
    withoutRequiredStoryEnrichmentErrors(
      validateExplicitPlanningCoverage(reconciled, [source]),
    ),
    [],
  );
});

test("Punto 5 V4.7.5 acepta una estructura explícita sin Epic cuando solo existen work items huérfanos", async () => {
  const source = {
    sourceId: SOURCE_ID,
    snapshotText: [
      "9.1 Feature Feature sin Epic confirmada",
      "9.1.1 HU HU hija de Feature huérfana",
      "9.1.1.1 Task Task hija de HU huérfana",
    ].join("\n"),
  };

  const parsed = parseAiAnalysisDraft(await rawV41());
  if (parsed.schemaVersion !== "4.1.0") {
    throw new Error("Se esperaba V4.1");
  }

  const reconciled = reconcileExplicitPlanningStructure(parsed, [source]);

  if (reconciled.schemaVersion !== "4.1.0") {
    throw new Error("Se esperaba V4.1");
  }

  const backlog = reconciled.structuredAnalysis.backlogStructure;
  assert.equal(backlog.structureStatus, "AI_SUGGESTED");
  assert.equal(backlog.epics.length, 0);
  assert.equal(backlog.pendingAssignments?.features.length, 1);
  assert.equal(
    backlog.pendingAssignments?.features[0]?.item.userStories[0]?.tasks.length,
    1,
  );
  assert.equal(
    reconciled.structuredAnalysis.functionalUserStories[0]?.assignmentStatus,
    "PENDING_ASSIGNMENT",
  );
  assert.deepEqual(
    withoutRequiredStoryEnrichmentErrors(
      validateExplicitPlanningCoverage(reconciled, [source]),
    ),
    [],
  );
});

test("Punto 5 V4.7.5 schema reserva pendingAssignments sin convertirlos en árbol canónico", () => {
  const schema = buildAiAnalysisOutputSchemaV41(false) as any;
  const backlog =
    schema.properties.structuredAnalysis.properties.backlogStructure;
  const pending = backlog.properties.pendingAssignments;

  assert.ok(backlog.required.includes("pendingAssignments"));
  assert.deepEqual(pending.required, ["features", "userStories", "tasks"]);
  assert.equal(
    pending.properties.features.items.properties.assignmentStatus.const,
    "PENDING_ASSIGNMENT",
  );
  assert.equal(
    pending.properties.userStories.items.properties.assignmentStatus.const,
    "PENDING_ASSIGNMENT",
  );
  assert.equal(
    pending.properties.tasks.items.properties.assignmentStatus.const,
    "PENDING_ASSIGNMENT",
  );
});

test("V7.4.4 canonicaliza Hitos confirmados contra cualquier Epic explícita", async () => {
  const source = {
    sourceId: SOURCE_ID,
    snapshotText: [
      "1 Epic Gestión de solicitudes",
      "2 Epic Integración con ERP",
    ].join("\n"),
  };

  const parsed = parseAiAnalysisDraft(await rawV41());
  if (parsed.schemaVersion !== "4.1.0") {
    throw new Error("Se esperaba V4.1");
  }

  const baseStory = parsed.structuredAnalysis.functionalUserStories[0]!;
  const draft = structuredClone(parsed) as any;
  draft.structuredAnalysis.functionalUserStories = [
    {
      ...baseStory,
      code: "HU-F-001",
      assignmentStatus: "ASSIGNED",
      milestone: "H-001",
      functionality: "Solicitudes",
    },
    {
      ...baseStory,
      code: "HU-F-002",
      assignmentStatus: "ASSIGNED",
      milestone: "H-002",
      functionality: "ERP",
      acceptanceCriteria: baseStory.acceptanceCriteria.map(
        (criterion: Record<string, any>, index: number) => ({
          ...criterion,
          code: `CA-F-002-${String(index + 1).padStart(2, "0")}`,
        }),
      ),
    },
  ];

  const reconciled = reconcileExplicitPlanningStructure(draft, [source]);
  if (reconciled.schemaVersion !== "4.1.0") {
    throw new Error("Se esperaba V4.1");
  }

  assert.equal(
    reconciled.structuredAnalysis.backlogStructure.structureStatus,
    "CONFIRMED",
  );
  assert.deepEqual(
    reconciled.structuredAnalysis.backlogStructure.epics.map(
      (epic) => epic.title,
    ),
    ["Gestión de solicitudes", "Integración con ERP"],
  );
  assert.deepEqual(
    reconciled.structuredAnalysis.functionalUserStories.map(
      (story) => story.functionality,
    ),
    ["Gestión de solicitudes", "Integración con ERP"],
  );
  assert.deepEqual(
    withoutRequiredStoryEnrichmentErrors(
      validateExplicitPlanningCoverage(reconciled, [source]),
    ),
    [],
  );
});

test("V7.1.2 acepta HU completa PENDING_ASSIGNMENT sin Hito inventado", async () => {
  const raw = await rawV41();
  const story = raw.structuredAnalysis.functionalUserStories[0];

  story.functionalNeedCodes = ["FN-001"];
  story.assignmentStatus = "PENDING_ASSIGNMENT";
  story.milestone = null;
  story.functionality = null;
  story.milestoneDescription = null;
  story.assignmentObservation =
    "La evidencia completa la necesidad, pero no permite determinar el Hito.";

  const parsed = parseAiAnalysisDraft(raw);
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");

  const pending = parsed.structuredAnalysis.functionalUserStories[0]!;
  assert.equal(pending.assignmentStatus, "PENDING_ASSIGNMENT");
  assert.equal(pending.milestone, null);
  assert.equal(pending.functionality, null);
  assert.equal(pending.milestoneDescription, null);
  assert.match(
    pending.assignmentObservation ?? "",
    /no permite determinar el Hito/u,
  );
});

test("V7.1.2 reconcilia PENDING_ASSIGNMENT con Hito o sin observación", async () => {
  const withMilestone = await rawV41();
  const storyA = withMilestone.structuredAnalysis.functionalUserStories[0];
  storyA.functionalNeedCodes = ["FN-001"];
  storyA.assignmentStatus = "PENDING_ASSIGNMENT";
  storyA.assignmentObservation = "Pendiente de ubicación.";

  const parsedWithMilestone = parseAiAnalysisDraft(withMilestone);
  if (parsedWithMilestone.schemaVersion !== "4.1.0") {
    throw new Error("Se esperaba V4.1");
  }
  const reconciledStory =
    parsedWithMilestone.structuredAnalysis.functionalUserStories[0]!;
  assert.equal(reconciledStory.assignmentStatus, "PENDING_ASSIGNMENT");
  assert.equal(reconciledStory.milestone, null);
  assert.equal(reconciledStory.functionality, null);
  assert.equal(reconciledStory.milestoneDescription, null);
  assert.match(
    parsedWithMilestone.warnings.join("\n"),
    /datos de Hito se descartaron/u,
  );

  const withoutObservation = await rawV41();
  const storyB = withoutObservation.structuredAnalysis.functionalUserStories[0];
  storyB.functionalNeedCodes = ["FN-001"];
  storyB.assignmentStatus = "PENDING_ASSIGNMENT";
  storyB.milestone = null;
  storyB.functionality = null;
  storyB.milestoneDescription = null;
  storyB.assignmentObservation = null;

  const parsedWithoutObservation = parseAiAnalysisDraft(withoutObservation);
  if (parsedWithoutObservation.schemaVersion !== "4.1.0") {
    throw new Error("Se esperaba V4.1");
  }
  assert.match(
    parsedWithoutObservation.structuredAnalysis.functionalUserStories[0]
      ?.assignmentObservation ?? "",
    /requiere validación/u,
  );
});

test("V7.1.2 schema exige estado de asignación y permite Hito nullable", () => {
  const schema = buildAiAnalysisOutputSchemaV41(false) as any;
  const story =
    schema.properties.structuredAnalysis.properties.functionalUserStories.items;

  assert.ok(story.required.includes("assignmentStatus"));
  assert.ok(story.required.includes("assignmentObservation"));
  assert.ok(story.required.includes("documentationStatus"));
  assert.ok(story.required.includes("documentationObservation"));
  assert.ok(story.required.includes("functionalNeedCodes"));
  assert.deepEqual(story.properties.assignmentStatus.enum, [
    "ASSIGNED",
    "PENDING_ASSIGNMENT",
  ]);
  assert.ok(Array.isArray(story.properties.milestone.anyOf));
  assert.equal(story.properties.functionalNeedCodes.minItems, 0);
  assert.equal(story.properties.acceptanceCriteria.minItems, 0);
});

test("Punto 8 V4.7.8 extrae solo HU-P explícitas como semillas funcionales 1:1", () => {
  const source = {
    sourceId: SOURCE_ID,
    snapshotText: [
      "9 Epic Gestión de herramientas",
      "9.1 Feature Préstamos",
      "9.1.1 HU Solicitar herramienta",
      "9.1.1.1 Task Diseñar formulario",
      "9.1.2 HU Devolver herramienta",
      "9.1.2.1 Task Registrar devolución",
    ].join("\n"),
  };

  assert.deepEqual(explicitPlanningFunctionalSeeds([source]), [
    {
      sourceId: SOURCE_ID,
      sourceNumber: "9.1.1",
      parentPath: "9/9.1",
      title: "Solicitar herramienta",
    },
    {
      sourceId: SOURCE_ID,
      sourceNumber: "9.1.2",
      parentPath: "9/9.1",
      title: "Devolver herramienta",
    },
  ]);
});

test("Punto 8 V4.7.8 enlaza cada HU-P explícita con una HU-F distinta del mismo título", async () => {
  const source = {
    sourceId: SOURCE_ID,
    snapshotText: [
      "9 Epic Gestión de herramientas",
      "9.1 Feature Préstamos",
      "9.1.1 HU Solicitar herramienta",
      "9.1.1.1 Task Diseñar formulario",
      "9.1.2 HU Devolver herramienta",
      "9.1.2.1 Task Registrar devolución",
    ].join("\n"),
  };

  const parsed = parseAiAnalysisDraft(await rawV41());
  if (parsed.schemaVersion !== "4.1.0") {
    throw new Error("Se esperaba V4.1");
  }

  const base = parsed.structuredAnalysis.functionalUserStories[0]!;
  const withFunctionalStories = {
    ...parsed,
    structuredAnalysis: {
      ...parsed.structuredAnalysis,
      functionalUserStories: [
        {
          ...base,
          code: "HU-F-001",
          title: "Solicitar herramienta",
          description: "Permitir solicitar una herramienta.",
          functionalNeedCodes: ["FN-001"],
        },
        {
          ...base,
          code: "HU-F-002",
          title: "Devolver herramienta",
          description: "Permitir devolver una herramienta.",
          functionalNeedCodes: ["FN-002"],
          acceptanceCriteria: base.acceptanceCriteria.map(
            (criterion, index) => ({
              ...criterion,
              code: `CA-F-002-${String(index + 1).padStart(2, "0")}`,
            }),
          ),
        },
      ],
    },
  } as typeof parsed;

  const planned = reconcileExplicitPlanningStructure(withFunctionalStories, [
    source,
  ]);
  const linked = reconcileExplicitPlanningFunctionalLinks(planned, [source]);

  if (linked.schemaVersion !== "4.1.0") {
    throw new Error("Se esperaba V4.1");
  }

  const stories =
    linked.structuredAnalysis.backlogStructure.epics[0]?.features[0]
      ?.userStories ?? [];

  assert.deepEqual(
    stories.map((story) => ({
      title: story.title,
      functionalRequirementCodes: story.functionalRequirementCodes,
    })),
    [
      {
        title: "Solicitar herramienta",
        functionalRequirementCodes: ["HU-F-001"],
      },
      {
        title: "Devolver herramienta",
        functionalRequirementCodes: ["HU-F-002"],
      },
    ],
  );

  assert.deepEqual(
    validateExplicitPlanningFunctionalAlignment(linked, [source]),
    [],
  );
});

test("V4.7.9 materializa y completa la HU-F omitida sin otro intento", async () => {
  const source = {
    sourceId: SOURCE_ID,
    snapshotText: [
      "9 Epic Gestión de herramientas",
      "9.1 Feature Préstamos",
      "9.1.1 HU Solicitar herramienta",
      "9.1.2 HU Devolver herramienta",
    ].join("\n"),
  };

  const parsed = parseAiAnalysisDraft(await rawV41());
  if (parsed.schemaVersion !== "4.1.0") {
    throw new Error("Se esperaba V4.1");
  }

  const base = parsed.structuredAnalysis.functionalUserStories[0]!;
  const incomplete = {
    ...parsed,
    structuredAnalysis: {
      ...parsed.structuredAnalysis,
      functionalUserStories: [
        {
          ...base,
          code: "HU-F-001",
          title: "Solicitar herramienta",
          functionalNeedCodes: ["FN-001"],
        },
      ],
    },
  } as typeof parsed;

  const planned = reconcileExplicitPlanningStructure(incomplete, [source]);
  const linked = reconcileExplicitPlanningFunctionalLinks(planned, [source]);
  const completed = reconcileAlignedFunctionalDocumentation(linked, [source]);

  assert.deepEqual(
    validateExplicitPlanningFunctionalAlignment(completed, [source]),
    [],
  );
  if (linked.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");
  assert.equal(completed.structuredAnalysis.functionalUserStories.length, 2);
  assert.equal(
    completed.structuredAnalysis.functionalUserStories[1]?.documentationStatus,
    "COMPLETE",
  );
});

const V479_SOURCE = {
  sourceId: SOURCE_ID,
  snapshotText: [
    "1 Epic Operación global",
    "1.1 Feature Solicitudes",
    "1.1.1 HU Registrar solicitud",
    "1.1.2 HU Aprobar solicitud",
    "1.2 Feature Consultas",
    "1.2.1 HU Consultar solicitud",
  ].join("\n"),
};

async function v479CompleteStory(
  code: string,
  title: string,
  criterionSequence: number,
) {
  const parsed = parseAiAnalysisDraft(await rawV41());
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");
  const base = parsed.structuredAnalysis.functionalUserStories[0]!;
  return {
    ...base,
    code,
    title,
    description: `Permitir ${title.toLocaleLowerCase("es")}.`,
    documentationStatus: "COMPLETE" as const,
    documentationObservation: null,
    functionalNeedCodes: [],
    sourceIds: [SOURCE_ID],
    acceptanceCriteria: base.acceptanceCriteria.map((criterion, index) => ({
      ...criterion,
      code: `CA-F-${String(criterionSequence).padStart(3, "0")}-${String(index + 1).padStart(2, "0")}`,
      sourceIds: [SOURCE_ID],
    })),
  };
}

async function reconcileV479(stories: readonly any[], source = V479_SOURCE) {
  const parsed = parseAiAnalysisDraft(await rawV41());
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");
  const input = {
    ...parsed,
    structuredAnalysis: {
      ...parsed.structuredAnalysis,
      functionalUserStories: [...stories],
      backlogStructure: {
        structureStatus: "AI_SUGGESTED" as const,
        epics: [],
        pendingAssignments: { features: [], userStories: [], tasks: [] },
      },
    },
  };
  const planned = reconcileExplicitPlanningStructure(input, [source]);
  return reconcileExplicitPlanningFunctionalStoriesV479(planned, [source]);
}

test("V4.7.9 alinea también las HU-P adicionales de la IA y elimina HU-F fuera del esquema", async () => {
  const source = {
    sourceId: SOURCE_ID,
    snapshotText: [
      "1 Epic Gestión de solicitudes",
      "1.1 Feature Registro",
      "1.1.1 HU Registrar solicitud",
    ].join("\n"),
  };
  const [registerStory, notifyStory, unrelatedStory] = await Promise.all([
    v479CompleteStory("HU-F-001", "Registrar solicitud", 1),
    v479CompleteStory("HU-F-002", "Notificar resultado", 2),
    v479CompleteStory("HU-F-003", "Historia fuera del esquema", 3),
  ]);
  const parsed = parseAiAnalysisDraft(await rawV41());
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");

  const planned = reconcileExplicitPlanningStructure(
    {
      ...parsed,
      structuredAnalysis: {
        ...parsed.structuredAnalysis,
        functionalUserStories: [registerStory, notifyStory, unrelatedStory],
      },
    },
    [source],
  );
  if (planned.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");
  const feature =
    planned.structuredAnalysis.backlogStructure.epics[0]?.features[0];
  const explicitStory = feature?.userStories[0];
  assert.ok(feature && explicitStory);
  feature.userStories.push({
    ...structuredClone(explicitStory),
    code: "HU-P-900",
    title: "Notificar resultado",
    description: "Notificar el resultado del registro al actor del proceso.",
    sourceNumber: null,
    functionalRequirementCodes: [],
    tasks: [],
  });

  const reconciled = reconcileExplicitPlanningFunctionalStoriesV479(planned, [
    source,
  ]);
  if (reconciled.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");

  const planningStories =
    reconciled.structuredAnalysis.backlogStructure.epics[0]?.features[0]
      ?.userStories ?? [];
  assert.equal(planningStories.length, 2);
  assert.equal(reconciled.structuredAnalysis.functionalUserStories.length, 2);
  assert.deepEqual(
    reconciled.structuredAnalysis.functionalUserStories.map(
      (story) => story.title,
    ),
    ["Registrar solicitud", "Notificar resultado"],
  );
  assert.equal(
    new Set(
      planningStories.flatMap((story) => story.functionalRequirementCodes),
    ).size,
    2,
  );
  assert.deepEqual(
    validateExplicitPlanningFunctionalAlignment(reconciled, [source]),
    [],
  );
});

test("V4.7.9 caso 1: tres HU-P y tres HU-F completas conservan alineación 1:1", async () => {
  const stories = await Promise.all([
    v479CompleteStory("HU-F-001", "Registrar solicitud", 1),
    v479CompleteStory("HU-F-002", "Aprobar solicitud", 2),
    v479CompleteStory("HU-F-003", "Consultar solicitud", 3),
  ]);
  const reconciled = await reconcileV479(stories);
  if (reconciled.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");
  assert.deepEqual(
    reconciled.structuredAnalysis.functionalUserStories.map(
      (story) => story.documentationStatus,
    ),
    ["COMPLETE", "COMPLETE", "COMPLETE"],
  );
  assert.deepEqual(
    validateExplicitPlanningFunctionalAlignment(reconciled, [V479_SOURCE]),
    [],
  );
});

test("V4.7.9 reparación final completa omisiones documentales sin repetir OpenAI", async () => {
  const reconciled = await reconcileV479([]);
  if (reconciled.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");

  const degraded = structuredClone(reconciled);
  for (const story of degraded.structuredAnalysis.functionalUserStories) {
    story.documentationStatus = "PENDING_DOCUMENTATION";
    story.documentationObservation = "Respuesta incompleta del proveedor.";
    story.role = "[PENDIENTE POR DEFINIR]";
    story.benefit = "[PENDIENTE POR DEFINIR]";
    story.context = "[PENDIENTE POR DEFINIR]";
    story.acceptanceCriteria = [];
  }

  const repaired = reconcileAlignedFunctionalDocumentation(degraded, [
    V479_SOURCE,
  ]);
  assert.deepEqual(
    validateExplicitPlanningFunctionalAlignment(repaired, [V479_SOURCE]),
    [],
  );
  assert.ok(
    repaired.structuredAnalysis.functionalUserStories.every(
      (story) =>
        story.documentationStatus === "COMPLETE" &&
        story.documentationObservation === null &&
        story.role === "Usuario autorizado" &&
        story.benefit.trim().length > 0 &&
        story.context.trim().length > 0 &&
        story.acceptanceCriteria.length > 0,
    ),
  );
});

test("V4.7.9 casos 2 y 3: completa una o tres HU-F cuando el proveedor omite historias", async () => {
  const twoComplete = await Promise.all([
    v479CompleteStory("HU-F-001", "Registrar solicitud", 1),
    v479CompleteStory("HU-F-002", "Aprobar solicitud", 2),
  ]);
  const partial = await reconcileV479(twoComplete);
  const empty = await reconcileV479([]);
  if (partial.schemaVersion !== "4.1.0" || empty.schemaVersion !== "4.1.0") {
    throw new Error("Se esperaba V4.1");
  }
  assert.equal(partial.structuredAnalysis.functionalUserStories.length, 3);
  assert.deepEqual(
    partial.structuredAnalysis.functionalUserStories.map(
      (story) => story.documentationStatus,
    ),
    ["COMPLETE", "COMPLETE", "COMPLETE"],
  );
  assert.equal(empty.structuredAnalysis.functionalUserStories.length, 3);
  assert.ok(
    empty.structuredAnalysis.functionalUserStories.every(
      (story) =>
        story.documentationStatus === "COMPLETE" &&
        story.acceptanceCriteria.length > 0,
    ),
  );
});

test("V4.7.9 caso 4: títulos iguales bajo parentPath diferentes generan HU-F distintas", async () => {
  const source = {
    sourceId: SOURCE_ID,
    snapshotText: [
      "1 Epic Operación",
      "1.1 Feature Configuración A",
      "1.1.1 HU Configurar módulo",
      "1.2 Feature Configuración B",
      "1.2.1 HU Configurar módulo",
    ].join("\n"),
  };
  const reconciled = await reconcileV479([], source);
  if (reconciled.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");
  const functional = reconciled.structuredAnalysis.functionalUserStories;
  assert.equal(functional.length, 2);
  assert.equal(new Set(functional.map((story) => story.code)).size, 2);
  const planning =
    reconciled.structuredAnalysis.backlogStructure.epics[0]!.features.flatMap(
      (feature) => feature.userStories,
    );
  assert.equal(
    new Set(planning.flatMap((story) => story.functionalRequirementCodes)).size,
    2,
  );
});

test("V4.7.9 casos 5 y 6: reutiliza y completa documentación conservadora desde la HU-P", async () => {
  const complete = await v479CompleteStory(
    "HU-F-010",
    "Registrar solicitud",
    10,
  );
  const reconciled = await reconcileV479([complete]);
  if (reconciled.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");
  const reused = reconciled.structuredAnalysis.functionalUserStories.find(
    (story) => story.code === "HU-F-010",
  )!;
  const pending = reconciled.structuredAnalysis.functionalUserStories.find(
    (story) => story.title === "Aprobar solicitud",
  )!;
  assert.equal(reused.documentationStatus, "COMPLETE");
  assert.ok(
    reused.role && reused.context && reused.acceptanceCriteria.length > 0,
  );
  assert.equal(pending.documentationStatus, "COMPLETE");
  assert.equal(pending.role, "Usuario autorizado");
  assert.equal(pending.want, "Aprobar solicitud");
  assert.deepEqual(pending.fields, []);
  assert.ok(pending.acceptanceCriteria.length > 0);
});

test("V4.7.9 casos 7 y 8: sin semillas explícitas alinea también las HU-P sugeridas", async () => {
  const parsed = parseAiAnalysisDraft(await rawV41());
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");
  const narrative = {
    sourceId: SOURCE_ID,
    snapshotText: "Necesidad narrativa sin árbol explícito.",
  };
  const planned = reconcileExplicitPlanningStructure(parsed, [narrative]);
  const reconciled = reconcileExplicitPlanningFunctionalStoriesV479(planned, [
    narrative,
  ]);
  assert.equal(reconciled.schemaVersion, "4.1.0");
  if (reconciled.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");
  assert.equal(
    reconciled.structuredAnalysis.functionalUserStories.length,
    reconciled.structuredAnalysis.backlogStructure.epics.reduce(
      (total, epic) =>
        total +
        epic.features.reduce(
          (featureTotal, feature) => featureTotal + feature.userStories.length,
          0,
        ),
      0,
    ),
  );
  assert.ok(
    reconciled.structuredAnalysis.functionalUserStories.every(
      (story) =>
        story.assignmentStatus === "ASSIGNED" && Boolean(story.milestone),
    ),
  );
});

test("V4.7.9 casos 11 y 12: el validador bloquea 2 enlaces y HU-F compartida", async () => {
  const reconciled = await reconcileV479([]);
  if (reconciled.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");
  const corruptedTwoLinks = structuredClone(reconciled) as any;
  const planningStories =
    corruptedTwoLinks.structuredAnalysis.backlogStructure.epics[0].features.flatMap(
      (feature: any) => feature.userStories,
    );
  planningStories[0].functionalRequirementCodes = ["HU-F-001", "HU-F-002"];
  assert.match(
    validateExplicitPlanningFunctionalAlignment(corruptedTwoLinks, [
      V479_SOURCE,
    ]).join("\n"),
    /debe enlazar exactamente una HU-F/u,
  );

  const corruptedShared = structuredClone(reconciled) as any;
  const sharedStories =
    corruptedShared.structuredAnalysis.backlogStructure.epics[0].features.flatMap(
      (feature: any) => feature.userStories,
    );
  sharedStories[1].functionalRequirementCodes = [
    sharedStories[0].functionalRequirementCodes[0],
  ];
  assert.match(
    validateExplicitPlanningFunctionalAlignment(corruptedShared, [
      V479_SOURCE,
    ]).join("\n"),
    /está enlazada a más de una HU-P explícita/u,
  );
});

test("V4.7.9 casos 13 y 14: estados documental y de asignación son independientes", async () => {
  const reconciled = await reconcileV479([]);
  if (reconciled.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");
  assert.equal(
    reconciled.structuredAnalysis.functionalUserStories[0]?.assignmentStatus,
    "ASSIGNED",
  );
  assert.equal(
    reconciled.structuredAnalysis.functionalUserStories[0]?.documentationStatus,
    "COMPLETE",
  );

  const raw = await rawV41();
  const story = raw.structuredAnalysis.functionalUserStories[0];
  story.assignmentStatus = "PENDING_ASSIGNMENT";
  story.milestone = null;
  story.functionality = null;
  story.milestoneDescription = null;
  story.assignmentObservation = "Pendiente de ubicación estructural.";
  story.documentationStatus = "COMPLETE";
  story.documentationObservation = null;
  const parsed = parseAiAnalysisDraft(raw);
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");
  assert.equal(
    parsed.structuredAnalysis.functionalUserStories[0]?.documentationStatus,
    "COMPLETE",
  );
});

test("V4.7.9 caso 15: resultados históricos sin documentationStatus se leen como COMPLETE", async () => {
  const raw = await rawV41();
  delete raw.structuredAnalysis.functionalUserStories[0].documentationStatus;
  delete raw.structuredAnalysis.functionalUserStories[0]
    .documentationObservation;
  const parsed = parseAiAnalysisDraft(raw);
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");
  assert.equal(
    parsed.structuredAnalysis.functionalUserStories[0]?.documentationStatus,
    "COMPLETE",
  );
  assert.equal(
    parsed.structuredAnalysis.functionalUserStories[0]
      ?.documentationObservation,
    null,
  );
});

test("V4.7.9 degrada COMPLETE incompleto y permite PENDING_DOCUMENTATION sin CA-F", async () => {
  const invalidComplete = await rawV41();
  const completeStory =
    invalidComplete.structuredAnalysis.functionalUserStories[0];
  completeStory.documentationStatus = "COMPLETE";
  completeStory.documentationObservation = null;
  completeStory.role = "[PENDIENTE POR DEFINIR]";
  const reconciledComplete = parseAiAnalysisDraft(invalidComplete);
  if (reconciledComplete.schemaVersion !== "4.1.0") {
    throw new Error("Se esperaba V4.1");
  }
  const downgraded =
    reconciledComplete.structuredAnalysis.functionalUserStories[0]!;
  assert.equal(downgraded.documentationStatus, "PENDING_DOCUMENTATION");
  assert.match(downgraded.documentationObservation ?? "", /role/u);
  assert.match(
    reconciledComplete.warnings.join("\n"),
    /se corrigió de COMPLETE a PENDING_DOCUMENTATION/u,
  );

  const validPending = await rawV41();
  const pendingStory = validPending.structuredAnalysis.functionalUserStories[0];
  pendingStory.documentationStatus = "PENDING_DOCUMENTATION";
  pendingStory.documentationObservation =
    "Faltan rol y criterios verificables.";
  pendingStory.role = "[PENDIENTE POR DEFINIR]";
  pendingStory.acceptanceCriteria = [];
  pendingStory.functionalNeedCodes = [];
  const parsed = parseAiAnalysisDraft(validPending);
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");
  assert.equal(
    parsed.structuredAnalysis.functionalUserStories[0]?.acceptanceCriteria
      .length,
    0,
  );
});

test("V4.7.9 normaliza observaciones incompatibles sin descartar una HU completa", async () => {
  const raw = await rawV41();
  const story = raw.structuredAnalysis.functionalUserStories[0];
  story.documentationStatus = "COMPLETE";
  story.documentationObservation =
    "La historia quedó documentada y lista para implementación.";
  story.assignmentStatus = "ASSIGNED";
  story.assignmentObservation = "Asignada al Hito confirmado.";

  const parsed = parseAiAnalysisDraft(raw);
  if (parsed.schemaVersion !== "4.1.0") throw new Error("Se esperaba V4.1");
  const normalized = parsed.structuredAnalysis.functionalUserStories[0]!;

  assert.equal(normalized.documentationStatus, "COMPLETE");
  assert.equal(normalized.documentationObservation, null);
  assert.equal(normalized.assignmentStatus, "ASSIGNED");
  assert.equal(normalized.assignmentObservation, null);
  assert.match(
    parsed.warnings.join("\n"),
    /documentationObservation se normalizó a null/u,
  );
  assert.match(
    parsed.warnings.join("\n"),
    /assignmentObservation se normalizó a null/u,
  );
});
