"use client";

import React, { useState } from "react";
import { type DocumentJsonValue } from "@levantamiento-rq/shared-contracts";
import { useDragPan, useDiagramExpand } from "./diagram-hooks";
import { FLOW_KIND_LABELS, flowTextLines } from "./flow-layout";
import { EmptyValue } from "./primitives";
import { recordValue, recordList, stringValue, displayText } from "./shared";
import {
  swimlaneEdgeLabel,
  swimlaneLayout,
  swimlaneRoute,
  swimlaneLabelPosition,
} from "./swimlane-layout";

export function SwimlaneProcessFlowDiagram({
  value,
}: {
  value: DocumentJsonValue;
}) {
  const flow = recordValue(value);
  const lanes = recordList(flow?.lanes);
  const nodes = recordList(flow?.nodes);
  const edges = recordList(flow?.edges);
  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useDiagramExpand();
  const pan = useDragPan();
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const markerId = React.useId().replaceAll(":", "");

  if (!flow || lanes.length === 0 || nodes.length === 0) {
    return (
      <EmptyValue>No existe un flujo estructurado para representar.</EmptyValue>
    );
  }

  const minimumReadableZoom = 0.6;
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
  const laneIndexById = new Map(
    lanes.map((lane, index) => [stringValue(lane.id), index]),
  );
  const { boxes, width: laidOutWidth } = swimlaneLayout(
    nodes,
    edges,
    laneIndexById,
    metrics,
  );
  const width = Math.max(640, laidOutWidth);
  const height = Math.max(240, lanes.length * metrics.laneHeight);
  // 100 % = ancho disponible; acercar amplía y el visor se desplaza.
  const fit = () => setZoom(1);

  return (
    <figure
      className="rq-process-flow rq-swimlane-flow"
      data-expanded={expanded}
    >
      <figcaption>
        <div className="rq-process-flow__heading">
          <strong>
            {displayText(stringValue(flow.title)) || "Flujo del proceso"}
          </strong>
          <small>
            {lanes.length} carriles · {nodes.length} pasos · {edges.length}{" "}
            conexiones
          </small>
        </div>
        <div
          aria-label="Zoom del diagrama"
          className="rq-process-flow__controls"
        >
          <button
            aria-label="Alejar"
            disabled={zoom <= minimumReadableZoom}
            onClick={() =>
              setZoom((current) =>
                Math.max(
                  minimumReadableZoom,
                  Number((current - 0.1).toFixed(2)),
                ),
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
          <button onClick={fit} type="button">
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
      {stringValue(flow.objective) ? (
        <p className="rq-swimlane-flow__objective">
          <strong>Objetivo:</strong> {displayText(stringValue(flow.objective))}
        </p>
      ) : null}
      <div
        className="rq-process-flow__viewport rq-swimlane-flow__viewport"
        ref={viewportRef}
        {...pan}
      >
        <svg
          aria-label={
            displayText(stringValue(flow.title)) || "Flujo por carriles"
          }
          role="img"
          style={{
            aspectRatio: `${width} / ${height}`,
            width: `${Math.round(zoom * 100)}%`,
          }}
          viewBox={`0 0 ${width} ${height}`}
        >
          <defs>
            <marker
              id={`${markerId}-arrow`}
              markerHeight="9"
              markerUnits="userSpaceOnUse"
              markerWidth="9"
              orient="auto"
              refX="8"
              refY="4.5"
              viewBox="0 0 12 12"
            >
              <path d="M 0 0 L 12 6 L 0 12 L 3 6 z" />
            </marker>
          </defs>
          <g className="rq-swimlane-flow__lanes">
            {lanes.map((lane, index) => {
              const laneName =
                displayText(stringValue(lane.name)) || `Carril ${index + 1}`;
              const laneNameLines = flowTextLines(laneName, 16, 3);
              const laneCenter =
                index * metrics.laneHeight + metrics.laneHeight / 2;
              const laneNameStart =
                laneCenter - (laneNameLines.length - 1) * 8 - 6;

              return (
                <g key={stringValue(lane.id) || index}>
                  <rect
                    height={metrics.laneHeight}
                    width={width}
                    x="0"
                    y={index * metrics.laneHeight}
                  />
                  <rect
                    className="rq-swimlane-flow__lane-label"
                    height={metrics.laneHeight}
                    width={metrics.labelWidth}
                    x="0"
                    y={index * metrics.laneHeight}
                  />
                  <rect
                    className="rq-swimlane-flow__lane-accent"
                    height={metrics.laneHeight}
                    width="6"
                    x="0"
                    y={index * metrics.laneHeight}
                  />
                  <text
                    textAnchor="middle"
                    x={(metrics.labelWidth + 6) / 2}
                    y={laneNameStart}
                  >
                    {laneNameLines.map((line, lineIndex) => (
                      <tspan
                        key={`${line}-${lineIndex}`}
                        x={(metrics.labelWidth + 6) / 2}
                        y={laneNameStart + lineIndex * 16}
                      >
                        {line}
                      </tspan>
                    ))}
                  </text>
                  <text
                    className="rq-swimlane-flow__lane-kind"
                    textAnchor="middle"
                    x={(metrics.labelWidth + 6) / 2}
                    y={laneNameStart + laneNameLines.length * 16 + 4}
                  >
                    {stringValue(lane.kind) === "SYSTEM" ? "Sistema" : "Actor"}
                  </text>
                </g>
              );
            })}
          </g>
          <g className="rq-swimlane-flow__edges">
            {edges.map((edge, index) => {
              const from = boxes.get(stringValue(edge.from));
              const to = boxes.get(stringValue(edge.to));
              if (!from || !to) return null;
              const route = swimlaneRoute(from, to);
              const label = displayText(stringValue(edge.label));
              const pill = swimlaneEdgeLabel(label);
              const position = label
                ? swimlaneLabelPosition(route.points, pill.width, [
                    ...boxes.values(),
                  ])
                : null;
              return (
                <g
                  key={`${stringValue(edge.from)}-${stringValue(edge.to)}-${index}`}
                >
                  <path d={route.path} markerEnd={`url(#${markerId}-arrow)`} />
                  {position ? (
                    <g
                      className="rq-swimlane-flow__edge-label"
                      transform={`translate(${position.x} ${position.y})`}
                    >
                      <rect
                        height="22"
                        rx="11"
                        width={pill.width}
                        x={-pill.width / 2}
                        y="-11"
                      />
                      <text dominantBaseline="middle" textAnchor="middle">
                        {pill.text}
                      </text>
                    </g>
                  ) : null}
                </g>
              );
            })}
          </g>
          <g className="rq-process-flow__nodes rq-swimlane-flow__nodes">
            {nodes.map((node, index) => {
              const geometry = boxes.get(stringValue(node.id));
              if (!geometry) return null;
              const kind = stringValue(node.kind) || "PROCESS";
              const label = displayText(stringValue(node.label)) || "Paso";
              const tag = FLOW_KIND_LABELS[kind] ?? "Proceso";
              // «Inicio / Inicio»: la etiqueta de tipo se omite si repite el texto.
              const showTag = label.trim().toLowerCase() !== tag.toLowerCase();
              const lines = flowTextLines(
                label,
                kind === "DECISION" ? 17 : 22,
                kind === "DECISION" ? 2 : 3,
              );
              const labelStartY = (showTag ? 9 : 4) - (lines.length - 1) * 8;
              return (
                <g
                  className={`rq-process-flow__node rq-process-flow__node--${kind.toLowerCase()}`}
                  key={stringValue(node.id) || index}
                  transform={`translate(${geometry.x} ${geometry.y})`}
                >
                  {kind === "DECISION" ? (
                    <polygon
                      points={`0,${-geometry.height / 2} ${geometry.width / 2},0 0,${geometry.height / 2} ${-geometry.width / 2},0`}
                    />
                  ) : (
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
                  )}
                  {showTag ? (
                    <text
                      className="rq-process-flow__type"
                      textAnchor="middle"
                      y={-geometry.height / 2 + (kind === "DECISION" ? 22 : 18)}
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
                        y={labelStartY + lineIndex * 16}
                      >
                        {line}
                      </tspan>
                    ))}
                  </text>
                  <title>{`${tag}: ${label}`}</title>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </figure>
  );
}
