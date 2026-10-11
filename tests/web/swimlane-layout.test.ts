import assert from "node:assert/strict";
import test from "node:test";

import {
  swimlaneLayout,
  swimlaneEdgeLabel,
  swimlaneLabelPosition,
  swimlaneRoute,
} from "../../apps/web/src/app/workspace/documents/[documentId]/document-section-presenter";

const metrics = {
  laneHeight: 116,
  labelWidth: 150,
  padding: 28,
  nodeWidth: 172,
  nodeHeight: 76,
  decisionHeight: 88,
  sameLaneGap: 46,
  crossLaneRun: 34,
};

// Flujo «Flujo actual de solicitudes SOAT»: 5 carriles, 8 pasos y 7 conexiones.
const lanes = ["solicitante", "centralizador", "d365", "lockton", "financieras"];
const laneIndex = new Map(lanes.map((id, index) => [id, index]));
const nodes = [
  { id: "inicio", laneId: "solicitante", kind: "START" },
  { id: "envia", laneId: "solicitante", kind: "ACTOR" },
  { id: "recibe", laneId: "centralizador", kind: "ACTOR" },
  { id: "consulta", laneId: "d365", kind: "SYSTEM" },
  { id: "valida", laneId: "centralizador", kind: "DECISION" },
  { id: "registra", laneId: "lockton", kind: "SYSTEM" },
  { id: "notifica", laneId: "financieras", kind: "ACTOR" },
  { id: "fin", laneId: "solicitante", kind: "END" },
];
const edges = [
  { from: "inicio", to: "envia" },
  { from: "envia", to: "recibe" },
  { from: "recibe", to: "consulta" },
  { from: "consulta", to: "valida", label: "Información completa" },
  { from: "valida", to: "registra" },
  { from: "registra", to: "notifica" },
  { from: "notifica", to: "fin" },
];

test("la disposición compacta reduce el ancho frente al paso fijo anterior", () => {
  const { boxes, width } = swimlaneLayout(nodes, edges, laneIndex, metrics);
  const height = lanes.length * metrics.laneHeight;

  // Antes: 190 + 60 + 184 + 7 × 224 ≈ 2000 px de ancho (relación ~3,6 : 1).
  assert.ok(width < 1500, `ancho ${width}`);
  assert.ok(width / height < 3, `relación ${width / height}`);
  assert.equal(boxes.size, nodes.length);
});

test("los pasos de un mismo carril nunca se solapan y respetan el espacio de la flecha", () => {
  const { boxes } = swimlaneLayout(nodes, edges, laneIndex, metrics);
  for (const [idA, a] of boxes) {
    for (const [idB, b] of boxes) {
      if (idA >= idB || a.lane !== b.lane) continue;
      const gap = Math.abs(a.x - b.x) - metrics.nodeWidth;
      assert.ok(gap >= metrics.sameLaneGap, `${idA} y ${idB}: separación ${gap}`);
    }
  }
});

test("cada conexión avanza hacia la derecha y entra por el lado izquierdo del destino", () => {
  const { boxes } = swimlaneLayout(nodes, edges, laneIndex, metrics);
  for (const edge of edges) {
    const from = boxes.get(edge.from)!;
    const to = boxes.get(edge.to)!;
    assert.ok(to.x > from.x, `${edge.from} → ${edge.to} debe ir a la derecha`);
    const route = swimlaneRoute(from, to);
    // El último punto es el borde izquierdo del destino.
    assert.ok(
      route.path.endsWith(`L ${to.x - to.width / 2} ${to.y}`),
      `${edge.from} → ${edge.to}: ${route.path}`,
    );
    assert.match(route.path, /^M [\d.]+ [\d.]+( L [\d.]+ [\d.]+){1,2}$/);
  }
});

test("un retorno hacia atrás rodea por la derecha y entra por el lado derecho", () => {
  const { boxes } = swimlaneLayout(nodes, edges, laneIndex, metrics);
  const from = boxes.get("notifica")!;
  const to = boxes.get("envia")!;
  const route = swimlaneRoute(from, to);
  assert.ok(route.path.endsWith(`L ${to.x + to.width / 2} ${to.y}`));
  // El tramo de vuelta queda fuera de ambos pasos, a la derecha.
  assert.ok((route.points[1]?.[0] ?? 0) > from.x + from.width / 2);
});

test("la etiqueta del conector no cae sobre ningún paso", () => {
  const { boxes } = swimlaneLayout(nodes, edges, laneIndex, metrics);
  const all = [...boxes.values()];
  for (const edge of edges.filter((item) => "label" in item)) {
    const pill = swimlaneEdgeLabel(edge.label as string);
    const route = swimlaneRoute(boxes.get(edge.from)!, boxes.get(edge.to)!);
    const label = swimlaneLabelPosition(route.points, pill.width, all);
    for (const box of all) {
      const overlapsX =
        label.x + pill.width / 2 > box.x - box.width / 2 &&
        label.x - pill.width / 2 < box.x + box.width / 2;
      const overlapsY =
        label.y + 11 > box.y - box.height / 2 &&
        label.y - 11 < box.y + box.height / 2;
      assert.ok(!(overlapsX && overlapsY), "la etiqueta no debe tapar un paso");
    }
  }
});

test("una etiqueta entre pasos del mismo carril ensancha el hueco para caber en la línea", () => {
  const sameLane = [
    { id: "a", laneId: "solicitante", kind: "ACTOR" },
    { id: "b", laneId: "solicitante", kind: "ACTOR" },
  ];
  const plain = swimlaneLayout(
    sameLane,
    [{ from: "a", to: "b" }],
    laneIndex,
    metrics,
  );
  const labeled = swimlaneLayout(
    sameLane,
    [{ from: "a", to: "b", label: "Información completa" }],
    laneIndex,
    metrics,
  );
  assert.ok(labeled.width > plain.width);
  const a = labeled.boxes.get("a")!;
  const b = labeled.boxes.get("b")!;
  const pill = swimlaneEdgeLabel("Información completa");
  const route = swimlaneRoute(a, b);
  const position = swimlaneLabelPosition(route.points, pill.width, [a, b]);
  assert.equal(position.y, a.y);
});
