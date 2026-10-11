import {
  type ProcessFlowEdgeVisualKind,
  type ProcessFlowLayoutResult as CanonicalProcessFlowLayout,
} from "@levantamiento-rq/shared-contracts";
import { type JsonRecord, stringValue, displayText } from "./shared";

export const FLOW_KIND_LABELS: Readonly<Record<string, string>> = {
  START: "Inicio",
  END: "Fin",
  ACTOR: "Actor",
  PROCESS: "Proceso",
  DECISION: "Decisión",
  SYSTEM: "Sistema",
};

interface FlowPosition {
  x: number;
  y: number;
}

interface FlowNodeGeometry extends FlowPosition {
  width: number;
  height: number;
  level: number;
}

type FlowEdgeKind = "normal" | "return" | "bypass";

interface FlowEdgeGeometry {
  path: string;
  labelX: number;
  labelY: number;
  kind: FlowEdgeKind;
  visualKind?: ProcessFlowEdgeVisualKind;
  sourcePoint?: FlowPosition;
  targetPoint?: FlowPosition;
}

interface FlowLayoutResult {
  positions: Map<string, FlowNodeGeometry>;
  routes: Map<number, FlowEdgeGeometry>;
  width: number;
  height: number;
}

export function canonicalFlowLayoutToRenderer(
  layout: CanonicalProcessFlowLayout,
): FlowLayoutResult {
  return {
    positions: new Map(
      layout.nodes.map((node) => [
        node.id,
        {
          x: node.x + node.width / 2,
          y: node.y + node.height / 2,
          width: node.width,
          height: node.height,
          level: 0,
        },
      ]),
    ),
    routes: new Map(
      layout.edges.map((edge) => [
        edge.index,
        {
          path: edge.path,
          labelX: edge.labelX,
          labelY: edge.labelY,
          kind: edge.kind,
          visualKind: edge.visualKind,
          sourcePoint: edge.sourcePoint,
          targetPoint: edge.targetPoint,
        },
      ]),
    ),
    width: layout.width,
    height: layout.height,
  };
}

export const FLOW_EDGE_VISUAL_STYLES: Readonly<
  Record<
    ProcessFlowEdgeVisualKind,
    { color: string; dashArray?: string; strokeWidth: number }
  >
> = {
  main: { color: "var(--rq-action-consult)", strokeWidth: 2.4 },
  condition: { color: "var(--rq-action-warning)", strokeWidth: 2 },
  affirmative: { color: "var(--rq-action-affirmative)", strokeWidth: 2 },
  negative: { color: "var(--rq-action-danger)", strokeWidth: 2 },
  information: { color: "var(--rq-action-information)", strokeWidth: 2 },
  alternate: {
    color: "var(--rq-action-operation)",
    dashArray: "3 4",
    strokeWidth: 1.9,
  },
  return: {
    color: "var(--rq-action-warning)",
    dashArray: "7 5",
    strokeWidth: 2,
  },
};

export const FLOW_EDGE_VISUAL_KINDS = Object.keys(
  FLOW_EDGE_VISUAL_STYLES,
) as readonly ProcessFlowEdgeVisualKind[];

const FLOW_NODE_WIDTH = 184;

const FLOW_NODE_HEIGHT = 62;

const FLOW_DECISION_WIDTH = 204;

const FLOW_DECISION_HEIGHT = 66;

const FLOW_COLUMN_GAP = 68;

const FLOW_MIN_LEVEL_GAP = 96;

const FLOW_EDGE_CLEARANCE = 22;

const FLOW_EDGE_LANE_GAP = 30;

const FLOW_PADDING_Y = 42;

const FLOW_NODE_AREA_PADDING = 52;

const FLOW_SIDE_MARGIN = 126;

const FLOW_SPECIAL_RAIL_GAP = 18;

function flowNodeDimensions(kind: string): {
  width: number;
  height: number;
} {
  if (kind === "DECISION") {
    return {
      width: FLOW_DECISION_WIDTH,
      height: FLOW_DECISION_HEIGHT,
    };
  }

  return {
    width: FLOW_NODE_WIDTH,
    height: FLOW_NODE_HEIGHT,
  };
}

function graphHasPath(
  start: string,
  target: string,
  outgoing: Map<string, string[]>,
): boolean {
  if (start === target) {
    return true;
  }

  const visited = new Set<string>();

  const stack = [start];

  while (stack.length > 0) {
    const current = stack.pop();

    if (!current || visited.has(current)) {
      continue;
    }

    visited.add(current);

    for (const next of outgoing.get(current) ?? []) {
      if (next === target) {
        return true;
      }

      if (!visited.has(next)) {
        stack.push(next);
      }
    }
  }

  return false;
}

function flowPortOffset(
  index: number,
  count: number,
  nodeWidth: number,
): number {
  if (count <= 1) {
    return 0;
  }

  const maxSpread = Math.max(0, Math.min(58, nodeWidth / 2 - 18));

  const step = Math.min(22, (maxSpread * 2) / Math.max(1, count - 1));

  return (index - (count - 1) / 2) * step;
}

export function flowTextLines(
  value: string,
  maxLength = 28,
  maxLines = 2,
): string[] {
  const words = value.split(/\s+/u).filter(Boolean);

  const lines: string[] = [];

  for (const rawWord of words) {
    const word =
      rawWord.length > maxLength
        ? `${rawWord.slice(0, maxLength - 1)}…`
        : rawWord;

    const current = lines.at(-1) ?? "";

    if (!current || `${current} ${word}`.length > maxLength) {
      lines.push(word);
    } else {
      lines[lines.length - 1] = `${current} ${word}`;
    }
  }

  if (lines.length <= maxLines) {
    return lines;
  }

  const visible = lines.slice(0, maxLines);

  const last = visible[maxLines - 1] ?? "";

  visible[maxLines - 1] = `${last.replace(/[.…]+$/u, "")}…`;

  return visible;
}

/*
 * MOTOR DE AUTO-LAYOUT GENÉRICO
 *
 * La IA continúa siendo la única fuente de:
 * - nodos
 * - tipos
 * - conexiones
 * - condiciones / etiquetas
 *
 * Este código solamente calcula:
 * - niveles
 * - orden visual
 * - posiciones
 * - puertos
 * - carriles
 * - rutas
 *
 * Nunca inventa ni elimina relaciones.
 */
export function buildFlowLayout(
  nodes: JsonRecord[],
  edges: JsonRecord[],
): FlowLayoutResult {
  const ids = nodes.map((node) => stringValue(node.id)).filter(Boolean);

  const validIds = new Set(ids);

  const indexById = new Map(ids.map((id, index) => [id, index] as const));

  const outgoing = new Map(ids.map((id) => [id, [] as string[]] as const));

  const incoming = new Map<string, number>(ids.map((id) => [id, 0]));

  const predecessor = new Map(ids.map((id) => [id, [] as string[]] as const));

  const successor = new Map(ids.map((id) => [id, [] as string[]] as const));

  const undirected = new Map(ids.map((id) => [id, [] as string[]] as const));

  const returnEdges = new Set<number>();

  const rankingPairs = new Set<string>();

  /*
   * Se genera un DAG solamente para calcular
   * posiciones.
   *
   * Las conexiones que cierren un ciclo NO
   * desaparecen: después se dibujan mediante
   * carriles laterales.
   */
  edges.forEach((edge, edgeIndex) => {
    const from = stringValue(edge.from);

    const to = stringValue(edge.to);

    if (!from || !to || !validIds.has(from) || !validIds.has(to)) {
      return;
    }

    if (from === to) {
      returnEdges.add(edgeIndex);
      return;
    }

    if (graphHasPath(to, from, outgoing)) {
      returnEdges.add(edgeIndex);
      return;
    }

    const pair = `${from}\u0000${to}`;

    if (rankingPairs.has(pair)) {
      return;
    }

    rankingPairs.add(pair);

    outgoing.get(from)?.push(to);

    predecessor.get(to)?.push(from);

    successor.get(from)?.push(to);

    undirected.get(from)?.push(to);

    undirected.get(to)?.push(from);

    incoming.set(to, (incoming.get(to) ?? 0) + 1);
  });

  /*
   * Detecta componentes separados para
   * mantenerlos agrupados.
   */
  const componentById = new Map<string, number>();

  let componentIndex = 0;

  for (const rootId of ids) {
    if (componentById.has(rootId)) {
      continue;
    }

    const stack = [rootId];

    while (stack.length > 0) {
      const current = stack.pop();

      if (!current || componentById.has(current)) {
        continue;
      }

      componentById.set(current, componentIndex);

      for (const neighbour of undirected.get(current) ?? []) {
        if (!componentById.has(neighbour)) {
          stack.push(neighbour);
        }
      }
    }

    componentIndex += 1;
  }

  /*
   * Cálculo de niveles mediante longest-path.
   */
  const levelById = new Map<string, number>();

  const queue = ids
    .filter((id) => (incoming.get(id) ?? 0) === 0)
    .sort(
      (left, right) => (indexById.get(left) ?? 0) - (indexById.get(right) ?? 0),
    );

  if (queue.length === 0 && ids.length > 0) {
    queue.push(ids[0] ?? "");
  }

  queue.forEach((id) => {
    levelById.set(id, 0);
  });

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor];

    if (!id) {
      continue;
    }

    const currentLevel = levelById.get(id) ?? 0;

    const targets = [...(outgoing.get(id) ?? [])].sort(
      (left, right) => (indexById.get(left) ?? 0) - (indexById.get(right) ?? 0),
    );

    for (const target of targets) {
      levelById.set(
        target,
        Math.max(levelById.get(target) ?? 0, currentLevel + 1),
      );

      incoming.set(target, Math.max(0, (incoming.get(target) ?? 1) - 1));

      if (incoming.get(target) === 0 && !queue.includes(target)) {
        queue.push(target);
      }
    }
  }

  /*
   * Nodos aislados o no alcanzables.
   */
  for (const id of ids) {
    if (!levelById.has(id)) {
      levelById.set(id, 0);
    }
  }

  const groups = new Map<number, string[]>();

  for (const id of ids) {
    const level = levelById.get(id) ?? 0;

    groups.set(level, [...(groups.get(level) ?? []), id]);
  }

  const levels = [...groups.keys()].sort((left, right) => left - right);

  /*
   * Barycentric ordering:
   * reduce cruces de líneas sin modificar
   * ninguna conexión.
   */
  const currentOrder = () => {
    const result = new Map<string, number>();

    for (const level of levels) {
      (groups.get(level) ?? []).forEach((id, index) => {
        result.set(id, index);
      });
    }

    return result;
  };

  const barycenter = (
    id: string,
    neighbours: Map<string, string[]>,
    order: Map<string, number>,
  ): number | null => {
    const items = neighbours.get(id) ?? [];

    if (items.length === 0) {
      return null;
    }

    const values = items
      .map((item) => order.get(item))
      .filter((value): value is number => value !== undefined);

    if (values.length === 0) {
      return null;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };

  const sortLevel = (level: number, neighbours: Map<string, string[]>) => {
    const group = groups.get(level);

    if (!group) {
      return;
    }

    const order = currentOrder();

    group.sort((left, right) => {
      const leftComponent = componentById.get(left) ?? 0;

      const rightComponent = componentById.get(right) ?? 0;

      if (leftComponent !== rightComponent) {
        return leftComponent - rightComponent;
      }

      const leftBarycenter = barycenter(left, neighbours, order);

      const rightBarycenter = barycenter(right, neighbours, order);

      if (
        leftBarycenter !== null &&
        rightBarycenter !== null &&
        Math.abs(leftBarycenter - rightBarycenter) > 0.001
      ) {
        return leftBarycenter - rightBarycenter;
      }

      if (leftBarycenter !== null && rightBarycenter === null) {
        return -1;
      }

      if (leftBarycenter === null && rightBarycenter !== null) {
        return 1;
      }

      return (indexById.get(left) ?? 0) - (indexById.get(right) ?? 0);
    });
  };

  /*
   * Varias pasadas arriba/abajo reducen
   * cruces en grafos con decisiones y
   * convergencias.
   */
  for (let sweep = 0; sweep < 4; sweep += 1) {
    for (let index = 1; index < levels.length; index += 1) {
      const level = levels[index];

      if (level !== undefined) {
        sortLevel(level, predecessor);
      }
    }

    for (let index = levels.length - 2; index >= 0; index -= 1) {
      const level = levels[index];

      if (level !== undefined) {
        sortLevel(level, successor);
      }
    }
  }

  interface EdgeMeta {
    edgeIndex: number;
    fromId: string;
    toId: string;
    fromLevel: number;
    toLevel: number;
    kind: "normal" | "return" | "bypass";
  }

  const edgeMeta: EdgeMeta[] = [];

  edges.forEach((edge, edgeIndex) => {
    const fromId = stringValue(edge.from);

    const toId = stringValue(edge.to);

    if (!validIds.has(fromId) || !validIds.has(toId)) {
      return;
    }

    const fromLevel = levelById.get(fromId) ?? 0;

    const toLevel = levelById.get(toId) ?? 0;

    let kind: EdgeMeta["kind"] = "normal";

    if (returnEdges.has(edgeIndex) || toLevel <= fromLevel) {
      kind = "return";
    } else if (toLevel > fromLevel + 1) {
      /*
       * Conexión válida que salta niveles.
       * Se saca por un lateral para evitar
       * atravesar nodos intermedios.
       */
      kind = "bypass";
    }

    edgeMeta.push({
      edgeIndex,
      fromId,
      toId,
      fromLevel,
      toLevel,
      kind,
    });
  });

  /*
   * Carriles laterales para ciclos y
   * conexiones que saltan niveles.
   */
  interface SpecialPlan {
    side: "left" | "right";
    lane: number;
    kind: "return" | "bypass";
  }

  const specialPlan = new Map<number, SpecialPlan>();

  let leftSpecialCount = 0;
  let rightSpecialCount = 0;

  for (const meta of edgeMeta) {
    if (meta.kind === "normal") {
      continue;
    }

    const group = groups.get(meta.fromLevel) ?? [];

    const sourceIndex = Math.max(0, group.indexOf(meta.fromId));

    const middle = (group.length - 1) / 2;

    let side: "left" | "right";

    if (group.length > 1 && sourceIndex < middle) {
      side = "left";
    } else if (group.length > 1 && sourceIndex > middle) {
      side = "right";
    } else {
      side = leftSpecialCount <= rightSpecialCount ? "left" : "right";
    }

    const lane = side === "left" ? leftSpecialCount++ : rightSpecialCount++;

    specialPlan.set(meta.edgeIndex, {
      side,
      lane,
      kind: meta.kind,
    });
  }

  const maxNodeWidth = Math.max(FLOW_NODE_WIDTH, FLOW_DECISION_WIDTH);

  const maxNodeHeight = Math.max(FLOW_NODE_HEIGHT, FLOW_DECISION_HEIGHT);

  const maxBreadth = Math.max(
    1,
    ...levels.map((level) => groups.get(level)?.length ?? 1),
  );

  const contentWidth =
    maxBreadth * maxNodeWidth + Math.max(0, maxBreadth - 1) * FLOW_COLUMN_GAP;

  const leftMargin =
    leftSpecialCount > 0
      ? FLOW_SIDE_MARGIN +
        Math.max(0, leftSpecialCount - 1) * FLOW_SPECIAL_RAIL_GAP
      : FLOW_NODE_AREA_PADDING;

  const rightMargin =
    rightSpecialCount > 0
      ? FLOW_SIDE_MARGIN +
        Math.max(0, rightSpecialCount - 1) * FLOW_SPECIAL_RAIL_GAP
      : FLOW_NODE_AREA_PADDING;

  const nodeAreaWidth = Math.max(
    560,
    contentWidth + FLOW_NODE_AREA_PADDING * 2,
  );

  const width = leftMargin + nodeAreaWidth + rightMargin;

  const nodeAreaCenter = leftMargin + nodeAreaWidth / 2;

  /*
   * Se agrupan las conexiones normales
   * por espacio entre niveles.
   *
   * Cada conexión obtiene un carril Y
   * independiente. Esto elimina el
   * solapamiento que tenía el renderer
   * anterior.
   */
  const adjacentByGap = new Map<number, number[]>();

  for (const meta of edgeMeta) {
    if (meta.kind !== "normal" || meta.toLevel !== meta.fromLevel + 1) {
      continue;
    }

    adjacentByGap.set(meta.fromLevel, [
      ...(adjacentByGap.get(meta.fromLevel) ?? []),
      meta.edgeIndex,
    ]);
  }

  const gapHeight = (level: number) => {
    const edgeCount = adjacentByGap.get(level)?.length ?? 0;

    return Math.max(
      FLOW_MIN_LEVEL_GAP,
      FLOW_EDGE_CLEARANCE * 2 + Math.max(1, edgeCount) * FLOW_EDGE_LANE_GAP,
    );
  };

  const levelY = new Map<number, number>();

  let currentY = FLOW_PADDING_Y + maxNodeHeight / 2;

  levels.forEach((level, levelIndex) => {
    if (levelIndex > 0) {
      const previousLevel = levels[levelIndex - 1];

      if (previousLevel !== undefined) {
        currentY += maxNodeHeight + gapHeight(previousLevel);
      }
    }

    levelY.set(level, currentY);
  });

  let height = Math.max(260, currentY + maxNodeHeight / 2 + FLOW_PADDING_Y);

  const positions = new Map<string, FlowNodeGeometry>();

  for (const level of levels) {
    const group = groups.get(level) ?? [];

    const groupWidth =
      group.length * maxNodeWidth +
      Math.max(0, group.length - 1) * FLOW_COLUMN_GAP;

    const firstX = nodeAreaCenter - groupWidth / 2 + maxNodeWidth / 2;

    group.forEach((id, index) => {
      const node = nodes.find((item) => stringValue(item.id) === id);

      const kind = stringValue(node?.kind) || "PROCESS";

      const dimensions = flowNodeDimensions(kind);

      positions.set(id, {
        x: firstX + index * (maxNodeWidth + FLOW_COLUMN_GAP),

        y: levelY.get(level) ?? currentY,

        width: dimensions.width,

        height: dimensions.height,

        level,
      });
    });
  }

  const metaByIndex = new Map(
    edgeMeta.map((meta) => [meta.edgeIndex, meta] as const),
  );

  const outgoingAdjacent = new Map(
    ids.map((id) => [id, [] as number[]] as const),
  );

  const incomingAdjacent = new Map(
    ids.map((id) => [id, [] as number[]] as const),
  );

  for (const meta of edgeMeta) {
    if (meta.kind !== "normal" || meta.toLevel !== meta.fromLevel + 1) {
      continue;
    }

    outgoingAdjacent.get(meta.fromId)?.push(meta.edgeIndex);

    incomingAdjacent.get(meta.toId)?.push(meta.edgeIndex);
  }

  /*
   * Ordena puertos según la posición del
   * nodo opuesto.
   */
  for (const edgeIndices of outgoingAdjacent.values()) {
    edgeIndices.sort((leftIndex, rightIndex) => {
      const left = metaByIndex.get(leftIndex);

      const right = metaByIndex.get(rightIndex);

      const leftX = left ? (positions.get(left.toId)?.x ?? 0) : 0;

      const rightX = right ? (positions.get(right.toId)?.x ?? 0) : 0;

      return leftX - rightX || leftIndex - rightIndex;
    });
  }

  for (const edgeIndices of incomingAdjacent.values()) {
    edgeIndices.sort((leftIndex, rightIndex) => {
      const left = metaByIndex.get(leftIndex);

      const right = metaByIndex.get(rightIndex);

      const leftX = left ? (positions.get(left.fromId)?.x ?? 0) : 0;

      const rightX = right ? (positions.get(right.fromId)?.x ?? 0) : 0;

      return leftX - rightX || leftIndex - rightIndex;
    });
  }

  const routes = new Map<number, FlowEdgeGeometry>();

  /*
   * CONEXIONES ENTRE NIVELES ADYACENTES
   *
   * Cada línea recibe:
   * - puerto de salida independiente
   * - carril horizontal independiente
   * - puerto de entrada independiente
   */
  for (const [fromLevel, edgeIndices] of adjacentByGap) {
    const orderedEdges = [...edgeIndices].sort((leftIndex, rightIndex) => {
      const left = metaByIndex.get(leftIndex);

      const right = metaByIndex.get(rightIndex);

      if (!left || !right) {
        return leftIndex - rightIndex;
      }

      const leftFromX = positions.get(left.fromId)?.x ?? 0;

      const rightFromX = positions.get(right.fromId)?.x ?? 0;

      const leftToX = positions.get(left.toId)?.x ?? 0;

      const rightToX = positions.get(right.toId)?.x ?? 0;

      return (
        leftFromX - rightFromX || leftToX - rightToX || leftIndex - rightIndex
      );
    });

    const firstMeta =
      orderedEdges.length > 0
        ? metaByIndex.get(orderedEdges[0] ?? -1)
        : undefined;

    const toLevel = firstMeta?.toLevel ?? fromLevel + 1;

    const upperCenterY = levelY.get(fromLevel) ?? 0;

    const lowerCenterY = levelY.get(toLevel) ?? upperCenterY;

    const gapTop = upperCenterY + maxNodeHeight / 2;

    const gapBottom = lowerCenterY - maxNodeHeight / 2;

    const laneStart = gapTop + FLOW_EDGE_CLEARANCE;

    const laneEnd = gapBottom - FLOW_EDGE_CLEARANCE;

    orderedEdges.forEach((edgeIndex, laneIndex) => {
      const meta = metaByIndex.get(edgeIndex);

      if (!meta) {
        return;
      }

      const from = positions.get(meta.fromId);

      const to = positions.get(meta.toId);

      if (!from || !to) {
        return;
      }

      const outgoingEdges = outgoingAdjacent.get(meta.fromId) ?? [];

      const incomingEdges = incomingAdjacent.get(meta.toId) ?? [];

      const outgoingIndex = Math.max(0, outgoingEdges.indexOf(edgeIndex));

      const incomingIndex = Math.max(0, incomingEdges.indexOf(edgeIndex));

      const x1 =
        from.x +
        flowPortOffset(outgoingIndex, outgoingEdges.length, from.width);

      const y1 = from.y + from.height / 2;

      const x2 =
        to.x + flowPortOffset(incomingIndex, incomingEdges.length, to.width);

      const y2 = to.y - to.height / 2;

      const channelY =
        orderedEdges.length <= 1
          ? (laneStart + laneEnd) / 2
          : laneStart +
            (laneEnd - laneStart) *
              (laneIndex / Math.max(1, orderedEdges.length - 1));

      const nearlyVertical = Math.abs(x2 - x1) < 8;

      const rawLabelX = nearlyVertical ? x1 : (x1 + x2) / 2;

      const labelX = Math.max(94, Math.min(width - 94, rawLabelX));

      routes.set(edgeIndex, {
        path:
          `M ${x1} ${y1} ` +
          `L ${x1} ${channelY} ` +
          `L ${x2} ${channelY} ` +
          `L ${x2} ${y2}`,

        labelX,
        labelY: channelY,
        kind: "normal",
      });
    });
  }

  /*
   * RETORNOS Y SALTOS DE NIVEL
   *
   * Se enrutan por carriles laterales.
   * No atraviesan nodos ni comparten
   * la misma línea principal.
   */
  for (const meta of edgeMeta) {
    if (meta.kind === "normal") {
      continue;
    }

    const plan = specialPlan.get(meta.edgeIndex);

    const from = positions.get(meta.fromId);

    const to = positions.get(meta.toId);

    if (!plan || !from || !to) {
      continue;
    }

    const nodeAreaLeft = leftMargin;

    const nodeAreaRight = width - rightMargin;

    const railX =
      plan.side === "left"
        ? nodeAreaLeft - 34 - plan.lane * FLOW_SPECIAL_RAIL_GAP
        : nodeAreaRight + 34 + plan.lane * FLOW_SPECIAL_RAIL_GAP;

    const sourceX = from.x;

    const sourceY = from.y + from.height / 2;

    const localLaneOffset = Math.min(3, plan.lane) * 8;

    const sourceLaneY = sourceY + 18 + localLaneOffset;

    const targetX = to.x;

    const targetY = to.y - to.height / 2;

    const targetLaneY = targetY - 18 - localLaneOffset;

    const sourceSegmentLength = Math.abs(sourceX - railX);

    const targetSegmentLength = Math.abs(targetX - railX);

    const edgeRecord = edges[meta.edgeIndex];

    const rawEdgeLabel = displayText(stringValue(edgeRecord?.label)).trim();

    const visibleEdgeLabel =
      rawEdgeLabel.length > 30 ? `${rawEdgeLabel.slice(0, 29)}…` : rawEdgeLabel;

    const estimatedLabelWidth = Math.max(
      38,
      Math.min(176, visibleEdgeLabel.length * 6.3 + 20),
    );

    const requiredHorizontalSpace = estimatedLabelWidth + 28;

    let labelX: number;
    let labelY: number;

    if (sourceSegmentLength >= requiredHorizontalSpace) {
      labelX = (sourceX + railX) / 2;

      labelY = sourceLaneY;
    } else if (targetSegmentLength >= requiredHorizontalSpace) {
      labelX = (targetX + railX) / 2;

      labelY = targetLaneY;
    } else {
      labelX =
        plan.side === "left"
          ? railX + estimatedLabelWidth / 2 + 12
          : railX - estimatedLabelWidth / 2 - 12;

      labelY = sourceLaneY + (targetLaneY - sourceLaneY) / 2;
    }

    labelX = Math.max(
      estimatedLabelWidth / 2 + 10,
      Math.min(width - estimatedLabelWidth / 2 - 10, labelX),
    );

    routes.set(meta.edgeIndex, {
      path:
        `M ${sourceX} ${sourceY} ` +
        `L ${sourceX} ${sourceLaneY} ` +
        `L ${railX} ${sourceLaneY} ` +
        `L ${railX} ${targetLaneY} ` +
        `L ${targetX} ${targetLaneY} ` +
        `L ${targetX} ${targetY}`,

      labelX,
      labelY,
      kind: plan.kind,
    });

    height = Math.max(height, labelY + 28 + FLOW_PADDING_Y);
  }

  return {
    positions,
    routes,
    width,
    height,
  };
}
