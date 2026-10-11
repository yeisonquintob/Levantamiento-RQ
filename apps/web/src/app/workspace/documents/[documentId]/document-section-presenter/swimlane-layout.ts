import { type JsonRecord, stringValue, displayText } from "./shared";

function flowDepths(
  nodes: JsonRecord[],
  edges: JsonRecord[],
): Map<string, number> {
  const ids = nodes.map((node) => stringValue(node.id)).filter(Boolean);
  const indegree = new Map(ids.map((id) => [id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const from = stringValue(edge.from);
    const to = stringValue(edge.to);
    if (!indegree.has(from) || !indegree.has(to)) continue;
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
    outgoing.set(from, [...(outgoing.get(from) ?? []), to]);
  }
  const queue = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  const depths = new Map(ids.map((id) => [id, 0]));
  const visited = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) break;
    visited.add(id);
    for (const to of outgoing.get(id) ?? []) {
      depths.set(to, Math.max(depths.get(to) ?? 0, (depths.get(id) ?? 0) + 1));
      indegree.set(to, (indegree.get(to) ?? 1) - 1);
      if (indegree.get(to) === 0) queue.push(to);
    }
  }
  ids.forEach((id, index) => {
    if (!visited.has(id)) depths.set(id, Math.max(depths.get(id) ?? 0, index));
  });
  return depths;
}

export interface SwimlaneBox {
  x: number;
  y: number;
  width: number;
  height: number;
  lane: number;
}

/** Texto visible y ancho de la pastilla de una etiqueta de conector. */
export function swimlaneEdgeLabel(label: string): {
  text: string;
  width: number;
} {
  const text = label.length > 26 ? `${label.slice(0, 25)}…` : label;
  return { text, width: Math.min(176, Math.max(52, text.length * 6.4 + 20)) };
}

/**
 * Disposición compacta por capas: cada paso avanza solo lo necesario respecto a sus
 * predecesores. Un paso en el mismo carril deja espacio para la flecha (y para la etiqueta del
 * conector si la tiene); uno en otro carril basta con que quede a la derecha del conector
 * vertical. Así el diagrama es mucho menos ancho y el texto se lee más grande al ajustarlo.
 */
export function swimlaneLayout(
  nodes: JsonRecord[],
  edges: JsonRecord[],
  laneIndexById: Map<string, number>,
  metrics: {
    laneHeight: number;
    labelWidth: number;
    padding: number;
    nodeWidth: number;
    nodeHeight: number;
    decisionHeight: number;
    sameLaneGap: number;
    crossLaneRun: number;
  },
): { boxes: Map<string, SwimlaneBox>; width: number } {
  const depths = flowDepths(nodes, edges);
  const ordered = nodes
    .map((node, index) => ({ node, index }))
    .sort(
      (left, right) =>
        (depths.get(stringValue(left.node.id)) ?? 0) -
          (depths.get(stringValue(right.node.id)) ?? 0) ||
        left.index - right.index,
    )
    .map((entry) => entry.node);
  const boxes = new Map<string, SwimlaneBox>();
  const laneRight = new Map<number, number>();
  const firstX = metrics.labelWidth + metrics.padding + metrics.nodeWidth / 2;
  let rightmost = firstX + metrics.nodeWidth / 2;

  for (const node of ordered) {
    const id = stringValue(node.id);
    const lane = laneIndexById.get(stringValue(node.laneId)) ?? 0;
    const height =
      stringValue(node.kind) === "DECISION"
        ? metrics.decisionHeight
        : metrics.nodeHeight;
    let x = firstX;
    for (const edge of edges) {
      if (stringValue(edge.to) !== id) continue;
      const source = boxes.get(stringValue(edge.from));
      if (!source) continue;
      const label = displayText(stringValue(edge.label));
      const sameLaneGap = label
        ? Math.max(metrics.sameLaneGap, swimlaneEdgeLabel(label).width + 28)
        : metrics.sameLaneGap;
      x = Math.max(
        x,
        source.lane === lane
          ? source.x + metrics.nodeWidth + sameLaneGap
          : source.x + metrics.nodeWidth / 2 + metrics.crossLaneRun,
      );
    }
    const occupied = laneRight.get(lane);
    if (occupied !== undefined) {
      x = Math.max(x, occupied + metrics.sameLaneGap + metrics.nodeWidth / 2);
    }
    laneRight.set(lane, x + metrics.nodeWidth / 2);
    rightmost = Math.max(rightmost, x + metrics.nodeWidth / 2);
    boxes.set(id, {
      x,
      y: lane * metrics.laneHeight + metrics.laneHeight / 2,
      width: metrics.nodeWidth,
      height,
      lane,
    });
  }

  return { boxes, width: rightmost + metrics.padding };
}

export interface SwimlaneRoute {
  path: string;
  points: readonly (readonly [number, number])[];
}

export function swimlaneRoute(
  from: SwimlaneBox,
  to: SwimlaneBox,
): SwimlaneRoute {
  const build = (points: readonly (readonly [number, number])[]) => ({
    path: points
      .map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`)
      .join(" "),
    points,
  });
  if (from.lane === to.lane && to.x > from.x) {
    return build([
      [from.x + from.width / 2, from.y],
      [to.x - to.width / 2, to.y],
    ]);
  }
  if (to.x - to.width / 2 >= from.x + 20) {
    const y1 = from.y + (to.y > from.y ? from.height / 2 : -from.height / 2);
    return build([
      [from.x, y1],
      [from.x, to.y],
      [to.x - to.width / 2, to.y],
    ]);
  }
  // Retorno o bucle: sale por la derecha, rodea y entra por el lado derecho del destino.
  const x1 = from.x + from.width / 2;
  const turn = Math.max(x1, to.x + to.width / 2) + 30;
  return build([
    [x1, from.y],
    [turn, from.y],
    [turn, to.y],
    [to.x + to.width / 2, to.y],
  ]);
}

/**
 * Busca sobre el conector el punto donde la pastilla de la etiqueta no tapa ningún paso;
 * prefiere el centro del recorrido y, si no hay hueco, lo deja allí.
 */
export function swimlaneLabelPosition(
  points: readonly (readonly [number, number])[],
  pillWidth: number,
  boxes: readonly SwimlaneBox[],
): { x: number; y: number } {
  const samples: { x: number; y: number }[] = [];
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const [ax, ay] = points[index - 1] as readonly [number, number];
    const [bx, by] = points[index] as readonly [number, number];
    const segment = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.round(segment / 6));
    for (let step = 0; step <= steps; step += 1) {
      samples.push({
        x: ax + ((bx - ax) * step) / steps,
        y: ay + ((by - ay) * step) / steps,
      });
    }
    length += segment;
  }
  const middle = samples[Math.floor(samples.length / 2)] ?? { x: 0, y: 0 };
  const halfWidth = pillWidth / 2 + 4;
  const halfHeight = 11 + 4;
  const free = (candidate: { x: number; y: number }) =>
    boxes.every(
      (box) =>
        candidate.x + halfWidth <= box.x - box.width / 2 ||
        candidate.x - halfWidth >= box.x + box.width / 2 ||
        candidate.y + halfHeight <= box.y - box.height / 2 ||
        candidate.y - halfHeight >= box.y + box.height / 2,
    );
  const best = [...samples]
    .sort(
      (left, right) =>
        Math.hypot(left.x - middle.x, left.y - middle.y) -
        Math.hypot(right.x - middle.x, right.y - middle.y),
    )
    .find(free);
  return best ?? (length > 0 ? middle : (samples[0] ?? { x: 0, y: 0 }));
}
