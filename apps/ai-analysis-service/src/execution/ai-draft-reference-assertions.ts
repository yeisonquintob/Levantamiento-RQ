import {
  type AiAnalysisDraftV2,
  type AiAnalysisDraftV3,
  type AiAnalysisDraftV4,
  type AiAnalysisDraftV41,
  type AiPlanningBacklogTaskV41,
  type AiPlanningBacklogUserStoryV41,
} from "@levantamiento-rq/shared-contracts";
import { unique } from "./ai-draft-parse-primitives";

export function assertReferencesV41(draft: AiAnalysisDraftV41): void {
  const functionalCodes = draft.structuredAnalysis.functionalUserStories.map(
    (story) => story.code,
  );
  unique(functionalCodes, "functionalUserStories");
  unique(
    draft.structuredAnalysis.functionalUserStories.flatMap((story) =>
      story.acceptanceCriteria.map((criterion) => criterion.code),
    ),
    "functionalAcceptanceCriteria",
  );
  unique(
    draft.requirements.map((item) => item.code),
    "requirements",
  );
  if (
    draft.requirements.some(
      (item) => item.sectionKey !== "nonFunctionalRequirements",
    )
  ) {
    throw new Error("AiAnalysisDraft 4.1.0 solo admite RNF en requirements.");
  }

  const functionalSet = new Set(functionalCodes);
  const criterionOwner = new Map<string, string>();
  for (const story of draft.structuredAnalysis.functionalUserStories) {
    for (const criterion of story.acceptanceCriteria) {
      criterionOwner.set(criterion.code, story.code);
    }
  }

  const epicCodes: string[] = [];
  const featureCodes: string[] = [];
  const planningStoryCodes: string[] = [];
  const taskCodes: string[] = [];
  const planningStoryFeature = new Map<string, string>();
  const taskDependencies = new Map<string, readonly string[]>();
  for (const epic of draft.structuredAnalysis.backlogStructure.epics) {
    epicCodes.push(epic.code);
    for (const feature of epic.features) {
      featureCodes.push(feature.code);
      for (const story of feature.userStories) {
        planningStoryCodes.push(story.code);
        planningStoryFeature.set(story.code, feature.code);
        if (
          story.functionalRequirementCodes.some(
            (code) => !functionalSet.has(code),
          )
        ) {
          throw new Error(
            `${story.code} referencia una HU funcional inexistente.`,
          );
        }
        for (const task of story.tasks) {
          taskCodes.push(task.code);
          taskDependencies.set(task.code, task.dependencyCodes);
          if (task.sourceNumber && task.origin !== "EVIDENCE") {
            throw new Error(
              `${task.code} proviene de fuente y debe usar origin=EVIDENCE.`,
            );
          }
        }
      }
    }
  }
  /*
   * POINT_5_PENDING_PLANNING_ASSIGNMENTS_V4_7_5
   * Los nodos pendientes se validan y conservan, pero NO forman parte del
   * conjunto canónico disponible para Scrum/Pruebas hasta tener padre.
   */
  const pending = draft.structuredAnalysis.backlogStructure
    .pendingAssignments ?? {
    features: [],
    userStories: [],
    tasks: [],
  };
  const pendingFeatureCodes: string[] = [];
  const pendingStoryCodes: string[] = [];
  const pendingTaskCodes: string[] = [];
  const pendingTaskDependencies = new Map<string, readonly string[]>();

  const inspectPendingTask = (task: AiPlanningBacklogTaskV41): void => {
    pendingTaskCodes.push(task.code);
    pendingTaskDependencies.set(task.code, task.dependencyCodes);
    if (task.sourceNumber && task.origin !== "EVIDENCE") {
      throw new Error(
        `${task.code} proviene de fuente y debe usar origin=EVIDENCE.`,
      );
    }
  };

  const inspectPendingStory = (story: AiPlanningBacklogUserStoryV41): void => {
    pendingStoryCodes.push(story.code);
    if (
      story.functionalRequirementCodes.some((code) => !functionalSet.has(code))
    ) {
      throw new Error(`${story.code} referencia una HU funcional inexistente.`);
    }
    for (const task of story.tasks) inspectPendingTask(task);
  };

  for (const envelope of pending.features) {
    pendingFeatureCodes.push(envelope.item.code);
    for (const story of envelope.item.userStories) inspectPendingStory(story);
  }
  for (const envelope of pending.userStories)
    inspectPendingStory(envelope.item);
  for (const envelope of pending.tasks) inspectPendingTask(envelope.item);

  unique(epicCodes, "epics");
  unique([...featureCodes, ...pendingFeatureCodes], "features");
  unique([...planningStoryCodes, ...pendingStoryCodes], "planningUserStories");
  unique([...taskCodes, ...pendingTaskCodes], "backlogTasks");
  const taskSet = new Set(taskCodes);
  const allTaskSet = new Set([...taskCodes, ...pendingTaskCodes]);

  for (const [taskCode, dependencies] of pendingTaskDependencies) {
    if (dependencies.some((code) => !allTaskSet.has(code))) {
      throw new Error(`${taskCode} referencia una Task inexistente.`);
    }
  }

  const pendingVisiting = new Set<string>();
  const pendingVisited = new Set<string>();
  const visitPendingTask = (code: string): void => {
    if (pendingVisiting.has(code)) {
      throw new Error(
        `Las dependencias de tareas pendientes contienen un ciclo en ${code}.`,
      );
    }
    if (pendingVisited.has(code)) return;
    pendingVisiting.add(code);
    for (const dependency of pendingTaskDependencies.get(code) ?? []) {
      if (pendingTaskDependencies.has(dependency)) visitPendingTask(dependency);
    }
    pendingVisiting.delete(code);
    pendingVisited.add(code);
  };
  for (const code of pendingTaskCodes) visitPendingTask(code);

  for (const [taskCode, dependencies] of taskDependencies) {
    if (dependencies.some((code) => !taskSet.has(code))) {
      throw new Error(`${taskCode} referencia una Task inexistente.`);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (code: string): void => {
    if (visiting.has(code)) {
      throw new Error(
        `Las dependencias de tareas contienen un ciclo en ${code}.`,
      );
    }
    if (visited.has(code)) return;
    visiting.add(code);
    for (const dependency of taskDependencies.get(code) ?? [])
      visit(dependency);
    visiting.delete(code);
    visited.add(code);
  };
  for (const code of taskCodes) visit(code);

  const planningStorySet = new Set(planningStoryCodes);
  const featureSet = new Set(featureCodes);
  const tests = new Set(
    draft.structuredAnalysis.tests.map((item) => item.code),
  );
  unique([...tests], "tests");
  for (const scenario of draft.structuredAnalysis.tests) {
    if (scenario.userStoryCodes.some((code) => !functionalSet.has(code))) {
      throw new Error(
        `${scenario.code} referencia una HU funcional inexistente.`,
      );
    }
    for (const criterionCode of scenario.acceptanceCriterionCodes) {
      const owner = criterionOwner.get(criterionCode);
      if (!owner || !scenario.userStoryCodes.includes(owner)) {
        throw new Error(
          `${scenario.code} referencia un criterio funcional inexistente o ajeno.`,
        );
      }
    }
    if ((scenario.taskCodes ?? []).some((code) => !taskSet.has(code))) {
      throw new Error(`${scenario.code} referencia una Task inexistente.`);
    }
  }

  const plan = draft.structuredAnalysis.scrumPlan;
  if (!plan) return;
  const scrumTaskCodes = plan.sprints.flatMap((sprint) =>
    sprint.tasks.map((task) => task.code),
  );
  unique(
    plan.sprints.map((sprint) => sprint.code),
    "sprints",
  );
  unique(scrumTaskCodes, "scrumTasks");
  const scrumTaskSet = new Set(scrumTaskCodes);
  for (const sprint of plan.sprints) {
    if (sprint.featureCodes.some((code) => !featureSet.has(code))) {
      throw new Error(`${sprint.code} referencia una Feature inexistente.`);
    }
    if (sprint.userStoryCodes.some((code) => !planningStorySet.has(code))) {
      throw new Error(`${sprint.code} referencia una HU-P inexistente.`);
    }
    for (const storyCode of sprint.userStoryCodes) {
      const parent = planningStoryFeature.get(storyCode);
      if (parent && !sprint.featureCodes.includes(parent)) {
        throw new Error(
          `${sprint.code} no incluye la Feature padre de ${storyCode}.`,
        );
      }
    }
    if (sprint.testCodes.some((code) => !tests.has(code))) {
      throw new Error(`${sprint.code} referencia una prueba inexistente.`);
    }
    for (const task of sprint.tasks) {
      if (!planningStorySet.has(task.userStoryCode)) {
        throw new Error(`${task.code} referencia una HU-P inexistente.`);
      }
      if (task.dependencyCodes.some((code) => !scrumTaskSet.has(code))) {
        throw new Error(`${task.code} referencia una Task Scrum inexistente.`);
      }
    }
  }
  const scrumDependencies = new Map(
    plan.sprints.flatMap((sprint) =>
      sprint.tasks.map((task) => [task.code, task.dependencyCodes] as const),
    ),
  );
  const scrumVisiting = new Set<string>();
  const scrumVisited = new Set<string>();
  const visitScrumTask = (code: string): void => {
    if (scrumVisiting.has(code)) {
      throw new Error(
        `Las dependencias de Tasks Scrum contienen un ciclo en ${code}.`,
      );
    }
    if (scrumVisited.has(code)) return;
    scrumVisiting.add(code);
    for (const dependency of scrumDependencies.get(code) ?? []) {
      visitScrumTask(dependency);
    }
    scrumVisiting.delete(code);
    scrumVisited.add(code);
  };
  for (const code of scrumTaskCodes) visitScrumTask(code);

  const scrumTasksByCode = new Map(
    plan.sprints.flatMap((sprint) =>
      sprint.tasks.map((task) => [task.code, task] as const),
    ),
  );
  for (const task of scrumTasksByCode.values()) {
    for (const dependencyCode of task.dependencyCodes) {
      const dependency = scrumTasksByCode.get(dependencyCode);
      if (
        dependency?.endDay !== undefined &&
        task.startDay !== undefined &&
        task.startDay <= dependency.endDay
      ) {
        throw new Error(
          `${task.code} debe iniciar después de finalizar ${dependencyCode}.`,
        );
      }
    }
  }
}

export function assertReferences(
  draft: AiAnalysisDraftV2 | AiAnalysisDraftV3 | AiAnalysisDraftV4,
): void {
  const featureCodes = draft.structuredAnalysis.features.map(
    (item) => item.code,
  );
  const storyCodes = draft.structuredAnalysis.userStories.map(
    (item) => item.code,
  );
  const criterionCodes = draft.structuredAnalysis.userStories.flatMap((story) =>
    story.acceptanceCriteria.map((criterion) => criterion.code),
  );
  const testCodes = draft.structuredAnalysis.tests.map((item) => item.code);
  unique(featureCodes, "features");
  unique(storyCodes, "userStories");
  unique(criterionCodes, "acceptanceCriteria");
  unique(testCodes, "tests");
  unique(
    draft.requirements.map((item) => item.code),
    "requirements",
  );
  const features = new Set(featureCodes);
  const stories = new Set(storyCodes);
  const criteria = new Set(criterionCodes);
  const tests = new Set(testCodes);
  const backlogTasks =
    draft.schemaVersion === "4.0.0"
      ? draft.structuredAnalysis.backlogStructure.epics.flatMap((epic) =>
          epic.features.flatMap((feature) =>
            feature.userStories.flatMap((story) => story.tasks),
          ),
        )
      : [];
  if (draft.schemaVersion === "4.0.0") {
    unique(
      draft.structuredAnalysis.backlogStructure.epics.map((epic) => epic.code),
      "epics",
    );
  }
  const backlogTaskCodes = backlogTasks.map((task) => task.code);
  unique(backlogTaskCodes, "backlogTasks");
  const backlogTaskSet = new Set(backlogTaskCodes);

  for (const story of draft.structuredAnalysis.userStories) {
    if (!features.has(story.featureCode)) {
      throw new Error(`${story.code} referencia una Feature inexistente.`);
    }
  }
  for (const feature of draft.structuredAnalysis.features) {
    for (const storyCode of feature.userStoryCodes) {
      const story = draft.structuredAnalysis.userStories.find(
        (item) => item.code === storyCode,
      );
      if (!story || story.featureCode !== feature.code) {
        throw new Error(
          `${feature.code} referencia una HU inexistente o ajena.`,
        );
      }
    }
    const actual = draft.structuredAnalysis.userStories
      .filter((story) => story.featureCode === feature.code)
      .map((story) => story.code);
    if (actual.some((code) => !feature.userStoryCodes.includes(code))) {
      throw new Error(
        `${feature.code} no agrupa todas sus Historias de Usuario.`,
      );
    }
  }
  for (const scenario of draft.structuredAnalysis.tests) {
    if (
      draft.schemaVersion !== "4.0.0" &&
      scenario.userStoryCodes.length === 0
    ) {
      throw new Error(`${scenario.code} no referencia ninguna HU.`);
    }
    if (scenario.userStoryCodes.some((code) => !stories.has(code))) {
      throw new Error(`${scenario.code} referencia una HU inexistente.`);
    }
    if (scenario.acceptanceCriterionCodes.some((code) => !criteria.has(code))) {
      throw new Error(`${scenario.code} referencia un criterio inexistente.`);
    }
    if ((scenario.taskCodes ?? []).some((code) => !backlogTaskSet.has(code))) {
      throw new Error(`${scenario.code} referencia una tarea inexistente.`);
    }
  }
  if (draft.schemaVersion === "4.0.0") {
    const parent = new Map<string, string>();
    for (const epic of draft.structuredAnalysis.backlogStructure.epics) {
      for (const feature of epic.features) {
        for (const story of feature.userStories) {
          if (story.featureCode !== feature.code) {
            throw new Error(`${story.code} no pertenece a ${feature.code}.`);
          }
          for (const task of story.tasks) {
            parent.set(task.code, story.code);
            if (
              task.dependencyCodes.some((code) => !backlogTaskSet.has(code))
            ) {
              throw new Error(`${task.code} referencia una tarea inexistente.`);
            }
          }
        }
      }
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (code: string): void => {
      if (visiting.has(code)) {
        throw new Error(
          `Las dependencias de tareas contienen un ciclo en ${code}.`,
        );
      }
      if (visited.has(code)) return;
      visiting.add(code);
      const task = backlogTasks.find((item) => item.code === code);
      for (const dependency of task?.dependencyCodes ?? []) visit(dependency);
      visiting.delete(code);
      visited.add(code);
    };
    for (const code of parent.keys()) visit(code);
  }
  const plan = draft.structuredAnalysis.scrumPlan;
  if (!plan) return;
  const taskCodes = plan.sprints.flatMap((sprint) =>
    sprint.tasks.map((task) => task.code),
  );
  unique(
    plan.sprints.map((sprint) => sprint.code),
    "sprints",
  );
  unique(taskCodes, "scrumTasks");
  const tasks = new Set(taskCodes);
  for (const sprint of plan.sprints) {
    if (sprint.featureCodes.some((code) => !features.has(code))) {
      throw new Error(`${sprint.code} referencia una Feature inexistente.`);
    }
    if (sprint.userStoryCodes.some((code) => !stories.has(code))) {
      throw new Error(`${sprint.code} referencia una HU inexistente.`);
    }
    if (sprint.testCodes.some((code) => !tests.has(code))) {
      throw new Error(`${sprint.code} referencia una prueba inexistente.`);
    }
    for (const task of sprint.tasks) {
      if (!stories.has(task.userStoryCode)) {
        throw new Error(`${task.code} referencia una HU inexistente.`);
      }
      if (task.dependencyCodes.some((code) => !tasks.has(code))) {
        throw new Error(`${task.code} referencia una tarea inexistente.`);
      }
    }
  }
}
