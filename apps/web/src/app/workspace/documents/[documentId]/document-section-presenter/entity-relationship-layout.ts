import { type JsonRecord, recordList, stringValue } from "./shared";

type ErSide = "left" | "right" | "top" | "bottom";

export interface EntityBox {
  x: number;
  y: number;
  width: number;
  height: number;
  col: number;
  row: number;
}

export interface EntityRelationshipLayout {
  boxes: Map<string, EntityBox>;
  width: number;
  height: number;
  gapX: number;
  gapY: number;
  rowTops: readonly number[];
  rowHeights: readonly number[];
}

export const ER_HEADER_HEIGHT = 46;

export const ER_ROW_HEIGHT = 27;

const ER_FOOTER = 12;

/** Altura real de una entidad: encabezado, una fila por atributo y un pie. */
function entityHeight(entity: JsonRecord): number {
  return (
    ER_HEADER_HEIGHT +
    Math.max(1, recordList(entity.attributes).length) * ER_ROW_HEIGHT +
    ER_FOOTER
  );
}

/**
 * Disposición en cuadrícula: las entidades relacionadas quedan contiguas (se ordenan desde la
 * más conectada recorriendo sus vecinas) y cada fila toma la altura de su entidad más alta,
 * de modo que nunca se solapan.
 */
export function entityRelationshipLayout(
  entities: JsonRecord[],
  relationships: JsonRecord[],
): EntityRelationshipLayout {
  const ids = entities.map((entity) => stringValue(entity.id));
  const neighbours = new Map<string, Set<string>>(
    ids.map((id) => [id, new Set()]),
  );
  for (const relationship of relationships) {
    const from = stringValue(relationship.from);
    const to = stringValue(relationship.to);
    if (from === to || !neighbours.has(from) || !neighbours.has(to)) continue;
    neighbours.get(from)?.add(to);
    neighbours.get(to)?.add(from);
  }
  const degree = (id: string) => neighbours.get(id)?.size ?? 0;
  const order: string[] = [];
  const seen = new Set<string>();
  const queue: string[] = [];
  const byDegree = [...ids].sort(
    (left, right) =>
      degree(right) - degree(left) || ids.indexOf(left) - ids.indexOf(right),
  );
  for (const start of byDegree) {
    if (seen.has(start)) continue;
    seen.add(start);
    queue.push(start);
    while (queue.length > 0) {
      const id = queue.shift() as string;
      order.push(id);
      const next = [...(neighbours.get(id) ?? [])]
        .filter((neighbour) => !seen.has(neighbour))
        .sort((left, right) => degree(right) - degree(left));
      for (const neighbour of next) {
        seen.add(neighbour);
        queue.push(neighbour);
      }
    }
  }

  const count = entities.length;
  const columns =
    count <= 3 ? Math.max(1, count) : count === 4 ? 2 : count <= 9 ? 3 : 4;
  const widest = entities.reduce((largest, entity) => {
    const attributes = recordList(entity.attributes);
    const row = attributes.reduce(
      (value, attribute) =>
        Math.max(
          value,
          stringValue(attribute.name).length * 7.4 +
            stringValue(attribute.dataType).length * 6.8,
        ),
      0,
    );
    return Math.max(
      largest,
      row + 104,
      stringValue(entity.name).length * 8.6 + 40,
    );
  }, 0);
  const boxWidth = Math.round(Math.min(340, Math.max(250, widest)));
  const gapX = 120;
  const gapY = 84;
  const padding = 52;
  const entityById = new Map(
    entities.map((entity) => [stringValue(entity.id), entity]),
  );
  const rows = Math.ceil(count / columns);
  const rowHeights = Array.from({ length: rows }, (_, row) =>
    order
      .slice(row * columns, row * columns + columns)
      .reduce(
        (height, id) =>
          Math.max(height, entityHeight(entityById.get(id) as JsonRecord)),
        0,
      ),
  );
  const rowTops: number[] = [];
  rowHeights.reduce((top, height) => {
    rowTops.push(top);
    return top + height + gapY;
  }, padding);

  const boxes = new Map<string, EntityBox>();
  order.forEach((id, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    boxes.set(id, {
      x: padding + col * (boxWidth + gapX),
      y: rowTops[row] as number,
      width: boxWidth,
      height: entityHeight(entityById.get(id) as JsonRecord),
      col,
      row,
    });
  });

  return {
    boxes,
    width: Math.max(
      640,
      padding * 2 + columns * boxWidth + (columns - 1) * gapX,
    ),
    height:
      padding * 2 +
      rowHeights.reduce((sum, height) => sum + height, 0) +
      Math.max(0, rows - 1) * gapY,
    gapX,
    gapY,
    rowTops,
    rowHeights,
  };
}

/** Lados por los que sale y entra una relación, según la posición de ambas entidades. */
export function entityRelationshipSides(
  from: EntityBox,
  to: EntityBox,
): { from: ErSide; to: ErSide } {
  const dc = to.col - from.col;
  const dr = to.row - from.row;
  if (dc === 0) {
    if (dr === 0 || Math.abs(dr) > 1) return { from: "right", to: "right" };
    return dr > 0
      ? { from: "bottom", to: "top" }
      : { from: "top", to: "bottom" };
  }
  if (dr === 0 && Math.abs(dc) > 1) return { from: "bottom", to: "bottom" };
  return dc > 0 ? { from: "right", to: "left" } : { from: "left", to: "right" };
}

function entityAnchor(
  box: EntityBox,
  side: ErSide,
  offset: number,
): readonly [number, number] {
  const limit = (size: number) => Math.max(0, size / 2 - 18);
  const clamp = (value: number, size: number) =>
    Math.max(-limit(size), Math.min(limit(size), value));
  if (side === "left")
    return [box.x, box.y + box.height / 2 + clamp(offset, box.height)];
  if (side === "right")
    return [
      box.x + box.width,
      box.y + box.height / 2 + clamp(offset, box.height),
    ];
  if (side === "top")
    return [box.x + box.width / 2 + clamp(offset, box.width), box.y];
  return [box.x + box.width / 2 + clamp(offset, box.width), box.y + box.height];
}

/**
 * Conector ortogonal que viaja por los pasillos entre filas y columnas, así nunca atraviesa
 * otra entidad. `fromOffset` y `toOffset` reparten varias relaciones en un mismo lado.
 */
export function entityRelationshipRoute(
  from: EntityBox,
  to: EntityBox,
  layout: Pick<
    EntityRelationshipLayout,
    "gapX" | "gapY" | "rowTops" | "rowHeights"
  >,
  fromOffset = 0,
  toOffset = 0,
): readonly (readonly [number, number])[] {
  const sides = entityRelationshipSides(from, to);
  const a = entityAnchor(from, sides.from, fromOffset);
  const b = entityAnchor(to, sides.to, toOffset);
  const rowBottom = (row: number) =>
    (layout.rowTops[row] as number) + (layout.rowHeights[row] as number);
  const dc = to.col - from.col;
  const dr = to.row - from.row;
  const points: [number, number][] = [[a[0], a[1]]];

  if (sides.from === "right" && sides.to === "right") {
    const x = Math.max(a[0], b[0]) + layout.gapX / 2;
    points.push([x, a[1]], [x, b[1]]);
  } else if (sides.from === "bottom" && sides.to === "bottom") {
    const y = rowBottom(from.row) + layout.gapY / 2;
    points.push([a[0], y], [b[0], y]);
  } else if (sides.from === "bottom") {
    const y = rowBottom(from.row) + layout.gapY / 2;
    points.push([a[0], y], [b[0], y]);
  } else if (sides.from === "top") {
    const y = (layout.rowTops[from.row] as number) - layout.gapY / 2;
    points.push([a[0], y], [b[0], y]);
  } else {
    const direction = dc > 0 ? 1 : -1;
    const x0 = a[0] + (direction * layout.gapX) / 2;
    const x1 = b[0] - (direction * layout.gapX) / 2;
    if (Math.abs(dc) === 1) {
      points.push([x0, a[1]], [x0, b[1]]);
    } else {
      const y =
        dr > 0
          ? rowBottom(from.row) + layout.gapY / 2
          : dr < 0
            ? (layout.rowTops[from.row] as number) - layout.gapY / 2
            : rowBottom(from.row) + layout.gapY / 2;
      points.push([x0, a[1]], [x0, y], [x1, y], [x1, b[1]]);
    }
  }
  points.push([b[0], b[1]]);

  // Quita puntos repetidos o alineados para que el trazo sea limpio.
  const clean: [number, number][] = [];
  for (const point of points) {
    const last = clean[clean.length - 1];
    if (last && last[0] === point[0] && last[1] === point[1]) continue;
    const before = clean[clean.length - 2];
    if (
      last &&
      before &&
      ((before[0] === last[0] && last[0] === point[0]) ||
        (before[1] === last[1] && last[1] === point[1]))
    ) {
      clean[clean.length - 1] = point;
      continue;
    }
    clean.push(point);
  }
  return clean;
}

/** Interpreta un lado de la cardinalidad: «1», «N», «0..1», «0..N», «*»… */
export function parseCardinality(token: string): {
  many: boolean;
  optional: boolean;
} {
  const value = token.trim().toLowerCase();
  return {
    many: /[nm*]|many|muchos/u.test(value),
    optional: /^0/u.test(value),
  };
}

/**
 * Marca de cardinalidad en notación pata de gallo, en el extremo `end` del conector.
 * `toward` es el punto siguiente del conector (para orientar la marca).
 */
export function cardinalityMark(
  end: readonly [number, number],
  toward: readonly [number, number],
  token: string,
): { path: string; circle: { cx: number; cy: number } | null } {
  const { many, optional } = parseCardinality(token);
  const length = Math.hypot(toward[0] - end[0], toward[1] - end[1]) || 1;
  // Vector unitario desde la entidad hacia el conector.
  const ux = (toward[0] - end[0]) / length;
  const uy = (toward[1] - end[1]) / length;
  const nx = -uy;
  const ny = ux;
  const at = (distance: number, side = 0) =>
    `${(end[0] + ux * distance + nx * side).toFixed(2)} ${(end[1] + uy * distance + ny * side).toFixed(2)}`;
  const parts: string[] = [];
  let circleDistance = 0;
  if (many) {
    parts.push(
      `M ${at(14, 0)} L ${at(0, 8)}`,
      `M ${at(14, 0)} L ${at(0, -8)}`,
      `M ${at(14, 0)} L ${at(0, 0)}`,
    );
    circleDistance = 22;
    if (!optional) parts.push(`M ${at(19, 7)} L ${at(19, -7)}`);
  } else {
    parts.push(`M ${at(13, 7)} L ${at(13, -7)}`);
    circleDistance = 21;
    if (!optional) parts.push(`M ${at(19, 7)} L ${at(19, -7)}`);
  }
  const circle = optional
    ? {
        cx: Number((end[0] + ux * circleDistance).toFixed(2)),
        cy: Number((end[1] + uy * circleDistance).toFixed(2)),
      }
    : null;
  return { path: parts.join(" "), circle };
}
