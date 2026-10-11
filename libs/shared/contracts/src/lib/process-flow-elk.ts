import ElkModule from "elkjs/lib/elk.bundled.js";
import type {
  ELK as ElkApi,
  ElkEdgeSection,
  ElkExtendedEdge,
  ElkLabel,
  ElkNode,
  ElkPoint,
} from "elkjs/lib/elk-api.js";

const ElkConstructor = ElkModule as unknown as new () => ElkApi;

export const PROCESS_FLOW_NODE_KINDS = [
  "START",
  "ACTOR",
  "PROCESS",
  "DECISION",
  "SYSTEM",
  "END",
] as const;

export type ProcessFlowNodeKind = (typeof PROCESS_FLOW_NODE_KINDS)[number];

export interface ProcessFlowNodeInput {
  id: string;
  kind: string;
  label: string;
}

export interface ProcessFlowEdgeInput {
  from: string;
  to: string;
  label: string | null;
}

export interface ProcessFlowInput {
  title?: string;
  nodes: readonly ProcessFlowNodeInput[];
  edges: readonly ProcessFlowEdgeInput[];
}

export interface ProcessFlowLayoutNode {
  id: string;
  kind: ProcessFlowNodeKind;
  label: string;
  lines: readonly string[];
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ProcessFlowEdgeKind = "normal" | "return" | "bypass";

export type ProcessFlowEdgeVisualKind =
  | "main"
  | "condition"
  | "affirmative"
  | "negative"
  | "information"
  | "alternate"
  | "return";

export interface ProcessFlowLayoutPoint {
  x: number;
  y: number;
}

export interface ProcessFlowLayoutSection {
  startPoint: ProcessFlowLayoutPoint;
  bendPoints: readonly ProcessFlowLayoutPoint[];
  endPoint: ProcessFlowLayoutPoint;
}

export interface ProcessFlowLayoutEdge {
  index: number;
  from: string;
  to: string;
  label: string | null;
  labelX: number;
  labelY: number;
  labelWidth: number;
  path: string;
  kind: ProcessFlowEdgeKind;
  visualKind: ProcessFlowEdgeVisualKind;
  sections: readonly ProcessFlowLayoutSection[];
  sourcePoint: ProcessFlowLayoutPoint;
  targetPoint: ProcessFlowLayoutPoint;
}

export interface ProcessFlowLayoutResult {
  engine: "elk" | "fallback";
  width: number;
  height: number;
  nodes: readonly ProcessFlowLayoutNode[];
  edges: readonly ProcessFlowLayoutEdge[];
}

export class ProcessFlowLayoutError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(issues.join(" "));
    this.name = "ProcessFlowLayoutError";
  }
}

const DEFAULT_NODE_WIDTH = 184;
const DECISION_NODE_WIDTH = 204;
const MIN_NODE_WIDTH = 164;
const MAX_NODE_WIDTH = 264;
const BASE_NODE_HEIGHT = 50;
const LINE_HEIGHT = 14;
const GRAPH_PADDING = 28;
const PROCESS_FLOW_KIND_LABELS: Readonly<Record<ProcessFlowNodeKind, string>> =
  {
    START: "Inicio",
    ACTOR: "Actor",
    PROCESS: "Proceso",
    DECISION: "Decisión",
    SYSTEM: "Sistema",
    END: "Fin",
  };

function normalizeKind(kind: string): ProcessFlowNodeKind {
  const normalized = kind.trim().toUpperCase();
  return PROCESS_FLOW_NODE_KINDS.includes(normalized as ProcessFlowNodeKind)
    ? (normalized as ProcessFlowNodeKind)
    : "PROCESS";
}

export function processFlowTextLines(
  value: string,
  maxLength = 29,
  maxLines = 3,
): readonly string[] {
  const words = value.trim().split(/\s+/u).filter(Boolean);
  const lines: string[] = [];
  for (const rawWord of words) {
    const word =
      rawWord.length > maxLength
        ? `${rawWord.slice(0, Math.max(1, maxLength - 1))}…`
        : rawWord;
    const current = lines.at(-1) ?? "";
    if (!current || `${current} ${word}`.length > maxLength) {
      lines.push(word);
    } else {
      lines[lines.length - 1] = `${current} ${word}`;
    }
  }
  if (lines.length <= maxLines) return lines.length ? lines : ["Sin nombre"];
  const visible = lines.slice(0, maxLines);
  visible[maxLines - 1] =
    `${(visible[maxLines - 1] ?? "").replace(/[.…]+$/u, "")}…`;
  return visible;
}

export function processFlowNodeDimensions(node: ProcessFlowNodeInput): {
  width: number;
  height: number;
  lines: readonly string[];
} {
  const kind = normalizeKind(node.kind);
  const lines = processFlowTextLines(node.label, kind === "DECISION" ? 27 : 29);
  const longestLine = Math.max(...lines.map((line) => line.length), 12);
  const minimumWidth =
    kind === "DECISION" ? DECISION_NODE_WIDTH : DEFAULT_NODE_WIDTH;
  return {
    width: Math.max(
      minimumWidth,
      Math.min(MAX_NODE_WIDTH, Math.max(MIN_NODE_WIDTH, longestLine * 7 + 38)),
    ),
    height: BASE_NODE_HEIGHT + Math.max(1, lines.length) * LINE_HEIGHT,
    lines,
  };
}

export function validateProcessFlowInput(
  input: ProcessFlowInput,
): readonly string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  input.nodes.forEach((node, index) => {
    const id = node.id.trim();
    if (!id) issues.push(`El paso ${index + 1} no tiene identificador.`);
    else if (ids.has(id)) issues.push(`El identificador ${id} está duplicado.`);
    else ids.add(id);
    if (!node.label.trim()) issues.push(`El paso ${index + 1} no tiene texto.`);
  });
  input.edges.forEach((edge, index) => {
    if (!edge.from.trim() || !edge.to.trim()) {
      issues.push(`La conexión ${index + 1} está incompleta.`);
      return;
    }
    if (!ids.has(edge.from.trim())) {
      issues.push(`La conexión ${index + 1} tiene un origen inexistente.`);
    }
    if (!ids.has(edge.to.trim())) {
      issues.push(`La conexión ${index + 1} tiene un destino inexistente.`);
    }
  });
  return issues;
}

function edgeLabelDimensions(label: string | null): {
  width: number;
  height: number;
} {
  const length = label?.trim().length ?? 0;
  return {
    width: length ? Math.max(38, Math.min(176, length * 6.3 + 20)) : 0,
    height: length ? 22 : 0,
  };
}

function sectionPoints(section: ElkEdgeSection): readonly ElkPoint[] {
  return [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
}

function copyPoint(point: ElkPoint): ProcessFlowLayoutPoint {
  return { x: point.x, y: point.y };
}

function copySections(
  sections: readonly ElkEdgeSection[],
): readonly ProcessFlowLayoutSection[] {
  return sections.map((section) => ({
    startPoint: copyPoint(section.startPoint),
    bendPoints: (section.bendPoints ?? []).map(copyPoint),
    endPoint: copyPoint(section.endPoint),
  }));
}

function pathFromSections(sections: readonly ElkEdgeSection[]): string {
  return sections
    .map((section) => {
      const points = sectionPoints(section);
      const [first, ...remaining] = points;
      if (!first) return "";
      return `M ${first.x} ${first.y} ${remaining
        .map((point) => `L ${point.x} ${point.y}`)
        .join(" ")}`;
    })
    .filter(Boolean)
    .join(" ");
}

function longestSectionMidpoint(sections: readonly ElkEdgeSection[]): ElkPoint {
  let longest = { length: -1, x: GRAPH_PADDING, y: GRAPH_PADDING };
  for (const section of sections) {
    const points = sectionPoints(section);
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1];
      const end = points[index];
      if (!start || !end) continue;
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      if (length > longest.length) {
        longest = {
          length,
          x: (start.x + end.x) / 2,
          y: (start.y + end.y) / 2,
        };
      }
    }
  }
  return longest;
}

function edgeKind(
  source: ProcessFlowLayoutNode | undefined,
  target: ProcessFlowLayoutNode | undefined,
): ProcessFlowEdgeKind {
  if (!source || !target) return "normal";
  if (target.y <= source.y) return "return";
  return target.y > source.y + source.height * 2 ? "bypass" : "normal";
}

function normalizedEdgeLabel(label: string | null): string {
  return (label ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .trim()
    .toLowerCase();
}

export function classifyProcessFlowEdgeVisualKind(
  label: string | null,
  routeKind: ProcessFlowEdgeKind = "normal",
): ProcessFlowEdgeVisualKind {
  if (routeKind === "return") return "return";
  const normalized = normalizedEdgeLabel(label);
  if (!normalized) return routeKind === "bypass" ? "alternate" : "main";
  if (
    /^(no|false)$/u.test(normalized) ||
    /\b(rechaz|error|fall|deneg|cancel|inval|no autorizado|no valido|incorrect|bloque)\w*/u.test(
      normalized,
    )
  ) {
    return "negative";
  }
  if (
    /^(si|yes|true)(\b|$)/u.test(normalized) ||
    /\b(aprob|acept|confirm|autoriz|correct|exito|valido|validada|complet|captur|autenticad)\w*/u.test(
      normalized,
    )
  ) {
    return "affirmative";
  }
  if (
    /\b(consult|valid|verific|solicit|envi|retorn|reintent|mostr|registr|guard|persist|ingres)\w*/u.test(
      normalized,
    )
  ) {
    return "information";
  }
  return routeKind === "bypass" ? "alternate" : "condition";
}

let elkInstance: ElkApi | null = null;

function elk(): ElkApi {
  elkInstance ??= new ElkConstructor();
  return elkInstance;
}

export async function layoutProcessFlow(
  input: ProcessFlowInput,
): Promise<ProcessFlowLayoutResult> {
  const issues = validateProcessFlowInput(input);
  if (issues.length > 0) throw new ProcessFlowLayoutError(issues);
  if (input.nodes.length === 0) {
    return { engine: "elk", width: 0, height: 0, nodes: [], edges: [] };
  }

  const dimensions = new Map(
    input.nodes.map(
      (node) => [node.id, processFlowNodeDimensions(node)] as const,
    ),
  );
  const graph: ElkNode = {
    id: "process-flow-root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.padding": `[top=${GRAPH_PADDING},left=${GRAPH_PADDING},bottom=${GRAPH_PADDING},right=${GRAPH_PADDING}]`,
      "elk.randomSeed": "1",
      "elk.separateConnectedComponents": "true",
      "elk.spacing.componentComponent": "56",
      "elk.spacing.nodeNode": "40",
      "elk.spacing.edgeEdge": "12",
      "elk.layered.spacing.nodeNodeBetweenLayers": "58",
      "elk.layered.spacing.edgeNodeBetweenLayers": "18",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.cycleBreaking.strategy": "GREEDY",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
    },
    children: input.nodes.map((node) => {
      const size = dimensions.get(node.id);
      if (!size) {
        throw new ProcessFlowLayoutError([
          `No se pudieron calcular las dimensiones del paso ${node.id}.`,
        ]);
      }
      return {
        id: node.id,
        width: size.width,
        height: size.height,
        layoutOptions: { "elk.portConstraints": "FREE" },
      };
    }),
    edges: input.edges.map((edge, index): ElkExtendedEdge => {
      const size = edgeLabelDimensions(edge.label);
      return {
        id: `process-flow-edge-${index}`,
        sources: [edge.from],
        targets: [edge.to],
        labels: edge.label?.trim()
          ? [
              {
                id: `process-flow-edge-label-${index}`,
                text: edge.label,
                width: size.width,
                height: size.height,
              },
            ]
          : undefined,
      };
    }),
  };

  const result = await elk().layout(graph);
  const nodes: ProcessFlowLayoutNode[] = (result.children ?? []).map(
    (child) => {
      const source = input.nodes.find((node) => node.id === child.id);
      const size = dimensions.get(child.id);
      if (!source || !size) {
        throw new ProcessFlowLayoutError([
          `ELK devolvió un paso desconocido: ${child.id}.`,
        ]);
      }
      return {
        id: child.id,
        kind: normalizeKind(source.kind),
        label: source.label,
        lines: size.lines,
        x: child.x ?? 0,
        y: child.y ?? 0,
        width: child.width ?? size.width,
        height: child.height ?? size.height,
      };
    },
  );
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));
  const edges: ProcessFlowLayoutEdge[] = (result.edges ?? []).map((edge) => {
    const index = Number(edge.id.replace("process-flow-edge-", ""));
    const source = input.edges[index];
    if (!Number.isInteger(index) || !source) {
      throw new ProcessFlowLayoutError([
        `ELK devolvió una conexión desconocida: ${edge.id}.`,
      ]);
    }
    const elkSections = edge.sections ?? [];
    const sections = copySections(elkSections);
    const firstSection = sections[0];
    const lastSection = sections.at(-1);
    if (!firstSection || !lastSection) {
      throw new ProcessFlowLayoutError([
        `ELK no devolvió geometría para la conexión ${index + 1}.`,
      ]);
    }
    const dimensionsForLabel = edgeLabelDimensions(source.label);
    const elkLabel = edge.labels?.[0] as ElkLabel | undefined;
    const midpoint = longestSectionMidpoint(elkSections);
    const kind = edgeKind(nodesById.get(source.from), nodesById.get(source.to));
    return {
      index,
      from: source.from,
      to: source.to,
      label: source.label,
      labelX:
        elkLabel?.x === undefined
          ? midpoint.x
          : elkLabel.x + (elkLabel.width ?? dimensionsForLabel.width) / 2,
      labelY:
        elkLabel?.y === undefined
          ? midpoint.y
          : elkLabel.y + (elkLabel.height ?? dimensionsForLabel.height) / 2,
      labelWidth: dimensionsForLabel.width,
      path: pathFromSections(elkSections),
      kind,
      visualKind: classifyProcessFlowEdgeVisualKind(source.label, kind),
      sections,
      sourcePoint: firstSection.startPoint,
      targetPoint: lastSection.endPoint,
    };
  });

  const width = Math.max(
    result.width ?? 0,
    ...nodes.map((node) => node.x + node.width),
  );
  const height = Math.max(
    result.height ?? 0,
    ...nodes.map((node) => node.y + node.height),
  );
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new ProcessFlowLayoutError(["ELK no devolvió dimensiones válidas."]);
  }
  if (edges.some((edge) => !edge.path)) {
    throw new ProcessFlowLayoutError([
      "ELK no devolvió una ruta para cada conexión.",
    ]);
  }
  return { engine: "elk", width, height, nodes, edges };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function nodePalette(kind: ProcessFlowNodeKind): {
  fill: string;
  stroke: string;
} {
  if (kind === "START" || kind === "END")
    return { fill: "#eef4eb", stroke: "#66784c" };
  if (kind === "DECISION") return { fill: "#fff7e8", stroke: "#c97828" };
  if (kind === "ACTOR") return { fill: "#f1f6fa", stroke: "#2f6fa3" };
  if (kind === "SYSTEM") return { fill: "#f4f1f7", stroke: "#675579" };
  return { fill: "#ffffff", stroke: "#4f6675" };
}

function edgePalette(kind: ProcessFlowEdgeVisualKind): string {
  if (kind === "affirmative") return "#66784c";
  if (kind === "negative") return "#ba3f3f";
  if (kind === "information") return "#2f6fa3";
  if (kind === "condition") return "#c97828";
  if (kind === "return") return "#8b5e34";
  return "#415d6b";
}

export function renderProcessFlowSvg(
  layout: ProcessFlowLayoutResult,
  options: {
    title?: string;
    markerId?: string;
    width?: number;
    height?: number;
  } = {},
): string {
  const markerId = (options.markerId ?? "rq-process-flow-arrow").replace(
    /[^a-z0-9_-]/giu,
    "",
  );
  const width = options.width ?? layout.width;
  const height = options.height ?? layout.height;
  const title = escapeXml(options.title?.trim() || "Diagrama de flujo");
  const markerKinds: readonly ProcessFlowEdgeVisualKind[] = [
    "main",
    "condition",
    "affirmative",
    "negative",
    "information",
    "alternate",
    "return",
  ];
  const markerMarkup = markerKinds
    .map((kind) => {
      const color = edgePalette(kind);
      return `<marker id="${markerId}-${kind}" markerWidth="12" markerHeight="12" refX="10.5" refY="6" orient="auto" markerUnits="userSpaceOnUse" viewBox="0 0 12 12"><path d="M 0 0 L 12 6 L 0 12 L 3 6 z" fill="${color}"/></marker>`;
    })
    .join("");
  const edgeMarkup = [...layout.edges]
    .sort((left, right) => left.index - right.index)
    .map((edge) => {
      const rawLabel = edge.label?.trim() ?? "";
      const visibleLabel =
        rawLabel.length > 30 ? `${rawLabel.slice(0, 29)}…` : rawLabel;
      const stroke = edgePalette(edge.visualKind);
      const dash =
        edge.visualKind === "return"
          ? ' stroke-dasharray="7 5"'
          : edge.visualKind === "alternate"
            ? ' stroke-dasharray="3 4"'
            : "";
      const strokeWidth = edge.visualKind === "main" ? 2.4 : 2;
      const labelMarkup = visibleLabel
        ? `<g class="rq-process-flow__edge-label" transform="translate(${edge.labelX} ${edge.labelY})"><rect x="${-edge.labelWidth / 2}" y="-11" width="${edge.labelWidth}" height="22" rx="11" fill="#ffffff" stroke="${stroke}" stroke-opacity=".35"/><text y="1" text-anchor="middle" dominant-baseline="middle" fill="${stroke}" font-size="9" font-weight="850">${escapeXml(visibleLabel)}</text><title>${escapeXml(rawLabel)}</title></g>`
        : "";
      return `<g class="rq-process-flow__edge rq-process-flow__edge--${edge.kind} rq-process-flow__edge--${edge.visualKind}"><path d="${escapeXml(edge.path)}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" marker-end="url(#${markerId}-${edge.visualKind})"${dash}/><circle class="rq-process-flow__edge-origin" cx="${edge.sourcePoint.x}" cy="${edge.sourcePoint.y}" r="3" fill="#ffffff" stroke="${stroke}" stroke-width="1.6" vector-effect="non-scaling-stroke"/>${labelMarkup}</g>`;
    })
    .join("");
  const nodeMarkup = layout.nodes
    .map((node) => {
      const palette = nodePalette(node.kind);
      const centerX = node.x + node.width / 2;
      const centerY = node.y + node.height / 2;
      const radius =
        node.kind === "START" || node.kind === "END" ? node.height / 2 : 12;

      const lines = node.lines
        .map(
          (line, index) =>
            `<tspan x="0" y="${8 + index * LINE_HEIGHT}">${escapeXml(line)}</tspan>`,
        )
        .join("");
      return `<g class="rq-process-flow__node rq-process-flow__node--${node.kind.toLowerCase()}" transform="translate(${centerX} ${centerY})"><rect x="${-node.width / 2}" y="${-node.height / 2}" width="${node.width}" height="${node.height}" rx="${radius}" fill="${palette.fill}" stroke="${palette.stroke}" stroke-width="1.4"/><line class="rq-process-flow__node-accent" x1="${-node.width / 2 + 15}" x2="${node.width / 2 - 15}" y1="${-node.height / 2 + 1}" y2="${-node.height / 2 + 1}" stroke="${palette.stroke}" stroke-width="3" stroke-linecap="round"/><text class="rq-process-flow__type" x="0" y="-12" text-anchor="middle" fill="#637077" font-size="7.5" font-weight="850">${escapeXml(PROCESS_FLOW_KIND_LABELS[node.kind])}</text><text class="rq-process-flow__node-label" text-anchor="middle" fill="#363534" font-size="10.5" font-weight="800">${lines}</text><title>${escapeXml(`${PROCESS_FLOW_KIND_LABELS[node.kind]}: ${node.label}`)}</title></g>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${title}" width="${Math.round(width)}" height="${Math.round(height)}" viewBox="0 0 ${layout.width} ${layout.height}"><title>${title}</title><defs>${markerMarkup}</defs><g class="rq-process-flow__edges">${edgeMarkup}</g><g class="rq-process-flow__nodes">${nodeMarkup}</g></svg>`;
}
