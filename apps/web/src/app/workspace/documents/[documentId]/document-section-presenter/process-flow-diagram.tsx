"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  classifyProcessFlowEdgeVisualKind,
  layoutProcessFlow,
  type ProcessFlowInput,
  type ProcessFlowLayoutResult as CanonicalProcessFlowLayout,
  type DocumentJsonValue,
} from "@levantamiento-rq/shared-contracts";
import { useDragPan, useDiagramExpand } from "./diagram-hooks";
import {
  FLOW_KIND_LABELS,
  canonicalFlowLayoutToRenderer,
  FLOW_EDGE_VISUAL_STYLES,
  FLOW_EDGE_VISUAL_KINDS,
  flowTextLines,
  buildFlowLayout,
} from "./flow-layout";
import { EmptyValue } from "./primitives";
import { recordValue, recordList, stringValue, displayText } from "./shared";

export function ProcessFlowDiagram({ value }: { value: DocumentJsonValue }) {
  const flow = recordValue(value);

  const nodes = recordList(flow?.nodes);

  const edges = recordList(flow?.edges);

  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useDiagramExpand();
  const pan = useDragPan();

  const viewportRef = React.useRef<HTMLDivElement>(null);

  const markerId = React.useId().replaceAll(":", "");

  const flowSignature = JSON.stringify({
    title: stringValue(flow?.title),
    nodes: nodes.map((node) => ({
      id: stringValue(node.id),
      kind: stringValue(node.kind),
      label: stringValue(node.label),
    })),
    edges: edges.map((edge) => ({
      from: stringValue(edge.from),
      to: stringValue(edge.to),
      label: edge.label === null ? null : stringValue(edge.label),
    })),
  });

  const flowInput = useMemo(
    () => JSON.parse(flowSignature) as ProcessFlowInput,
    [flowSignature],
  );

  const [elkLayoutState, setElkLayoutState] = useState<{
    signature: string;
    layout: CanonicalProcessFlowLayout | null;
  }>({ signature: "", layout: null });

  useEffect(() => {
    if (flowInput.nodes.length === 0) return;
    let cancelled = false;
    void layoutProcessFlow(flowInput)
      .then((layout) => {
        if (cancelled) return;

        setElkLayoutState({ signature: flowSignature, layout });
        setZoom(1);
      })
      .catch((error: unknown) => {
        globalThis.console.warn(
          "[process-flow] ELK no pudo calcular el layout; se conserva el renderer anterior.",
          error instanceof Error ? error.message : "Error desconocido",
        );
        if (!cancelled) {
          setElkLayoutState({ signature: flowSignature, layout: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [flowInput, flowSignature]);

  if (!flow || nodes.length === 0) {
    return (
      <EmptyValue>No existe un flujo estructurado para representar.</EmptyValue>
    );
  }

  const fallbackLayout = buildFlowLayout(nodes, edges);

  const isElkLayout =
    elkLayoutState.signature === flowSignature &&
    elkLayoutState.layout !== null;

  const currentLayout =
    isElkLayout && elkLayoutState.layout
      ? canonicalFlowLayoutToRenderer(elkLayoutState.layout)
      : fallbackLayout;

  const { positions, routes, width, height } = currentLayout;

  // 100 % = ancho disponible; acercar amplía y el visor se desplaza.
  const fitDiagram = () => setZoom(1);

  const validNodeIds = new Set(
    nodes.map((node) => stringValue(node.id)).filter(Boolean),
  );

  return (
    <figure
      className="rq-process-flow"
      aria-label={displayText(stringValue(flow.title)) || "Diagrama de flujo"}
      data-expanded={expanded}
    >
      <figcaption>
        <div className="rq-process-flow__heading">
          <strong>
            {displayText(stringValue(flow.title)) || "Flujo del proceso"}
          </strong>

          <small>
            Construido desde IA
            {" · "}
            {nodes.length} pasos
            {" · "}
            {edges.length} conexiones
          </small>
        </div>

        <div
          aria-label="Zoom del diagrama"
          className="rq-process-flow__controls"
        >
          <button
            aria-label="Alejar"
            disabled={zoom <= 0.25}
            onClick={() =>
              setZoom((current) =>
                Math.max(0.25, Number((current - 0.1).toFixed(2))),
              )
            }
            type="button"
          >
            −
          </button>

          <output>{Math.round(zoom * 100)}%</output>

          <button
            aria-label="Acercar"
            disabled={zoom >= 2}
            onClick={() =>
              setZoom((current) =>
                Math.min(2, Number((current + 0.1).toFixed(2))),
              )
            }
            type="button"
          >
            +
          </button>

          <button onClick={fitDiagram} type="button">
            Ajustar
          </button>

          <button
            aria-pressed={expanded}
            onClick={() => setExpanded((current) => !current)}
            type="button"
          >
            {expanded ? "Cerrar" : "Ampliar"}
          </button>
        </div>
      </figcaption>

      <div
        className="rq-process-flow__viewport"
        data-layout-engine={isElkLayout ? "elk" : "fallback"}
        ref={viewportRef}
        {...pan}
      >
        <svg
          aria-label={
            displayText(stringValue(flow.title)) || "Flujo del proceso"
          }
          role="img"
          style={{
            aspectRatio: `${width} / ${height}`,
            width: `${Math.round(zoom * 100)}%`,
          }}
          viewBox={`0 0 ${width} ${height}`}
        >
          <defs>
            {FLOW_EDGE_VISUAL_KINDS.map((visualKind) => {
              const visualStyle = FLOW_EDGE_VISUAL_STYLES[visualKind];
              return (
                <marker
                  id={`${markerId}-${visualKind}`}
                  key={visualKind}
                  markerHeight="9"
                  markerUnits="userSpaceOnUse"
                  markerWidth="9"
                  orient="auto"
                  refX="8"
                  refY="4.5"
                  viewBox="0 0 12 12"
                >
                  <path
                    d="M 0 0 L 12 6 L 0 12 L 3 6 z"
                    style={{ fill: visualStyle.color }}
                  />
                </marker>
              );
            })}
          </defs>

          <g className="rq-process-flow__edges">
            {edges.map((edge, edgeIndex) => {
              const fromId = stringValue(edge.from);

              const toId = stringValue(edge.to);

              if (!validNodeIds.has(fromId) || !validNodeIds.has(toId)) {
                return null;
              }

              const geometry = routes.get(edgeIndex);

              if (!geometry) {
                return null;
              }

              const rawLabel = displayText(stringValue(edge.label)).trim();

              const visualKind =
                geometry.visualKind ??
                classifyProcessFlowEdgeVisualKind(
                  rawLabel || null,
                  geometry.kind,
                );

              const visualStyle = FLOW_EDGE_VISUAL_STYLES[visualKind];

              const label =
                rawLabel.length > 30 ? `${rawLabel.slice(0, 29)}…` : rawLabel;

              const labelWidth = Math.max(
                38,
                Math.min(176, label.length * 6.3 + 20),
              );

              const edgeClass =
                `rq-process-flow__edge ` +
                `rq-process-flow__edge--${geometry.kind} ` +
                `rq-process-flow__edge--${visualKind}`;

              return (
                <g className={edgeClass} key={`${fromId}-${toId}-${edgeIndex}`}>
                  <title>
                    {`${displayText(stringValue(nodes.find((node) => node.id === fromId)?.label)) || fromId} → ${displayText(stringValue(nodes.find((node) => node.id === toId)?.label)) || toId}${rawLabel ? `: ${rawLabel}` : ""}`}
                  </title>

                  <path
                    d={geometry.path}
                    markerEnd={`url(#${markerId}-${visualKind})`}
                    style={{
                      stroke: visualStyle.color,
                      strokeDasharray: visualStyle.dashArray,
                      strokeWidth: visualStyle.strokeWidth,
                    }}
                  />

                  {geometry.sourcePoint ? (
                    <circle
                      className="rq-process-flow__edge-origin"
                      cx={geometry.sourcePoint.x}
                      cy={geometry.sourcePoint.y}
                      r="3"
                      style={{
                        fill: "var(--rq-color-surface)",
                        stroke: visualStyle.color,
                        strokeWidth: 1.6,
                      }}
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null}

                  {label ? (
                    <g
                      className="rq-process-flow__edge-label"
                      transform={
                        `translate(` +
                        `${geometry.labelX} ` +
                        `${geometry.labelY})`
                      }
                    >
                      <rect
                        height="22"
                        rx="11"
                        width={labelWidth}
                        x={-labelWidth / 2}
                        y="-11"
                        style={{ stroke: visualStyle.color }}
                      />

                      <text
                        dominantBaseline="middle"
                        style={{ fill: visualStyle.color }}
                        textAnchor="middle"
                        y="1"
                      >
                        {label}
                      </text>

                      <title>{rawLabel}</title>
                    </g>
                  ) : null}
                </g>
              );
            })}
          </g>

          <g className="rq-process-flow__nodes">
            {nodes.map((node, index) => {
              const id = stringValue(node.id);

              const geometry = positions.get(id);

              if (!geometry) {
                return null;
              }

              const kind = stringValue(node.kind) || "PROCESS";

              const label =
                displayText(stringValue(node.label)) ||
                FLOW_KIND_LABELS[kind] ||
                "Paso";

              const lines = flowTextLines(
                label,
                kind === "DECISION" ? 27 : 29,
                isElkLayout ? 3 : 2,
              );

              const tag = FLOW_KIND_LABELS[kind] ?? "Proceso";
              // «Inicio / Inicio»: la etiqueta de tipo se omite si repite el texto.
              const showTag = label.trim().toLowerCase() !== tag.toLowerCase();

              const hasIncoming = edges.some(
                (edge) => stringValue(edge.to) === id,
              );

              const hasOutgoing = edges.some(
                (edge) => stringValue(edge.from) === id,
              );

              return (
                <g
                  className={
                    `rq-process-flow__node ` +
                    `rq-process-flow__node--${kind.toLowerCase()}`
                  }
                  key={id || index}
                  transform={`translate(` + `${geometry.x} ` + `${geometry.y})`}
                >
                  <rect
                    height={geometry.height}
                    rx={
                      kind === "START" || kind === "END"
                        ? geometry.height / 2
                        : 12
                    }
                    width={geometry.width}
                    x={-geometry.width / 2}
                    y={-geometry.height / 2}
                  />

                  <line
                    className="rq-process-flow__node-accent"
                    x1={-geometry.width / 2 + 15}
                    x2={geometry.width / 2 - 15}
                    y1={-geometry.height / 2 + 1}
                    y2={-geometry.height / 2 + 1}
                  />

                  {!isElkLayout && hasIncoming ? (
                    <circle
                      className="rq-process-flow__port rq-process-flow__port--in"
                      cx="0"
                      cy={-geometry.height / 2}
                      r="3"
                    />
                  ) : null}

                  {!isElkLayout && hasOutgoing ? (
                    <circle
                      className="rq-process-flow__port rq-process-flow__port--out"
                      cx="0"
                      cy={geometry.height / 2}
                      r="3"
                    />
                  ) : null}

                  {showTag ? (
                    <text
                      className="rq-process-flow__type"
                      textAnchor="middle"
                      x="0"
                      y="-9"
                    >
                      {tag}
                    </text>
                  ) : null}

                  <text
                    className="rq-process-flow__node-label"
                    textAnchor="middle"
                  >
                    {lines.map((line, lineIndex) => (
                      <tspan
                        key={lineIndex}
                        x="0"
                        y={
                          (showTag ? 8 : 4) -
                          (showTag ? 0 : (lines.length - 1) * 7) +
                          lineIndex * 14
                        }
                      >
                        {line}
                      </tspan>
                    ))}
                  </text>

                  <title>
                    {`${FLOW_KIND_LABELS[kind] ?? "Proceso"}: ${label}`}
                  </title>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </figure>
  );
}
