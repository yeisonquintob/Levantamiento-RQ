import React from "react";
import { type DocumentJsonValue } from "@levantamiento-rq/shared-contracts";
import { formatColombianCalendarDate } from "../colombian-business-calendar";
import {
  EmptyValue,
  TextList,
  Tags,
  HumanValue,
  TextField,
  EditorDisclosure,
  EditorHint,
  StringListEditor,
  ReferenceListEditor,
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
  numberValue,
  humanLabel,
  displayText,
} from "./shared";

function TasksTable({ value }: { value: DocumentJsonValue | undefined }) {
  const tasks = recordList(value);
  if (tasks.length === 0) return <EmptyValue>Sin tareas definidas.</EmptyValue>;
  return (
    <div className="rq-document-responsive-table">
      <table>
        <thead>
          <tr>
            <th scope="col">Código</th>
            <th scope="col">Tipo</th>
            <th scope="col">Tarea</th>
            <th scope="col">HU</th>
            <th scope="col">Rol</th>
            <th scope="col">Programación</th>
            <th scope="col">Depende de</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task, index) => (
            <tr key={stringValue(task.code) || index}>
              <td data-label="Código">{displayText(stringValue(task.code))}</td>
              <td data-label="Tipo">{displayText(stringValue(task.type))}</td>
              <td data-label="Tarea">
                {displayText(stringValue(task.description))}
              </td>
              <td data-label="HU">
                {displayText(stringValue(task.userStoryCode))}
              </td>
              <td data-label="Rol">
                {displayText(stringValue(task.suggestedRole))}
              </td>
              <td data-label="Programación">
                {numberValue(task.startDay) !== null &&
                numberValue(task.endDay) !== null ? (
                  <span>
                    {stringValue(task.startDate) && stringValue(task.endDate)
                      ? `${formatColombianCalendarDate(stringValue(task.startDate))} al ${formatColombianCalendarDate(stringValue(task.endDate))}`
                      : `Día ${numberValue(task.startDay)} al Día ${numberValue(task.endDay)}`}
                    {numberValue(task.estimatedDurationDays) !== null
                      ? ` · ${numberValue(task.estimatedDurationDays)} día(s)`
                      : ""}
                  </span>
                ) : (
                  "-"
                )}
              </td>
              <td data-label="Depende de">
                {stringList(task.dependencyCodes).join(", ") || "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ScrumView({ value }: { value: DocumentJsonValue }) {
  const plan = recordValue(value);
  if (!plan) return <HumanValue value={value} />;
  const sprints = recordList(plan.sprints);
  const usesColombianBusinessCalendar =
    plan.calendarMode === "COLOMBIA_BUSINESS_DAYS";
  const selectedStartDate = stringValue(plan.confirmedStartDate);
  const operationalStartDate = stringValue(sprints[0]?.startDate);
  return (
    <div className="rq-document-scrum-view">
      <div className="rq-document-cadence">
        <span>Cadencia</span>
        <strong>
          {numberValue(plan.cadenceDays) ?? 15}{" "}
          {usesColombianBusinessCalendar
            ? "días hábiles · calendario Colombia"
            : "días calendario"}
        </strong>
      </div>
      {plan.scheduleBasis === "CONFIRMED_DATE" && plan.confirmedStartDate ? (
        <p>
          Fecha de inicio confirmada:{" "}
          <strong>
            {usesColombianBusinessCalendar
              ? formatColombianCalendarDate(
                  stringValue(plan.confirmedStartDate),
                )
              : stringValue(plan.confirmedStartDate)}
          </strong>
          {usesColombianBusinessCalendar
            ? " · Se excluyen sábados, domingos y festivos nacionales."
            : ""}
          {usesColombianBusinessCalendar &&
          operationalStartDate &&
          operationalStartDate !== selectedStartDate
            ? ` Inicio operativo ajustado al ${formatColombianCalendarDate(operationalStartDate)}.`
            : ""}
        </p>
      ) : null}
      <div className="rq-document-sprint-timeline">
        {sprints.map((sprint, index) => {
          const number = numberValue(sprint.number) ?? index + 1;
          const startDate = stringValue(sprint.startDate);
          const endDate = stringValue(sprint.endDate);
          const period =
            usesColombianBusinessCalendar && startDate && endDate
              ? `${formatColombianCalendarDate(startDate)} al ${formatColombianCalendarDate(endDate)}`
              : stringValue(sprint.period) ||
                `Día ${(number - 1) * 15 + 1} al Día ${number * 15}`;
          const excludedDates = recordList(sprint.calendarExcludedDates);
          return (
            <EditorDisclosure
              description={stringValue(sprint.objective)}
              key={`${stringValue(sprint.code)}-${index}`}
              meta={`${recordList(sprint.tasks).length} tareas · ${stringList(sprint.testCodes).length} pruebas`}
              title={`Sprint ${number} · ${period}`}
            >
              <div className="rq-document-detail-panel">
                <h4>Objetivo</h4>
                <HumanValue value={sprint.objective ?? ""} />
                {usesColombianBusinessCalendar ? (
                  <>
                    <h4>Calendario laboral colombiano</h4>
                    <p>
                      {excludedDates.length > 0
                        ? `${excludedDates.length} día(s) no laborable(s) excluido(s): ${excludedDates
                            .map((day) => {
                              const date = stringValue(day.date);
                              const reason = stringValue(day.reason);
                              return date
                                ? `${formatColombianCalendarDate(date)} (${reason})`
                                : reason;
                            })
                            .join(", ")}.`
                        : "El periodo no contiene días no laborables nacionales."}
                    </p>
                  </>
                ) : null}
                <h4>Funcionalidades</h4>
                <Tags values={stringList(sprint.featureCodes)} />
                <h4>Historias de usuario</h4>
                <Tags values={stringList(sprint.userStoryCodes)} />
                <h4>Tareas</h4>
                <TasksTable value={sprint.tasks} />
                <h4>Dependencias</h4>
                <TextList
                  empty="Sin dependencias previas."
                  items={stringList(sprint.dependencies)}
                />
                <h4>Pruebas</h4>
                <Tags values={stringList(sprint.testCodes)} />
                <h4>Entregables</h4>
                <TextList items={stringList(sprint.deliverables)} />
                <h4>Criterio de cierre</h4>
                <HumanValue value={sprint.closingCriterion ?? ""} />
              </div>
            </EditorDisclosure>
          );
        })}
      </div>
    </div>
  );
}

export function ScrumEditor({
  value,
  readOnly,
  onChange,
}: BusinessEditorProps) {
  const plan = recordValue(value);
  if (!plan)
    return (
      <SafeValueEditor
        label="Plan de trabajo"
        onChange={onChange}
        readOnly={readOnly}
        value={value}
      />
    );
  const sprints = recordList(plan.sprints);
  const allTasks = sprints.flatMap((sprint) => recordList(sprint.tasks));
  const nextTaskNumber =
    allTasks.reduce((maximum, task) => {
      const match = stringValue(task.code).match(/(\d+)$/);
      return Math.max(maximum, match ? Number(match[1]) : 0);
    }, 0) + 1;
  const updatePlan = (changes: JsonRecord) => onChange({ ...plan, ...changes });
  const updateSprint = (index: number, changes: JsonRecord) =>
    updatePlan({
      sprints: sprints.map((sprint, itemIndex) =>
        itemIndex === index ? { ...sprint, ...changes } : sprint,
      ),
    });
  return (
    <div className="rq-document-scrum-editor">
      <EditorHint />
      <div className="rq-document-cadence">
        <span>Cadencia</span>
        <strong>
          {numberValue(plan.cadenceDays) ?? 15}{" "}
          {plan.calendarMode === "COLOMBIA_BUSINESS_DAYS"
            ? "días hábiles · calendario Colombia"
            : "días calendario"}
        </strong>
      </div>
      {plan.scheduleBasis === "CONFIRMED_DATE" ? (
        <p className="rq-document-calendar-note">
          La fecha y los periodos se administran desde el calendario ubicado
          junto al botón Editar sección.
        </p>
      ) : null}
      <div className="rq-document-editor-collection-heading">
        <h3>Sprints sugeridos</h3>
        <span>{sprints.length} registro(s)</span>
      </div>
      <div className="rq-document-disclosure-list">
        {sprints.map((sprint, index) => {
          const number = numberValue(sprint.number) ?? index + 1;
          const tasks = recordList(sprint.tasks);
          const taskOptions = allTasks.map((task, taskIndex) => ({
            value: stringValue(task.code),
            label: `${displayText(stringValue(task.code)) || `T-${taskIndex + 1}`} · ${displayText(stringValue(task.description))}`,
          }));
          const storyOptions = stringList(sprint.userStoryCodes).map(
            (code) => ({
              value: code,
              label: code,
            }),
          );
          return (
            <EditorDisclosure
              description={stringValue(sprint.objective)}
              key={`${stringValue(sprint.code)}-${index}`}
              meta={
                stringValue(sprint.period) ||
                `Día ${(number - 1) * 15 + 1} al Día ${number * 15}`
              }
              title={`Sprint ${number}`}
            >
              <TextField
                label="Objetivo"
                onChange={(objective) => updateSprint(index, { objective })}
                readOnly={readOnly}
                value={stringValue(sprint.objective)}
              />
              <StringListEditor
                label="Funcionalidades"
                onChange={(featureCodes) =>
                  updateSprint(index, { featureCodes })
                }
                readOnly={readOnly}
                value={stringList(sprint.featureCodes)}
              />
              <StringListEditor
                label="Historias de usuario"
                onChange={(userStoryCodes) =>
                  updateSprint(index, { userStoryCodes })
                }
                readOnly={readOnly}
                value={stringList(sprint.userStoryCodes)}
              />
              <fieldset className="rq-document-business-list">
                <legend>Tareas ({tasks.length})</legend>
                {tasks.map((task, taskIndex) => (
                  <EditorDisclosure
                    description={stringValue(task.description)}
                    key={stringValue(task.code) || taskIndex}
                    meta={displayText(stringValue(task.type))}
                    onDelete={
                      readOnly
                        ? undefined
                        : () =>
                            updateSprint(index, {
                              tasks: tasks.filter(
                                (_, itemIndex) => itemIndex !== taskIndex,
                              ),
                            })
                    }
                    title={`Tarea ${stringValue(task.code) || taskIndex + 1}`}
                  >
                    {[
                      "code",
                      "description",
                      "suggestedRole",
                      "expectedResult",
                    ].map((key) => (
                      <TextField
                        key={key}
                        label={humanLabel(key)}
                        multiline={
                          !["code", "userStoryCode", "suggestedRole"].includes(
                            key,
                          )
                        }
                        onChange={(next) =>
                          updateSprint(index, {
                            tasks: tasks.map((item, itemIndex) =>
                              itemIndex === taskIndex
                                ? { ...item, [key]: next }
                                : item,
                            ),
                          })
                        }
                        readOnly={readOnly}
                        value={stringValue(task[key])}
                      />
                    ))}
                    <div className="rq-document-task-schedule-editor">
                      {(
                        [
                          [
                            "estimatedDurationDays",
                            "Duración estimada (días)",
                            15,
                          ],
                          ["startDay", "Día de inicio", 1_500],
                          ["endDay", "Día de finalización", 1_500],
                        ] as const
                      ).map(([key, label, maximum]) => (
                        <label className="rq-document-business-field" key={key}>
                          <span>{label}</span>
                          <input
                            disabled={readOnly}
                            max={maximum}
                            min={1}
                            onChange={(event) =>
                              updateSprint(index, {
                                tasks: tasks.map((item, itemIndex) =>
                                  itemIndex === taskIndex
                                    ? {
                                        ...item,
                                        [key]: event.target.value
                                          ? Number(event.target.value)
                                          : null,
                                      }
                                    : item,
                                ),
                              })
                            }
                            type="number"
                            value={numberValue(task[key]) ?? ""}
                          />
                        </label>
                      ))}
                    </div>
                    <label className="rq-document-business-field">
                      <span>Historia relacionada</span>
                      <select
                        disabled={readOnly}
                        onChange={(event) =>
                          updateSprint(index, {
                            tasks: tasks.map((item, itemIndex) =>
                              itemIndex === taskIndex
                                ? {
                                    ...item,
                                    userStoryCode: event.target.value,
                                  }
                                : item,
                            ),
                          })
                        }
                        value={stringValue(task.userStoryCode)}
                      >
                        <option value="">Seleccionar…</option>
                        {storyOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="rq-document-business-field">
                      <span>Tipo</span>
                      <select
                        disabled={readOnly}
                        onChange={(event) =>
                          updateSprint(index, {
                            tasks: tasks.map((item, itemIndex) =>
                              itemIndex === taskIndex
                                ? { ...item, type: event.target.value }
                                : item,
                            ),
                          })
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
                    <ReferenceListEditor
                      label="Dependencias"
                      onChange={(dependencyCodes) =>
                        updateSprint(index, {
                          tasks: tasks.map((item, itemIndex) =>
                            itemIndex === taskIndex
                              ? { ...item, dependencyCodes }
                              : item,
                          ),
                        })
                      }
                      options={taskOptions.filter(
                        (option) => option.value !== stringValue(task.code),
                      )}
                      readOnly={readOnly}
                      value={stringList(task.dependencyCodes)}
                    />
                  </EditorDisclosure>
                ))}
                {!readOnly ? (
                  <button
                    className="rq-document-add-item"
                    onClick={() =>
                      updateSprint(index, {
                        tasks: [
                          ...tasks,
                          {
                            code: `T-${String(nextTaskNumber).padStart(3, "0")}`,
                            description: PENDING,
                            userStoryCode: storyOptions[0]?.value ?? "",
                            suggestedRole: PENDING,
                            expectedResult: PENDING,
                            type: "ANALYSIS",
                            dependencyCodes: [],
                            estimatedDurationDays: 1,
                            startDay: Math.min(
                              (numberValue(sprint.startDay) ??
                                (number - 1) * 15 + 1) + tasks.length,
                              numberValue(sprint.endDay) ?? number * 15,
                            ),
                            endDay: Math.min(
                              (numberValue(sprint.startDay) ??
                                (number - 1) * 15 + 1) + tasks.length,
                              numberValue(sprint.endDay) ?? number * 15,
                            ),
                            sourceIds: [],
                          },
                        ],
                      })
                    }
                    type="button"
                  >
                    Agregar tarea
                  </button>
                ) : null}
              </fieldset>
              <StringListEditor
                emptyLabel="Sin dependencias previas."
                label="Dependencias del Sprint"
                onChange={(dependencies) =>
                  updateSprint(index, { dependencies })
                }
                readOnly={readOnly}
                value={stringList(sprint.dependencies)}
              />
              <StringListEditor
                label="Pruebas"
                onChange={(testCodes) => updateSprint(index, { testCodes })}
                readOnly={readOnly}
                value={stringList(sprint.testCodes)}
              />
              <StringListEditor
                label="Entregables"
                onChange={(deliverables) =>
                  updateSprint(index, { deliverables })
                }
                readOnly={readOnly}
                value={stringList(sprint.deliverables)}
              />
              <TextField
                label="Criterio de cierre"
                onChange={(closingCriterion) =>
                  updateSprint(index, { closingCriterion })
                }
                readOnly={readOnly}
                value={stringValue(sprint.closingCriterion)}
              />
              <StringListEditor
                label="Riesgos"
                onChange={(risks) => updateSprint(index, { risks })}
                readOnly={readOnly}
                value={stringList(sprint.risks)}
              />
            </EditorDisclosure>
          );
        })}
      </div>
    </div>
  );
}
