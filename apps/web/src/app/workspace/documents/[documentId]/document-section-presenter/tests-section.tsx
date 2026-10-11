import React from "react";
import { type DocumentJsonValue } from "@levantamiento-rq/shared-contracts";
import {
  Tags,
  HumanValue,
  TextField,
  EditorDisclosure,
  EditorHint,
  StringListEditor,
  SafeValueEditor,
  type BusinessEditorProps,
} from "./primitives";
import {
  PENDING,
  type JsonRecord,
  recordValue,
  recordList,
  stringValue,
  stringList,
  displayText,
} from "./shared";

export function TestsView({ value }: { value: DocumentJsonValue }) {
  const record = recordValue(value);
  const scenarios = Array.isArray(value)
    ? recordList(value)
    : recordList(record?.scenarios);
  if (scenarios.length === 0) return <HumanValue value={value} />;
  return (
    <div className="rq-document-tests-view">
      <div className="rq-document-master-list">
        {scenarios.map((scenario, index) => (
          <EditorDisclosure
            description={stringValue(scenario.title)}
            key={stringValue(scenario.code) || index}
            meta={`${stringList(scenario.userStoryCodes).length} HU · Definida`}
            title={
              displayText(stringValue(scenario.code)) || `Prueba ${index + 1}`
            }
          >
            <div className="rq-document-detail-panel">
              <h4>Historias verificadas</h4>
              <Tags values={stringList(scenario.userStoryCodes)} />
              <h4>Criterios verificados</h4>
              <Tags values={stringList(scenario.acceptanceCriterionCodes)} />
              <h4>Tareas verificadas</h4>
              <Tags values={stringList(scenario.taskCodes)} />
              <h4>Precondición</h4>
              <HumanValue value={scenario.precondition ?? ""} />
              <h4>Acción</h4>
              <HumanValue value={scenario.action ?? ""} />
              <h4>Resultado esperado</h4>
              <HumanValue value={scenario.expectedResult ?? ""} />
            </div>
          </EditorDisclosure>
        ))}
      </div>
    </div>
  );
}

export function TestsEditor({
  value,
  readOnly,
  onChange,
}: BusinessEditorProps) {
  const record = recordValue(value);
  if (!record)
    return (
      <SafeValueEditor
        label="Escenarios de prueba"
        onChange={onChange}
        readOnly={readOnly}
        value={value}
      />
    );
  const scenarios = recordList(record.scenarios);
  const updateScenarios = (next: JsonRecord[]) =>
    onChange({ ...record, scenarios: next });
  return (
    <div className="rq-document-tests-editor">
      <EditorHint />
      <div className="rq-document-editor-collection-heading">
        <h3>Escenarios de prueba</h3>
        <span>{scenarios.length} registro(s)</span>
      </div>
      <div className="rq-document-disclosure-list">
        {scenarios.map((scenario, index) => {
          const update = (key: string, next: DocumentJsonValue) =>
            updateScenarios(
              scenarios.map((item, itemIndex) =>
                itemIndex === index ? { ...item, [key]: next } : item,
              ),
            );
          return (
            <EditorDisclosure
              description={stringValue(scenario.title)}
              key={stringValue(scenario.code) || index}
              meta={`${stringList(scenario.userStoryCodes).length} HU · ${stringList(scenario.acceptanceCriterionCodes).length} criterio(s)`}
              onDelete={
                readOnly
                  ? undefined
                  : () =>
                      updateScenarios(
                        scenarios.filter((_, itemIndex) => itemIndex !== index),
                      )
              }
              title={`Escenario ${displayText(stringValue(scenario.code)) || index + 1}`}
            >
              <div className="rq-document-business-grid">
                <TextField
                  label="Código"
                  multiline={false}
                  onChange={(next) => update("code", next)}
                  readOnly={readOnly}
                  value={stringValue(scenario.code)}
                />
                <TextField
                  label="Nombre"
                  multiline={false}
                  onChange={(next) => update("title", next)}
                  readOnly={readOnly}
                  value={stringValue(scenario.title)}
                />
                <StringListEditor
                  label="Historias verificadas"
                  onChange={(next) => update("userStoryCodes", next)}
                  readOnly={readOnly}
                  value={stringList(scenario.userStoryCodes)}
                />
                <StringListEditor
                  label="Criterios verificados"
                  onChange={(next) => update("acceptanceCriterionCodes", next)}
                  readOnly={readOnly}
                  value={stringList(scenario.acceptanceCriterionCodes)}
                />
                {[
                  ["precondition", "Precondición"],
                  ["action", "Acción"],
                  ["expectedResult", "Resultado esperado"],
                ].map(([key, label]) => (
                  <TextField
                    key={key}
                    label={label}
                    onChange={(next) => update(key, next)}
                    readOnly={readOnly}
                    value={stringValue(scenario[key])}
                  />
                ))}
              </div>
            </EditorDisclosure>
          );
        })}
      </div>
      {!readOnly ? (
        <button
          className="rq-document-add-item"
          onClick={() =>
            updateScenarios([
              ...scenarios,
              {
                code: `CP-${String(scenarios.length + 1).padStart(3, "0")}`,
                title: PENDING,
                userStoryCodes: [],
                acceptanceCriterionCodes: [],
                precondition: PENDING,
                action: PENDING,
                expectedResult: PENDING,
                sourceIds: [],
              },
            ])
          }
          type="button"
        >
          Agregar escenario
        </button>
      ) : null}
    </div>
  );
}
