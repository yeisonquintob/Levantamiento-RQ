// AI_ANALYSIS_LOCAL_ONLY_V2_PRIOR_CODES_V1
//
// Esquema, Pruebas y Plan de trabajo se generan sin ver los códigos que ya
// produjeron Requerimientos y Esquema, así que el modelo los adivina. Este
// módulo calcula, de forma determinista y sin llamar a ningún modelo, la lista
// de códigos reales de los puntos anteriores para incluirla como dato en el
// prompt. Los códigos salen del mismo normalizador que produce el documento
// final, de modo que coinciden con los que verá la persona.
import type { DocumentJsonValue } from "@levantamiento-rq/shared-contracts";
import { normalizeLocalOnlyV2SectionContent } from "./local-only-v2-section-content";

interface PriorPoint {
  readonly packet: { readonly sectionKey: string };
  readonly drafts: readonly { readonly content: string }[];
}

const MAX_ITEMS_PER_GROUP = 40;
const MAX_TITLE_CHARACTERS = 60;
const MAX_CONTEXT_CHARACTERS = 3_200;

function record(value: unknown): Record<string, DocumentJsonValue> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, DocumentJsonValue>)
    : null;
}

function list(value: unknown): Record<string, DocumentJsonValue>[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const entry = record(item);
        return entry ? [entry] : [];
      })
    : [];
}

function label(entry: Record<string, DocumentJsonValue>): string {
  const code = typeof entry.code === "string" ? entry.code : "";
  const title = typeof entry.title === "string" ? entry.title.trim() : "";
  const short =
    title.length > MAX_TITLE_CHARACTERS
      ? `${title.slice(0, MAX_TITLE_CHARACTERS - 1).trimEnd()}…`
      : title;
  return short ? `${code} · ${short}` : code;
}

function normalizedSection(
  points: readonly PriorPoint[],
  sectionKey: string,
): Record<string, DocumentJsonValue> | null {
  const point = points.find((item) => item.packet.sectionKey === sectionKey);
  if (!point) return null;
  const content = point.drafts
    .flatMap((draft) => draft.content.split(/\n+/u))
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  if (!content) return null;
  return record(normalizeLocalOnlyV2SectionContent(sectionKey, content, {}));
}

/** Lista de códigos existentes para el punto `sectionKey`, o undefined. */
export function localOnlyV2PriorCodesContext(
  sectionKey: string,
  points: readonly PriorPoint[],
): string | undefined {
  if (
    sectionKey !== "backlogStructure" &&
    sectionKey !== "tests" &&
    sectionKey !== "scrumPlan"
  ) {
    return undefined;
  }

  const groups: Array<[string, string[]]> = [];
  const add = (title: string, items: string[]) => {
    const unique = items.filter(
      (item, index) => item && items.indexOf(item) === index,
    );
    if (unique.length > 0) {
      groups.push([title, unique.slice(0, MAX_ITEMS_PER_GROUP)]);
    }
  };

  const milestones = normalizedSection(points, "milestones");
  const stories = list(milestones?.functionalRequirements);
  if (sectionKey === "backlogStructure") {
    // Una Épica por Hito: se listan los Hitos con las HU-F que contienen.
    const hitos = new Map<string, { title: string; stories: string[] }>();
    for (const story of stories) {
      const code = typeof story.milestone === "string" ? story.milestone : "";
      if (!code) continue;
      const entry = hitos.get(code) ?? {
        title: typeof story.functionality === "string" ? story.functionality : "",
        stories: [],
      };
      entry.stories.push(typeof story.code === "string" ? story.code : "");
      hitos.set(code, entry);
    }
    add(
      "Hitos de Requerimientos (una Épica por Hito, con el mismo título, y una HU-P por cada HU-F)",
      [...hitos].map(
        ([code, entry]) =>
          `${code} · ${entry.title.slice(0, MAX_TITLE_CHARACTERS)} → ${entry.stories.join(", ")}`,
      ),
    );
  }
  add("Historias funcionales (HU-F)", stories.map(label));

  if (sectionKey === "tests") {
    add(
      "Criterios de aceptación (CA-F)",
      stories.flatMap((story) =>
        list(story.acceptanceCriteria).map((criterion) =>
          typeof criterion.code === "string" ? criterion.code : "",
        ),
      ),
    );
  }

  if (sectionKey === "tests" || sectionKey === "scrumPlan") {
    const backlog = normalizedSection(points, "backlogStructure");
    const features = list(backlog?.epics).flatMap((epic) =>
      list(epic.features),
    );
    const planningStories = features.flatMap((feature) =>
      list(feature.userStories),
    );
    if (sectionKey === "scrumPlan") add("Features (FE)", features.map(label));
    add("Historias de planificación (HU-P)", planningStories.map(label));
    add(
      "Tareas (T)",
      planningStories.flatMap((story) => list(story.tasks)).map(label),
    );
  }

  if (sectionKey === "scrumPlan") {
    const tests = normalizedSection(points, "tests");
    add(
      "Pruebas (TS)",
      list(tests?.scenarios).map((scenario) =>
        typeof scenario.code === "string" ? scenario.code : "",
      ),
    );
  }

  if (groups.length === 0) return undefined;
  const text = groups
    .map(([title, items]) => `${title}: ${items.join("; ")}`)
    .join("\n");
  const bounded =
    text.length > MAX_CONTEXT_CHARACTERS
      ? `${text.slice(0, MAX_CONTEXT_CHARACTERS).replace(/\s+\S*$/u, "")}…`
      : text;
  return `CÓDIGOS EXISTENTES EN PUNTOS ANTERIORES (datos: referencia solo estos códigos exactos y no inventes otros):\n${bounded}`;
}
