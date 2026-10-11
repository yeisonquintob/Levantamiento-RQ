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
import { EntityRelationshipEditor } from "./entity-relationship-editor";
import { EmptyValue, type BusinessEditorProps } from "./primitives";
import { ProcessFlowEditor } from "./process-flow-editor";

export function ProcessModelsEditor({
  value,
  readOnly,
  onChange,
}: BusinessEditorProps) {
  const models = resolveDiagramModels(value);
  const [active, setActive] = useState<DiagramModelTab>("asIs");
  const includeEntityRelationship =
    models.historical || models.root?.entityRelationship !== null;
  const updateFlow = (key: "asIs" | "toBe", next: DocumentJsonValue) => {
    if (!models.root || !models.processFlows) return;
    onChange({
      ...models.root,
      processFlows: { ...models.processFlows, [key]: next },
    });
  };
  const updateEntityRelationship = (next: DocumentJsonValue) => {
    if (!models.root) return;
    onChange({ ...models.root, entityRelationship: next });
  };
  return (
    <div className="rq-diagram-models rq-diagram-models--editor">
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
          models.historical || hasProcessFlowModelContent(models.asIs) ? (
            <ProcessFlowEditor
              onChange={(next) =>
                models.historical ? onChange(next) : updateFlow("asIs", next)
              }
              readOnly={readOnly}
              value={models.asIs ?? {}}
            />
          ) : (
            <EmptyValue>{NO_AS_IS_EVIDENCE_MESSAGE}</EmptyValue>
          )
        ) : active === "toBe" ? (
          hasProcessFlowModelContent(models.toBe) ? (
            <ProcessFlowEditor
              onChange={(next) => updateFlow("toBe", next)}
              readOnly={readOnly}
              value={models.toBe ?? {}}
            />
          ) : (
            <EmptyValue>
              {models.historical
                ? HISTORICAL_TO_BE_MESSAGE
                : NO_TO_BE_EVIDENCE_MESSAGE}
            </EmptyValue>
          )
        ) : hasEntityRelationshipModelContent(models.entityRelationship) ? (
          <EntityRelationshipEditor
            onChange={updateEntityRelationship}
            readOnly={readOnly}
            value={models.entityRelationship ?? {}}
          />
        ) : (
          <EmptyValue>
            {models.historical ? HISTORICAL_ER_MESSAGE : NO_ER_EVIDENCE_MESSAGE}
          </EmptyValue>
        )}
      </section>
    </div>
  );
}
