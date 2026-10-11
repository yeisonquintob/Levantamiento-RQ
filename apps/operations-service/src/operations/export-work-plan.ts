import type { DocumentJsonValue } from "@levantamiento-rq/shared-contracts";

type RecordValue = Record<string, DocumentJsonValue>;
const isRecord = (
  value: DocumentJsonValue | undefined,
): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const record = (value: DocumentJsonValue | undefined): RecordValue =>
  isRecord(value) ? value : {};
const records = (value: DocumentJsonValue | undefined): RecordValue[] =>
  Array.isArray(value)
    ? (value.filter(
        (item) => item && typeof item === "object" && !Array.isArray(item),
      ) as RecordValue[])
    : [];
const code = (value: DocumentJsonValue | undefined): string =>
  typeof value === "string" ? value.trim().toUpperCase() : "";
const codes = (value: DocumentJsonValue | undefined): string[] =>
  Array.isArray(value) ? value.map(code).filter(Boolean) : [];
const number = (value: DocumentJsonValue | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const dateDay = (value: DocumentJsonValue | undefined): number | null => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
    return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp / 86400000
    : null;
};
export interface ExportEpicTimelineRow {
  code: string;
  title: string;
  start: number | null;
  end: number | null;
}
export interface ExportEpicTimeline {
  calendar: boolean;
  start: number;
  end: number;
  rows: ExportEpicTimelineRow[];
}

/** Uses assigned task ranges, falling back to their sprint range only when tasks have no schedule. */
export function buildExportEpicTimeline(
  planValue: DocumentJsonValue,
  backlogValue: DocumentJsonValue,
): ExportEpicTimeline | null {
  const plan = record(planValue),
    sprints = records(plan.sprints),
    epics = records(record(backlogValue).epics);
  if (!sprints.length || !epics.length) return null;
  const calendar = sprints.every(
    (sprint) =>
      dateDay(sprint.startDate) !== null && dateDay(sprint.endDate) !== null,
  );
  const cadence = Math.max(1, number(plan.cadenceDays) ?? 15);
  const schedule = sprints
    .map((sprint, index) => {
      const startDay = number(sprint.startDay) ?? index * cadence + 1;
      const endDay = number(sprint.endDay) ?? startDay + cadence - 1;
      const start = calendar ? (dateDay(sprint.startDate) as number) : startDay;
      const end = calendar ? (dateDay(sprint.endDate) as number) : endDay;
      const tasks = records(sprint.tasks);
      const taskRanges = tasks.flatMap((task) => {
        const a = number(task.startDay),
          b = number(task.endDay);
        const dateStart = dateDay(task.startDate),
          dateEnd = dateDay(task.endDate);
        const start = calendar
          ? (dateStart ??
            (a === null
              ? null
              : (dateDay(sprint.startDate) as number) + a - startDay))
          : a;
        const end = calendar
          ? (dateEnd ??
            (b === null
              ? null
              : (dateDay(sprint.startDate) as number) + b - startDay))
          : b;
        return start === null || end === null || end < start
          ? []
          : [
              {
                code: code(task.code),
                storyCode: code(task.userStoryCode),
                start,
                end,
              },
            ];
      });
      return {
        start,
        end,
        taskRanges,
        featureCodes: codes(sprint.featureCodes),
        storyCodes: [
          ...codes(sprint.userStoryCodes),
          ...tasks.map((task) => code(task.userStoryCode)).filter(Boolean),
        ],
        taskCodes: tasks.map((task) => code(task.code)).filter(Boolean),
      };
    })
    .filter((sprint) => sprint.end >= sprint.start);
  if (!schedule.length) return null;
  const rows = epics.map((epic, index) => {
    const features = records(epic.features),
      stories = features.flatMap((feature) => records(feature.userStories));
    const featureCodes = new Set(
      features.map((feature) => code(feature.code)).filter(Boolean),
    );
    const storyCodes = new Set(
      stories.map((story) => code(story.code)).filter(Boolean),
    );
    const taskCodes = new Set(
      stories
        .flatMap((story) => records(story.tasks).map((task) => code(task.code)))
        .filter(Boolean),
    );
    const ranges = schedule.flatMap((sprint) => {
      const tasks = sprint.taskRanges.filter(
        (task) => taskCodes.has(task.code) || storyCodes.has(task.storyCode),
      );
      if (tasks.length) return tasks;
      const assigned =
        sprint.featureCodes.some((value) => featureCodes.has(value)) ||
        sprint.storyCodes.some((value) => storyCodes.has(value)) ||
        sprint.taskCodes.some((value) => taskCodes.has(value));
      return assigned
        ? [{ code: "", storyCode: "", start: sprint.start, end: sprint.end }]
        : [];
    });
    return {
      code: code(epic.code) || `EP-${String(index + 1).padStart(3, "0")}`,
      title: typeof epic.title === "string" ? epic.title : "Épica sin título",
      start: ranges.length
        ? Math.min(...ranges.map((range) => range.start))
        : null,
      end: ranges.length ? Math.max(...ranges.map((range) => range.end)) : null,
    };
  });
  return {
    calendar,
    start: Math.min(
      ...schedule.map((s) => s.start),
      ...rows.flatMap((r) => (r.start === null ? [] : [r.start])),
    ),
    end: Math.max(
      ...schedule.map((s) => s.end),
      ...rows.flatMap((r) => (r.end === null ? [] : [r.end])),
    ),
    rows,
  };
}
