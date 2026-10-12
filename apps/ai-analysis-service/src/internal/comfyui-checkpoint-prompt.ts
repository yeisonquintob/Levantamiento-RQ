import type { PrototypeImageGenerationInternalRequest } from "@levantamiento-rq/shared-contracts";

export interface CheckpointProfile {
  steps: number;
  cfg: number;
  samplerName: string;
  scheduler: string;
}

/**
 * Los modelos destilados (Lightning/Turbo/LCM/Hyper) convergen en pocos pasos y con CFG bajo; con
 * un SDXL base eso da ruido, y a la inversa un destilado con 28 pasos y CFG 7 se quema. Los nombres
 * desconocidos reciben un perfil intermedio que un SDXL/SD1.5 estándar tolera.
 */
const FAST_CHECKPOINT_PATTERN = /lightning|turbo|lcm|hyper|schnell/u;
const SDXL_CHECKPOINT_PATTERN = /sd_?xl|(?:^|[^a-z])xl|xl(?:[^a-z]|$)/u;

export function resolveCheckpointProfile(
  checkpointName: string,
): CheckpointProfile {
  const name = checkpointName.toLowerCase();
  if (FAST_CHECKPOINT_PATTERN.test(name)) {
    return {
      steps: 4,
      cfg: 1.5,
      samplerName: "euler",
      scheduler: "sgm_uniform",
    };
  }
  if (SDXL_CHECKPOINT_PATTERN.test(name)) {
    return {
      steps: 28,
      cfg: 6.5,
      samplerName: "dpmpp_2m",
      scheduler: "karras",
    };
  }
  return { steps: 25, cfg: 7, samplerName: "euler", scheduler: "normal" };
}

type ScreenKind =
  | "LOGIN"
  | "MAP"
  | "KANBAN"
  | "GALLERY"
  | "REPORT"
  | "SETTINGS"
  | "APPROVAL"
  | "DETAIL"
  | "DASHBOARD"
  | "LIST"
  | "FORM"
  | "GENERIC";

const START = "(?<!\\p{L})";

function kindPattern(alternatives: string): RegExp {
  return new RegExp(`${START}(?:${alternatives})`, "iu");
}

const SCREEN_KIND_PATTERNS: ReadonlyArray<readonly [ScreenKind, RegExp]> = [
  [
    "LOGIN",
    kindPattern(
      "login|log in|sign ?in|iniciar sesi|inicio de sesi|autenticaci|authenticat|contrase|password|acceso al sistema",
    ),
  ],
  ["MAP", kindPattern("mapa|map(?!\\p{L})|geolocal|geogr[aá]f|cartogr")],
  ["KANBAN", kindPattern("kanban|tablero(?! de control)|board(?!\\p{L})")],
  [
    "GALLERY",
    kindPattern("galer|gallery|fotograf|[aá]lbum|miniatura|thumbnail"),
  ],
  [
    "REPORT",
    kindPattern("report|informe|gr[aá]fic|chart|anal[ií]tic|estad[ií]stic"),
  ],
  [
    "SETTINGS",
    kindPattern(
      "configuraci|ajustes|settings|parametriz|usuarios|users|roles|permisos|administraci|panel de administraci",
    ),
  ],
  [
    "APPROVAL",
    kindPattern(
      "aprobaci|aprobar|approv|flujo|workflow|autorizaci|bandeja|pendientes de",
    ),
  ],
  ["DETAIL", kindPattern("detalle|ficha|detail|perfil|profile|visualizaci")],
  [
    "DASHBOARD",
    kindPattern(
      "dashboard|tablero de control|kpi|indicador|m[eé]trica|resumen|overview|home|panel|inicio(?! de sesi)",
    ),
  ],
  [
    "LIST",
    kindPattern(
      "list|tabla|table|grilla|grid|historial|history|cat[aá]logo|inventario|registros|solicitudes|requests|consulta|b[uú]squeda|search",
    ),
  ],
  [
    "FORM",
    kindPattern(
      "formulario|form(?!\\p{L})|solicitud(?!es)|registro(?!s)|request(?!s)|register|crear|nuevo|nueva|captura|edici|editar|diligenci",
    ),
  ],
];

const SCREEN_KIND_BY_COMPONENT: ReadonlyArray<readonly [ScreenKind, RegExp]> = [
  ["DASHBOARD", /(?:^|[\s,])KPI \(/u],
  ["LIST", /(?:^|[\s,])(?:TABLE|LIST|FILTER_BAR) \(/u],
  ["DETAIL", /(?:^|[\s,])DETAIL_PANEL \(/u],
  ["FORM", /(?:^|[\s,])(?:FORM|TEXT_INPUT|SELECT|DATE_PICKER) \(/u],
];

function kindFromText(text: string): ScreenKind | null {
  let best: { kind: ScreenKind; index: number } | null = null;
  for (const [kind, pattern] of SCREEN_KIND_PATTERNS) {
    const index = pattern.exec(text)?.index;
    if (index !== undefined && (!best || index < best.index)) {
      best = { kind, index };
    }
  }
  return best?.kind ?? null;
}

const SHELL_COMPONENT_TYPES = new Set([
  "APP_SHELL",
  "SIDEBAR",
  "TOPBAR",
  "MOBILE_HEADER",
  "MOBILE_NAVIGATION",
]);

const SHELL_ROLES = /^(?:applicationShell|screenHeader|primaryNavigation)$/u;
const MAX_ELEMENTS = 5;
const MAX_ELEMENT_CHARS = 32;
const MAX_PROMPT_CHARS = 600;

function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space >= 8 ? cut.slice(0, space) : cut).trim();
}

function cleanElement(raw: string): string {
  const head = raw.split(/[:(]| - |\. /u)[0] ?? "";
  if (/\d\s*px|#[0-9a-f]{3,8}(?![0-9a-z])/iu.test(head)) return "";
  const cleaned = truncateAtWord(
    head
      .replace(/[A-Z][A-Z0-9]*_[A-Z0-9_]+/gu, " ")
      .replace(/["\\{}[\]]/gu, "")
      .replace(/\s+/gu, " ")
      .trim(),
    MAX_ELEMENT_CHARS,
  );
  return cleaned.length < 3 || SHELL_ROLES.test(cleaned) ? "" : cleaned;
}

function componentRoles(prompt: string): Array<{ type: string; role: string }> {
  const line = /^Components:\s*(.+?)\.?\s*$/mu.exec(prompt)?.[1] ?? "";
  return Array.from(
    line.matchAll(/([A-Z][A-Z0-9_]+) \(([^)]*)\)/gu),
    (match) => ({ type: match[1] ?? "", role: match[2] ?? "" }),
  );
}

function hierarchyItems(prompt: string): string[] {
  const line =
    /^Content hierarchy[^:\n]*:\s*(.+?)\.?\s*$/mu.exec(prompt)?.[1] ?? "";
  return line
    .split(" > ")
    .map((item) => item.trim())
    .filter(Boolean);
}

function mainElements(prompt: string, screen: string | undefined): string[] {
  const hierarchy = hierarchyItems(prompt).slice(1);
  const candidates =
    hierarchy.length > 0
      ? hierarchy
      : componentRoles(prompt)
          .filter(({ type }) => !SHELL_COMPONENT_TYPES.has(type))
          .map(({ role }) => role);
  const seen = new Set<string>(screen ? [screen.toLowerCase()] : []);
  const result: string[] = [];
  for (const candidate of candidates) {
    const element = cleanElement(candidate);
    const key = element.toLowerCase();
    if (!element || seen.has(key)) continue;
    seen.add(key);
    result.push(element);
    if (result.length === MAX_ELEMENTS) break;
  }
  return result;
}

function inferScreenKind(
  prompt: string,
  screen: string | undefined,
  objective: string | undefined,
): ScreenKind {
  const fromName = screen ? kindFromText(screen) : null;
  if (fromName) return fromName;
  const fromObjective = objective ? kindFromText(objective) : null;
  if (fromObjective) return fromObjective;
  const roles = componentRoles(prompt);
  const componentLine = roles.map(({ type }) => `${type} (`).join(", ");
  for (const [kind, pattern] of SCREEN_KIND_BY_COMPONENT) {
    if (pattern.test(componentLine)) return kind;
  }
  const rolesText = [
    ...hierarchyItems(prompt).slice(1),
    ...roles
      .filter(({ type }) => !SHELL_COMPONENT_TYPES.has(type))
      .map(({ role }) => role),
  ].join(" | ");
  return kindFromText(rolesText) ?? "GENERIC";
}

const SCREEN_LAYOUT: Record<ScreenKind, { web: string; mobile: string }> = {
  FORM: {
    web: "a form with labeled input fields, dropdowns and a primary button",
    mobile:
      "a form with labeled input fields, dropdowns and a full-width primary button",
  },
  LIST: {
    web: "a search and filter bar above a data table with column headers and rows",
    mobile:
      "a search field and filter chips above a vertical list of record cards",
  },
  DASHBOARD: {
    web: "a row of summary metric cards above bar and line charts and a recent activity table",
    mobile: "stacked summary metric cards followed by a chart and a short list",
  },
  DETAIL: {
    web: "a record header with a status badge, read-only fields in two columns and action buttons",
    mobile:
      "a record header with a status badge, a list of read-only fields and action buttons",
  },
  LOGIN: {
    web: "a centered sign-in card with username and password fields and a primary button",
    mobile:
      "a sign-in form with username and password fields and a full-width primary button",
  },
  APPROVAL: {
    web: "a table of pending requests with status badges and approve and reject buttons",
    mobile:
      "a list of pending request cards with status badges and approve and reject buttons",
  },
  SETTINGS: {
    web: "settings sections with toggles, dropdowns, a users and roles table and a save button",
    mobile:
      "settings sections with toggles, dropdowns, a list of users and roles and a save button",
  },
  MAP: {
    web: "a large map with location markers and a side panel with filters and a list of places",
    mobile:
      "a full-screen map with location markers and a bottom sheet listing places",
  },
  KANBAN: {
    web: "a kanban board with status columns holding task cards",
    mobile:
      "a kanban board with status columns holding task cards, one column visible at a time",
  },
  GALLERY: {
    web: "a toolbar with filters above a grid of image thumbnails",
    mobile: "a search field above a two-column grid of image thumbnails",
  },
  REPORT: {
    web: "report filters on top, bar and line charts and a summary table with an export button",
    mobile: "report filters, a chart and a summary list with an export button",
  },
  GENERIC: {
    web: "a page title, section headings, content cards and text blocks",
    mobile: "a page title, section headings and content cards",
  },
};

export function buildCheckpointPrompt(
  prompt: string,
  device: PrototypeImageGenerationInternalRequest["device"],
): string {
  const screen =
    /^Screen:\s*(.+?)\.?\s*$/mu
      .exec(prompt)?.[1]
      ?.replace(/["\\{}[\]]/gu, "")
      .replace(/[A-Z][A-Z0-9]*_[A-Z0-9_]+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 80)
      .trim() || undefined;
  const objective = /^Objective:\s*(.+?)\.?\s*$/mu.exec(prompt)?.[1];
  const kind = inferScreenKind(prompt, screen, objective);
  const elements = mainElements(prompt, screen);
  const subject = screen ? ` "${screen}"` : "";
  const mobile = device === "MOBILE";
  const layout = mobile ? SCREEN_LAYOUT[kind].mobile : SCREEN_LAYOUT[kind].web;
  const compose = (items: readonly string[]): string => {
    const showing = items.length > 0 ? `, showing ${items.join(", ")}` : "";
    return mobile
      ? `single flat 2D mobile app screen${subject}, full-frame UI screenshot, portrait, single column, top app header, ${layout}${showing}, bottom tab bar, white background, muted corporate accent color, minimal clean design, UI design, high quality`
      : `single flat 2D web application screen${subject}, full-frame UI screenshot, narrow left sidebar with menu icons, top header bar, main content area with ${layout}${showing}, white background, muted corporate accent color, minimal clean design, UI design, high quality`;
  };
  const items = [...elements];
  let result = compose(items);
  while (result.length > MAX_PROMPT_CHARS && items.length > 0) {
    items.pop();
    result = compose(items);
  }
  return result;
}
