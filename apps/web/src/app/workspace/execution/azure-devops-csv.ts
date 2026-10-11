import type {
  DocumentJsonValue,
  RequirementDocumentDetail,
} from "@levantamiento-rq/shared-contracts";

import {
  computeWorkPlanTimeline,
  type WorkPlanTimelineRange,
} from "../work-plan-timeline";

type JsonRecord = Readonly<Record<string, DocumentJsonValue>>;

export interface ExecutionTask {
  code: string;
  title: string;
  description: string;
  epicCode: string;
  epicTitle: string;
  featureCode: string;
  featureTitle: string;
  storyCode: string;
  storyTitle: string;
  sprintCode: string;
  role: string;
  start: number;
  end: number;
  startLabel: string;
  endLabel: string;
  estimatedDays: number;
}

export interface ExecutionEpic {
  code: string;
  title: string;
  taskCodes: readonly string[];
  start: number;
  end: number;
  startLabel: string;
  endLabel: string;
}

export interface ExecutionPlan {
  documentId: string;
  documentTitle: string;
  projectId: string;
  tasks: readonly ExecutionTask[];
  epics: readonly ExecutionEpic[];
  timelineStart: number;
  timelineEnd: number;
  usesDates: boolean;
}

export interface AzureExecutionItem {
  id: string;
  code: string;
  title: string;
  type: string;
  state: string;
  completed: boolean;
  completedAt: string | null;
}

export interface AzureExecutionImport {
  fileName: string;
  importedAt: string;
  items: readonly AzureExecutionItem[];
}

export interface AzureCsvExport {
  content: string;
  fileName: string;
  itemCount: number;
}

function record(value: DocumentJsonValue | undefined): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function records(value: DocumentJsonValue | undefined): JsonRecord[] {
  return Array.isArray(value)
    ? value.map(record).filter((item): item is JsonRecord => Boolean(item))
    : [];
}

function text(value: DocumentJsonValue | undefined): string {
  return typeof value === "string"
    ? value.trim()
    : typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : "";
}

function number(value: DocumentJsonValue | undefined): number | null {
  const parsed = typeof value === "number" ? value : Number(text(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function csvCell(value: string | number): string {
  return `"${String(value).replace(/"/gu, '""')}"`;
}

function safeFileName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-zA-Z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLowerCase() || "proyecto";
}

export function buildExecutionPlan(
  document: RequirementDocumentDetail,
): ExecutionPlan {
  const backlogSection = document.currentVersionDetail.sections.find(
    (section) => section.key === "backlogStructure",
  );
  const scrumSection = document.currentVersionDetail.sections.find(
    (section) => section.key === "scrumPlan",
  );
  const backlog = record(backlogSection?.content);
  const scrum = record(scrumSection?.content);
  const scheduleByCode = new Map<string, JsonRecord & { sprintCode?: string }>();
  const sprints = records(scrum?.sprints);
  // Fechas y ejes: los mismos que muestra «Plan de trabajo» en el documento.
  const timeline = computeWorkPlanTimeline(
    scrumSection?.content,
    backlogSection?.content,
    "EPIC",
  );

  sprints.forEach((sprint) => {
    records(sprint.tasks).forEach((task) => {
      const code = text(task.code).toUpperCase();
      if (code) scheduleByCode.set(code, { ...task, sprintCode: text(sprint.code) });
    });
  });

  const rangeOfTask = (
    code: string,
    storyCode: string,
    featureCode: string,
  ): WorkPlanTimelineRange | null => {
    const canonical = code.trim().toUpperCase();
    const story = storyCode.trim().toUpperCase();
    const feature = featureCode.trim().toUpperCase();
    for (const sprint of timeline.sprints) {
      const scheduled = sprint.tasks.find((task) => task.code === canonical);
      if (scheduled) return scheduled;
    }
    const sprint =
      timeline.sprints.find((item) => item.taskCodes.has(canonical)) ??
      timeline.sprints.find((item) => story && item.storyCodes.has(story)) ??
      timeline.sprints.find((item) => feature && item.featureCodes.has(feature));
    return sprint ?? null;
  };

  const tasks: ExecutionTask[] = [];
  records(backlog?.epics).forEach((epic, epicIndex) => {
    const epicCode = text(epic.code) || `EP-${String(epicIndex + 1).padStart(3, "0")}`;
    const epicTitle = text(epic.title) || epicCode;
    records(epic.features).forEach((feature, featureIndex) => {
      const featureCode = text(feature.code) || `FE-${String(featureIndex + 1).padStart(3, "0")}`;
      records(feature.userStories).forEach((story, storyIndex) => {
        const storyCode = text(story.code) || `HU-${String(storyIndex + 1).padStart(3, "0")}`;
        records(story.tasks).forEach((backlogTask, taskIndex) => {
          const code = text(backlogTask.code) || `TA-${String(taskIndex + 1).padStart(3, "0")}`;
          const scheduled = scheduleByCode.get(code.toUpperCase());
          const startDay = number(scheduled?.startDay) ?? taskIndex + 1;
          const endDay = number(scheduled?.endDay) ?? startDay;
          const range = rangeOfTask(code, storyCode, featureCode);
          const usesDates = timeline.hasCalendar;
          tasks.push({
            code,
            title: text(backlogTask.title) || text(scheduled?.description) || code,
            description: text(backlogTask.description) || text(scheduled?.description),
            epicCode,
            epicTitle,
            featureCode,
            featureTitle: text(feature.title),
            storyCode,
            storyTitle: text(story.title),
            sprintCode: text(scheduled?.sprintCode),
            role: text(scheduled?.suggestedRole),
            start: range?.start ?? (usesDates ? timeline.timelineEnd : startDay),
            end: range?.end ?? (usesDates ? timeline.timelineEnd : endDay),
            startLabel: range?.startLabel ?? `Día ${startDay}`,
            endLabel: range?.endLabel ?? `Día ${endDay}`,
            estimatedDays: number(scheduled?.estimatedDurationDays) ?? Math.max(1, endDay - startDay + 1),
          });
        });
      });
    });
  });

  const epics = records(backlog?.epics).map<ExecutionEpic>((epic, index) => {
    const code = text(epic.code) || `EP-${String(index + 1).padStart(3, "0")}`;
    const scheduled = timeline.items.find(
      (item) => item.code === code.trim().toUpperCase(),
    );
    return {
      code,
      title: text(epic.title) || code,
      taskCodes: tasks.filter((task) => task.epicCode === code).map((task) => task.code),
      start: scheduled?.start ?? 0,
      end: scheduled?.end ?? scheduled?.start ?? 0,
      startLabel: scheduled?.startLabel ?? "Sin programación",
      endLabel: scheduled?.endLabel ?? "Sin programación",
    };
  });
  const timelineStart = timeline.sprints.length ? timeline.timelineStart : 0;
  const timelineEnd = timeline.sprints.length ? timeline.timelineEnd : 1;

  return {
    documentId: document.id,
    documentTitle: document.title,
    projectId: document.projectId,
    tasks,
    epics,
    timelineStart,
    timelineEnd,
    usesDates: timeline.hasCalendar,
  };
}

export function buildAzureDevOpsCsv(
  document: RequirementDocumentDetail,
): AzureCsvExport | null {
  const backlog = record(
    document.currentVersionDetail.sections.find(
      (section) => section.key === "backlogStructure",
    )?.content,
  );
  if (!records(backlog?.epics).length) return null;
  const headers = [
    "ID",
    "Work Item Type",
    "Title 1",
    "Title 2",
    "Title 3",
    "Title 4",
    "State",
    "Effort",
    "Business Value",
    "Value Area",
    "Tags",
  ];
  const rows: (string | number)[][] = [];
  records(backlog?.epics).forEach((epic) => {
    const epicCode = text(epic.code);
    rows.push(["", "Epic", `${epicCode} · ${text(epic.title)}`, "", "", "", "", "", "", "Business", "Levantamiento-RQ"]);
    records(epic.features).forEach((feature) => {
      const featureCode = text(feature.code);
      rows.push(["", "Feature", "", `${featureCode} · ${text(feature.title)}`, "", "", "", "", "", "Business", `Levantamiento-RQ;${epicCode}`]);
      records(feature.userStories).forEach((story) => {
        const storyCode = text(story.code);
        rows.push(["", "Product Backlog Item", "", "", `${storyCode} · ${text(story.title)}`, "", "", "", "", "Business", `Levantamiento-RQ;${featureCode}`]);
        records(story.tasks).forEach((task) => {
          const code = text(task.code);
          rows.push(["", "Task", "", "", "", `${code} · ${text(task.title)}`, "", "", "", "", `Levantamiento-RQ;${storyCode}`]);
        });
      });
    });
  });
  return {
    content: `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`,
    fileName: `${safeFileName(document.title)}-azure-devops.csv`,
    itemCount: rows.length,
  };
}

export function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = content.replace(/^\uFEFF/u, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? "";
    if (quoted && char === '"' && source[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim()); cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell.trim()); cell = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell.trim());
    if (row.some(Boolean)) rows.push(row);
  }
  return rows;
}

function normalizedHeader(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").trim().toLowerCase();
}

function workItemCode(title: string): string {
  return title.split(/\s+[·|-]\s+/u)[0]?.trim().toUpperCase() ?? "";
}

export function parseAzureDevOpsCsv(
  content: string,
  fileName: string,
): AzureExecutionImport {
  const [headerRow, ...dataRows] = parseCsv(content);
  if (!headerRow) throw new Error("El archivo CSV está vacío.");
  const headers = headerRow.map(normalizedHeader);
  const field = (row: string[], names: string[]) => {
    const index = headers.findIndex((header) => names.includes(header));
    return index >= 0 ? (row[index] ?? "").trim() : "";
  };
  const hasType = headers.includes("work item type");
  const titleIndexes = headers
    .map((header, index) => (/^title(?:\s+\d+)?$/u.test(header) ? index : -1))
    .filter((index) => index >= 0);
  if (!hasType || titleIndexes.length === 0) {
    throw new Error("El CSV debe contener las columnas “Work Item Type” y “Title” (o “Title 1”, “Title 2”…). ");
  }
  const doneStates = new Set(["done", "closed", "resolved", "completed", "complete", "cerrado", "cerrada", "completado", "completada", "hecho", "hecha"]);
  const items = dataRows.flatMap<AzureExecutionItem>((row) => {
    const title = titleIndexes.map((index) => row[index]?.trim() ?? "").find(Boolean) ?? "";
    const type = field(row, ["work item type"]);
    if (!title || !type) return [];
    const state = field(row, ["state", "estado"]);
    const completed = doneStates.has(normalizedHeader(state));
    return [{
      id: field(row, ["id"]),
      code: workItemCode(title),
      title,
      type,
      state,
      completed,
      completedAt: field(row, ["closed date", "completed date", "fecha de cierre", "changed date"]) || null,
    }];
  });
  return { fileName, importedAt: new Date().toISOString(), items };
}

export function downloadTextFile(content: string, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  window.document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function executionStorageKey(projectId: string): string {
  return `rq-azure-execution-v1:${projectId}`;
}
