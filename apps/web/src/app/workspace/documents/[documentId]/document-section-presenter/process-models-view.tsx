import React, { useState } from "react";
import { type DocumentJsonValue } from "@levantamiento-rq/shared-contracts";
import {
  type DiagramModelTab,
  HISTORICAL_TO_BE_MESSAGE,
  HISTORICAL_ER_MESSAGE,
  NO_AS_IS_EVIDENCE_MESSAGE,
  NO_TO_BE_EVIDENCE_MESSAGE,
  NO_ER_EVIDENCE_MESSAGE,
  resolveDiagramModels,
  hasProcessFlowModelContent,
  hasEntityRelationshipModelContent,
  DiagramModelTabs,
} from "./diagram-models";
import { EntityRelationshipDiagram } from "./entity-relationship-diagram";
import { EmptyValue } from "./primitives";
import { ProcessFlowDiagram } from "./process-flow-diagram";
import { recordValue, stringList, displayText } from "./shared";
import { SwimlaneProcessFlowDiagram } from "./swimlane-diagram";

function FlowEvidenceNotes({ value }: { value: DocumentJsonValue }) {
  const flow = recordValue(value);
  if (!flow) return null;
  const groups = [
    ["problems", "Problemas identificados"],
    ["improvements", "Mejoras del proceso"],
    ["expectedResults", "Resultados esperados"],
  ] as const;
  const visible = groups.filter(([key]) => stringList(flow[key]).length > 0);
  if (visible.length === 0) return null;
  return (
    <div className="rq-diagram-evidence-notes">
      {visible.map(([key, label]) => (
        <section key={key}>
          <h3>{label}</h3>
          <ul>
            {stringList(flow[key]).map((item, index) => (
              <li key={`${item}-${index}`}>{displayText(item)}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function ProcessModelsView({ value }: { value: DocumentJsonValue }) {
  const models = resolveDiagramModels(value);
  const [active, setActive] = useState<DiagramModelTab>("asIs");
  const includeEntityRelationship =
    models.historical || models.root?.entityRelationship !== null;
  return (
    <div className="rq-diagram-models">
      <DiagramModelTabs
        active={active}
        includeEntityRelationship={includeEntityRelationship}
        onChange={setActive}
      />
      <section
        aria-labelledby={`diagram-tab-${active}`}
        id={`diagram-panel-${active}`}
        role="tabpanel"
      >
        {active === "asIs" ? (
          models.historical ? (
            <ProcessFlowDiagram value={models.asIs ?? {}} />
          ) : hasProcessFlowModelContent(models.asIs) ? (
            <>
              <SwimlaneProcessFlowDiagram value={models.asIs ?? {}} />
              <FlowEvidenceNotes value={models.asIs ?? {}} />
            </>
          ) : (
            <EmptyValue>{NO_AS_IS_EVIDENCE_MESSAGE}</EmptyValue>
          )
        ) : active === "toBe" ? (
          hasProcessFlowModelContent(models.toBe) ? (
            <>
              <SwimlaneProcessFlowDiagram value={models.toBe ?? {}} />
              <FlowEvidenceNotes value={models.toBe ?? {}} />
            </>
          ) : (
            <EmptyValue>
              {models.historical
                ? HISTORICAL_TO_BE_MESSAGE
                : NO_TO_BE_EVIDENCE_MESSAGE}
            </EmptyValue>
          )
        ) : hasEntityRelationshipModelContent(models.entityRelationship) ? (
          <EntityRelationshipDiagram value={models.entityRelationship ?? {}} />
        ) : (
          <EmptyValue>
            {models.historical ? HISTORICAL_ER_MESSAGE : NO_ER_EVIDENCE_MESSAGE}
          </EmptyValue>
        )}
      </section>
    </div>
  );
}
