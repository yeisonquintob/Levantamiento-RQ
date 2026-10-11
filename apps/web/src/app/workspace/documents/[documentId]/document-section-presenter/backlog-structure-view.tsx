import React, { useRef } from "react";
import { type DocumentJsonValue } from "@levantamiento-rq/shared-contracts";
import {
  EmptyValue,
  HumanValue,
  EditorDisclosure,
  BacklogWorkItemIcon,
} from "./primitives";
import {
  type JsonRecord,
  recordValue,
  recordList,
  stringValue,
  stringList,
  numberValue,
  displayText,
} from "./shared";

export function backlogCounts(epics: readonly JsonRecord[]) {
  const features = epics.flatMap((epic) => recordList(epic.features));

  const stories = features.flatMap((feature) =>
    recordList(feature.userStories),
  );

  const tasks = stories.flatMap((story) => recordList(story.tasks));

  return {
    features,
    stories,
    tasks,
  };
}

export function BacklogOverview({ epics }: { epics: readonly JsonRecord[] }) {
  const { features, stories, tasks } = backlogCounts(epics);

  const counters = [
    ["Epics", epics.length],
    ["Features", features.length],
    ["User Stories", stories.length],
    ["Tasks", tasks.length],
  ] as const;

  return (
    <div aria-label="Resumen del esquema" className="rq-backlog-overview">
      {counters.map(([label, count]) => (
        <article key={label}>
          <span>{label}</span>
          <strong>{count}</strong>
        </article>
      ))}
    </div>
  );
}

type BacklogViewTab = "tree" | "structure";

type BacklogTreeGrouping = "epics" | "sprints" | "stories";

/*
 * PUNTO_7_TWO_VIEW_TABS
 *
 * Vista normal:
 * - Árbol del proyecto: lectura ejecutiva compacta.
 * - Estructura: detalle jerárquico completo.
 *
 * El editor mantiene su implementación independiente.
 */
function _BacklogViewTabs({
  active,
  onChange,
}: {
  active: BacklogViewTab;
  onChange: (tab: BacklogViewTab) => void;
}) {
  const tabs = [
    ["tree", "Árbol del proyecto"],
    ["structure", "Estructura"],
  ] as const;

  return (
    <div
      aria-label="Vistas del esquema"
      className="rq-backlog-view-tabs"
      role="tablist"
    >
      {tabs.map(([key, label]) => (
        <button
          aria-controls={`backlog-panel-${key}`}
          aria-selected={active === key}
          id={`backlog-tab-${key}`}
          key={key}
          onClick={() => onChange(key)}
          role="tab"
          tabIndex={active === key ? 0 : -1}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function BacklogVisualTree({ epics }: { epics: readonly JsonRecord[] }) {
  const nodeContent = (
    item: JsonRecord,
    kind: "Epic" | "Feature" | "User Story" | "Task",
  ) => (
    <>
      <BacklogWorkItemIcon
        kind={
          kind === "Epic"
            ? "epic"
            : kind === "Feature"
              ? "feature"
              : kind === "User Story"
                ? "product-backlog-item"
                : "task"
        }
      />
      <span className="rq-backlog-source-number">
        {displayText(stringValue(item.sourceNumber))}
      </span>
      <span className="rq-backlog-kind">{kind}</span>
      <div className="rq-backlog-visual-node__content">
        <strong>{displayText(stringValue(item.title))}</strong>
        <p>{displayText(stringValue(item.description))}</p>
      </div>
      <small>{displayText(stringValue(item.code))}</small>
    </>
  );
  return (
    <div className="rq-backlog-visual-tree">
      {epics.map((epic, epicIndex) => (
        <details
          className="rq-backlog-visual-tree__epic"
          key={stringValue(epic.code) || epicIndex}
          open={epicIndex === 0}
        >
          <summary className="rq-backlog-visual-node rq-backlog-visual-node--epic">
            {nodeContent(epic, "Epic")}
          </summary>

          <div className="rq-backlog-visual-children">
            {recordList(epic.features).map((feature, featureIndex) => (
              <details
                className="rq-backlog-visual-branch"
                key={stringValue(feature.code) || featureIndex}
                open
              >
                <summary className="rq-backlog-visual-node rq-backlog-visual-node--feature">
                  {nodeContent(feature, "Feature")}
                </summary>

                <div className="rq-backlog-visual-children">
                  {recordList(feature.userStories).map((story, storyIndex) => (
                    <details
                      className="rq-backlog-visual-branch"
                      key={stringValue(story.code) || storyIndex}
                      open
                    >
                      <summary className="rq-backlog-visual-node rq-backlog-visual-node--story">
                        {nodeContent(story, "User Story")}
                      </summary>

                      {recordList(story.tasks).length > 0 ? (
                        <div className="rq-backlog-visual-children rq-backlog-visual-children--tasks">
                          {recordList(story.tasks).map((task, taskIndex) => (
                            <div
                              className="rq-backlog-visual-branch"
                              key={stringValue(task.code) || taskIndex}
                            >
                              <div className="rq-backlog-visual-node rq-backlog-visual-node--task">
                                {nodeContent(task, "Task")}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </details>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

function _BacklogGroupedTree({
  epics,
  grouping,
  scrumValue,
}: {
  epics: readonly JsonRecord[];
  grouping: Exclude<BacklogTreeGrouping, "epics">;
  scrumValue?: DocumentJsonValue | null;
}) {
  const features = epics.flatMap((epic) =>
    recordList(epic.features).map((feature) => ({ epic, feature })),
  );
  const stories = features.flatMap(({ epic, feature }) =>
    recordList(feature.userStories).map((story) => ({ epic, feature, story })),
  );
  type StoryEntry = (typeof stories)[number];
  const storyByCode = new Map(
    stories.map((entry) => [stringValue(entry.story.code), entry]),
  );

  const storyCard = (entry: StoryEntry, index: number) => (
    <article
      className="rq-backlog-grouped-story"
      key={stringValue(entry.story.code) || index}
    >
      <BacklogWorkItemIcon kind="product-backlog-item" />
      <span className="rq-backlog-source-number">
        {displayText(stringValue(entry.story.sourceNumber))}
      </span>
      <div>
        <strong>
          {displayText(stringValue(entry.story.code))} ·{" "}
          {displayText(stringValue(entry.story.title))}
        </strong>
        <small>
          {displayText(stringValue(entry.epic.code))} →{" "}
          {displayText(stringValue(entry.feature.code))} ·{" "}
          {recordList(entry.story.tasks).length} Task
        </small>
      </div>
    </article>
  );

  if (grouping === "stories") {
    return (
      <div className="rq-backlog-grouped-view">
        <header>
          <div>
            <strong>Historias de usuario</strong>
            <p>Vista directa con la Epic y Feature de origen.</p>
          </div>
          <span>{stories.length} HU</span>
        </header>
        <div className="rq-backlog-grouped-list">{stories.map(storyCard)}</div>
      </div>
    );
  }

  const scrum = recordValue(scrumValue);
  const sprints = recordList(scrum?.sprints);

  return (
    <div className="rq-backlog-grouped-view">
      <header>
        <div>
          <strong>Sprints</strong>
          <p>Historias organizadas según el plan de trabajo del documento.</p>
        </div>
        <span>{sprints.length} sprint(s)</span>
      </header>
      {sprints.length === 0 ? (
        <EmptyValue>Sin sprints definidos en el plan de trabajo.</EmptyValue>
      ) : (
        <div className="rq-backlog-sprint-groups">
          {sprints.map((sprint, sprintIndex) => {
            const number = numberValue(sprint.number) ?? sprintIndex + 1;
            const sprintStories = stringList(sprint.userStoryCodes)
              .map((code) => storyByCode.get(code))
              .filter((entry): entry is StoryEntry => Boolean(entry));
            return (
              <details
                className="rq-backlog-sprint-group"
                key={`${stringValue(sprint.code)}-${sprintIndex}`}
                open={sprintIndex === 0}
              >
                <summary>
                  <span className="rq-backlog-sprint-number">{number}</span>
                  <span>
                    <strong>Sprint {number}</strong>
                    <small>{displayText(stringValue(sprint.objective))}</small>
                  </span>
                  <strong>{sprintStories.length} HU</strong>
                </summary>
                <div className="rq-backlog-grouped-list">
                  {sprintStories.length > 0 ? (
                    sprintStories.map(storyCard)
                  ) : (
                    <EmptyValue>
                      Sin historias asociadas a este sprint.
                    </EmptyValue>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Conservadas únicamente como compatibilidad interna para versiones históricas;
// la vista activa del Punto 7 presenta solo el esquema detallado.
void [_BacklogViewTabs, _BacklogGroupedTree, BacklogStructureDetail];

function BacklogStructureDetail({ epics }: { epics: readonly JsonRecord[] }) {
  /*
   * PUNTO_7_STRUCTURE_TITLE_DESCRIPTION
   *
   * La estructura presenta únicamente:
   * - tipo
   * - código
   * - título
   * - descripción
   *
   * COMO / QUIERO / PARA, contexto, campos y criterios
   * pertenecen al Punto 6 y no se duplican aquí.
   */
  return (
    <div className="rq-backlog-tree rq-backlog-tree--detail">
      {epics.map((epic, epicIndex) => (
        <details
          className="rq-backlog-epic"
          key={stringValue(epic.code) || epicIndex}
          open={epicIndex === 0}
        >
          <summary>
            <BacklogWorkItemIcon kind="epic" />
            <span className="rq-backlog-source-number">
              {displayText(stringValue(epic.sourceNumber))}
            </span>
            <span className="rq-backlog-kind">EPIC</span>

            <strong>{displayText(stringValue(epic.code))}</strong>

            <span>{displayText(stringValue(epic.title))}</span>
          </summary>

          <div className="rq-backlog-node-body">
            <div className="rq-backlog-description">
              <strong>Descripción</strong>

              <HumanValue value={epic.description ?? ""} />
            </div>

            <div className="rq-backlog-detail-list">
              {recordList(epic.features).map((feature, featureIndex) => (
                <details
                  className="rq-backlog-feature"
                  key={stringValue(feature.code) || featureIndex}
                >
                  <summary>
                    <BacklogWorkItemIcon kind="feature" />
                    <span className="rq-backlog-source-number">
                      {displayText(stringValue(feature.sourceNumber))}
                    </span>
                    <span className="rq-backlog-kind">FEATURE</span>

                    <strong>{displayText(stringValue(feature.code))}</strong>

                    <span>{displayText(stringValue(feature.title))}</span>
                  </summary>

                  <div className="rq-backlog-node-body">
                    <div className="rq-backlog-description">
                      <strong>Descripción</strong>

                      <HumanValue value={feature.description ?? ""} />
                    </div>

                    <div className="rq-backlog-detail-list">
                      {recordList(feature.userStories).map(
                        (story, storyIndex) => (
                          <details
                            className="rq-backlog-story"
                            key={stringValue(story.code) || storyIndex}
                          >
                            <summary>
                              <BacklogWorkItemIcon kind="product-backlog-item" />
                              <span className="rq-backlog-source-number">
                                {displayText(stringValue(story.sourceNumber))}
                              </span>
                              <span className="rq-backlog-kind">HU</span>

                              <strong>
                                {displayText(stringValue(story.code))}
                              </strong>

                              <span>
                                {displayText(stringValue(story.title))}
                              </span>
                            </summary>

                            <div className="rq-backlog-node-body">
                              <div className="rq-backlog-description">
                                <strong>Descripción</strong>

                                <HumanValue value={story.description ?? ""} />
                              </div>

                              <div className="rq-backlog-task-structure">
                                {recordList(story.tasks).length === 0 ? (
                                  <EmptyValue>Sin tareas definidas.</EmptyValue>
                                ) : (
                                  recordList(story.tasks).map(
                                    (task, taskIndex) => (
                                      <details
                                        className="rq-backlog-task-detail"
                                        key={
                                          stringValue(task.code) || taskIndex
                                        }
                                      >
                                        <summary>
                                          <BacklogWorkItemIcon kind="task" />
                                          <span className="rq-backlog-source-number">
                                            {displayText(
                                              stringValue(task.sourceNumber),
                                            )}
                                          </span>
                                          <span className="rq-backlog-kind">
                                            TASK
                                          </span>

                                          <strong>
                                            {displayText(
                                              stringValue(task.code),
                                            )}
                                          </strong>

                                          <span>
                                            {displayText(
                                              stringValue(task.title),
                                            )}
                                          </span>
                                        </summary>

                                        <div className="rq-backlog-description">
                                          <strong>Descripción</strong>

                                          <HumanValue
                                            value={task.description ?? ""}
                                          />
                                        </div>
                                      </details>
                                    ),
                                  )
                                )}
                              </div>
                            </div>
                          </details>
                        ),
                      )}
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}

/*
 * POINT_5_PENDING_PLANNING_ASSIGNMENTS_V4_7_5
 *
 * Los work items sin padre inequívoco se muestran debajo del árbol. En este
 * punto son de solo consulta estructural; crear/asignar padres se implementa
 * en el Punto 6 sin ocultarlos ni forzar una relación automática.
 */
/** Lista de elementos pendientes por asignar. Va fuera del componente para no remontarse en cada render. */
const PendingItems = ({
  assignments,
  kind,
}: {
  assignments: readonly JsonRecord[];
  kind: "Feature" | "HU-P" | "Task";
}) => (
  <div className="rq-document-disclosure-list">
    {assignments.map((assignment, index) => {
      const item = recordValue(assignment.item) ?? {};
      const code = stringValue(item.code);
      const childCount =
        kind === "Feature"
          ? recordList(item.userStories).length
          : kind === "HU-P"
            ? recordList(item.tasks).length
            : 0;

      return (
        <EditorDisclosure
          description={stringValue(item.title)}
          key={code || `${kind}-${index}`}
          meta="Pendiente por asignar"
          title={
            `${kind} ${displayText(code) || index + 1} · ` +
            displayText(stringValue(item.title))
          }
        >
          <div className="rq-document-detail-panel">
            <h4>Estado</h4>
            <p>Pendiente por asignar</p>

            <h4>Descripción</h4>
            <HumanValue value={item.description ?? ""} />

            <h4>Motivo</h4>
            <HumanValue
              value={
                assignment.assignmentObservation ??
                "No existe un padre inequívoco en la evidencia."
              }
            />

            <h4>Ruta de origen conocida</h4>
            <HumanValue
              value={
                stringValue(assignment.sourceParentPath) ||
                "Padre no identificado"
              }
            />

            {childCount > 0 ? (
              <p>
                Se conservan {childCount} descendiente(s) cuyo padre inmediato
                sí es conocido.
              </p>
            ) : null}
          </div>
        </EditorDisclosure>
      );
    })}
  </div>
);

function PendingPlanningAssignmentsView({
  value,
}: {
  value: DocumentJsonValue;
}) {
  const root = recordValue(value);
  const pending = recordValue(root?.pendingAssignments);
  const featureAssignments = recordList(pending?.features);
  const storyAssignments = recordList(pending?.userStories);
  const taskAssignments = recordList(pending?.tasks);
  const total =
    featureAssignments.length +
    storyAssignments.length +
    taskAssignments.length;

  if (total === 0) return null;

  return (
    <section className="rq-requirement-milestone">
      <div className="rq-requirement-milestones__heading">
        <div>
          <strong>Elementos de planificación pendientes por asignar</strong>
          <p>
            Se conservan fuera del árbol hasta que una persona defina su padre.
            No se crean Epic, Feature o HU-P artificiales para acomodarlos.
          </p>
        </div>
        <span>{total} pendiente(s)</span>
      </div>

      {featureAssignments.length > 0 ? (
        <div className="rq-backlog-pending-group">
          <h4>Features sin Epic ({featureAssignments.length})</h4>
          <PendingItems assignments={featureAssignments} kind="Feature" />
        </div>
      ) : null}

      {storyAssignments.length > 0 ? (
        <div className="rq-backlog-pending-group">
          <h4>HU-P sin Feature ({storyAssignments.length})</h4>
          <PendingItems assignments={storyAssignments} kind="HU-P" />
        </div>
      ) : null}

      {taskAssignments.length > 0 ? (
        <div className="rq-backlog-pending-group">
          <h4>Tasks sin HU-P ({taskAssignments.length})</h4>
          <PendingItems assignments={taskAssignments} kind="Task" />
        </div>
      ) : null}
    </section>
  );
}

export function BacklogStructureView({ value }: { value: DocumentJsonValue }) {
  const structureRef = useRef<HTMLDivElement>(null);
  const root = recordValue(value);
  const epics = recordList(root?.epics);
  const structureStatus = stringValue(root?.structureStatus)
    .trim()
    .toUpperCase();
  const suggested = structureStatus === "AI_SUGGESTED";
  const pendingRoot = recordValue(root?.pendingAssignments);
  const pendingAssignmentCount =
    recordList(pendingRoot?.features).length +
    recordList(pendingRoot?.userStories).length +
    recordList(pendingRoot?.tasks).length;

  if (epics.length === 0 && pendingAssignmentCount === 0) {
    return <EmptyValue>Sin elementos en el esquema.</EmptyValue>;
  }

  return (
    <div className="rq-backlog-workspace">
      <BacklogOverview epics={epics} />

      <div className="rq-backlog-purpose">
        <strong>
          {suggested ? "Estructura sugerida por IA" : "Esquema del proyecto"}
        </strong>

        <p>
          {suggested
            ? "Propuesta no confirmada por una persona. Sus Epic organizan el Punto 6 como Hitos sugeridos por posición y mantienen la trazabilidad 1:1 entre HU-P y HU-F."
            : "Jerarquía confirmada preparada para Azure DevOps con número de origen, tipo de work item, concepto, descripción y código técnico único."}
        </p>

        {suggested ? (
          <p>
            Hitos sugeridos:{" "}
            {epics
              .map(
                (epic, index) =>
                  `H-${String(index + 1).padStart(3, "0")} · ${displayText(stringValue(epic.title))}`,
              )
              .join(" · ")}
          </p>
        ) : null}
      </div>

      <section className="rq-backlog-view-panel" ref={structureRef}>
        <div className="rq-backlog-structure-heading rq-backlog-structure-heading--actions">
          <div>
            <strong>Estructura detallada</strong>

            <p>
              Epic → Feature → Historia de usuario → Tarea, con sus
              descripciones.
            </p>
          </div>
          <div className="rq-backlog-expand-actions">
            <button
              onClick={() =>
                structureRef.current
                  ?.querySelectorAll("details")
                  .forEach((item) => {
                    item.open = true;
                  })
              }
              type="button"
            >
              Expandir todo
            </button>
            <button
              onClick={() =>
                structureRef.current
                  ?.querySelectorAll("details")
                  .forEach((item) => {
                    item.open = false;
                  })
              }
              type="button"
            >
              Comprimir todo
            </button>
          </div>
        </div>

        <BacklogVisualTree epics={epics} />
      </section>

      <PendingPlanningAssignmentsView value={value} />
    </div>
  );
}
