import {
  AI_SCRUM_TASK_TYPES,
  type AiScrumPlan,
  type AiScrumSprint,
  type AiScrumTask,
} from "@levantamiento-rq/shared-contracts";
import {
  object,
  string,
  nullableString,
  integer,
  strings,
  array,
  sourceIds,
  isoDate,
  addDays,
} from "./ai-draft-parse-primitives";

function parseTask(
  value: unknown,
  name: string,
  schedule: {
    sprintStartDay: number;
    sprintEndDay: number;
    fallbackStartDay: number;
    confirmedStartDate: string | null;
  },
): AiScrumTask {
  const task = object(value, name);
  const type = string(task.type, `${name}.type`, 30);
  if (!AI_SCRUM_TASK_TYPES.includes(type as never)) {
    throw new Error(`${name}.type no está permitido.`);
  }
  const startDay =
    typeof task.startDay === "number"
      ? integer(task.startDay, `${name}.startDay`, 1, 1_500)
      : schedule.fallbackStartDay;
  const endDay =
    typeof task.endDay === "number"
      ? integer(task.endDay, `${name}.endDay`, 1, 1_500)
      : startDay;
  if (
    startDay < schedule.sprintStartDay ||
    endDay > schedule.sprintEndDay ||
    endDay < startDay
  ) {
    throw new Error(
      `${name} debe programarse entre los días ${schedule.sprintStartDay} y ${schedule.sprintEndDay} de su Sprint.`,
    );
  }
  // El rango programado es la fuente canónica de la duración. Los modelos de
  // IA pueden devolver una estimación distinta aun usando salida estructurada;
  // normalizarla evita invalidar el documento completo por un dato derivable.
  const estimatedDurationDays = endDay - startDay + 1;
  return {
    code: string(task.code, `${name}.code`, 50),
    type: type as AiScrumTask["type"],
    description: string(task.description, `${name}.description`, 2_000),
    userStoryCode: string(task.userStoryCode, `${name}.userStoryCode`, 50),
    suggestedRole: string(task.suggestedRole, `${name}.suggestedRole`, 300),
    dependencyCodes: strings(
      task.dependencyCodes,
      `${name}.dependencyCodes`,
      30,
    ),
    expectedResult: string(
      task.expectedResult,
      `${name}.expectedResult`,
      2_000,
    ),
    estimatedDurationDays,
    startDay,
    endDay,
    startDate: schedule.confirmedStartDate
      ? addDays(schedule.confirmedStartDate, startDay - 1)
      : null,
    endDate: schedule.confirmedStartDate
      ? addDays(schedule.confirmedStartDate, endDay - 1)
      : null,
  };
}

export function parseScrumPlan(value: unknown): AiScrumPlan | null {
  if (value === null) return null;
  const plan = object(value, "structuredAnalysis.scrumPlan");
  if (plan.cadenceDays !== 15) {
    throw new Error("El plan Scrum debe usar Sprints de 15 días calendario.");
  }
  const scheduleBasis = string(
    plan.scheduleBasis,
    "structuredAnalysis.scrumPlan.scheduleBasis",
    30,
  );
  if (scheduleBasis !== "RELATIVE_DAY" && scheduleBasis !== "CONFIRMED_DATE") {
    throw new Error("scheduleBasis no es válido.");
  }
  const rawStartDate = nullableString(
    plan.confirmedStartDate,
    "structuredAnalysis.scrumPlan.confirmedStartDate",
    10,
  );
  const confirmedStartDate = rawStartDate
    ? isoDate(rawStartDate, "structuredAnalysis.scrumPlan.confirmedStartDate")
    : null;
  if (
    (scheduleBasis === "CONFIRMED_DATE" && !confirmedStartDate) ||
    (scheduleBasis === "RELATIVE_DAY" && confirmedStartDate)
  ) {
    throw new Error(
      "La fecha confirmada debe existir únicamente cuando scheduleBasis es CONFIRMED_DATE.",
    );
  }

  const sprints: AiScrumSprint[] = array(
    plan.sprints,
    "structuredAnalysis.scrumPlan.sprints",
    40,
  ).map((item, index) => {
    const name = `structuredAnalysis.scrumPlan.sprints[${index}]`;
    const sprint = object(item, name);
    const number = integer(sprint.number, `${name}.number`, 1, 100);
    if (number !== index + 1) {
      throw new Error("Los Sprints deben ser consecutivos y comenzar en 1.");
    }
    const startDay = index * 15 + 1;
    const endDay = startDay + 14;
    const startDate = confirmedStartDate
      ? addDays(confirmedStartDate, index * 15)
      : null;
    const endDate = startDate ? addDays(startDate, 14) : null;
    return {
      code: string(sprint.code, `${name}.code`, 50),
      number,
      period:
        startDate && endDate
          ? `${startDate} al ${endDate}`
          : `Día ${startDay} al Día ${endDay}`,
      startDay,
      endDay,
      startDate,
      endDate,
      objective: string(sprint.objective, `${name}.objective`, 2_000),
      featureCodes: strings(sprint.featureCodes, `${name}.featureCodes`, 100),
      userStoryCodes: strings(
        sprint.userStoryCodes,
        `${name}.userStoryCodes`,
        100,
      ),
      tasks: array(sprint.tasks, `${name}.tasks`, 200).map((task, taskIndex) =>
        parseTask(task, `${name}.tasks[${taskIndex}]`, {
          sprintStartDay: startDay,
          sprintEndDay: endDay,
          fallbackStartDay: Math.min(startDay + taskIndex, endDay),
          confirmedStartDate,
        }),
      ),
      dependencies: strings(sprint.dependencies, `${name}.dependencies`, 100),
      testCodes: strings(sprint.testCodes, `${name}.testCodes`, 100),
      deliverables: strings(sprint.deliverables, `${name}.deliverables`, 100),
      closingCriterion: string(
        sprint.closingCriterion,
        `${name}.closingCriterion`,
        2_000,
      ),
      risks: strings(sprint.risks, `${name}.risks`, 100),
    };
  });
  return {
    cadenceDays: 15,
    scheduleBasis,
    confirmedStartDate,
    sourceIds: sourceIds(
      plan.sourceIds,
      "structuredAnalysis.scrumPlan.sourceIds",
    ),
    sprints,
  };
}

export function reconcileScrumDependencies(
  plan: AiScrumPlan | null,
): AiScrumPlan | null {
  if (!plan) return null;

  const sprintCodes = new Set(plan.sprints.map((sprint) => sprint.code));
  const taskCodes = new Set(
    plan.sprints.flatMap((sprint) => sprint.tasks.map((task) => task.code)),
  );

  return {
    ...plan,
    sprints: plan.sprints.map((sprint) => {
      const sprintDependencies = new Set(sprint.dependencies);
      const tasks = sprint.tasks.map((task) => {
        const taskDependencies: string[] = [];

        for (const dependencyCode of task.dependencyCodes) {
          if (taskCodes.has(dependencyCode)) {
            taskDependencies.push(dependencyCode);
          } else if (sprintCodes.has(dependencyCode)) {
            // Los modelos suelen ubicar una dependencia de Sprint dentro de una
            // tarea. Se conserva a nivel de Sprint, que es su ubicación canónica.
            if (dependencyCode !== sprint.code) {
              sprintDependencies.add(dependencyCode);
            }
          } else {
            // Se conserva para que assertReferences rechace referencias realmente
            // inexistentes en vez de ocultar información inconsistente.
            taskDependencies.push(dependencyCode);
          }
        }

        return {
          ...task,
          dependencyCodes: [...new Set(taskDependencies)],
        };
      });

      return {
        ...sprint,
        tasks,
        dependencies: [...sprintDependencies],
      };
    }),
  };
}
