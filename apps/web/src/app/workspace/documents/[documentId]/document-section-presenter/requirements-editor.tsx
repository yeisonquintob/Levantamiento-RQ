import React, { useState } from "react";
import { type DocumentJsonValue } from "@levantamiento-rq/shared-contracts";
import {
  EmptyValue,
  Tags,
  TextField,
  EditorDisclosure,
  EditorHint,
  featureContextMeta,
  storyContextMeta,
  StringListEditor,
  ReferenceListEditor,
  SafeValueEditor,
  type BusinessEditorProps,
} from "./primitives";
import {
  normalizeStoryAcceptanceCriteria,
  type FunctionalMilestoneGroup,
  pendingFunctionalStories,
  functionalMilestoneGroups,
  confirmedManualMilestoneOptions,
  commonEpicMilestoneRoots,
  assignPendingFunctionalStoryToMilestone,
} from "./requirements-model";
import {
  type RequirementsTab,
  RequirementsTabList,
  PendingFunctionalNeedsView,
} from "./requirements-view";
import {
  PENDING,
  type JsonRecord,
  recordValue,
  recordList,
  stringValue,
  stringList,
  humanLabel,
  displayText,
} from "./shared";

function FeatureEditor({
  feature,
  storyOptions,
  readOnly,
  onChange,
}: {
  feature: JsonRecord;
  storyOptions: readonly { value: string; label: string }[];
  readOnly: boolean;
  onChange: (feature: JsonRecord) => void;
}) {
  const set = (key: string, value: DocumentJsonValue) =>
    onChange({ ...feature, [key]: value });
  return (
    <div className="rq-document-business-grid">
      <TextField
        label="Código"
        multiline={false}
        onChange={(value) => set("code", value)}
        readOnly={readOnly}
        value={stringValue(feature.code)}
      />
      <TextField
        label="Nombre"
        multiline={false}
        onChange={(value) => set("title", value)}
        readOnly={readOnly}
        value={stringValue(feature.title)}
      />
      <TextField
        label="Objetivo"
        onChange={(value) => set("objective", value)}
        readOnly={readOnly}
        value={stringValue(feature.objective)}
      />
      <TextField
        label="Descripción"
        onChange={(value) => set("description", value)}
        readOnly={readOnly}
        value={stringValue(feature.description)}
      />
      <StringListEditor
        label="Incluye"
        onChange={(value) => set("inScope", value)}
        readOnly={readOnly}
        value={stringList(feature.inScope)}
      />
      <StringListEditor
        emptyLabel="Sin exclusiones explícitamente definidas."
        label="Fuera de alcance"
        onChange={(value) => set("outOfScope", value)}
        readOnly={readOnly}
        value={stringList(feature.outOfScope)}
      />
      <ReferenceListEditor
        label="Historias relacionadas"
        onChange={(value) => set("userStoryCodes", value)}
        options={storyOptions}
        readOnly={readOnly}
        value={stringList(feature.userStoryCodes)}
      />
    </div>
  );
}

function StoryEditor({
  story,
  featureOptions,
  readOnly,
  lockStructure = false,
  onChange,
}: {
  story: JsonRecord;
  featureOptions: readonly { value: string; label: string }[];
  readOnly: boolean;
  lockStructure?: boolean;
  onChange: (story: JsonRecord) => void;
}) {
  const set = (key: string, value: DocumentJsonValue) =>
    onChange({ ...story, [key]: value });
  const fields = recordList(story.fields);
  const criteria = normalizeStoryAcceptanceCriteria(
    story.acceptanceCriteria,
    stringValue(story.code),
  );
  const pendingDocumentation =
    stringValue(story.documentationStatus).trim().toUpperCase() ===
    "PENDING_DOCUMENTATION";
  return (
    <div>
      {pendingDocumentation ? (
        <div className="rq-document-callout rq-document-callout-warning">
          <strong>Estado documental: Pendiente de documentación</strong>
          <p>{displayText(stringValue(story.documentationObservation))}</p>
        </div>
      ) : null}
      <div className="rq-document-business-grid">
        {[
          "code",
          "title",
          "description",
          "role",
          "want",
          "benefit",
          "context",
        ].map((key) => (
          <TextField
            key={key}
            label={humanLabel(key)}
            multiline={!["code", "featureCode", "title"].includes(key)}
            onChange={(value) => set(key, value)}
            readOnly={readOnly || (lockStructure && key === "code")}
            value={stringValue(story[key])}
          />
        ))}
        {!lockStructure ? (
          <label className="rq-document-business-field">
            <span>Funcionalidad relacionada</span>
            <select
              disabled={readOnly}
              onChange={(event) => set("featureCode", event.target.value)}
              value={stringValue(story.featureCode)}
            >
              <option value="">Seleccionar…</option>
              {featureOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <StringListEditor
          label="Premisas"
          onChange={(value) => set("premises", value)}
          readOnly={readOnly}
          value={stringList(story.premises)}
        />
        <StringListEditor
          label="Sistemas impactados"
          onChange={(value) => set("impactedSystems", value)}
          readOnly={readOnly}
          value={stringList(story.impactedSystems)}
        />
      </div>
      <fieldset className="rq-document-business-list">
        <legend>Campos ({fields.length})</legend>
        {fields.map((field, index) => (
          <EditorDisclosure
            description={stringValue(field.dataType)}
            key={index}
            onDelete={
              readOnly
                ? undefined
                : () =>
                    set(
                      "fields",
                      fields.filter((_, itemIndex) => itemIndex !== index),
                    )
            }
            title={displayText(stringValue(field.name)) || `Campo ${index + 1}`}
          >
            <TextField
              label="Nombre"
              multiline={false}
              onChange={(value) =>
                set(
                  "fields",
                  fields.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, name: value } : item,
                  ),
                )
              }
              readOnly={readOnly}
              value={stringValue(field.name)}
            />
            <TextField
              label="Tipo de dato"
              multiline={false}
              onChange={(value) =>
                set(
                  "fields",
                  fields.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, dataType: value } : item,
                  ),
                )
              }
              readOnly={readOnly}
              value={stringValue(field.dataType)}
            />
            <label className="rq-document-business-check">
              <input
                checked={field.required === true}
                disabled={readOnly}
                onChange={(event) =>
                  set(
                    "fields",
                    fields.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, required: event.target.checked }
                        : item,
                    ),
                  )
                }
                type="checkbox"
              />
              <span>Obligatorio</span>
            </label>
            <TextField
              label="Validación"
              onChange={(value) =>
                set(
                  "fields",
                  fields.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, validation: value } : item,
                  ),
                )
              }
              readOnly={readOnly}
              value={stringValue(field.validation)}
            />
          </EditorDisclosure>
        ))}
        {!readOnly ? (
          <button
            className="rq-document-add-item"
            onClick={() =>
              set("fields", [
                ...fields,
                {
                  name: PENDING,
                  dataType: PENDING,
                  required: false,
                  validation: PENDING,
                  sourceIds: [],
                },
              ])
            }
            type="button"
          >
            Agregar campo
          </button>
        ) : null}
      </fieldset>
      <fieldset className="rq-document-business-list">
        <legend>Criterios de aceptación ({criteria.length})</legend>
        {pendingDocumentation && criteria.length === 0 ? (
          <p>Pendientes de documentación.</p>
        ) : null}
        {criteria.map((criterion, index) => (
          <EditorDisclosure
            description={stringValue(criterion.given)}
            key={index}
            onDelete={
              readOnly
                ? undefined
                : () =>
                    set(
                      "acceptanceCriteria",
                      criteria.filter((_, itemIndex) => itemIndex !== index),
                    )
            }
            title={
              displayText(stringValue(criterion.code)) ||
              `Criterio ${index + 1}`
            }
          >
            {["code", "given", "when", "then"].map((key) => (
              <TextField
                key={key}
                label={humanLabel(key)}
                multiline={key !== "code"}
                onChange={(value) =>
                  set(
                    "acceptanceCriteria",
                    criteria.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, [key]: value } : item,
                    ),
                  )
                }
                readOnly={readOnly}
                value={stringValue(criterion[key])}
              />
            ))}
          </EditorDisclosure>
        ))}
        {!readOnly ? (
          <button
            className="rq-document-add-item"
            onClick={() =>
              set("acceptanceCriteria", [
                ...criteria,
                {
                  code: `CA-${stringValue(story.code).replace(/^HU-/u, "") || "HU"}-${String(criteria.length + 1).padStart(3, "0")}`,
                  given: PENDING,
                  when: PENDING,
                  then: PENDING,
                  sourceIds: [],
                },
              ])
            }
            type="button"
          >
            Agregar criterio
          </button>
        ) : null}
      </fieldset>
    </div>
  );
}

export function RequirementsEditor({
  value,
  readOnly,
  onChange,
  backlogValue,
}: BusinessEditorProps & {
  backlogValue?: DocumentJsonValue | null;
}) {
  const record = recordValue(value);
  if (!record)
    return (
      <SafeValueEditor
        label="Requerimientos"
        onChange={onChange}
        readOnly={readOnly}
        value={value}
      />
    );
  if (
    "functionalRequirements" in record ||
    "nonFunctionalRequirements" in record
  ) {
    return (
      <RequirementsTabsEditor
        backlogValue={backlogValue}
        onChange={onChange}
        readOnly={readOnly}
        value={record}
      />
    );
  }
  const features = recordList(record.features);
  const stories = recordList(record.userStories);
  const featureOptions = features.map((feature, index) => ({
    value: stringValue(feature.code),
    label: `${displayText(stringValue(feature.code)) || `F-${index + 1}`} · ${displayText(stringValue(feature.title))}`,
  }));
  const storyOptions = stories.map((story, index) => ({
    value: stringValue(story.code),
    label: `${displayText(stringValue(story.code)) || `HU-${index + 1}`} · ${displayText(stringValue(story.title))}`,
  }));
  const update = (key: string, next: DocumentJsonValue) =>
    onChange({ ...record, [key]: next });
  return (
    <div className="rq-document-requirements-editor">
      <EditorHint />
      <div className="rq-requirements-dual-column">
        <section>
          <h3>Funcionalidades ({features.length})</h3>
          <div className="rq-document-disclosure-list">
            {features.map((feature, index) => (
              <EditorDisclosure
                description={stringValue(feature.title)}
                key={stringValue(feature.code) || index}
                meta={featureContextMeta(feature)}
                onDelete={
                  readOnly
                    ? undefined
                    : () =>
                        update(
                          "features",
                          features.filter(
                            (_, itemIndex) => itemIndex !== index,
                          ),
                        )
                }
                title={`Funcionalidad ${displayText(stringValue(feature.code)) || index + 1}`}
              >
                <FeatureEditor
                  feature={feature}
                  onChange={(next) =>
                    update(
                      "features",
                      features.map((item, itemIndex) =>
                        itemIndex === index ? next : item,
                      ),
                    )
                  }
                  readOnly={readOnly}
                  storyOptions={storyOptions}
                />
              </EditorDisclosure>
            ))}
          </div>
          {!readOnly ? (
            <button
              className="rq-document-add-item"
              onClick={() =>
                update("features", [
                  ...features,
                  {
                    code: `F-${String(features.length + 1).padStart(3, "0")}`,
                    title: PENDING,
                    objective: PENDING,
                    description: PENDING,
                    inScope: [],
                    outOfScope: [],
                    userStoryCodes: [],
                    sourceIds: [],
                  },
                ])
              }
              type="button"
            >
              Agregar funcionalidad
            </button>
          ) : null}
        </section>
        <section>
          <h3>Historias de usuario ({stories.length})</h3>
          <div className="rq-document-disclosure-list">
            {stories.map((story, index) => (
              <EditorDisclosure
                description={stringValue(story.title)}
                key={stringValue(story.code) || index}
                meta={storyContextMeta(story)}
                onDelete={
                  readOnly
                    ? undefined
                    : () =>
                        update(
                          "userStories",
                          stories.filter((_, itemIndex) => itemIndex !== index),
                        )
                }
                title={`Historia ${displayText(stringValue(story.code)) || index + 1}`}
              >
                <StoryEditor
                  featureOptions={featureOptions}
                  onChange={(next) =>
                    update(
                      "userStories",
                      stories.map((item, itemIndex) =>
                        itemIndex === index ? next : item,
                      ),
                    )
                  }
                  readOnly={readOnly}
                  story={story}
                />
              </EditorDisclosure>
            ))}
          </div>
          {!readOnly ? (
            <button
              className="rq-document-add-item"
              onClick={() =>
                update("userStories", [
                  ...stories,
                  {
                    code: `HU-${String(stories.length + 1).padStart(3, "0")}`,
                    featureCode: stringValue(features.at(-1)?.code),
                    title: PENDING,
                    role: PENDING,
                    want: PENDING,
                    benefit: PENDING,
                    context: PENDING,
                    premises: [],
                    impactedSystems: [],
                    fields: [],
                    acceptanceCriteria: [],
                    sourceIds: [],
                  },
                ])
              }
              type="button"
            >
              Agregar historia de usuario
            </button>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function FunctionalRequirementsEditor({
  value,
  readOnly,
  onChange,
  backlogValue,
}: {
  value: DocumentJsonValue | undefined;
  readOnly: boolean;
  onChange: (value: DocumentJsonValue) => void;
  backlogValue?: DocumentJsonValue | null;
}) {
  /*
   * PUNTO_6_MILESTONE_EDITOR
   *
   * Punto 6 administra:
   * - Hito: código, nombre, descripción.
   * - HU: título, descripción, COMO, QUIERO, PARA.
   * - contexto, premisas, sistemas y campos.
   * - criterios de aceptación.
   *
   * Punto 7 continúa administrando:
   * - Epic;
   * - Feature;
   * - ubicación estructural de HU;
   * - Tasks y dependencias.
   */
  const stories = recordList(value);

  const groups = functionalMilestoneGroups(value);
  const pending = pendingFunctionalStories(value);
  const confirmedMilestones = confirmedManualMilestoneOptions(backlogValue);
  const integratedRoots = commonEpicMilestoneRoots(value, backlogValue);

  if (stories.length === 0 && integratedRoots.length === 0) {
    return <EmptyValue>Sin historias de usuario funcionales.</EmptyValue>;
  }

  if (stories.length === 0) {
    return (
      <div className="rq-document-requirements-editor rq-requirement-milestones">
        <EditorHint />
        <EmptyValue>
          Hitos confirmados sin HU-F documentadas todavía.
        </EmptyValue>
      </div>
    );
  }

  const updateGroup = (
    group: FunctionalMilestoneGroup,
    changes: JsonRecord,
  ) => {
    const indexes = new Set(group.stories.map(({ index }) => index));

    onChange(
      stories.map((story, index) =>
        indexes.has(index)
          ? {
              ...story,
              ...changes,
            }
          : story,
      ),
    );
  };

  const updateStory = (storyIndex: number, next: JsonRecord) => {
    onChange(
      stories.map((story, index) => (index === storyIndex ? next : story)),
    );
  };

  return (
    <div className="rq-document-requirements-editor rq-requirement-milestones">
      <EditorHint />

      <div className="rq-requirement-milestones__heading">
        <div>
          <strong>6.1 · Hitos y requerimientos funcionales</strong>

          <p>
            Cada Hito agrupa una o varias Historias de Usuario completas. Las HU
            completas sin ubicación segura se muestran al final como pendientes
            por asignar. Epic, Feature y Tasks se administran en el Punto 7 ·
            Esquema.
          </p>
        </div>

        <span>{groups.length} hito(s)</span>
      </div>

      {groups.map((group, groupIndex) => (
        <EditorDisclosure
          description={group.name || "Hito pendiente de definición"}
          key={group.key}
          meta={`${group.stories.length} ` + "Historia(s) de Usuario"}
          title={`Hito ${displayText(group.code) || groupIndex + 1}`}
        >
          <div className="rq-requirement-milestone-editor">
            <div className="rq-document-business-grid">
              <TextField
                label="Código del hito"
                multiline={false}
                onChange={(milestone) => updateGroup(group, { milestone })}
                readOnly={readOnly}
                value={group.code}
              />

              <TextField
                label="Nombre del hito"
                multiline={false}
                onChange={(functionality) =>
                  updateGroup(group, { functionality })
                }
                readOnly={readOnly}
                value={group.name}
              />

              <TextField
                label="Descripción del hito"
                onChange={(milestoneDescription) =>
                  updateGroup(group, {
                    milestoneDescription,
                  })
                }
                readOnly={readOnly}
                value={group.description}
              />
            </div>

            <div className="rq-requirement-milestone-editor__stories">
              <h4>Historias de usuario ({group.stories.length})</h4>

              <div className="rq-document-disclosure-list">
                {group.stories.map(({ story, index }) => (
                  <EditorDisclosure
                    description={stringValue(story.title)}
                    key={stringValue(story.code) || index}
                    meta="HU completa"
                    title={`Historia ${
                      displayText(stringValue(story.code)) || index + 1
                    }`}
                  >
                    <StoryEditor
                      featureOptions={[]}
                      lockStructure
                      onChange={(next) => updateStory(index, next)}
                      readOnly={readOnly}
                      story={story}
                    />
                  </EditorDisclosure>
                ))}
              </div>
            </div>
          </div>
        </EditorDisclosure>
      ))}

      {pending.length > 0 ? (
        <section className="rq-requirement-milestone">
          <div className="rq-requirement-milestones__heading">
            <div>
              <strong>Historias de usuario pendientes por asignar</strong>

              <p>
                Se conservan totalmente documentadas. Solo está pendiente su
                ubicación estructural.
              </p>
            </div>

            <span>{pending.length} HU</span>
          </div>

          <div className="rq-document-disclosure-list">
            {pending.map(({ story, index }) => (
              <EditorDisclosure
                description={stringValue(story.title)}
                key={stringValue(story.code) || index}
                meta="Pendiente por asignar"
                title={
                  `${
                    displayText(stringValue(story.code)) || `HU-${index + 1}`
                  } · ` + displayText(stringValue(story.title))
                }
              >
                <div className="rq-requirement-milestone-editor">
                  <TextField
                    label="Observación de asignación"
                    onChange={(assignmentObservation) =>
                      updateStory(index, {
                        ...story,
                        assignmentObservation,
                      })
                    }
                    readOnly={readOnly}
                    value={stringValue(story.assignmentObservation)}
                  />

                  {!readOnly ? (
                    confirmedMilestones.length > 0 ? (
                      <form
                        className="rq-document-business-grid"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const data = new FormData(event.currentTarget);
                          const milestoneCode = String(
                            data.get("milestoneCode") ?? "",
                          );

                          onChange(
                            assignPendingFunctionalStoryToMilestone(
                              value,
                              backlogValue,
                              stringValue(story.code),
                              milestoneCode,
                            ),
                          );
                        }}
                      >
                        <label className="rq-document-business-field">
                          <span>Asignar a Hito confirmado</span>
                          <select defaultValue="" name="milestoneCode" required>
                            <option disabled value="">
                              Selecciona un Hito
                            </option>
                            {confirmedMilestones.map((milestone) => (
                              <option
                                key={milestone.code}
                                value={milestone.code}
                              >
                                {milestone.code} · {milestone.title}
                              </option>
                            ))}
                          </select>
                        </label>

                        <button className="rq-document-add-item" type="submit">
                          Asignar HU-F
                        </button>
                      </form>
                    ) : (
                      <p className="rq-document-prose">
                        No existe un Hito confirmado disponible. Crea o confirma
                        la Epic/Hito correspondiente en el Punto 7 antes de
                        asignar esta HU-F.
                      </p>
                    )
                  ) : null}

                  {stringList(story.functionalNeedCodes).length > 0 ? (
                    <div>
                      <h4>Trazabilidad funcional</h4>

                      <Tags values={stringList(story.functionalNeedCodes)} />
                    </div>
                  ) : null}

                  <StoryEditor
                    featureOptions={[]}
                    lockStructure
                    onChange={(next) => updateStory(index, next)}
                    readOnly={readOnly}
                    story={story}
                  />
                </div>
              </EditorDisclosure>
            ))}
          </div>
        </section>
      ) : null}

      <p className="rq-document-prose">
        La creación o reorganización estructural de Epic, Feature, HU y Task
        continúa en el Punto 7 · Esquema. El Punto 6 define el contenido
        funcional del Hito y de cada HU. Las HU pendientes permanecen
        documentadas hasta contar con evidencia suficiente para ubicarlas.
      </p>
    </div>
  );
}

function NonFunctionalRequirementsEditor({
  value,
  readOnly,
  onChange,
}: {
  value: DocumentJsonValue | undefined;
  readOnly: boolean;
  onChange: (value: DocumentJsonValue) => void;
}) {
  const requirements = recordList(value);

  if (requirements.length === 0) {
    return (
      <EmptyValue>Sin requerimientos no funcionales registrados.</EmptyValue>
    );
  }

  const updateRequirement = (
    index: number,
    key: string,
    next: DocumentJsonValue,
  ) => {
    onChange(
      requirements.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: next } : item,
      ),
    );
  };

  return (
    <div className="rq-document-requirements-editor">
      <EditorHint />

      <p className="rq-document-prose">
        Los requerimientos no funcionales permanecen separados de las Historias
        de Usuario. Aquí se documentan categoría, medida y objetivo verificable
        sin mezclar Hito o Feature.
      </p>

      <div className="rq-document-disclosure-list">
        {requirements.map((requirement, index) => (
          <EditorDisclosure
            description={stringValue(requirement.title)}
            key={stringValue(requirement.code) || index}
            meta={displayText(stringValue(requirement.category))}
            title={
              displayText(stringValue(requirement.code)) || `RNF ${index + 1}`
            }
          >
            <div className="rq-document-business-grid">
              <TextField
                label="Código"
                multiline={false}
                onChange={() => undefined}
                readOnly
                value={stringValue(requirement.code)}
              />

              <TextField
                label="Título"
                multiline={false}
                onChange={(next) => updateRequirement(index, "title", next)}
                readOnly={readOnly}
                value={stringValue(requirement.title)}
              />

              <TextField
                label="Descripción"
                onChange={(next) =>
                  updateRequirement(index, "description", next)
                }
                readOnly={readOnly}
                value={stringValue(requirement.description)}
              />

              <TextField
                label="Tipo"
                multiline={false}
                onChange={(next) =>
                  updateRequirement(index, "requirementType", next)
                }
                readOnly={readOnly}
                value={stringValue(requirement.requirementType)}
              />

              <TextField
                label="Categoría"
                multiline={false}
                onChange={(next) => updateRequirement(index, "category", next)}
                readOnly={readOnly}
                value={stringValue(requirement.category)}
              />

              <TextField
                label="Medida"
                onChange={(next) => updateRequirement(index, "measure", next)}
                readOnly={readOnly}
                value={stringValue(requirement.measure)}
              />

              <TextField
                label="Objetivo / Meta"
                onChange={(next) => updateRequirement(index, "target", next)}
                readOnly={readOnly}
                value={stringValue(requirement.target)}
              />

              <StringListEditor
                label="Criterios de aceptación"
                onChange={(next) =>
                  updateRequirement(index, "acceptanceCriteria", next)
                }
                readOnly={readOnly}
                value={stringList(requirement.acceptanceCriteria)}
              />
            </div>
          </EditorDisclosure>
        ))}
      </div>
    </div>
  );
}

function RequirementsTabsEditor({
  value,
  readOnly,
  onChange,
  backlogValue,
}: BusinessEditorProps & {
  backlogValue?: DocumentJsonValue | null;
}) {
  const [active, setActive] = useState<RequirementsTab>("functional");

  const record = recordValue(value) ?? {
    functionalRequirements: [],
    nonFunctionalRequirements: [],
  };

  return (
    <div className="rq-document-requirements-tabs-editor">
      <RequirementsTabList active={active} onChange={setActive} />

      <section
        aria-labelledby={`requirements-tab-${active}`}
        id={`requirements-panel-${active}`}
        role="tabpanel"
      >
        {active === "functional" ? (
          <>
            <FunctionalRequirementsEditor
              backlogValue={backlogValue}
              onChange={(next) =>
                onChange({
                  ...record,
                  functionalRequirements: next,
                })
              }
              readOnly={readOnly}
              value={record.functionalRequirements}
            />

            <PendingFunctionalNeedsView value={record.pendingFunctionalNeeds} />
          </>
        ) : (
          <NonFunctionalRequirementsEditor
            onChange={(next) =>
              onChange({
                ...record,
                nonFunctionalRequirements: next,
              })
            }
            readOnly={readOnly}
            value={record.nonFunctionalRequirements ?? []}
          />
        )}
      </section>
    </div>
  );
}
