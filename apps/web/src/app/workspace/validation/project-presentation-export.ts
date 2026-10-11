import type { RequirementDocumentDetail } from "@levantamiento-rq/shared-contracts";

export const PRESENTATION_PENDING = "Pendiente de definición";
export const PRESENTATION_EMPTY = "Sin información registrada";
export const PRESENTATION_NO_FLOW =
  "Sin flujo de proceso registrado en el documento";

export const PRESENTATION_SECTION_KEYS = [
  "cover",
  "objective",
  "problem",
  "solution",
  "flowAsIs",
  "flowToBe",
  "processes",
  "kpi",
] as const;

export type PresentationSectionKey = (typeof PRESENTATION_SECTION_KEYS)[number];

export interface PresentationFlowImage {
  available: boolean;
  title: string;
  /** Imagen SVG embebible (data URI) con representación por carriles. */
  dataUri: string;
  width: number;
  height: number;
}

export interface PresentationEpic {
  code: string;
  title: string;
  description: string;
}

export interface PresentationBacklog {
  available: boolean;
  counts: {
    epics: number;
    features: number;
    userStories: number;
    tasks: number;
  };
  epics: readonly PresentationEpic[];
}

export interface PresentationKpi {
  name: string;
  /** Estado inicial fijo de la presentación; no es un dato de ejecución. */
  current: string;
  target: string;
  method: string;
}

export interface PresentationOutline {
  fileName: string;
  sections: readonly PresentationSectionKey[];
  cover: { title: string; projectCode: string; version: string; date: string };
  objective: { general: string; specific: readonly string[] };
  problem: {
    currentState: string;
    impacts: readonly string[];
    need: string;
  };
  solution: {
    objective: string;
    description: string;
    elements: readonly string[];
  };
  flowAsIs: PresentationFlowImage;
  flowToBe: PresentationFlowImage;
  backlog: PresentationBacklog;
  kpis: readonly PresentationKpi[];
}

type Json = unknown;
type JsonRecord = Record<string, Json>;

const COLORS = {
  ink: "1F2A37",
  navy: "24323F",
  accent: "F2B705",
  paper: "F6F4EE",
  card: "FFFFFF",
  border: "E3DFD3",
  muted: "5B6672",
  soft: "EEF1F4",
} as const;

const MAX_KPIS = 3;
const MAX_EPICS = 3;
const KPI_INITIAL_VALUE = "0%";

function record(value: Json): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

export function cleanPresentationText(value: Json, limit = 220): string {
  if (typeof value !== "string") return "";
  const cleaned = value
    .replace(/[*_`#>]+/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (cleaned.length <= limit) return cleaned;
  const cut = cleaned.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.]+$/u, "")}…`;
}

function textList(value: Json, limit: number, itemLimit: number): string[] {
  const raw: Json[] = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\s*(?:\r?\n+|;|•)\s*/u)
      : [];
  return raw
    .map((item) =>
      cleanPresentationText(
        typeof item === "string"
          ? item.replace(/^\s*(?:[-–—•*]|\d{1,2}[.)])\s*/u, "")
          : (record(item)?.title ?? record(item)?.name ?? ""),
        itemLimit,
      ),
    )
    .filter(Boolean)
    .slice(0, limit);
}

function sectionContent(
  document: RequirementDocumentDetail,
  key: string,
): Json {
  return document.currentVersionDetail?.sections.find(
    (section) => section.key === key,
  )?.content;
}

export function presentationFileName(title: string | null | undefined): string {
  const slug = (title ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 60)
    .replace(/-+$/u, "");
  return `${slug || "proyecto"}-presentacion.pptx`;
}

function flowRecordOf(value: Json): JsonRecord | null {
  const flow = record(value);
  return flow && Array.isArray(flow.nodes) && flow.nodes.length ? flow : null;
}

function pickFlowRecords(content: Json): {
  asIs: JsonRecord | null;
  toBe: JsonRecord | null;
} {
  const root = record(content);
  const flows = record(root?.processFlows);
  return {
    asIs: flowRecordOf(flows?.asIs),
    // Documentos históricos guardaban un único flujo en la raíz (TO-BE).
    toBe: flowRecordOf(flows?.toBe) ?? flowRecordOf(root),
  };
}

const SVG_NODE_COLORS: Record<string, { fill: string; stroke: string }> = {
  START: { fill: "#eef4eb", stroke: "#66784c" },
  ACTOR: { fill: "#f1f6fa", stroke: "#2f6fa3" },
  PROCESS: { fill: "#ffffff", stroke: "#4f6675" },
  DECISION: { fill: "#fff7e8", stroke: "#c97828" },
  SYSTEM: { fill: "#f4f1f7", stroke: "#675579" },
  END: { fill: "#eef4eb", stroke: "#66784c" },
};
const SVG_KIND_LABELS: Record<string, string> = {
  START: "Inicio",
  ACTOR: "Actor",
  PROCESS: "Proceso",
  DECISION: "Decisión",
  SYSTEM: "Sistema",
  END: "Fin",
};
const SVG_LANE_COLORS = ["#356f98", "#566c7e", "#927649", "#527779", "#3e5d72"];

function svgEscape(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function svgTextLines(value: string, perLine: number, maxLines: number) {
  const lines: string[] = [];
  let current = "";
  for (const word of value.split(/\s+/u).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= perLine || !current) current = next;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    visible[maxLines - 1] = `${visible[maxLines - 1]?.slice(0, perLine - 1)}…`;
  }
  return visible.map((line) => line.slice(0, perLine + 2));
}

function svgDataUri(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

/** Profundidad desde el inicio por BFS, ignorando retornos a nodos ya vistos. */
function flowDepths(
  nodes: readonly { id: string }[],
  edges: readonly { from: string; to: string }[],
): Map<string, number> {
  const depth = new Map<string, number>();
  const incoming = new Set(edges.map((edge) => edge.to));
  const roots = nodes.filter((node) => !incoming.has(node.id));
  const queue = (roots.length ? roots : nodes.slice(0, 1)).map((node) => {
    depth.set(node.id, 0);
    return node.id;
  });
  while (queue.length) {
    const current = queue.shift() as string;
    for (const edge of edges) {
      if (edge.from !== current || depth.has(edge.to)) continue;
      depth.set(edge.to, (depth.get(current) ?? 0) + 1);
      queue.push(edge.to);
    }
  }
  let fallback = Math.max(-1, ...depth.values());
  for (const node of nodes) {
    if (!depth.has(node.id)) depth.set(node.id, ++fallback);
  }
  return depth;
}

/** Imagen SVG por carriles, coherente con la exportación del documento. */
function buildFlowImage(flow: JsonRecord): PresentationFlowImage {
  const title = cleanPresentationText(flow.title, 90);
  const lanes = (Array.isArray(flow.lanes) ? flow.lanes : [])
    .map((item) => record(item))
    .filter((item): item is JsonRecord => Boolean(item?.id && item.name))
    .map((item) => ({
      id: String(item.id),
      name: cleanPresentationText(item.name, 80),
      system: String(item.kind ?? "").toUpperCase() === "SYSTEM",
    }));
  if (!lanes.length) {
    lanes.push({ id: "flow", name: "Flujo del proceso", system: false });
  }
  const nodes = (flow.nodes as Json[])
    .map((item) => record(item))
    .filter((item): item is JsonRecord => Boolean(item?.id))
    .map((item) => {
      const kind = String(item.kind ?? item.type ?? "").toUpperCase();
      return {
        id: String(item.id),
        kind: kind in SVG_NODE_COLORS ? kind : "PROCESS",
        laneId: String(item.laneId ?? ""),
        label:
          cleanPresentationText(item.label ?? item.name ?? item.title, 120) ||
          PRESENTATION_PENDING,
      };
    });
  const ids = new Set(nodes.map((node) => node.id));
  const edges = (Array.isArray(flow.edges) ? flow.edges : [])
    .map((item) => record(item))
    .filter(
      (item): item is JsonRecord =>
        Boolean(item) && ids.has(String(item?.from)) && ids.has(String(item?.to)),
    )
    .map((item) => ({
      from: String(item.from),
      to: String(item.to),
      label: cleanPresentationText(item.label, 26),
    }));

  const laneHeight = 112;
  const laneLabelWidth = 190;
  const nodeWidth = 184;
  const stageWidth = 224;
  const padding = 30;
  const depths = flowDepths(nodes, edges);
  const laneIndex = new Map(lanes.map((lane, index) => [lane.id, index]));
  const positions = new Map<
    string,
    { x: number; y: number; h: number }
  >();
  let maxDepth = 0;
  for (const node of nodes) {
    const depth = depths.get(node.id) ?? 0;
    maxDepth = Math.max(maxDepth, depth);
    positions.set(node.id, {
      x: laneLabelWidth + padding + nodeWidth / 2 + depth * stageWidth,
      y: (laneIndex.get(node.laneId) ?? 0) * laneHeight + laneHeight / 2,
      h: node.kind === "DECISION" ? 90 : 82,
    });
  }
  const width = Math.max(
    760,
    laneLabelWidth + padding * 2 + nodeWidth + maxDepth * stageWidth,
  );
  const height = Math.max(260, lanes.length * laneHeight);
  const font = 'font-family="Arial, sans-serif"';
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    `<defs><marker id="arrow" markerWidth="12" markerHeight="12" refX="10.5" refY="6" orient="auto" markerUnits="userSpaceOnUse" viewBox="0 0 12 12"><path d="M 0 0 L 12 6 L 0 12 L 3 6 z" fill="#415d6b"/></marker></defs>`,
  ];
  lanes.forEach((lane, index) => {
    const y = index * laneHeight;
    const center = y + laneHeight / 2;
    const lines = svgTextLines(lane.name, 23, 3);
    const startY = center - (lines.length - 1) * 7 - 8;
    parts.push(
      `<rect x="0" y="${y}" width="${width}" height="${laneHeight}" fill="${lane.system ? "#f5f3ef" : "#edf3f6"}" stroke="#c3cac8"/>`,
      `<rect x="0" y="${y}" width="${laneLabelWidth}" height="${laneHeight}" fill="${SVG_LANE_COLORS[index % SVG_LANE_COLORS.length]}"/>`,
      `<text x="${laneLabelWidth / 2}" y="${startY}" text-anchor="middle" ${font} font-size="13" font-weight="700" fill="#ffffff">${lines.map((line, i) => `<tspan x="${laneLabelWidth / 2}" y="${startY + i * 14}">${svgEscape(line)}</tspan>`).join("")}</text>`,
      `<text x="${laneLabelWidth / 2}" y="${center + 27}" text-anchor="middle" ${font} font-size="9" font-weight="600" fill="#eaf0f3">${lane.system ? "Sistema" : "Actor"}</text>`,
    );
  });
  for (const edge of edges) {
    const from = positions.get(edge.from) as { x: number; y: number };
    const to = positions.get(edge.to) as { x: number; y: number };
    const x1 = from.x + nodeWidth / 2;
    const x2 = to.x - nodeWidth / 2;
    const middle = x2 > x1 ? (x1 + x2) / 2 : Math.max(x1, x2) + 45;
    parts.push(
      `<path d="M ${x1} ${from.y} L ${middle} ${from.y} L ${middle} ${to.y} L ${x2} ${to.y}" fill="none" stroke="#415d6b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#arrow)"/>`,
    );
    if (edge.label) {
      const w = Math.min(170, Math.max(48, edge.label.length * 6 + 18));
      parts.push(
        `<g transform="translate(${middle} ${(from.y + to.y) / 2})"><rect x="${-w / 2}" y="-11" width="${w}" height="22" rx="11" fill="#ffffff" stroke="#d6dcda"/><text y="1" text-anchor="middle" dominant-baseline="middle" ${font} font-size="9" font-weight="700" fill="#415d6b">${svgEscape(edge.label)}</text></g>`,
      );
    }
  }
  for (const node of nodes) {
    const pos = positions.get(node.id) as { x: number; y: number; h: number };
    const colors = SVG_NODE_COLORS[node.kind] as { fill: string; stroke: string };
    const lines = svgTextLines(node.label, 28, 4);
    const labelStartY = 9 - (lines.length - 1) * 7;
    parts.push(`<g transform="translate(${pos.x} ${pos.y})">`);
    parts.push(
      node.kind === "DECISION"
        ? `<polygon points="0,${-pos.h / 2} ${nodeWidth / 2},0 0,${pos.h / 2} ${-nodeWidth / 2},0" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="1.4"/>`
        : `<rect x="${-nodeWidth / 2}" y="${-pos.h / 2}" width="${nodeWidth}" height="${pos.h}" rx="${node.kind === "START" || node.kind === "END" ? pos.h / 2 : 10}" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="1.4"/>`,
      `<text x="0" y="${-pos.h / 2 + 17}" text-anchor="middle" ${font} font-size="8" font-weight="700" fill="#637077">${SVG_KIND_LABELS[node.kind]}</text>`,
      `<text x="0" text-anchor="middle" ${font} font-size="11" font-weight="700" fill="#363534">${lines.map((line, i) => `<tspan x="0" y="${labelStartY + i * 14}">${svgEscape(line)}</tspan>`).join("")}</text>`,
      "</g>",
    );
  }
  parts.push("</svg>");
  return {
    available: true,
    title,
    dataUri: svgDataUri(parts.join("")),
    width,
    height,
  };
}

const NO_FLOW_IMAGE: PresentationFlowImage = {
  available: false,
  title: "",
  dataUri: "",
  width: 0,
  height: 0,
};

function buildBacklogSummary(content: Json): PresentationBacklog {
  const records = (value: Json): JsonRecord[] =>
    (Array.isArray(value) ? value : [])
      .map((item) => record(item))
      .filter((item): item is JsonRecord => item !== null);
  const epics = records(record(content)?.epics);
  const counts = { epics: epics.length, features: 0, userStories: 0, tasks: 0 };
  for (const epic of epics) {
    for (const feature of records(epic.features)) {
      counts.features += 1;
      for (const story of records(feature.userStories)) {
        counts.userStories += 1;
        counts.tasks += records(story.tasks).length;
      }
    }
  }
  return {
    available: epics.length > 0,
    counts,
    epics: epics.slice(0, MAX_EPICS).map((epic) => ({
      code: cleanPresentationText(epic.code, 30),
      title: cleanPresentationText(epic.title, 110),
      description: cleanPresentationText(epic.description, 220),
    })),
  };
}

export function buildProjectPresentationOutline(
  document: RequirementDocumentDetail,
): PresentationOutline {
  const objectives = record(sectionContent(document, "objectives"));
  const problemRaw = sectionContent(document, "problemDescription");
  const problem = record(problemRaw);
  const solution = record(sectionContent(document, "solutionProposal"));
  const scope = record(sectionContent(document, "scope"));
  const header = record(sectionContent(document, "header"));
  const flows = pickFlowRecords(sectionContent(document, "processFlow"));

  const specific = textList(
    objectives?.specific ?? [
      ...textList(objectives?.qualitative, 4, 160),
      ...textList(objectives?.quantitative, 4, 160),
    ],
    4,
    160,
  );
  const kpis = (Array.isArray(scope?.kpis) ? scope.kpis : [])
    .map((item): PresentationKpi | null => {
      const kpi = record(item);
      const name = cleanPresentationText(kpi?.name ?? kpi?.title, 90);
      if (!kpi || !name) return null;
      const method = cleanPresentationText(
        kpi.measurement ?? kpi.formula ?? kpi.metric,
        150,
      );
      const frequency = cleanPresentationText(kpi.frequency, 60);
      return {
        name,
        current: KPI_INITIAL_VALUE,
        target:
          cleanPresentationText(kpi.target ?? kpi.goal, 90) ||
          PRESENTATION_PENDING,
        method:
          [method, frequency ? `Frecuencia: ${frequency}` : ""]
            .filter(Boolean)
            .join(" · ") || PRESENTATION_PENDING,
      };
    })
    .filter((item): item is PresentationKpi => item !== null)
    .slice(0, MAX_KPIS);

  const title =
    cleanPresentationText(document.title, 120) ||
    cleanPresentationText(header?.title, 120) ||
    "Proyecto sin título";
  const updated = new Date(document.updatedAt);

  return {
    fileName: presentationFileName(document.title),
    sections: PRESENTATION_SECTION_KEYS,
    cover: {
      title,
      projectCode: cleanPresentationText(header?.projectCode, 40),
      version: cleanPresentationText(
        document.currentVersionDetail?.version ?? document.currentVersion,
        20,
      ),
      date: Number.isNaN(updated.getTime())
        ? ""
        : updated.toLocaleDateString("es-CO", {
            day: "2-digit",
            month: "long",
            year: "numeric",
          }),
    },
    objective: {
      general:
        cleanPresentationText(objectives?.general, 320) || PRESENTATION_PENDING,
      specific,
    },
    problem: {
      currentState:
        cleanPresentationText(
          problem?.currentState ?? (typeof problemRaw === "string" ? problemRaw : ""),
          360,
        ) || PRESENTATION_EMPTY,
      impacts: textList(problem?.operationalImpact, 4, 150),
      need: cleanPresentationText(problem?.need, 260),
    },
    solution: {
      objective: cleanPresentationText(solution?.objective, 240),
      description:
        cleanPresentationText(solution?.description, 520) || PRESENTATION_PENDING,
      elements: textList(solution?.involvedElements, 6, 70),
    },
    flowAsIs: flows.asIs ? buildFlowImage(flows.asIs) : NO_FLOW_IMAGE,
    flowToBe: flows.toBe ? buildFlowImage(flows.toBe) : NO_FLOW_IMAGE,
    backlog: buildBacklogSummary(sectionContent(document, "backlogStructure")),
    kpis,
  };
}

export async function downloadProjectPresentation(
  document: RequirementDocumentDetail,
): Promise<{ fileName: string; slideCount: number }> {
  const outline = buildProjectPresentationOutline(document);
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = outline.cover.title;
  pptx.company = "Navitrans S.A.S.";
  const shape = pptx.ShapeType;
  const SERIF = "Georgia";
  const SANS = "Calibri";

  const contentSlide = (title: string, kicker: string) => {
    const slide = pptx.addSlide();
    slide.background = { color: COLORS.paper };
    slide.addShape(shape.rect, {
      x: 0.7, y: 0.45, w: 0.08, h: 0.75,
      fill: { color: COLORS.accent }, line: { color: COLORS.accent, width: 0 },
    });
    slide.addText(kicker.toUpperCase(), {
      x: 0.95, y: 0.4, w: 9, h: 0.3, fontFace: SANS, fontSize: 11, bold: true,
      color: COLORS.muted, charSpacing: 2, margin: 0,
    });
    slide.addText(title, {
      x: 0.95, y: 0.7, w: 11.5, h: 0.6, fontFace: SERIF, fontSize: 28,
      color: COLORS.ink, margin: 0,
    });
    slide.addShape(shape.rect, {
      x: 0, y: 7.1, w: 13.33, h: 0.4,
      fill: { color: COLORS.navy }, line: { color: COLORS.navy, width: 0 },
    });
    slide.addText(`Navitrans · ${outline.cover.title}`, {
      x: 0.7, y: 7.1, w: 10, h: 0.4, fontFace: SANS, fontSize: 10,
      color: "D5DBE2", valign: "middle", margin: 0, fit: "shrink",
    });
    return slide;
  };

  const card = (
    slide: ReturnType<typeof contentSlide>,
    x: number, y: number, w: number, h: number,
  ) =>
    slide.addShape(shape.roundRect, {
      x, y, w, h, rectRadius: 0.08,
      fill: { color: COLORS.card }, line: { color: COLORS.border, width: 1 },
    });

  const cardTitle = (
    slide: ReturnType<typeof contentSlide>,
    text: string, x: number, y: number, w: number,
  ) =>
    slide.addText(text, {
      x: x + 0.25, y: y + 0.2, w: w - 0.5, h: 0.3, fontFace: SANS,
      fontSize: 12, bold: true, color: COLORS.muted, charSpacing: 1, margin: 0,
    });

  const body = (
    slide: ReturnType<typeof contentSlide>,
    text: string, x: number, y: number, w: number, h: number, size = 16,
  ) =>
    slide.addText(text, {
      x: x + 0.25, y: y + 0.6, w: w - 0.5, h: h - 0.8, fontFace: SANS,
      fontSize: size, color: COLORS.ink, valign: "top", margin: 0, fit: "shrink",
    });

  const bullets = (
    slide: ReturnType<typeof contentSlide>,
    items: readonly string[], x: number, y: number, w: number, h: number,
    size = 14,
  ) =>
    slide.addText(
      (items.length ? items : [PRESENTATION_EMPTY]).map((text) => ({
        text,
        options: {
          bullet: items.length ? { indent: 14 } : false,
          breakLine: true,
          paraSpaceAfter: 6,
        },
      })),
      {
        x: x + 0.25, y: y + 0.6, w: w - 0.5, h: h - 0.8, fontFace: SANS,
        fontSize: size, color: COLORS.ink, valign: "top", margin: 0,
        fit: "shrink",
      },
    );

  // 1. Portada
  const cover = pptx.addSlide();
  cover.background = { color: COLORS.navy };
  cover.addShape(shape.rect, {
    x: 0.9, y: 2.35, w: 0.12, h: 1.9,
    fill: { color: COLORS.accent }, line: { color: COLORS.accent, width: 0 },
  });
  cover.addText("PRESENTACIÓN DEL PROYECTO", {
    x: 1.3, y: 1.7, w: 10, h: 0.4, fontFace: SANS, fontSize: 14, bold: true,
    color: COLORS.accent, charSpacing: 3, margin: 0,
  });
  cover.addText(outline.cover.title, {
    x: 1.3, y: 2.3, w: 10.8, h: 2.0, fontFace: SERIF, fontSize: 40,
    color: "FFFFFF", valign: "middle", margin: 0, fit: "shrink",
  });
  const coverMeta = [
    outline.cover.projectCode && `Código ${outline.cover.projectCode}`,
    outline.cover.version && `Versión ${outline.cover.version}`,
    outline.cover.date,
  ].filter(Boolean).join("   ·   ");
  if (coverMeta) {
    cover.addText(coverMeta, {
      x: 1.3, y: 4.6, w: 10.8, h: 0.4, fontFace: SANS, fontSize: 14,
      color: "C9D2DC", margin: 0,
    });
  }
  cover.addText("Navitrans S.A.S.", {
    x: 1.3, y: 6.6, w: 6, h: 0.4, fontFace: SANS, fontSize: 12,
    color: "9FB0C0", margin: 0,
  });

  // 2. Objetivo del proyecto
  const objective = contentSlide("Objetivo del proyecto", "Qué buscamos");
  card(objective, 0.7, 1.75, 5.4, 4.95);
  cardTitle(objective, "OBJETIVO GENERAL", 0.7, 1.75, 5.4);
  body(objective, outline.objective.general, 0.7, 1.75, 5.4, 4.95, 18);
  card(objective, 6.35, 1.75, 6.28, 4.95);
  cardTitle(objective, "OBJETIVOS ESPECÍFICOS", 6.35, 1.75, 6.28);
  bullets(objective, outline.objective.specific, 6.35, 1.75, 6.28, 4.95, 15);

  // 3. Descripción del problema
  const problem = contentSlide("Descripción del problema", "Situación actual");
  const problemColumns: [string, readonly string[], boolean][] = [
    ["SITUACIÓN ACTUAL", [outline.problem.currentState], false],
    ["IMPACTOS OPERACIONALES", outline.problem.impacts, true],
    ["NECESIDAD", outline.problem.need ? [outline.problem.need] : [], false],
  ];
  problemColumns.forEach(([label, items, isList], index) => {
    const x = 0.7 + index * 4.05;
    card(problem, x, 1.75, 3.83, 4.95);
    cardTitle(problem, label, x, 1.75, 3.83);
    if (isList) bullets(problem, items, x, 1.75, 3.83, 4.95, 14);
    else body(problem, items[0] ?? PRESENTATION_EMPTY, x, 1.75, 3.83, 4.95, 14);
  });

  // 4. Solución propuesta
  const solution = contentSlide("Solución propuesta", "Cómo lo resolvemos");
  card(solution, 0.7, 1.75, 7.6, 4.95);
  cardTitle(solution, "DESCRIPCIÓN", 0.7, 1.75, 7.6);
  body(
    solution,
    [outline.solution.objective, outline.solution.description]
      .filter(Boolean)
      .join("\n\n"),
    0.7, 1.75, 7.6, 4.95, 15,
  );
  card(solution, 8.55, 1.75, 4.08, 4.95);
  cardTitle(solution, "ELEMENTOS INVOLUCRADOS", 8.55, 1.75, 4.08);
  bullets(solution, outline.solution.elements, 8.55, 1.75, 4.08, 4.95, 14);

  // 5-6. Diagramas de flujo AS-IS y TO-BE
  const flowSlide = (
    label: string,
    kicker: string,
    image: PresentationFlowImage,
  ) => {
    const slide = contentSlide(label, image.title || kicker);
    if (!image.available) {
      card(slide, 0.7, 1.75, 11.93, 4.95);
      slide.addText(PRESENTATION_NO_FLOW, {
        x: 0.7, y: 1.75, w: 11.93, h: 4.95, align: "center", valign: "middle",
        fontFace: SANS, fontSize: 18, color: COLORS.muted, margin: 0,
      });
      return;
    }
    card(slide, 0.5, 1.6, 12.33, 5.3);
    const box = { x: 0.6, y: 1.7, w: 12.13, h: 5.1 };
    const scale = Math.min(box.w / image.width, box.h / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    slide.addImage({
      data: image.dataUri,
      x: box.x + (box.w - w) / 2,
      y: box.y + (box.h - h) / 2,
      w,
      h,
      altText: `${label}: ${image.title || kicker}`,
    });
  };
  flowSlide("Flujo AS-IS", "Proceso actual", outline.flowAsIs);
  flowSlide("Flujo TO-BE", "Proceso propuesto", outline.flowToBe);

  // 7. Procesos a implementar
  const processes = contentSlide("Procesos a implementar", "Backlog");
  if (!outline.backlog.available) {
    card(processes, 0.7, 1.75, 11.93, 4.95);
    processes.addText(PRESENTATION_EMPTY, {
      x: 0.7, y: 1.75, w: 11.93, h: 4.95, align: "center", valign: "middle",
      fontFace: SANS, fontSize: 18, color: COLORS.muted, margin: 0,
    });
  } else {
    const countItems: [string, number][] = [
      ["ÉPICAS", outline.backlog.counts.epics],
      ["FEATURES", outline.backlog.counts.features],
      ["HISTORIAS DE USUARIO", outline.backlog.counts.userStories],
      ["TAREAS", outline.backlog.counts.tasks],
    ];
    countItems.forEach(([label, value], index) => {
      const x = 0.7 + index * 3.0;
      card(processes, x, 1.75, 2.85, 1.35);
      processes.addText(String(value), {
        x: x + 0.25, y: 1.85, w: 2.35, h: 0.7, fontFace: SERIF, fontSize: 36,
        color: COLORS.ink, margin: 0,
      });
      processes.addText(label, {
        x: x + 0.25, y: 2.6, w: 2.35, h: 0.3, fontFace: SANS, fontSize: 11,
        bold: true, color: COLORS.muted, charSpacing: 1, margin: 0,
      });
    });
    outline.backlog.epics.forEach((epic, index) => {
      const x = 0.7 + index * 4.05;
      card(processes, x, 3.3, 3.83, 3.4);
      cardTitle(processes, epic.code || `ÉPICA ${index + 1}`, x, 3.3, 3.83);
      processes.addText(epic.title || PRESENTATION_PENDING, {
        x: x + 0.25, y: 3.85, w: 3.33, h: 0.8, fontFace: SERIF, fontSize: 16,
        color: COLORS.ink, valign: "top", margin: 0, fit: "shrink",
      });
      processes.addText(epic.description || PRESENTATION_EMPTY, {
        x: x + 0.25, y: 4.7, w: 3.33, h: 1.85, fontFace: SANS, fontSize: 12,
        color: COLORS.muted, valign: "top", margin: 0, fit: "shrink",
      });
    });
  }

  // 8. KPI
  const kpi = contentSlide("KPI", "Indicadores");
  if (outline.kpis.length === 0) {
    card(kpi, 0.7, 1.75, 11.93, 4.95);
    kpi.addText(PRESENTATION_EMPTY, {
      x: 0.7, y: 1.75, w: 11.93, h: 4.95, align: "center", valign: "middle",
      fontFace: SANS, fontSize: 18, color: COLORS.muted, margin: 0,
    });
  } else {
    outline.kpis.forEach((item, index) => {
      const x = 0.7 + index * 4.05;
      card(kpi, x, 1.75, 3.83, 4.95);
      kpi.addText(item.name, {
        x: x + 0.25, y: 1.95, w: 3.33, h: 0.8, fontFace: SANS, fontSize: 14,
        bold: true, color: COLORS.ink, valign: "top", margin: 0, fit: "shrink",
      });
      kpi.addText(item.current, {
        x: x + 0.25, y: 2.8, w: 3.33, h: 1.3, fontFace: SERIF, fontSize: 66,
        color: COLORS.ink, margin: 0, fit: "shrink",
      });
      kpi.addText("VALOR ACTUAL INICIAL", {
        x: x + 0.25, y: 4.1, w: 3.33, h: 0.25, fontFace: SANS, fontSize: 10,
        bold: true, color: COLORS.muted, charSpacing: 1, margin: 0,
      });
      kpi.addShape(shape.rect, {
        x: x + 0.25, y: 4.45, w: 0.6, h: 0.05,
        fill: { color: COLORS.accent }, line: { color: COLORS.accent, width: 0 },
      });
      kpi.addText(
        [
          { text: "META  ", options: { bold: true, fontSize: 10, color: COLORS.muted } },
          { text: `${item.target}\n\n`, options: { fontSize: 15, bold: true, color: COLORS.ink } },
          { text: "MÉTODO / FRECUENCIA\n", options: { bold: true, fontSize: 10, color: COLORS.muted } },
          { text: item.method, options: { fontSize: 12, color: COLORS.ink } },
        ],
        {
          x: x + 0.25, y: 4.6, w: 3.33, h: 2.0, fontFace: SANS, valign: "top",
          margin: 0, fit: "shrink",
        },
      );
    });
  }

  const blob = (await pptx.write({ outputType: "blob" })) as Blob;
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = outline.fileName;
  window.document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return { fileName: outline.fileName, slideCount: outline.sections.length };
}
