import type { DocumentJsonValue } from "@levantamiento-rq/shared-contracts";

import { formatColombianCalendarDate } from "./documents/[documentId]/colombian-business-calendar";

/**
 * Línea de tiempo del plan de trabajo. Es la única forma de calcular el inicio y el cierre de
 * épicas, features e historias: el documento («Plan de trabajo») y el seguimiento de Ejecución
 * la usan, así que muestran exactamente las mismas fechas.
 */

type JsonRecord = Record<string, DocumentJsonValue>;

function isRecord(value: DocumentJsonValue): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recordValue(value: DocumentJsonValue | undefined): JsonRecord | null {
  return value && isRecord(value) ? value : null;
}

function recordList(value: DocumentJsonValue | undefined): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter(isRecord).map((item) => ({ ...item }))
    : [];
}

function stringValue(value: DocumentJsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function stringList(value: DocumentJsonValue | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function numberValue(value: DocumentJsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** El contenido de una sección puede llegar como texto JSON. */
function presentSectionContent(value: DocumentJsonValue): DocumentJsonValue {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed) as DocumentJsonValue;
  } catch {
    return value;
  }
}

export interface WorkPlanTimelineRange {
  start: number;
  end: number;
  startLabel: string;
  endLabel: string;
}

export interface WorkPlanTimelineSprint extends WorkPlanTimelineRange {
  featureCodes: Set<string>;
  storyCodes: Set<string>;
  taskCodes: Set<string>;
  tasks: WorkPlanTimelineTask[];
}

export interface WorkPlanTimelineTask extends WorkPlanTimelineRange {
  code: string;
  storyCode: string;
}

export interface WorkPlanTimelineEntity {
  code: string;
  title: string;
  featureCodes: Set<string>;
  storyCodes: Set<string>;
  taskCodes: Set<string>;
}

export interface WorkPlanTimelineItem extends WorkPlanTimelineEntity {
  start: number;
  end: number;
  startLabel: string;
  endLabel: string;
}

export function canonicalWorkItemCode(value: DocumentJsonValue | undefined): string {
  return stringValue(value).trim().toUpperCase();
}

function workPlanDateTimestamp(value: DocumentJsonValue | undefined) {
  const text = stringValue(value).trim();
  if (!text) return null;
  const timestamp = Date.parse(
    /^\d{4}-\d{2}-\d{2}$/u.test(text) ? `${text}T12:00:00Z` : text,
  );
  return Number.isFinite(timestamp) ? timestamp : null;
}

function workPlanDateLabel(value: DocumentJsonValue | undefined) {
  const text = stringValue(value).trim();
  return text ? formatColombianCalendarDate(text) : "";
}

export function workPlanTimelineSprints(value: DocumentJsonValue) {
  const plan = recordValue(value);
  const sprints = recordList(plan?.sprints);
  const hasCalendar = sprints.some(
    (sprint) =>
      workPlanDateTimestamp(sprint.startDate) !== null &&
      workPlanDateTimestamp(sprint.endDate) !== null,
  );

  return sprints.map<WorkPlanTimelineSprint>((sprint, index) => {
    const fallbackStart = numberValue(sprint.startDay) ?? index * 15 + 1;
    const fallbackEnd = numberValue(sprint.endDay) ?? fallbackStart + 14;
    const startTimestamp = workPlanDateTimestamp(sprint.startDate);
    const endTimestamp = workPlanDateTimestamp(sprint.endDate);
    const start = hasCalendar
      ? (startTimestamp ?? Date.UTC(2000, 0, fallbackStart))
      : fallbackStart;
    const end = hasCalendar
      ? (endTimestamp ?? Date.UTC(2000, 0, fallbackEnd))
      : fallbackEnd;
    const tasks = recordList(sprint.tasks);
    const scheduledTasks = tasks.flatMap<WorkPlanTimelineTask>((task) => {
      const taskStartDay = numberValue(task.startDay);
      const taskEndDay = numberValue(task.endDay);
      const taskStartDate = workPlanDateTimestamp(task.startDate);
      const taskEndDate = workPlanDateTimestamp(task.endDate);
      if (
        taskStartDay === null ||
        taskEndDay === null ||
        taskEndDay < taskStartDay
      ) {
        return [];
      }
      return [
        {
          code: canonicalWorkItemCode(task.code),
          storyCode: canonicalWorkItemCode(task.userStoryCode),
          start: hasCalendar
            ? (taskStartDate ??
              start + (taskStartDay - fallbackStart) * 24 * 60 * 60 * 1_000)
            : taskStartDay,
          end: hasCalendar
            ? (taskEndDate ??
              start + (taskEndDay - fallbackStart) * 24 * 60 * 60 * 1_000)
            : taskEndDay,
          startLabel:
            workPlanDateLabel(task.startDate) || `Día ${taskStartDay}`,
          endLabel: workPlanDateLabel(task.endDate) || `Día ${taskEndDay}`,
        },
      ];
    });
    return {
      start,
      end,
      startLabel: workPlanDateLabel(sprint.startDate) || `Día ${fallbackStart}`,
      endLabel: workPlanDateLabel(sprint.endDate) || `Día ${fallbackEnd}`,
      featureCodes: new Set(
        stringList(sprint.featureCodes).map((code) =>
          code.trim().toUpperCase(),
        ),
      ),
      storyCodes: new Set([
        ...stringList(sprint.userStoryCodes).map((code) =>
          code.trim().toUpperCase(),
        ),
        ...tasks
          .map((task) => canonicalWorkItemCode(task.userStoryCode))
          .filter(Boolean),
      ]),
      taskCodes: new Set(
        tasks.map((task) => canonicalWorkItemCode(task.code)).filter(Boolean),
      ),
      tasks: scheduledTasks,
    };
  });
}

export function workPlanTimelineEntities(
  value: DocumentJsonValue | null | undefined,
  granularity: TimelineGranularity,
): WorkPlanTimelineEntity[] {
  const backlog = recordValue(presentSectionContent(value ?? {}));
  const epics = recordList(backlog?.epics);
  const entities: WorkPlanTimelineEntity[] = [];

  for (const [epicIndex, epic] of epics.entries()) {
    const features = recordList(epic.features);
    const epicFeatureCodes = new Set<string>();
    const epicStoryCodes = new Set<string>();
    const epicTaskCodes = new Set<string>();

    for (const [featureIndex, feature] of features.entries()) {
      const featureCode =
        canonicalWorkItemCode(feature.code) ||
        `FE-${String(featureIndex + 1).padStart(3, "0")}`;
      const stories = recordList(feature.userStories);
      const featureStoryCodes = new Set<string>();
      const featureTaskCodes = new Set<string>();
      epicFeatureCodes.add(featureCode);

      for (const [storyIndex, story] of stories.entries()) {
        const storyCode =
          canonicalWorkItemCode(story.code) ||
          `HU-P-${String(storyIndex + 1).padStart(3, "0")}`;
        const storyTaskCodes = new Set(
          recordList(story.tasks)
            .map((task) => canonicalWorkItemCode(task.code))
            .filter(Boolean),
        );
        featureStoryCodes.add(storyCode);
        epicStoryCodes.add(storyCode);
        for (const code of storyTaskCodes) {
          featureTaskCodes.add(code);
          epicTaskCodes.add(code);
        }
        if (granularity === "USER_STORY") {
          entities.push({
            code: storyCode,
            title: stringValue(story.title) || storyCode,
            featureCodes: new Set([featureCode]),
            storyCodes: new Set([storyCode]),
            taskCodes: storyTaskCodes,
          });
        }
      }

      if (granularity === "FEATURE") {
        entities.push({
          code: featureCode,
          title: stringValue(feature.title) || featureCode,
          featureCodes: new Set([featureCode]),
          storyCodes: featureStoryCodes,
          taskCodes: featureTaskCodes,
        });
      }
    }

    if (granularity === "EPIC") {
      const epicCode =
        canonicalWorkItemCode(epic.code) ||
        `EP-${String(epicIndex + 1).padStart(3, "0")}`;
      entities.push({
        code: epicCode,
        title: stringValue(epic.title) || epicCode,
        featureCodes: epicFeatureCodes,
        storyCodes: epicStoryCodes,
        taskCodes: epicTaskCodes,
      });
    }
  }

  return entities;
}

export function timelineSprintMatchesEntity(
  sprint: WorkPlanTimelineSprint,
  entity: WorkPlanTimelineEntity,
) {
  return (
    [...entity.featureCodes].some((code) => sprint.featureCodes.has(code)) ||
    [...entity.storyCodes].some((code) => sprint.storyCodes.has(code)) ||
    [...entity.taskCodes].some((code) => sprint.taskCodes.has(code))
  );
}


export type TimelineGranularity = "EPIC" | "FEATURE" | "USER_STORY";

export interface WorkPlanTimeline {
  sprints: WorkPlanTimelineSprint[];
  items: WorkPlanTimelineItem[];
  timelineStart: number;
  timelineEnd: number;
  /** El plan tiene calendario (fechas reales); si no, todo se expresa en días. */
  hasCalendar: boolean;
}

/**
 * Inicio y cierre de cada elemento: salen de las tareas calendarizadas que contiene (o, si no
 * las hay, de los sprints que las contienen). El eje va del primer sprint al último.
 */
export function computeWorkPlanTimeline(
  scrumValue: DocumentJsonValue | null | undefined,
  backlogValue: DocumentJsonValue | null | undefined,
  granularity: TimelineGranularity,
): WorkPlanTimeline {
  const sprints = workPlanTimelineSprints(
    presentSectionContent(scrumValue ?? {}),
  );
  const entities = workPlanTimelineEntities(backlogValue, granularity);
  const items = entities.flatMap<WorkPlanTimelineItem>((entity) => {
    const assigned = sprints.flatMap<WorkPlanTimelineRange>((sprint) => {
      const taskRanges = sprint.tasks.filter(
        (task) =>
          entity.taskCodes.has(task.code) ||
          entity.storyCodes.has(task.storyCode),
      );
      if (taskRanges.length > 0) return taskRanges;
      return timelineSprintMatchesEntity(sprint, entity) ? [sprint] : [];
    });
    if (assigned.length === 0) return [];
    const ordered = [...assigned].sort((left, right) => left.start - right.start);
    return [
      {
        ...entity,
        start: ordered[0]?.start ?? 0,
        end: ordered.at(-1)?.end ?? ordered[0]?.end ?? 0,
        startLabel: ordered[0]?.startLabel ?? "",
        endLabel: ordered.at(-1)?.endLabel ?? "",
      },
    ];
  });
  const timelineStart =
    sprints.length > 0 ? Math.min(...sprints.map((sprint) => sprint.start)) : 0;
  const timelineEnd =
    sprints.length > 0 ? Math.max(...sprints.map((sprint) => sprint.end)) : 1;
  const hasCalendar = sprints.some((sprint) => sprint.start > 10_000);
  return { sprints, items, timelineStart, timelineEnd, hasCalendar };
}

/** Rótulos del eje (cinco puntos): fechas con calendario o «Día N» sin él. */
export function workPlanAxisLabels(start: number, end: number): string[] {
  const length = Math.max(1, end - start);
  return Array.from({ length: 5 }, (_, index) => {
    const point = start + (length * index) / 4;
    return point > 10_000
      ? new Intl.DateTimeFormat("es-CO", {
          day: "2-digit",
          month: "short",
          timeZone: "UTC",
        }).format(new Date(point))
      : `Día ${Math.round(point)}`;
  });
}
