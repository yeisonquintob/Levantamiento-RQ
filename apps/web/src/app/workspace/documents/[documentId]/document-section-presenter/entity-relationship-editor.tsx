import React from "react";
import { EntityRelationshipDiagram } from "./entity-relationship-diagram";
import {
  TextField,
  EditorDisclosure,
  EditorHint,
  type BusinessEditorProps,
} from "./primitives";
import {
  PENDING,
  type JsonRecord,
  recordValue,
  recordList,
  stringValue,
  displayText,
} from "./shared";

export function EntityRelationshipEditor({
  value,
  readOnly,
  onChange,
}: BusinessEditorProps) {
  const model = recordValue(value) ?? {
    title: "Modelo entidad-relación",
    entities: [],
    relationships: [],
    sourceIds: [],
  };
  const entities = recordList(model.entities);
  const relationships = recordList(model.relationships);
  const update = (changes: JsonRecord) => onChange({ ...model, ...changes });
  const updateEntity = (index: number, changes: JsonRecord) =>
    update({
      entities: entities.map((entity, itemIndex) =>
        itemIndex === index ? { ...entity, ...changes } : entity,
      ),
    });

  return (
    <div className="rq-entity-relationship-editor">
      <EntityRelationshipDiagram value={model} />
      <EditorHint />
      <TextField
        label="Nombre del modelo"
        onChange={(title) => update({ title })}
        readOnly={readOnly}
        value={stringValue(model.title)}
      />
      <div className="rq-entity-relationship-editor__columns">
        <section>
          <h3>Entidades ({entities.length})</h3>
          <div className="rq-document-disclosure-list">
            {entities.map((entity, entityIndex) => {
              const attributes = recordList(entity.attributes);
              const entityId = stringValue(entity.id);
              return (
                <EditorDisclosure
                  description={`${attributes.length} atributos`}
                  key={entityId || entityIndex}
                  onDelete={
                    readOnly
                      ? undefined
                      : () =>
                          update({
                            entities: entities.filter(
                              (_, itemIndex) => itemIndex !== entityIndex,
                            ),
                            relationships: relationships.filter(
                              (relationship) =>
                                relationship.from !== entity.id &&
                                relationship.to !== entity.id,
                            ),
                          })
                  }
                  title={
                    displayText(stringValue(entity.name)) ||
                    `Entidad ${entityIndex + 1}`
                  }
                >
                  <TextField
                    label="Nombre"
                    multiline={false}
                    onChange={(name) => updateEntity(entityIndex, { name })}
                    readOnly={readOnly}
                    value={stringValue(entity.name)}
                  />
                  <TextField
                    label="Descripción"
                    onChange={(description) =>
                      updateEntity(entityIndex, { description })
                    }
                    readOnly={readOnly}
                    value={stringValue(entity.description)}
                  />
                  <h4>Atributos</h4>
                  <div className="rq-document-disclosure-list">
                    {attributes.map((attribute, attributeIndex) => (
                      <EditorDisclosure
                        description={displayText(
                          stringValue(attribute.dataType),
                        )}
                        key={`${stringValue(attribute.name)}-${attributeIndex}`}
                        onDelete={
                          readOnly
                            ? undefined
                            : () =>
                                updateEntity(entityIndex, {
                                  attributes: attributes.filter(
                                    (_, itemIndex) =>
                                      itemIndex !== attributeIndex,
                                  ),
                                })
                        }
                        title={
                          displayText(stringValue(attribute.name)) ||
                          `Atributo ${attributeIndex + 1}`
                        }
                      >
                        <div className="rq-entity-attribute-editor">
                          <TextField
                            label="Nombre"
                            multiline={false}
                            onChange={(name) =>
                              updateEntity(entityIndex, {
                                attributes: attributes.map((item, itemIndex) =>
                                  itemIndex === attributeIndex
                                    ? { ...item, name }
                                    : item,
                                ),
                              })
                            }
                            readOnly={readOnly}
                            value={stringValue(attribute.name)}
                          />
                          <TextField
                            label="Tipo de dato"
                            multiline={false}
                            onChange={(dataType) =>
                              updateEntity(entityIndex, {
                                attributes: attributes.map((item, itemIndex) =>
                                  itemIndex === attributeIndex
                                    ? { ...item, dataType }
                                    : item,
                                ),
                              })
                            }
                            readOnly={readOnly}
                            value={stringValue(attribute.dataType)}
                          />
                          {[
                            ["primaryKey", "Clave primaria (PK)"],
                            ["foreignKey", "Clave foránea (FK)"],
                            ["required", "Obligatorio"],
                          ].map(([key, label]) => (
                            <label className="rq-document-checkbox" key={key}>
                              <input
                                checked={attribute[key] === true}
                                disabled={readOnly}
                                onChange={(event) =>
                                  updateEntity(entityIndex, {
                                    attributes: attributes.map(
                                      (item, itemIndex) =>
                                        itemIndex === attributeIndex
                                          ? {
                                              ...item,
                                              [key]: event.target.checked,
                                            }
                                          : item,
                                    ),
                                  })
                                }
                                type="checkbox"
                              />
                              <span>{label}</span>
                            </label>
                          ))}
                        </div>
                      </EditorDisclosure>
                    ))}
                  </div>
                  {!readOnly ? (
                    <button
                      className="rq-document-add-item"
                      onClick={() =>
                        updateEntity(entityIndex, {
                          attributes: [
                            ...attributes,
                            {
                              name: PENDING,
                              dataType: PENDING,
                              primaryKey: false,
                              foreignKey: false,
                              required: false,
                            },
                          ],
                        })
                      }
                      type="button"
                    >
                      Agregar atributo
                    </button>
                  ) : null}
                </EditorDisclosure>
              );
            })}
          </div>
          {!readOnly ? (
            <button
              className="rq-document-add-item"
              onClick={() =>
                update({
                  entities: [
                    ...entities,
                    {
                      id: `entity-${entities.length + 1}-${Date.now()}`,
                      name: PENDING,
                      description: PENDING,
                      attributes: [],
                    },
                  ],
                })
              }
              type="button"
            >
              Agregar entidad
            </button>
          ) : null}
        </section>
        <section>
          <h3>Relaciones ({relationships.length})</h3>
          <div className="rq-document-disclosure-list">
            {relationships.map((relationship, index) => (
              <EditorDisclosure
                description={`${displayText(stringValue(entities.find((entity) => entity.id === relationship.from)?.name)) || "Entidad"} → ${displayText(stringValue(entities.find((entity) => entity.id === relationship.to)?.name)) || "Entidad"}`}
                key={index}
                onDelete={
                  readOnly
                    ? undefined
                    : () =>
                        update({
                          relationships: relationships.filter(
                            (_, itemIndex) => itemIndex !== index,
                          ),
                        })
                }
                title={
                  displayText(stringValue(relationship.label)) ||
                  `Relación ${index + 1}`
                }
              >
                <div className="rq-document-flow-connections">
                  {[
                    ["from", "Desde"],
                    ["to", "Hacia"],
                  ].map(([key, label]) => (
                    <label key={key}>
                      <span>{label}</span>
                      <select
                        disabled={readOnly}
                        onChange={(event) =>
                          update({
                            relationships: relationships.map(
                              (item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, [key]: event.target.value }
                                  : item,
                            ),
                          })
                        }
                        value={stringValue(relationship[key])}
                      >
                        {entities.map((entity) => (
                          <option
                            key={stringValue(entity.id)}
                            value={stringValue(entity.id)}
                          >
                            {displayText(stringValue(entity.name))}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <label>
                    <span>Cardinalidad</span>
                    <select
                      disabled={readOnly}
                      onChange={(event) =>
                        update({
                          relationships: relationships.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, cardinality: event.target.value }
                              : item,
                          ),
                        })
                      }
                      value={stringValue(relationship.cardinality) || "1:N"}
                    >
                      {(["1:1", "1:N", "N:1", "N:M"] as const).map(
                        (cardinality) => (
                          <option key={cardinality} value={cardinality}>
                            {cardinality}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                </div>
                <TextField
                  label="Nombre de la relación"
                  multiline={false}
                  onChange={(label) =>
                    update({
                      relationships: relationships.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, label } : item,
                      ),
                    })
                  }
                  readOnly={readOnly}
                  value={stringValue(relationship.label)}
                />
              </EditorDisclosure>
            ))}
          </div>
          {!readOnly && entities.length > 1 ? (
            <button
              className="rq-document-add-item"
              onClick={() =>
                update({
                  relationships: [
                    ...relationships,
                    {
                      from: stringValue(entities[0]?.id),
                      to: stringValue(entities[1]?.id),
                      cardinality: "1:N",
                      label: PENDING,
                    },
                  ],
                })
              }
              type="button"
            >
              Agregar relación
            </button>
          ) : null}
        </section>
      </div>
    </div>
  );
}
