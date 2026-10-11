"use client";

import React, { useState } from "react";
import { type DocumentJsonValue } from "@levantamiento-rq/shared-contracts";
import { useDragPan, useDiagramExpand } from "./diagram-hooks";
import {
  ER_HEADER_HEIGHT,
  ER_ROW_HEIGHT,
  entityRelationshipLayout,
  entityRelationshipSides,
  entityRelationshipRoute,
  cardinalityMark,
} from "./entity-relationship-layout";
import { EmptyValue } from "./primitives";
import { recordValue, recordList, stringValue, displayText } from "./shared";
import { swimlaneEdgeLabel, swimlaneLabelPosition } from "./swimlane-layout";

export function EntityRelationshipDiagram({
  value,
}: {
  value: DocumentJsonValue;
}) {
  const model = recordValue(value);
  const entities = recordList(model?.entities);
  const relationships = recordList(model?.relationships);
  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useDiagramExpand();
  const pan = useDragPan();
  const viewportRef = React.useRef<HTMLDivElement>(null);
  if (!model || entities.length === 0) {
    return (
      <EmptyValue>
        No existe un modelo entidad-relación para representar.
      </EmptyValue>
    );
  }
  const layout = entityRelationshipLayout(entities, relationships);
  const { boxes, width, height } = layout;
  const boxList = [...boxes.values()];
  // 100 % = ancho disponible; acercar amplía y el visor se desplaza.
  const fit = () => setZoom(1);

  // Reparte las relaciones que comparten un mismo lado de una entidad.
  const resolved = relationships.flatMap((relationship, index) => {
    const from = boxes.get(stringValue(relationship.from));
    const to = boxes.get(stringValue(relationship.to));
    if (!from || !to) return [];
    const sides = entityRelationshipSides(from, to);
    return [
      {
        relationship,
        index,
        from,
        to,
        sides,
        fromKey: `${stringValue(relationship.from)}|${sides.from}`,
        toKey: `${stringValue(relationship.to)}|${sides.to}`,
      },
    ];
  });
  const usage = new Map<string, number[]>();
  for (const item of resolved) {
    for (const key of [item.fromKey, item.toKey]) {
      usage.set(key, [...(usage.get(key) ?? []), item.index]);
    }
  }
  const offsetFor = (key: string, index: number) => {
    const list = usage.get(key) ?? [];
    return (list.indexOf(index) - (list.length - 1) / 2) * 20;
  };

  return (
    <figure
      className="rq-process-flow rq-entity-relationship"
      data-expanded={expanded}
    >
      <figcaption>
        <div className="rq-process-flow__heading">
          <strong>
            {displayText(stringValue(model.title)) || "Modelo entidad-relación"}
          </strong>
          <small>
            {entities.length} entidades · {relationships.length} relaciones
          </small>
        </div>
        <div aria-label="Zoom del modelo" className="rq-process-flow__controls">
          <button
            aria-label="Alejar"
            disabled={zoom <= 0.35}
            onClick={() =>
              setZoom((current) =>
                Math.max(0.35, Number((current - 0.1).toFixed(2))),
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
      <div
        className="rq-process-flow__viewport rq-entity-relationship__viewport"
        ref={viewportRef}
        {...pan}
      >
        <svg
          aria-label={
            displayText(stringValue(model.title)) || "Modelo entidad-relación"
          }
          role="img"
          style={{
            aspectRatio: `${width} / ${height}`,
            width: `${Math.round(zoom * 100)}%`,
          }}
          viewBox={`0 0 ${width} ${height}`}
        >
          <g className="rq-er__relations">
            {resolved.map((item) => {
              const points = entityRelationshipRoute(
                item.from,
                item.to,
                layout,
                item.from === item.to
                  ? -16
                  : offsetFor(item.fromKey, item.index),
                item.from === item.to ? 16 : offsetFor(item.toKey, item.index),
              );
              const [leftToken = "", rightToken = ""] = stringValue(
                item.relationship.cardinality,
              ).split(":");
              const first = points[0] as readonly [number, number];
              const second = points[1] as readonly [number, number];
              const last = points[points.length - 1] as readonly [
                number,
                number,
              ];
              const beforeLast = points[points.length - 2] as readonly [
                number,
                number,
              ];
              const marks = [
                cardinalityMark(first, second, leftToken),
                cardinalityMark(last, beforeLast, rightToken),
              ];
              const label = displayText(stringValue(item.relationship.label));
              const pill = swimlaneEdgeLabel(label);
              const position = label
                ? swimlaneLabelPosition(
                    points,
                    pill.width,
                    boxList.map((box) => ({ ...box, lane: 0 })),
                  )
                : null;
              return (
                <g
                  key={`${stringValue(item.relationship.from)}-${stringValue(item.relationship.to)}-${item.index}`}
                >
                  <path
                    className="rq-er__line"
                    d={points
                      .map(
                        ([x, y], index) =>
                          `${index === 0 ? "M" : "L"} ${x} ${y}`,
                      )
                      .join(" ")}
                  />
                  {marks.map((mark, markIndex) => (
                    <g className="rq-er__mark" key={markIndex}>
                      <path d={mark.path} />
                      {mark.circle ? (
                        <circle cx={mark.circle.cx} cy={mark.circle.cy} r="4" />
                      ) : null}
                    </g>
                  ))}
                  {position ? (
                    <g
                      className="rq-er__relation-label"
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
                  <title>{`${label}: ${stringValue(item.relationship.cardinality)}`}</title>
                </g>
              );
            })}
          </g>
          <g className="rq-er__entities">
            {entities.map((entity, index) => {
              const geometry = boxes.get(stringValue(entity.id));
              if (!geometry) return null;
              const attributes = recordList(entity.attributes);
              const radius = 12;
              return (
                <g
                  className="rq-er__entity"
                  key={stringValue(entity.id) || index}
                  transform={`translate(${geometry.x} ${geometry.y})`}
                >
                  <rect
                    className="rq-er__card"
                    height={geometry.height}
                    rx={radius}
                    width={geometry.width}
                  />
                  <path
                    className="rq-er__header"
                    d={`M 0 ${ER_HEADER_HEIGHT} V ${radius} a ${radius} ${radius} 0 0 1 ${radius} ${-radius} H ${geometry.width - radius} a ${radius} ${radius} 0 0 1 ${radius} ${radius} V ${ER_HEADER_HEIGHT} z`}
                  />
                  <text className="rq-er__name" x="16" y="29">
                    {displayText(stringValue(entity.name))}
                  </text>
                  {attributes.length === 0 ? (
                    <text
                      className="rq-er__empty"
                      x="16"
                      y={ER_HEADER_HEIGHT + 19}
                    >
                      Sin atributos sustentados
                    </text>
                  ) : (
                    attributes.map((attribute, attributeIndex) => {
                      const top =
                        ER_HEADER_HEIGHT + attributeIndex * ER_ROW_HEIGHT;
                      const middle = top + ER_ROW_HEIGHT / 2 + 4.5;
                      const primary = attribute.primaryKey === true;
                      const foreign = attribute.foreignKey === true;
                      return (
                        <g
                          key={`${stringValue(attribute.name)}-${attributeIndex}`}
                        >
                          {attributeIndex % 2 === 1 ? (
                            <rect
                              className="rq-er__stripe"
                              height={ER_ROW_HEIGHT}
                              width={geometry.width}
                              x="0"
                              y={top}
                            />
                          ) : null}
                          {primary ? (
                            <g className="rq-er__badge rq-er__badge--pk">
                              <rect
                                height="16"
                                rx="5"
                                width="24"
                                x="12"
                                y={top + 5.5}
                              />
                              <text textAnchor="middle" x="24" y={top + 17}>
                                PK
                              </text>
                            </g>
                          ) : null}
                          {foreign ? (
                            <g className="rq-er__badge rq-er__badge--fk">
                              <rect
                                height="16"
                                rx="5"
                                width="24"
                                x="40"
                                y={top + 5.5}
                              />
                              <text textAnchor="middle" x="52" y={top + 17}>
                                FK
                              </text>
                            </g>
                          ) : null}
                          <text
                            className={
                              primary
                                ? "rq-er__attribute rq-er__attribute--key"
                                : "rq-er__attribute"
                            }
                            x="72"
                            y={middle}
                          >
                            {displayText(stringValue(attribute.name))}
                            {attribute.required === true ? (
                              <tspan className="rq-er__required"> *</tspan>
                            ) : null}
                          </text>
                          <text
                            className="rq-er__type"
                            textAnchor="end"
                            x={geometry.width - 14}
                            y={middle}
                          >
                            {displayText(stringValue(attribute.dataType))}
                          </text>
                        </g>
                      );
                    })
                  )}
                  <title>{displayText(stringValue(entity.description))}</title>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </figure>
  );
}
