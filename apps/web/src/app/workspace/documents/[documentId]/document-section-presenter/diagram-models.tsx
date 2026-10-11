import React from "react";
import { type DocumentJsonValue } from "@levantamiento-rq/shared-contracts";
import {
  type JsonRecord,
  recordValue,
  recordList,
  stringValue,
} from "./shared";

export type DiagramModelTab = "asIs" | "toBe" | "entityRelationship";

const DIAGRAM_MODEL_TABS: readonly {
  key: DiagramModelTab;
  label: string;
}[] = [
  { key: "asIs", label: "Flujo AS-IS" },
  { key: "toBe", label: "Flujo TO-BE" },
  { key: "entityRelationship", label: "Modelo entidad-relación" },
];

export const HISTORICAL_TO_BE_MESSAGE =
  "No existe flujo TO-BE en esta versión histórica.";

export const HISTORICAL_ER_MESSAGE =
  "No existe modelo entidad-relación en esta versión histórica.";

export const NO_AS_IS_EVIDENCE_MESSAGE =
  "No hay información o evidencia suficiente para representar el flujo AS-IS.";

export const NO_TO_BE_EVIDENCE_MESSAGE =
  "No hay información o evidencia suficiente para representar el flujo TO-BE.";

export const NO_ER_EVIDENCE_MESSAGE =
  "No hay información o evidencia suficiente para representar el modelo entidad-relación.";

export function resolveDiagramModels(value: DocumentJsonValue) {
  const narrativeModels =
    typeof value === "string" ? processModelsFromNarrative(value) : null;
  const root = recordValue(value) ?? narrativeModels;
  const processFlows = recordValue(root?.processFlows);
  if (!root || !processFlows) {
    return {
      historical: true,
      root,
      processFlows: null,
      asIs: root,
      toBe: null,
      entityRelationship: null,
    };
  }
  return {
    historical: false,
    root,
    processFlows,
    asIs: recordValue(processFlows.asIs),
    toBe: recordValue(processFlows.toBe),
    entityRelationship: recordValue(root.entityRelationship),
  };
}

function processModelsFromNarrative(value: string): JsonRecord | null {
  const normalized = value.replace(/\r\n/gu, "\n");
  const asIsMatch = normalized.match(/Diagrama de flujo AS-IS:\s*\n([^\n]+)/iu);
  const toBeMatch = normalized.match(/Diagrama de flujo TO-BE:\s*\n([^\n]+)/iu);
  if (!asIsMatch && !toBeMatch) return null;

  const flow = (
    line: string | undefined,
    key: "as-is" | "to-be",
    title: string,
  ): JsonRecord => {
    const steps = (line ?? "")
      .split(/\s*->\s*/u)
      .map((step) =>
        step
          .replace(/^\[[^\]]+\]\s*/u, (match) => match.slice(1, -2))
          .replace(/^\(|\)$/gu, "")
          .replace(/\.$/u, "")
          .trim(),
      )
      .filter(Boolean);
    const laneId = `${key}-lane`;
    const nodes: JsonRecord[] = steps.map((label, index) => ({
      id: `${key}-${index + 1}`,
      laneId,
      kind:
        index === 0
          ? "START"
          : index === steps.length - 1
            ? "END"
            : label.includes("?")
              ? "DECISION"
              : "PROCESS",
      label,
    }));
    const edges: JsonRecord[] = nodes.slice(1).map((node, index) => ({
      from: stringValue(nodes[index]?.id),
      to: stringValue(node.id),
      label: "",
    }));
    return {
      title,
      objective:
        key === "as-is"
          ? "Representar el proceso actual identificado en la evidencia."
          : "Representar el proceso futuro identificado en la evidencia.",
      lanes: [
        {
          id: laneId,
          name: key === "as-is" ? "Proceso actual" : "Solución propuesta",
          kind: key === "as-is" ? "ACTOR" : "SYSTEM",
        },
      ],
      nodes,
      edges,
      problems: [],
      improvements: [],
      expectedResults: [],
      sourceIds: [],
    };
  };

  return {
    processFlows: {
      asIs: flow(asIsMatch?.[1], "as-is", "Flujo AS-IS"),
      toBe: flow(toBeMatch?.[1], "to-be", "Flujo TO-BE"),
    },
    entityRelationship: {
      title: "Modelo entidad-relación",
      entities: [],
      relationships: [],
      sourceIds: [],
    },
  };
}

export function hasProcessFlowModelContent(value: JsonRecord | null): boolean {
  return Boolean(
    value &&
    (recordList(value.nodes).length > 0 ||
      recordList(value.edges).length > 0 ||
      recordList(value.lanes).length > 0),
  );
}

export function hasEntityRelationshipModelContent(
  value: JsonRecord | null,
): boolean {
  return Boolean(
    value &&
    (recordList(value.entities).length > 0 ||
      recordList(value.relationships).length > 0),
  );
}

export function DiagramModelTabs({
  active,
  includeEntityRelationship = true,
  onChange,
}: {
  active: DiagramModelTab;
  includeEntityRelationship?: boolean;
  onChange: (tab: DiagramModelTab) => void;
}) {
  return (
    <div
      aria-label="Modelos de la sección Diagramas"
      className="rq-diagram-model-tabs"
      role="tablist"
    >
      {DIAGRAM_MODEL_TABS.filter(
        (tab) => includeEntityRelationship || tab.key !== "entityRelationship",
      ).map((tab) => (
        <button
          aria-controls={`diagram-panel-${tab.key}`}
          aria-selected={active === tab.key}
          className={active === tab.key ? "is-active" : undefined}
          id={`diagram-tab-${tab.key}`}
          key={tab.key}
          onClick={() => onChange(tab.key)}
          role="tab"
          tabIndex={active === tab.key ? 0 : -1}
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
