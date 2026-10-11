// AI_ANALYSIS_PROTOTYPE_REQUEST_BRIEF_V1
//
// Punto 13 ("Prototipo"): información con la que se piden los prototipos.
// Se construye de forma determinista y sin llamar a ningún modelo, igual para
// IA local, híbrida y nube, a partir de lo que el propio documento ya contiene
// (encabezado, objetivo, alcance y Requerimientos) más el estilo visual de la
// aplicación (CORPORATE_DEFAULT_V1). Solo reordena información existente: no
// inventa módulos, campos, roles ni reglas.
import type { DocumentJsonValue } from "@levantamiento-rq/shared-contracts";

type Rec = Record<string, DocumentJsonValue>;

// Debe coincidir con apps/prototypes-service/src/visual/prototype-design-system.ts
// (lo verifica tests/ai-analysis/prototype-request-brief.test.ts).
export const PROTOTYPE_STYLE_LINES: readonly string[] = [
  "ESTILO VISUAL (sistema de diseño corporativo de la aplicación, CORPORATE_DEFAULT_V1)",
  "- Tipografía Inter (o la del sistema); títulos en negrita; texto de 14 px; tablas de 13 px.",
  "- Colores: fondo #F7F8FA, superficies blancas #FFFFFF, color principal morado #675579 (oscuro #50415F), texto #27313A, texto secundario #66727D, bordes #D8DEE3; éxito #2E7D5B, alerta #B7791F, error #C24141, información #3B6E8F.",
  "- Estructura: barra lateral de 240 px con el módulo activo resaltado en el color principal, barra superior con título y acciones, contenido en tarjetas blancas con borde fino y sombra suave.",
  "- Componentes: tablas con encabezado sobre superficie blanca y filas de 44 px; filtros en barra superior de la tabla; formularios con etiqueta arriba y controles de 40 px; botones de 40 px (principal en morado, secundario blanco); insignias redondeadas para estados.",
  "- Móvil: mismo contenido y navegación adaptados al ancho móvil, controles de 48 px, sin carcasa de teléfono ni pantalla de inicio del sistema operativo.",
  "- Todas las pantallas forman una sola aplicación con identidad y navegación comunes, y siempre incluyen estados vacío, de error y de éxito.",
];

const MAX_MODULES = 12;
const MAX_STORIES_PER_MODULE = 12;
const MAX_FIELDS_PER_STORY = 8;
const MAX_ROLES = 8;
const MAX_SYSTEMS = 8;

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

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function defined(value: string): boolean {
  return Boolean(value) && !/PENDIENTE POR DEFINIR/iu.test(value);
}

function unique(values: string[]): string[] {
  return values.filter((item, index) => item && values.indexOf(item) === index);
}

function short(value: string, max: number): string {
  const clean = value.replace(/\s+/gu, " ").trim();
  return clean.length <= max
    ? clean
    : `${clean.slice(0, max - 1).replace(/\s+\S*$/u, "")}…`;
}

/** Marca que `ai-analysis-input.ts` añade a la instrucción cuando «Prototipo» está activado. */
const PROTOTYPE_ENABLED_MARKER = "PROTOTYPE_MARKDOWN_V1=ENABLED";

/** `true` solo si quien procesó activó «Prototipo» en esa solicitud. */
export function isPrototypeRequested(
  instruction: string | null | undefined,
): boolean {
  return instruction?.includes(PROTOTYPE_ENABLED_MARKER) === true;
}

/** Contenido del punto 13 cuando el prototipo no se solicitó. */
export const PROTOTYPE_NOT_REQUESTED =
  "Prototipo no solicitado en esta generación. Actívalo en «Procesamiento IA» para generarlo.";

export interface PrototypeBriefSections {
  readonly header?: DocumentJsonValue;
  readonly objectives?: DocumentJsonValue;
  readonly scope?: DocumentJsonValue;
  readonly milestones?: DocumentJsonValue;
}

/**
 * Devuelve el texto del punto 13, o null cuando el documento aún no tiene
 * Requerimientos funcionales de los que derivar las funciones del prototipo.
 */
export function buildPrototypeRequestBrief(
  sections: PrototypeBriefSections,
): string | null {
  const stories = recs(rec(sections.milestones)?.functionalRequirements).filter(
    (story) => defined(text(story.title)),
  );
  if (stories.length === 0) return null;

  const header = rec(sections.header);
  const objectives = rec(sections.objectives);
  const scope = rec(sections.scope);
  const lines: string[] = [];

  lines.push("SOLICITUD DE PROTOTIPO");
  const name = text(header?.title);
  if (defined(name)) lines.push(`Aplicación: ${name}.`);
  const objective = text(objectives?.general);
  if (defined(objective)) lines.push(`Propósito: ${short(objective, 320)}`);

  const roles = unique(
    stories.map((story) => text(story.role)).filter(defined),
  ).slice(0, MAX_ROLES);
  if (roles.length > 0) lines.push(`Actores: ${roles.join("; ")}.`);
  const systems = unique(
    [
      ...strings(scope?.involvedSystems),
      ...stories.flatMap((story) => strings(story.impactedSystems)),
    ].filter(defined),
  ).slice(0, MAX_SYSTEMS);
  if (systems.length > 0) {
    lines.push(`Sistemas e integraciones visibles: ${systems.join("; ")}.`);
  }
  lines.push("");

  lines.push("FUNCIONES POR MÓDULO (cada módulo es un Hito de Requerimientos)");
  const modules = new Map<string, { title: string; stories: Rec[] }>();
  for (const story of stories) {
    const key = text(story.milestone) || "SIN-HITO";
    const entry = modules.get(key) ?? {
      title: defined(text(story.functionality))
        ? text(story.functionality)
        : "Funciones generales",
      stories: [],
    };
    entry.stories.push(story);
    modules.set(key, entry);
  }
  const all = [...modules.values()];
  for (const entry of all.slice(0, MAX_MODULES)) {
    lines.push(`Módulo: ${entry.title}`);
    for (const story of entry.stories.slice(0, MAX_STORIES_PER_MODULE)) {
      const want = text(story.want);
      const detail = defined(want) ? ` — ${short(want, 140)}` : "";
      lines.push(
        `- ${text(story.code)} ${short(text(story.title), 90)}${detail}`,
      );
      const fields = recs(story.fields)
        .filter((field) => defined(text(field.name)))
        .slice(0, MAX_FIELDS_PER_STORY)
        .map(
          (field) =>
            `${text(field.name)}${field.required === true ? " (obligatorio)" : ""}`,
        );
      if (fields.length > 0) lines.push(`  Campos: ${fields.join(", ")}.`);
    }
    if (entry.stories.length > MAX_STORIES_PER_MODULE) {
      lines.push(
        `  (+${entry.stories.length - MAX_STORIES_PER_MODULE} funciones más en Requerimientos)`,
      );
    }
  }
  if (all.length > MAX_MODULES) {
    lines.push(`(+${all.length - MAX_MODULES} módulos más en Requerimientos)`);
  }
  lines.push("");
  lines.push(...PROTOTYPE_STYLE_LINES);
  return lines.join("\n");
}
