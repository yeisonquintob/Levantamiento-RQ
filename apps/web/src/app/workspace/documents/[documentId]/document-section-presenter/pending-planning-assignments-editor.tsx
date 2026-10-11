import React from "react";
import {
  type PendingPlanningAssignmentKind,
  planningPendingRecord,
  assignPendingPlanningItem,
  createParentForPendingPlanningItem,
} from "./backlog-planning-model";
import {
  HumanValue,
  EditorDisclosure,
  type BusinessEditorProps,
} from "./primitives";
import { recordValue, recordList, stringValue, displayText } from "./shared";

export function PendingPlanningAssignmentsEditor({
  value,
  readOnly,
  onChange,
}: BusinessEditorProps) {
  const root = recordValue(value) ?? { epics: [] };
  const pending = planningPendingRecord(root);
  const epics = recordList(root.epics);
  const features = epics.flatMap((epic) => recordList(epic.features));
  const stories = features.flatMap((feature) =>
    recordList(feature.userStories),
  );

  const epicOptions = epics.map((epic) => ({
    value: stringValue(epic.code),
    label:
      `${displayText(stringValue(epic.code))} · ` +
      displayText(stringValue(epic.title)),
  }));
  const featureOptions = features.map((feature) => ({
    value: stringValue(feature.code),
    label:
      `${displayText(stringValue(feature.code))} · ` +
      displayText(stringValue(feature.title)),
  }));
  const storyOptions = stories.map((story) => ({
    value: stringValue(story.code),
    label:
      `${displayText(stringValue(story.code))} · ` +
      displayText(stringValue(story.title)),
  }));

  const groups: Array<{
    kind: PendingPlanningAssignmentKind;
    label: string;
    singular: string;
    parentLabel: string;
    parentOptions: Array<{ value: string; label: string }>;
    newParentLabel: string;
    containerLabel: string;
    containerOptions: Array<{ value: string; label: string }>;
  }> = [
    {
      kind: "features",
      label: "Features sin Epic",
      singular: "Feature",
      parentLabel: "Epic existente",
      parentOptions: epicOptions,
      newParentLabel: "Nombre de la nueva Epic",
      containerLabel: "",
      containerOptions: [],
    },
    {
      kind: "userStories",
      label: "HU-P sin Feature",
      singular: "HU-P",
      parentLabel: "Feature existente",
      parentOptions: featureOptions,
      newParentLabel: "Nombre de la nueva Feature",
      containerLabel: "Epic para la nueva Feature",
      containerOptions: epicOptions,
    },
    {
      kind: "tasks",
      label: "Tasks sin HU-P",
      singular: "Task",
      parentLabel: "HU-P existente",
      parentOptions: storyOptions,
      newParentLabel: "Nombre de la nueva HU-P",
      containerLabel: "Feature para la nueva HU-P",
      containerOptions: featureOptions,
    },
  ];

  const total = groups.reduce(
    (sum, group) => sum + recordList(pending[group.kind]).length,
    0,
  );
  if (total === 0) return null;

  return (
    <section className="rq-requirement-milestone">
      <div className="rq-requirement-milestones__heading">
        <div>
          <strong>Elementos de planificación pendientes por asignar</strong>
          <p>
            La asignación solo ocurre cuando una persona selecciona el padre.
            También puedes crear el padre inmediato y ubicar el work item en una
            sola operación.
          </p>
        </div>
        <span>{total} pendiente(s)</span>
      </div>

      {groups.map((group) => {
        const assignments = recordList(pending[group.kind]);
        if (assignments.length === 0) return null;

        return (
          <div className="rq-backlog-pending-group" key={group.kind}>
            <h4>
              {group.label} ({assignments.length})
            </h4>

            <div className="rq-document-disclosure-list">
              {assignments.map((assignment, index) => {
                const item = recordValue(assignment.item) ?? {};
                const code = stringValue(item.code);

                return (
                  <EditorDisclosure
                    description={stringValue(item.title)}
                    key={code || `${group.kind}-${index}`}
                    meta="Pendiente por asignar"
                    title={
                      `${group.singular} ${displayText(code) || index + 1} · ` +
                      displayText(stringValue(item.title))
                    }
                  >
                    <div className="rq-requirement-milestone-editor">
                      <HumanValue
                        label="Motivo"
                        value={
                          assignment.assignmentObservation ??
                          "No existe un padre inequívoco en la evidencia."
                        }
                      />

                      {!readOnly && group.parentOptions.length > 0 ? (
                        <form
                          className="rq-document-business-grid"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const data = new FormData(event.currentTarget);
                            const parentCode = String(
                              data.get("parentCode") ?? "",
                            );
                            onChange(
                              assignPendingPlanningItem(
                                value,
                                group.kind,
                                index,
                                parentCode,
                              ),
                            );
                          }}
                        >
                          <label className="rq-document-business-field">
                            <span>{group.parentLabel}</span>
                            <select defaultValue="" name="parentCode" required>
                              <option disabled value="">
                                Selecciona el padre
                              </option>
                              {group.parentOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>

                          <button
                            className="rq-document-add-item"
                            type="submit"
                          >
                            Asignar a padre existente
                          </button>
                        </form>
                      ) : null}

                      {!readOnly &&
                      (group.kind === "features" ||
                        group.containerOptions.length > 0) ? (
                        <form
                          className="rq-document-business-grid"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const data = new FormData(event.currentTarget);
                            const parentTitle = String(
                              data.get("parentTitle") ?? "",
                            );
                            const containerCode = String(
                              data.get("containerCode") ?? "",
                            );

                            onChange(
                              createParentForPendingPlanningItem(
                                value,
                                group.kind,
                                index,
                                containerCode || null,
                                parentTitle,
                              ),
                            );
                          }}
                        >
                          {group.kind !== "features" ? (
                            <label className="rq-document-business-field">
                              <span>{group.containerLabel}</span>
                              <select
                                defaultValue=""
                                name="containerCode"
                                required
                              >
                                <option disabled value="">
                                  Selecciona dónde crear el padre
                                </option>
                                {group.containerOptions.map((option) => (
                                  <option
                                    key={option.value}
                                    value={option.value}
                                  >
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ) : null}

                          <label className="rq-document-business-field">
                            <span>{group.newParentLabel}</span>
                            <input
                              maxLength={300}
                              minLength={2}
                              name="parentTitle"
                              required
                            />
                          </label>

                          <button
                            className="rq-document-add-item"
                            type="submit"
                          >
                            Crear padre y asignar
                          </button>
                        </form>
                      ) : null}

                      {!readOnly &&
                      group.kind !== "features" &&
                      group.containerOptions.length === 0 ? (
                        <p className="rq-document-prose">
                          Primero crea el nivel superior necesario en el árbol.
                        </p>
                      ) : null}
                    </div>
                  </EditorDisclosure>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}
