import type {
  DocumentJsonValue,
  DocumentStatus,
  RequirementDocumentDetail,
} from "@levantamiento-rq/shared-contracts";

type JsonRecord = Readonly<Record<string, DocumentJsonValue>>;

export interface ReadableBacklogTxtExport {
  content: string;
  fileName: string;
  itemCount: number;
}

function recordValue(value: DocumentJsonValue | undefined): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function records(value: DocumentJsonValue | undefined): JsonRecord[] {
  return Array.isArray(value)
    ? value
        .map((item) => recordValue(item))
        .filter((item): item is JsonRecord => Boolean(item))
    : [];
}

function textValue(value: DocumentJsonValue | undefined): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function singleLine(value: string): string {
  return value.replace(/[\t\r\n]+/gu, " ").replace(/\s+/gu, " ").trim();
}

function safeFileSegment(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/gu, "")
      .replace(/[^a-zA-Z0-9_-]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .toLowerCase() || "documento"
  );
}

function documentStatusLabel(status: DocumentStatus): string {
  if (status === "IN_REVIEW") return "En validación";
  if (status === "CHANGES_REQUESTED") return "Correcciones solicitadas";
  if (status === "APPROVED") return "Aprobado";
  if (status === "REJECTED") return "Rechazado";
  if (status === "ARCHIVED") return "Archivado";
  return "Borrador";
}

function itemHeading(
  label: string,
  item: JsonRecord,
  fallbackNumber: string,
): string {
  const sourceNumber = textValue(item.sourceNumber) || fallbackNumber;
  const code = textValue(item.code) || "Sin código";
  const title = textValue(item.title) || "Sin título";
  return `${label} ${sourceNumber} · ${code} · ${singleLine(title)}`;
}

function itemDescription(item: JsonRecord): string {
  return singleLine(textValue(item.description)) || "Sin descripción.";
}

export function buildReadableBacklogTxtExport(
  document: RequirementDocumentDetail,
): ReadableBacklogTxtExport | null {
  const backlogSection = document.currentVersionDetail.sections.find(
    (section) => section.key === "backlogStructure",
  );
  const backlog = recordValue(backlogSection?.content);
  const epics = records(backlog?.epics);
  if (epics.length === 0) return null;

  const counts = {
    epics: epics.length,
    features: 0,
    userStories: 0,
    tasks: 0,
  };
  const body: string[] = [];

  epics.forEach((epic, epicIndex) => {
    const epicNumber = String(epicIndex + 1);
    body.push("═".repeat(88));
    body.push(itemHeading("ÉPICA", epic, epicNumber));
    body.push(`Descripción: ${itemDescription(epic)}`);
    body.push("");

    records(epic.features).forEach((feature, featureIndex) => {
      counts.features += 1;
      const featureNumber = `${epicNumber}.${featureIndex + 1}`;
      body.push(`  ${itemHeading("FEATURE", feature, featureNumber)}`);
      body.push(`  Descripción: ${itemDescription(feature)}`);
      body.push("");

      records(feature.userStories).forEach((userStory, storyIndex) => {
        counts.userStories += 1;
        const storyNumber = `${featureNumber}.${storyIndex + 1}`;
        const tasks = records(userStory.tasks);
        body.push(
          `    ${itemHeading("HISTORIA DE USUARIO", userStory, storyNumber)}`,
        );
        body.push(`    Descripción: ${itemDescription(userStory)}`);
        body.push(`    Tareas: ${tasks.length}`);

        tasks.forEach((task, taskIndex) => {
          counts.tasks += 1;
          const taskNumber = `${storyNumber}.${taskIndex + 1}`;
          body.push(`      ${itemHeading("TAREA", task, taskNumber)}`);
          body.push(`      Descripción: ${itemDescription(task)}`);
        });
        body.push("");
      });
    });
  });

  const structureStatus = textValue(backlog?.structureStatus).toUpperCase();
  const structureLabel =
    structureStatus === "CONFIRMED"
      ? "Confirmada"
      : "Sugerida por IA; pendiente de confirmación humana";
  const itemCount =
    counts.epics + counts.features + counts.userStories + counts.tasks;
  const header = [
    "ESQUEMA DEL PROYECTO",
    "═".repeat(88),
    `Documento: ${singleLine(document.title)}`,
    `Versión: ${document.currentVersion}`,
    `Estado del documento: ${documentStatusLabel(document.status)}`,
    `Estado de la estructura: ${structureLabel}`,
    `Resumen: ${counts.epics} épica(s) · ${counts.features} feature(s) · ${counts.userStories} historia(s) de usuario · ${counts.tasks} tarea(s)`,
    "",
    "CÓMO LEER ESTE ARCHIVO",
    "Cada elemento aparece debajo de su padre. La sangría muestra la jerarquía:",
    "Épica → Feature → Historia de usuario → Tarea.",
    "",
  ];

  return {
    // BOM para conservar correctamente tildes y caracteres en los editores.
    content: `\uFEFF${[...header, ...body].join("\r\n")}\r\n`,
    fileName: `${safeFileSegment(document.title)}-v${document.currentVersion}-esquema.txt`,
    itemCount,
  };
}
