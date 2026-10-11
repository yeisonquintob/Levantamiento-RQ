// AI_ANALYSIS_LOCAL_ONLY_V2_BACKLOG_ALIGNMENT_V1
//
// Requerimientos (Hitos → HU-F) y Esquema (Épicas → HU-P) describen la misma
// estructura vista desde dos ángulos: cada Épica corresponde a un Hito y cada
// HU-F tiene su HU-P. Un modelo local pequeño genera ambos puntos por separado
// y no garantiza esa correspondencia, así que aquí se impone de forma
// determinista sobre el resultado ya normalizado. Solo reordena y reasigna lo
// que el modelo escribió: no inventa tareas ni descripciones.
import type { DocumentJsonValue } from "@levantamiento-rq/shared-contracts";
import {
  buildPrototypeRequestBrief,
  PROTOTYPE_NOT_REQUESTED,
} from "./prototype-request-brief";
import { normalizeLocalOnlyV2SectionContent } from "./local-only-v2-section-content";

type Rec = Record<string, DocumentJsonValue>;

const PENDING = "[PENDIENTE POR DEFINIR]";
const UNGROUPED_TITLE = "Necesidades funcionales identificadas";

function rec(value: unknown): Rec | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Rec)
    : null;
}

function recs(value: unknown): Rec[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const entry = rec(item);
        return entry ? [entry] : [];
      })
    : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isPending(value: string): boolean {
  return !value || value.includes("PENDIENTE POR DEFINIR");
}

function pad(prefix: string, number: number): string {
  return `${prefix}-${String(number).padStart(3, "0")}`;
}

interface Hito {
  code: string;
  title: string;
  description: string;
  stories: Rec[];
}

function groupHitos(stories: Rec[]): Hito[] {
  const hitos: Hito[] = [];
  const byKey = new Map<string, Hito>();
  for (const story of stories) {
    const code = text(story.milestone) || "SIN-HITO";
    let hito = byKey.get(code);
    if (!hito) {
      hito = {
        code,
        title: text(story.functionality) || UNGROUPED_TITLE,
        description: text(story.milestoneDescription),
        stories: [],
      };
      byKey.set(code, hito);
      hitos.push(hito);
    }
    hito.stories.push(story);
  }
  return hitos;
}

interface PlanningStory {
  story: Rec;
  featureTitle: string;
  featureDescription: string;
}

/**
 * Reorganiza el Esquema para que tenga una Épica por Hito y una HU-P por
 * HU-F. Si no hay Requerimientos utilizables devuelve el Esquema intacto.
 */
export function alignBacklogWithRequirements(
  requirements: DocumentJsonValue,
  backlog: DocumentJsonValue,
): DocumentJsonValue {
  const requirementsRecord = rec(requirements);
  const backlogRecord = rec(backlog);
  if (!requirementsRecord || !backlogRecord) return backlog;
  const functional = recs(requirementsRecord.functionalRequirements).filter(
    (story) => /^HU-F-\d+$/u.test(text(story.code)),
  );
  if (functional.length === 0) return backlog;
  const hitos = groupHitos(functional);
  const validCodes = new Set(functional.map((story) => text(story.code)));

  const planning: PlanningStory[] = [];
  for (const epic of recs(backlogRecord.epics)) {
    for (const feature of recs(epic.features)) {
      for (const story of recs(feature.userStories)) {
        planning.push({
          story,
          featureTitle: text(feature.title),
          featureDescription: text(feature.description),
        });
      }
    }
  }

  // 1) HU-P que ya referencian una HU-F existente.
  const claimed = new Map<string, PlanningStory>();
  const used = new Set<PlanningStory>();
  for (const item of planning) {
    const refs = (
      Array.isArray(item.story.functionalRequirementCodes)
        ? item.story.functionalRequirementCodes
        : []
    ).filter(
      (code): code is string =>
        typeof code === "string" && validCodes.has(code),
    );
    const target = refs.find((code) => !claimed.has(code));
    if (target) {
      claimed.set(target, item);
      used.add(item);
    }
  }
  // 2) HU-P sin referencia válida ocupan, por posición, las HU-F sin HU-P.
  const spare = planning.filter((item) => !used.has(item));
  for (const story of functional) {
    const code = text(story.code);
    if (claimed.has(code)) continue;
    const item = spare.shift();
    if (item) claimed.set(code, item);
  }

  let featureNumber = 0;
  let storyNumber = 0;
  const epics = hitos.map((hito, hitoIndex) => {
    const features: Rec[] = [];
    const featureByTitle = new Map<string, Rec>();
    const featureFor = (title: string, description: string): Rec => {
      const key = title.toLocaleLowerCase("es");
      const existing = featureByTitle.get(key);
      if (existing) return existing;
      featureNumber += 1;
      const feature: Rec = {
        code: pad("FE", featureNumber),
        title: title || hito.title,
        description: description || title || hito.title,
        sourceNumber: null,
        sourceIds: [],
        userStories: [],
      };
      featureByTitle.set(key, feature);
      features.push(feature);
      return feature;
    };

    for (const hu of hito.stories) {
      const code = text(hu.code);
      const found = claimed.get(code);
      const feature = featureFor(
        found?.featureTitle ?? "",
        found?.featureDescription ?? "",
      );
      storyNumber += 1;
      const title = text(found?.story.title);
      const description = text(found?.story.description);
      (feature.userStories as Rec[]).push({
        code: pad("HU-P", storyNumber),
        title: isPending(title) ? text(hu.title) || PENDING : title,
        description: isPending(description)
          ? text(hu.title) || PENDING
          : description,
        sourceNumber: found?.story.sourceNumber ?? null,
        functionalRequirementCodes: [code],
        sourceIds: [],
        tasks: recs(found?.story.tasks),
      });
    }

    const hitoDescription = hito.description;
    return {
      code: pad("EP", hitoIndex + 1),
      title: hito.title,
      description: isPending(hitoDescription) ? hito.title : hitoDescription,
      sourceNumber: null,
      sourceIds: [],
      features,
    };
  });

  return { ...backlogRecord, epics };
}

const SPRINT_DAYS = 15;
const MAX_TASKS_PER_SPRINT = 8;

/**
 * Plan de trabajo derivado del Esquema: recorre Épicas → Features → HU-P en
 * orden y las reparte en Sprints consecutivos (15 días cada uno), de modo que
 * cada HU-P aparece exactamente una vez y en secuencia. Las tareas son las del
 * Esquema; una HU-P sin tareas recibe una tarea de detalle para que quede
 * programada. Si el Esquema no tiene HU-P, devuelve `fallback`.
 */
export function buildScrumPlanFromBacklog(
  backlog: DocumentJsonValue,
  tests: DocumentJsonValue | undefined,
  fallback: DocumentJsonValue,
): DocumentJsonValue {
  const backlogRecord = rec(backlog);
  if (!backlogRecord) return fallback;
  interface Entry {
    story: Rec;
    featureCode: string;
    tasks: Rec[];
  }
  const entries: Entry[] = [];
  for (const epic of recs(backlogRecord.epics)) {
    for (const feature of recs(epic.features)) {
      for (const story of recs(feature.userStories)) {
        const tasks = recs(story.tasks);
        entries.push({
          story,
          featureCode: text(feature.code),
          tasks:
            tasks.length > 0
              ? tasks
              : [
                  {
                    code: "",
                    type: "ANALYSIS",
                    title: `Detallar y planificar: ${text(story.title)}`,
                    description: `Detallar y planificar: ${text(story.title)}`,
                    dependencyCodes: [],
                  },
                ],
        });
      }
    }
  }
  if (entries.length === 0) return fallback;

  const scenarios = recs(rec(tests)?.scenarios);
  const groups: Entry[][] = [];
  let current: Entry[] = [];
  let count = 0;
  for (const entry of entries) {
    if (
      current.length > 0 &&
      count + entry.tasks.length > MAX_TASKS_PER_SPRINT
    ) {
      groups.push(current);
      current = [];
      count = 0;
    }
    current.push(entry);
    count += entry.tasks.length;
  }
  if (current.length > 0) groups.push(current);

  const scheduled = new Set<string>();
  let taskNumber = 0;
  const sprints = groups.map((group, index) => {
    const number = index + 1;
    const start = (number - 1) * SPRINT_DAYS + 1;
    const all = group.flatMap((entry) =>
      entry.tasks.map((task) => ({ entry, task })),
    );
    const perTask = Math.max(1, Math.floor(SPRINT_DAYS / all.length));
    const storyCodes = group.map((entry) => text(entry.story.code));
    const tasks = all.map(({ entry, task }, position) => {
      taskNumber += 1;
      const originalCode = text(task.code);
      const code = originalCode || pad("T", 900 + taskNumber);
      const startDay = Math.min(
        start + SPRINT_DAYS - 1,
        start + position * perTask,
      );
      const endDay = Math.min(
        start + SPRINT_DAYS - 1,
        position === all.length - 1
          ? start + SPRINT_DAYS - 1
          : startDay + perTask - 1,
      );
      const dependencies = (
        Array.isArray(task.dependencyCodes) ? task.dependencyCodes : []
      ).filter(
        (dependency): dependency is string =>
          typeof dependency === "string" && scheduled.has(dependency),
      );
      scheduled.add(code);
      const title = text(task.title);
      const description = text(task.description);
      return {
        code,
        type: text(task.type) || "ANALYSIS",
        description: isPending(title) ? description || PENDING : title,
        userStoryCode: text(entry.story.code),
        suggestedRole: PENDING,
        dependencyCodes: dependencies,
        expectedResult: isPending(description) ? PENDING : description,
        estimatedDurationDays: endDay - startDay + 1,
        startDay,
        endDay,
      };
    });
    return {
      code: pad("SP", number),
      number,
      objective:
        group
          .map((entry) => text(entry.story.title))
          .filter((title) => !isPending(title))
          .join("; ")
          .slice(0, 300) || PENDING,
      featureCodes: [
        ...new Set(group.map((entry) => entry.featureCode)),
      ].filter(Boolean),
      userStoryCodes: storyCodes,
      tasks,
      dependencies: [],
      testCodes: scenarios
        .filter((scenario) =>
          (Array.isArray(scenario.userStoryCodes)
            ? scenario.userStoryCodes
            : []
          ).some(
            (code) => typeof code === "string" && storyCodes.includes(code),
          ),
        )
        .map((scenario) => text(scenario.code))
        .filter(Boolean),
      deliverables: [],
      closingCriterion: PENDING,
      risks: [],
    };
  });

  return {
    cadenceDays: SPRINT_DAYS,
    scheduleBasis: "RELATIVE_DAY",
    confirmedStartDate: null,
    sourceIds: [],
    sprints,
  };
}

// AI_ANALYSIS_LOCAL_ONLY_V2_TESTS_FROM_REQUIREMENTS_V1
//
// Si el modelo local no entregó ningún escenario válido para «Pruebas», el
// punto no puede quedar vacío: cada HU-F ya trae su contexto, su necesidad y sus
// criterios de aceptación. Aquí se arma un escenario por HU-F solo con esos
// datos (sin inventar códigos, cifras ni resultados) y se enlazan las tareas de
// la HU-P que la materializa. Un resultado del modelo con escenarios no se toca.
function hasScenarios(content: DocumentJsonValue | undefined): boolean {
  return recs(rec(content)?.scenarios).length > 0;
}

function deriveTestsFromRequirements(
  requirements: DocumentJsonValue,
  backlog: DocumentJsonValue | undefined,
): DocumentJsonValue | null {
  const functional = recs(rec(requirements)?.functionalRequirements).filter(
    (story) => /^HU-F-\d+$/u.test(text(story.code)),
  );
  const tasksByStory = new Map<string, string[]>();
  for (const epic of recs(rec(backlog)?.epics)) {
    for (const feature of recs(epic.features)) {
      for (const planned of recs(feature.userStories)) {
        const taskCodes = recs(planned.tasks)
          .map((task) => text(task.code))
          .filter((code) => /^T-\d+$/u.test(code));
        const refs = Array.isArray(planned.functionalRequirementCodes)
          ? planned.functionalRequirementCodes
          : [];
        for (const ref of refs) {
          if (typeof ref === "string") {
            tasksByStory.set(ref, [
              ...(tasksByStory.get(ref) ?? []),
              ...taskCodes,
            ]);
          }
        }
      }
    }
  }
  const scenarios: Rec[] = [];
  for (const story of functional) {
    const criteria = recs(story.acceptanceCriteria).filter((criterion) =>
      /^CA-F-\d+$/u.test(text(criterion.code)),
    );
    const title = text(story.title);
    if (criteria.length === 0 || isPending(title)) continue;
    const premise = Array.isArray(story.premises)
      ? story.premises.find(
          (item) => typeof item === "string" && !isPending(item),
        )
      : undefined;
    const context = text(story.context);
    const want = text(story.want);
    const results = criteria
      .map((criterion) => text(criterion.then))
      .filter((value) => !isPending(value));
    scenarios.push({
      code: pad("TS", scenarios.length + 1),
      title: `Verificar: ${title}`,
      userStoryCodes: [text(story.code)],
      acceptanceCriterionCodes: criteria.map((criterion) =>
        text(criterion.code),
      ),
      taskCodes: [...new Set(tasksByStory.get(text(story.code)) ?? [])],
      precondition: !isPending(context)
        ? context
        : typeof premise === "string"
          ? premise
          : PENDING,
      action: !isPending(want) ? want : title,
      expectedResult: results.length > 0 ? results.join("; ") : PENDING,
      sourceIds: Array.isArray(story.sourceIds)
        ? story.sourceIds.filter((id): id is string => typeof id === "string")
        : [],
    });
  }
  return scenarios.length > 0 ? { scenarios } : null;
}

interface SectionLike {
  readonly key: string;
  readonly content: DocumentJsonValue;
}

/**
 * Normaliza cada sección generada y aplica la alineación Requerimientos ↔
 * Esquema. `currentContent` entrega el contenido vigente de una sección.
 */
export function normalizeLocalOnlyV2Sections<T extends SectionLike>(
  sections: readonly T[],
  currentContent: (key: string) => DocumentJsonValue | undefined,
  /** Punto 13 solo se genera si se pidió el prototipo. */
  includePrototype = false,
): Array<{ key: string; content: DocumentJsonValue }> {
  const normalized = sections.map((section) => ({
    key: section.key,
    content: normalizeLocalOnlyV2SectionContent(
      section.key,
      section.content,
      currentContent(section.key) ?? section.content,
    ),
  }));
  const requirements = normalized.find((item) => item.key === "milestones");
  const aligned = normalized.map((item) =>
    item.key === "backlogStructure" && requirements
      ? {
          key: item.key,
          content: alignBacklogWithRequirements(
            requirements.content,
            item.content,
          ),
        }
      : item,
  );
  const backlog = aligned.find((item) => item.key === "backlogStructure");
  const derivedTests =
    requirements &&
    !hasScenarios(aligned.find((item) => item.key === "tests")?.content)
      ? deriveTestsFromRequirements(requirements.content, backlog?.content)
      : null;
  const tests = derivedTests
    ? { key: "tests", content: derivedTests }
    : aligned.find((item) => item.key === "tests");
  const brief = includePrototype
    ? buildPrototypeRequestBrief({
        header: aligned.find((item) => item.key === "header")?.content,
        objectives: aligned.find((item) => item.key === "objectives")?.content,
        scope: aligned.find((item) => item.key === "scope")?.content,
        milestones: requirements?.content,
      })
    : null;
  return aligned
    .map((item) =>
      item.key === "tests" && derivedTests
        ? { key: item.key, content: derivedTests }
        : item,
    )
    .map((item) =>
      item.key !== "visualFormat"
        ? item
        : {
            key: item.key,
            content: includePrototype
              ? (brief ?? item.content)
              : PROTOTYPE_NOT_REQUESTED,
          },
    )
    .map((item) =>
      item.key === "scrumPlan" && backlog
        ? {
            key: item.key,
            content: buildScrumPlanFromBacklog(
              backlog.content,
              tests?.content,
              item.content,
            ),
          }
        : item,
    );
}
