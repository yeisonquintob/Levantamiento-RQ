import assert from "node:assert/strict";
import test from "node:test";

import {
  cardinalityMark,
  entityRelationshipLayout,
  entityRelationshipRoute,
  entityRelationshipSides,
  parseCardinality,
} from "../../apps/web/src/app/workspace/documents/[documentId]/document-section-presenter";

const attribute = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  dataType: "string",
  ...extra,
});
const entity = (id: string, attributes: number) => ({
  id,
  name: id,
  attributes: Array.from({ length: attributes }, (_, index) =>
    attribute(`campo_${index}`, index === 0 ? { primaryKey: true } : {}),
  ),
});

// Seis entidades; «solicitud» tiene 9 atributos (antes superaba el alto fijo de fila y se solapaba).
const entities = [
  entity("solicitud", 9),
  entity("vehiculo", 4),
  entity("cliente", 3),
  entity("pago", 5),
  entity("area", 2),
  entity("notificacion", 3),
];
const relationships = [
  { from: "solicitud", to: "vehiculo", label: "Consulta", cardinality: "1:N" },
  { from: "solicitud", to: "cliente", label: "Pertenece", cardinality: "N:1" },
  { from: "solicitud", to: "pago", label: "Genera", cardinality: "1:N" },
  { from: "pago", to: "area", label: "Revisa", cardinality: "N:1" },
  { from: "area", to: "notificacion", label: "Envía", cardinality: "0..1:N" },
  { from: "notificacion", to: "solicitud", label: "Sobre", cardinality: "N:1" },
  { from: "cliente", to: "cliente", label: "Referido por", cardinality: "0..1:N" },
];

test("las entidades nunca se solapan, incluso con una muy alta", () => {
  const { boxes } = entityRelationshipLayout(entities, relationships);
  const list = [...boxes.entries()];
  assert.equal(list.length, entities.length);
  for (const [idA, a] of list) {
    for (const [idB, b] of list) {
      if (idA >= idB) continue;
      const overlap =
        a.x < b.x + b.width &&
        b.x < a.x + a.width &&
        a.y < b.y + b.height &&
        b.y < a.y + a.height;
      assert.ok(!overlap, `${idA} se solapa con ${idB}`);
    }
  }
});

test("las entidades relacionadas quedan contiguas: la más conectada abre la cuadrícula", () => {
  const { boxes } = entityRelationshipLayout(entities, relationships);
  const first = boxes.get("solicitud")!;
  assert.deepEqual([first.col, first.row], [0, 0]);
  const near = ["vehiculo", "cliente", "pago", "notificacion"].map((id) => boxes.get(id)!);
  for (const box of near) {
    assert.ok(Math.abs(box.col - first.col) + Math.abs(box.row - first.row) <= 3);
  }
});

function segmentCrossesBox(
  [ax, ay]: readonly [number, number],
  [bx, by]: readonly [number, number],
  box: { x: number; y: number; width: number; height: number },
): boolean {
  const left = box.x + 1;
  const right = box.x + box.width - 1;
  const top = box.y + 1;
  const bottom = box.y + box.height - 1;
  if (ax === bx) {
    return ax > left && ax < right && Math.max(ay, by) > top && Math.min(ay, by) < bottom;
  }
  return ay > top && ay < bottom && Math.max(ax, bx) > left && Math.min(ax, bx) < right;
}

test("ningún conector atraviesa una entidad ajena", () => {
  const layout = entityRelationshipLayout(entities, relationships);
  for (const relationship of relationships) {
    if (relationship.from === relationship.to) continue;
    const from = layout.boxes.get(relationship.from)!;
    const to = layout.boxes.get(relationship.to)!;
    const points = entityRelationshipRoute(from, to, layout);
    for (let index = 1; index < points.length; index += 1) {
      for (const [id, box] of layout.boxes) {
        if (box === from || box === to) continue;
        assert.ok(
          !segmentCrossesBox(points[index - 1]!, points[index]!, box),
          `${relationship.from} → ${relationship.to} cruza ${id}`,
        );
      }
    }
  }
});

test("una relación de una entidad consigo misma dibuja un bucle visible", () => {
  const layout = entityRelationshipLayout(entities, relationships);
  const box = layout.boxes.get("cliente")!;
  assert.deepEqual(entityRelationshipSides(box, box), { from: "right", to: "right" });
  const points = entityRelationshipRoute(box, box, layout, -16, 16);
  assert.ok(points.length >= 3);
  assert.notDeepEqual(points[0], points[points.length - 1]);
});

test("los lados de salida y entrada dependen de la posición relativa", () => {
  const layout = entityRelationshipLayout(entities, relationships);
  const boxes = [...layout.boxes.values()];
  const a = boxes.find((box) => box.col === 0 && box.row === 0)!;
  const right = boxes.find((box) => box.col === 1 && box.row === 0);
  if (right) assert.deepEqual(entityRelationshipSides(a, right), { from: "right", to: "left" });
  const below = boxes.find((box) => box.col === 0 && box.row === 1);
  if (below) assert.deepEqual(entityRelationshipSides(a, below), { from: "bottom", to: "top" });
});

test("la cardinalidad se interpreta y produce marcas válidas en pata de gallo", () => {
  assert.deepEqual(parseCardinality("1"), { many: false, optional: false });
  assert.deepEqual(parseCardinality("N"), { many: true, optional: false });
  assert.deepEqual(parseCardinality("*"), { many: true, optional: false });
  assert.deepEqual(parseCardinality("0..1"), { many: false, optional: true });
  assert.deepEqual(parseCardinality("0..N"), { many: true, optional: true });

  for (const token of ["1", "N", "0..1", "0..N", ""]) {
    const mark = cardinalityMark([100, 50], [160, 50], token);
    assert.ok(mark.path.length > 0);
    assert.doesNotMatch(mark.path, /NaN/);
  }
  assert.equal(cardinalityMark([0, 0], [10, 0], "0..N").circle !== null, true);
  assert.equal(cardinalityMark([0, 0], [10, 0], "N").circle, null);
  // «Muchos» abre tres ramas hacia la entidad; «uno» obligatorio, dos marcas.
  assert.equal((cardinalityMark([0, 0], [10, 0], "N").path.match(/M /g) ?? []).length, 4);
  assert.equal((cardinalityMark([0, 0], [10, 0], "1").path.match(/M /g) ?? []).length, 2);
});
