import React from "react";
import { FLOW_KIND_LABELS } from "./flow-layout";
import {
  TextField,
  EditorDisclosure,
  EditorHint,
  StringListEditor,
  type BusinessEditorProps,
} from "./primitives";
import { ProcessFlowDiagram } from "./process-flow-diagram";
import {
  PENDING,
  type JsonRecord,
  recordValue,
  recordList,
  stringValue,
  stringList,
  displayText,
} from "./shared";
import { SwimlaneProcessFlowDiagram } from "./swimlane-diagram";

export function ProcessFlowEditor({
  value,
  readOnly,
  onChange,
}: BusinessEditorProps) {
  const flow = recordValue(value) ?? {
    title: "Flujo del proceso",
    nodes: [],
    edges: [],
    sourceIds: [],
  };
  const nodes = recordList(flow.nodes);
  const edges = recordList(flow.edges);
  const supportsSwimlanes = Array.isArray(flow.lanes);
  const lanes = recordList(flow.lanes);
  const update = (changes: JsonRecord) => onChange({ ...flow, ...changes });
  const updateNode = (index: number, changes: JsonRecord) =>
    update({
      nodes: nodes.map((node, itemIndex) =>
        itemIndex === index ? { ...node, ...changes } : node,
      ),
    });
  return (
    <div className="rq-process-flow-editor">
      {supportsSwimlanes ? (
        <SwimlaneProcessFlowDiagram value={flow} />
      ) : (
        <ProcessFlowDiagram value={flow} />
      )}
      <EditorHint />
      <TextField
        label="Nombre del flujo"
        onChange={(title) => update({ title })}
        readOnly={readOnly}
        value={stringValue(flow.title)}
      />
      {Object.hasOwn(flow, "objective") ? (
        <TextField
          label="Objetivo del flujo"
          onChange={(objective) =>
            update({ objective: objective.trim() ? objective : null })
          }
          readOnly={readOnly}
          value={stringValue(flow.objective)}
        />
      ) : null}
      {supportsSwimlanes ? (
        <section className="rq-process-flow-editor__lanes">
          <h3>Actores y sistemas ({lanes.length})</h3>
          <div className="rq-document-disclosure-list">
            {lanes.map((lane, index) => (
              <EditorDisclosure
                description={
                  stringValue(lane.kind) === "SYSTEM" ? "Sistema" : "Actor"
                }
                key={stringValue(lane.id) || index}
                onDelete={
                  readOnly
                    ? undefined
                    : () => {
                        const laneId = stringValue(lane.id);
                        update({
                          lanes: lanes.filter(
                            (_, itemIndex) => itemIndex !== index,
                          ),
                          nodes: nodes.map((node) =>
                            stringValue(node.laneId) === laneId
                              ? { ...node, laneId: null }
                              : node,
                          ),
                        });
                      }
                }
                title={
                  displayText(stringValue(lane.name)) || `Carril ${index + 1}`
                }
              >
                <TextField
                  label="Nombre"
                  multiline={false}
                  onChange={(name) =>
                    update({
                      lanes: lanes.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, name } : item,
                      ),
                    })
                  }
                  readOnly={readOnly}
                  value={stringValue(lane.name)}
                />
                <label className="rq-document-business-field">
                  <span>Tipo</span>
                  <select
                    disabled={readOnly}
                    onChange={(event) =>
                      update({
                        lanes: lanes.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, kind: event.target.value }
                            : item,
                        ),
                      })
                    }
                    value={stringValue(lane.kind) || "ACTOR"}
                  >
                    <option value="ACTOR">Actor</option>
                    <option value="SYSTEM">Sistema</option>
                  </select>
                </label>
              </EditorDisclosure>
            ))}
          </div>
          {!readOnly ? (
            <button
              className="rq-document-add-item"
              onClick={() =>
                update({
                  lanes: [
                    ...lanes,
                    {
                      id: `lane-${lanes.length + 1}-${Date.now()}`,
                      name: PENDING,
                      kind: "ACTOR",
                    },
                  ],
                })
              }
              type="button"
            >
              Agregar actor o sistema
            </button>
          ) : null}
        </section>
      ) : null}
      <div className="rq-process-flow-editor__columns">
        <section>
          <h3>Pasos del proceso ({nodes.length})</h3>
          <div className="rq-document-disclosure-list">
            {nodes.map((node, index) => (
              <EditorDisclosure
                description={FLOW_KIND_LABELS[stringValue(node.kind)]}
                key={stringValue(node.id) || index}
                onDelete={
                  readOnly
                    ? undefined
                    : () =>
                        update({
                          nodes: nodes.filter(
                            (_, itemIndex) => itemIndex !== index,
                          ),
                          edges: edges.filter(
                            (edge) =>
                              edge.from !== node.id && edge.to !== node.id,
                          ),
                        })
                }
                title={`Paso ${index + 1}: ${displayText(stringValue(node.label)) || "Sin nombre"}`}
              >
                <label className="rq-document-business-field">
                  <span>Tipo</span>
                  <select
                    disabled={readOnly}
                    onChange={(event) =>
                      updateNode(index, { kind: event.target.value })
                    }
                    value={stringValue(node.kind)}
                  >
                    {Object.entries(FLOW_KIND_LABELS).map(([kind, label]) => (
                      <option key={kind} value={kind}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <TextField
                  label={node.kind === "DECISION" ? "Pregunta" : "Nombre"}
                  onChange={(label) => updateNode(index, { label })}
                  readOnly={readOnly}
                  value={stringValue(node.label)}
                />
                {supportsSwimlanes ? (
                  <label className="rq-document-business-field">
                    <span>Actor o sistema responsable</span>
                    <select
                      disabled={readOnly}
                      onChange={(event) =>
                        updateNode(index, {
                          laneId: event.target.value || null,
                        })
                      }
                      value={stringValue(node.laneId)}
                    >
                      <option value="">Sin carril asignado</option>
                      {lanes.map((lane) => (
                        <option
                          key={stringValue(lane.id)}
                          value={stringValue(lane.id)}
                        >
                          {displayText(stringValue(lane.name))}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </EditorDisclosure>
            ))}
          </div>
          {!readOnly ? (
            <button
              className="rq-document-add-item"
              onClick={() =>
                update({
                  nodes: [
                    ...nodes,
                    {
                      id: `step-${nodes.length + 1}-${Date.now()}`,
                      kind: "PROCESS",
                      label: PENDING,
                      ...(supportsSwimlanes
                        ? { laneId: stringValue(lanes[0]?.id) || null }
                        : {}),
                    },
                  ],
                })
              }
              type="button"
            >
              Agregar paso
            </button>
          ) : null}
        </section>
        <section>
          <h3>Conexiones ({edges.length})</h3>
          <div className="rq-document-disclosure-list">
            {edges.map((edge, index) => (
              <EditorDisclosure
                description={`${displayText(stringValue(nodes.find((node) => node.id === edge.from)?.label)) || "Origen"} → ${displayText(stringValue(nodes.find((node) => node.id === edge.to)?.label)) || "Destino"}`}
                key={index}
                onDelete={
                  readOnly
                    ? undefined
                    : () =>
                        update({
                          edges: edges.filter(
                            (_, itemIndex) => itemIndex !== index,
                          ),
                        })
                }
                title={`Conexión ${index + 1}`}
              >
                <div className="rq-document-flow-connections">
                  <label>
                    <span>De</span>
                    <select
                      disabled={readOnly}
                      onChange={(event) =>
                        update({
                          edges: edges.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, from: event.target.value }
                              : item,
                          ),
                        })
                      }
                      value={stringValue(edge.from)}
                    >
                      {nodes.map((node, nodeIndex) => (
                        <option
                          key={stringValue(node.id)}
                          value={stringValue(node.id)}
                        >
                          Paso {nodeIndex + 1}:{" "}
                          {displayText(stringValue(node.label))}
                        </option>
                      ))}
                    </select>
                  </label>
                  <TextField
                    label="Condición opcional"
                    multiline={false}
                    onChange={(label) =>
                      update({
                        edges: edges.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, label: label.trim() ? label : null }
                            : item,
                        ),
                      })
                    }
                    readOnly={readOnly}
                    value={stringValue(edge.label)}
                  />
                  <label>
                    <span>A</span>
                    <select
                      disabled={readOnly}
                      onChange={(event) =>
                        update({
                          edges: edges.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, to: event.target.value }
                              : item,
                          ),
                        })
                      }
                      value={stringValue(edge.to)}
                    >
                      {nodes.map((node, nodeIndex) => (
                        <option
                          key={stringValue(node.id)}
                          value={stringValue(node.id)}
                        >
                          Paso {nodeIndex + 1}:{" "}
                          {displayText(stringValue(node.label))}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </EditorDisclosure>
            ))}
          </div>
          {!readOnly && nodes.length > 1 ? (
            <button
              className="rq-document-add-item"
              onClick={() =>
                update({
                  edges: [
                    ...edges,
                    {
                      from: stringValue(nodes[0]?.id),
                      to: stringValue(nodes[1]?.id),
                      label: null,
                    },
                  ],
                })
              }
              type="button"
            >
              Agregar conexión
            </button>
          ) : null}
        </section>
      </div>
      {Object.hasOwn(flow, "problems") ? (
        <div className="rq-process-flow-editor__evidence">
          <StringListEditor
            emptyLabel="Sin problemas respaldados."
            label="Problemas identificados"
            onChange={(problems) => update({ problems })}
            readOnly={readOnly}
            value={stringList(flow.problems)}
          />
          <StringListEditor
            emptyLabel="Sin mejoras respaldadas."
            label="Mejoras del proceso"
            onChange={(improvements) => update({ improvements })}
            readOnly={readOnly}
            value={stringList(flow.improvements)}
          />
          <StringListEditor
            emptyLabel="Sin resultados esperados respaldados."
            label="Resultados esperados"
            onChange={(expectedResults) => update({ expectedResults })}
            readOnly={readOnly}
            value={stringList(flow.expectedResults)}
          />
        </div>
      ) : null}
    </div>
  );
}
