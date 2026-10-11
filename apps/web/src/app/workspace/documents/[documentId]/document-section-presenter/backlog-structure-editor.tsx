import React from "react";
import { nextBacklogCode } from "./backlog-planning-model";
import { backlogCounts, BacklogOverview } from "./backlog-structure-view";
import { PendingPlanningAssignmentsEditor } from "./pending-planning-assignments-editor";
import {
  TextField,
  EditorDisclosure,
  EditorHint,
  ReferenceListEditor,
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

/*
 * PUNTO_7_CANONICAL_EDITOR
 *
 * Propiedad funcional:
 *
 * Punto 6:
 * - COMO
 * - QUIERO
 * - PARA
 * - contexto
 * - premisas
 * - sistemas
 * - campos
 * - criterios
 *
 * Punto 7:
 * - Epic
 * - Feature
 * - ubicación de HU
 * - identidad/título HU
 * - Task
 * - dependencias
 *
 * Los códigos existentes quedan bloqueados porque son
 * referencias canónicas usadas por Pruebas y Scrum.
 */
export function BacklogStructureEditor({
  value,
  readOnly,
  onChange,
}: BusinessEditorProps) {
  const root = recordValue(value) ?? { epics: [] };

  const epics = recordList(root.epics);

  const { features, stories, tasks } = backlogCounts(epics);

  const updateEpics = (next: JsonRecord[]) =>
    onChange({
      ...root,
      epics: next,
    });

  const updateEpic = (epicIndex: number, changes: JsonRecord) =>
    updateEpics(
      epics.map((epic, index) =>
        index === epicIndex ? { ...epic, ...changes } : epic,
      ),
    );

  const updateFeature = (
    epicIndex: number,
    featureIndex: number,
    changes: JsonRecord,
  ) => {
    const epic = epics[epicIndex];

    if (!epic) return;

    const currentFeatures = recordList(epic.features);

    updateEpic(epicIndex, {
      features: currentFeatures.map((feature, index) =>
        index === featureIndex
          ? {
              ...feature,
              ...changes,
            }
          : feature,
      ),
    });
  };

  const updateStory = (
    epicIndex: number,
    featureIndex: number,
    storyIndex: number,
    changes: JsonRecord,
  ) => {
    const epic = epics[epicIndex];

    if (!epic) return;

    const feature = recordList(epic.features)[featureIndex];

    if (!feature) return;

    const currentStories = recordList(feature.userStories);

    updateFeature(epicIndex, featureIndex, {
      userStories: currentStories.map((story, index) =>
        index === storyIndex
          ? {
              ...story,
              ...changes,
            }
          : story,
      ),
    });
  };

  const updateTask = (
    epicIndex: number,
    featureIndex: number,
    storyIndex: number,
    taskIndex: number,
    changes: JsonRecord,
  ) => {
    const epic = epics[epicIndex];

    if (!epic) return;

    const feature = recordList(epic.features)[featureIndex];

    if (!feature) return;

    const story = recordList(feature.userStories)[storyIndex];

    if (!story) return;

    const currentTasks = recordList(story.tasks);

    updateStory(epicIndex, featureIndex, storyIndex, {
      tasks: currentTasks.map((task, index) =>
        index === taskIndex
          ? {
              ...task,
              ...changes,
            }
          : task,
      ),
    });
  };

  const epicOptions = epics.map((epic, index) => ({
    value: stringValue(epic.code),
    label:
      `${displayText(stringValue(epic.code)) || `EP-${index + 1}`} · ` +
      displayText(stringValue(epic.title)),
  }));

  const featureOptions = features.map((feature, index) => ({
    value: stringValue(feature.code),
    label:
      `${displayText(stringValue(feature.code)) || `FE-${index + 1}`} · ` +
      displayText(stringValue(feature.title)),
  }));

  const taskOptions = tasks.map((task, index) => ({
    value: stringValue(task.code),
    label:
      `${displayText(stringValue(task.code)) || `T-${index + 1}`} · ` +
      displayText(stringValue(task.title)),
  }));

  const moveFeature = (featureCode: string, targetEpicCode: string) => {
    const moving = features.find(
      (feature) => stringValue(feature.code) === featureCode,
    );

    if (!moving) return;

    updateEpics(
      epics.map((epic) => {
        const currentFeatures = recordList(epic.features).filter(
          (feature) => stringValue(feature.code) !== featureCode,
        );

        if (stringValue(epic.code) !== targetEpicCode) {
          return {
            ...epic,
            features: currentFeatures,
          };
        }

        return {
          ...epic,
          features: [...currentFeatures, moving],
        };
      }),
    );
  };

  const moveStory = (storyCode: string, targetFeatureCode: string) => {
    const moving = stories.find(
      (story) => stringValue(story.code) === storyCode,
    );

    if (!moving) return;

    updateEpics(
      epics.map((epic) => ({
        ...epic,

        features: recordList(epic.features).map((feature) => {
          const currentStories = recordList(feature.userStories).filter(
            (story) => stringValue(story.code) !== storyCode,
          );

          if (stringValue(feature.code) !== targetFeatureCode) {
            return {
              ...feature,
              userStories: currentStories,
            };
          }

          return {
            ...feature,

            userStories: [
              ...currentStories,
              {
                ...moving,
                featureCode: targetFeatureCode,
              },
            ],
          };
        }),
      })),
    );
  };

  return (
    <div className="rq-backlog-editor">
      <EditorHint />

      <BacklogOverview epics={epics} />

      <div className="rq-backlog-purpose">
        <strong>Administración estructural</strong>

        <p>
          Organiza Epic → Feature → HU → Task. Los códigos existentes no se
          editan para proteger referencias. El detalle funcional de la HU se
          mantiene en el Punto 6.
        </p>
      </div>

      <div className="rq-backlog-tree">
        {epics.map((epic, epicIndex) => {
          const currentFeatures = recordList(epic.features);

          const epicStoryCount = currentFeatures.flatMap((feature) =>
            recordList(feature.userStories),
          ).length;

          return (
            <EditorDisclosure
              description={stringValue(epic.title)}
              key={stringValue(epic.code) || epicIndex}
              meta={
                `${currentFeatures.length} Feature · ` + `${epicStoryCount} HU`
              }
              leadingIcon="epic"
              title={
                `${stringValue(epic.sourceNumber).trim() ? `${displayText(stringValue(epic.sourceNumber))} · ` : ""}Epic ` +
                (displayText(stringValue(epic.code)) || epicIndex + 1)
              }
            >
              <div className="rq-document-business-grid">
                <TextField
                  label="Código"
                  multiline={false}
                  onChange={() => undefined}
                  readOnly
                  value={stringValue(epic.code)}
                />

                <TextField
                  label="Número de origen"
                  multiline={false}
                  onChange={(sourceNumber) =>
                    updateEpic(epicIndex, { sourceNumber })
                  }
                  readOnly={readOnly}
                  value={stringValue(epic.sourceNumber)}
                />

                <TextField
                  label="Nombre"
                  multiline={false}
                  onChange={(title) => updateEpic(epicIndex, { title })}
                  readOnly={readOnly}
                  value={stringValue(epic.title)}
                />

                <TextField
                  label="Descripción"
                  onChange={(description) =>
                    updateEpic(epicIndex, { description })
                  }
                  readOnly={readOnly}
                  value={stringValue(epic.description)}
                />
              </div>

              <fieldset className="rq-document-business-list rq-backlog-level-editor">
                <legend>Features ({currentFeatures.length})</legend>

                {currentFeatures.map((feature, featureIndex) => {
                  const currentStories = recordList(feature.userStories);

                  return (
                    <EditorDisclosure
                      description={stringValue(feature.title)}
                      key={stringValue(feature.code) || featureIndex}
                      meta={`${currentStories.length} HU`}
                      leadingIcon="feature"
                      title={
                        `${stringValue(feature.sourceNumber).trim() ? `${displayText(stringValue(feature.sourceNumber))} · ` : ""}Feature ` +
                        (displayText(stringValue(feature.code)) ||
                          featureIndex + 1)
                      }
                    >
                      <div className="rq-document-business-grid">
                        <TextField
                          label="Código"
                          multiline={false}
                          onChange={() => undefined}
                          readOnly
                          value={stringValue(feature.code)}
                        />

                        <TextField
                          label="Número de origen"
                          multiline={false}
                          onChange={(sourceNumber) =>
                            updateFeature(epicIndex, featureIndex, {
                              sourceNumber,
                            })
                          }
                          readOnly={readOnly}
                          value={stringValue(feature.sourceNumber)}
                        />

                        <TextField
                          label="Nombre"
                          multiline={false}
                          onChange={(title) =>
                            updateFeature(epicIndex, featureIndex, {
                              title,
                            })
                          }
                          readOnly={readOnly}
                          value={stringValue(feature.title)}
                        />

                        <TextField
                          label="Descripción"
                          onChange={(description) =>
                            updateFeature(epicIndex, featureIndex, {
                              description,
                            })
                          }
                          readOnly={readOnly}
                          value={stringValue(feature.description)}
                        />

                        <label className="rq-document-business-field">
                          <span>Epic padre</span>

                          <select
                            disabled={readOnly}
                            onChange={(event) => {
                              const next = event.target.value;

                              if (next && next !== stringValue(epic.code)) {
                                moveFeature(stringValue(feature.code), next);
                              }
                            }}
                            value={stringValue(epic.code)}
                          >
                            {epicOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <fieldset className="rq-document-business-list rq-backlog-level-editor">
                        <legend>
                          Historias de usuario ({currentStories.length})
                        </legend>

                        {currentStories.map((story, storyIndex) => {
                          const currentTasks = recordList(story.tasks);

                          return (
                            <EditorDisclosure
                              description={stringValue(story.title)}
                              key={stringValue(story.code) || storyIndex}
                              meta={`${currentTasks.length} Task`}
                              leadingIcon="product-backlog-item"
                              title={
                                `${stringValue(story.sourceNumber).trim() ? `${displayText(stringValue(story.sourceNumber))} · ` : ""}HU ` +
                                (displayText(stringValue(story.code)) ||
                                  storyIndex + 1)
                              }
                            >
                              <div className="rq-document-business-grid">
                                <TextField
                                  label="Código"
                                  multiline={false}
                                  onChange={() => undefined}
                                  readOnly
                                  value={stringValue(story.code)}
                                />

                                <TextField
                                  label="Número de origen"
                                  multiline={false}
                                  onChange={(sourceNumber) =>
                                    updateStory(
                                      epicIndex,
                                      featureIndex,
                                      storyIndex,
                                      { sourceNumber },
                                    )
                                  }
                                  readOnly={readOnly}
                                  value={stringValue(story.sourceNumber)}
                                />

                                <TextField
                                  label="Título"
                                  multiline={false}
                                  onChange={(title) =>
                                    updateStory(
                                      epicIndex,
                                      featureIndex,
                                      storyIndex,
                                      {
                                        title,
                                      },
                                    )
                                  }
                                  readOnly={readOnly}
                                  value={stringValue(story.title)}
                                />

                                <TextField
                                  label="Descripción estructural"
                                  onChange={(description) =>
                                    updateStory(
                                      epicIndex,
                                      featureIndex,
                                      storyIndex,
                                      {
                                        description,
                                      },
                                    )
                                  }
                                  readOnly={readOnly}
                                  value={stringValue(story.description)}
                                />

                                <label className="rq-document-business-field">
                                  <span>Feature padre</span>

                                  <select
                                    disabled={readOnly}
                                    onChange={(event) => {
                                      const next = event.target.value;

                                      if (
                                        next &&
                                        next !== stringValue(feature.code)
                                      ) {
                                        moveStory(
                                          stringValue(story.code),
                                          next,
                                        );
                                      }
                                    }}
                                    value={stringValue(feature.code)}
                                  >
                                    {featureOptions.map((option) => (
                                      <option
                                        key={option.value}
                                        value={option.value}
                                      >
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              </div>

                              <fieldset className="rq-document-business-list rq-backlog-task-editor">
                                <legend>Tareas ({currentTasks.length})</legend>

                                {currentTasks.map((task, taskIndex) => (
                                  <EditorDisclosure
                                    description={stringValue(task.title)}
                                    key={stringValue(task.code) || taskIndex}
                                    meta={displayText(stringValue(task.type))}
                                    leadingIcon="task"
                                    title={
                                      `${stringValue(task.sourceNumber).trim() ? `${displayText(stringValue(task.sourceNumber))} · ` : ""}Task ` +
                                      (displayText(stringValue(task.code)) ||
                                        taskIndex + 1)
                                    }
                                  >
                                    <div className="rq-document-business-grid">
                                      <TextField
                                        label="Código"
                                        multiline={false}
                                        onChange={() => undefined}
                                        readOnly
                                        value={stringValue(task.code)}
                                      />

                                      <TextField
                                        label="Número de origen"
                                        multiline={false}
                                        onChange={(sourceNumber) =>
                                          updateTask(
                                            epicIndex,
                                            featureIndex,
                                            storyIndex,
                                            taskIndex,
                                            {
                                              sourceNumber,
                                              origin: sourceNumber.trim()
                                                ? "EVIDENCE"
                                                : task.origin,
                                            },
                                          )
                                        }
                                        readOnly={readOnly}
                                        value={stringValue(task.sourceNumber)}
                                      />

                                      <TextField
                                        label="Título"
                                        multiline={false}
                                        onChange={(title) =>
                                          updateTask(
                                            epicIndex,
                                            featureIndex,
                                            storyIndex,
                                            taskIndex,
                                            {
                                              title,
                                            },
                                          )
                                        }
                                        readOnly={readOnly}
                                        value={stringValue(task.title)}
                                      />

                                      <TextField
                                        label="Descripción"
                                        onChange={(description) =>
                                          updateTask(
                                            epicIndex,
                                            featureIndex,
                                            storyIndex,
                                            taskIndex,
                                            {
                                              description,
                                            },
                                          )
                                        }
                                        readOnly={readOnly}
                                        value={stringValue(task.description)}
                                      />

                                      <label className="rq-document-business-field">
                                        <span>Tipo</span>

                                        <select
                                          disabled={readOnly}
                                          onChange={(event) =>
                                            updateTask(
                                              epicIndex,
                                              featureIndex,
                                              storyIndex,
                                              taskIndex,
                                              {
                                                type: event.target.value,
                                              },
                                            )
                                          }
                                          value={stringValue(task.type)}
                                        >
                                          {[
                                            ["ANALYSIS", "Análisis"],
                                            ["DESIGN", "Diseño"],
                                            ["DEVELOPMENT", "Desarrollo"],
                                            ["CONFIGURATION", "Configuración"],
                                            ["INTEGRATION", "Integración"],
                                            ["DATA", "Datos"],
                                            ["TESTING", "Pruebas"],
                                            ["UAT", "Pruebas de usuario"],
                                            ["DOCUMENTATION", "Documentación"],
                                            ["DEPLOYMENT", "Despliegue"],
                                          ].map(([code, label]) => (
                                            <option key={code} value={code}>
                                              {label}
                                            </option>
                                          ))}
                                        </select>
                                      </label>

                                      <label className="rq-document-business-field">
                                        <span>Origen</span>

                                        <select
                                          disabled={readOnly}
                                          onChange={(event) =>
                                            updateTask(
                                              epicIndex,
                                              featureIndex,
                                              storyIndex,
                                              taskIndex,
                                              {
                                                origin: event.target.value,
                                              },
                                            )
                                          }
                                          value={stringValue(task.origin)}
                                        >
                                          <option value="EVIDENCE">
                                            Evidencia
                                          </option>

                                          <option value="IMPLEMENTATION_PROPOSAL">
                                            Propuesta de implementación
                                          </option>
                                        </select>
                                      </label>

                                      <ReferenceListEditor
                                        label="Dependencias"
                                        onChange={(dependencyCodes) =>
                                          updateTask(
                                            epicIndex,
                                            featureIndex,
                                            storyIndex,
                                            taskIndex,
                                            {
                                              dependencyCodes,
                                            },
                                          )
                                        }
                                        options={taskOptions.filter(
                                          (option) =>
                                            option.value !==
                                            stringValue(task.code),
                                        )}
                                        readOnly={readOnly}
                                        value={stringList(task.dependencyCodes)}
                                      />
                                    </div>
                                  </EditorDisclosure>
                                ))}

                                {!readOnly ? (
                                  <button
                                    className="rq-document-add-item"
                                    onClick={() => {
                                      const code = nextBacklogCode(tasks, "T");

                                      updateStory(
                                        epicIndex,
                                        featureIndex,
                                        storyIndex,
                                        {
                                          tasks: [
                                            ...currentTasks,
                                            {
                                              code,
                                              title: PENDING,
                                              description: PENDING,
                                              type: "ANALYSIS",
                                              origin: "IMPLEMENTATION_PROPOSAL",
                                              dependencyCodes: [],
                                              sourceIds: [],
                                            },
                                          ],
                                        },
                                      );
                                    }}
                                    type="button"
                                  >
                                    Agregar Task
                                  </button>
                                ) : null}
                              </fieldset>
                            </EditorDisclosure>
                          );
                        })}

                        {!readOnly ? (
                          <button
                            className="rq-document-add-item"
                            onClick={() => {
                              const code = nextBacklogCode(stories, "HU");

                              const criterionCode = `CA-${code}-001`;

                              updateFeature(epicIndex, featureIndex, {
                                userStories: [
                                  ...currentStories,
                                  {
                                    code,
                                    featureCode: stringValue(feature.code),
                                    title: PENDING,
                                    description: PENDING,
                                    role: PENDING,
                                    want: PENDING,
                                    benefit: PENDING,
                                    context: PENDING,
                                    premises: [],
                                    impactedSystems: [],
                                    fields: [],
                                    acceptanceCriteria: [
                                      {
                                        code: criterionCode,
                                        given: PENDING,
                                        when: PENDING,
                                        then: PENDING,
                                        sourceIds: [],
                                      },
                                    ],
                                    sourceIds: [],
                                    tasks: [],
                                  },
                                ],
                              });
                            }}
                            type="button"
                          >
                            Agregar Historia de Usuario
                          </button>
                        ) : null}
                      </fieldset>
                    </EditorDisclosure>
                  );
                })}

                {!readOnly ? (
                  <button
                    className="rq-document-add-item"
                    onClick={() => {
                      const code = nextBacklogCode(features, "FE");

                      updateEpic(epicIndex, {
                        features: [
                          ...currentFeatures,
                          {
                            code,
                            title: PENDING,
                            description: PENDING,
                            sourceIds: [],
                            userStories: [],
                          },
                        ],
                      });
                    }}
                    type="button"
                  >
                    Agregar Feature
                  </button>
                ) : null}
              </fieldset>
            </EditorDisclosure>
          );
        })}
      </div>

      {!readOnly ? (
        <button
          className="rq-document-add-item rq-backlog-add-epic"
          onClick={() => {
            const code = nextBacklogCode(epics, "EP");

            updateEpics([
              ...epics,
              {
                code,
                title: PENDING,
                description: PENDING,
                sourceIds: [],
                features: [],
              },
            ]);
          }}
          type="button"
        >
          Agregar Epic
        </button>
      ) : null}

      <PendingPlanningAssignmentsEditor
        onChange={onChange}
        readOnly={readOnly}
        value={value}
      />

      <p className="rq-document-prose">
        La eliminación estructural no se habilita desde este editor para evitar
        romper referencias existentes en Pruebas, Scrum o trazabilidad.
      </p>
    </div>
  );
}
