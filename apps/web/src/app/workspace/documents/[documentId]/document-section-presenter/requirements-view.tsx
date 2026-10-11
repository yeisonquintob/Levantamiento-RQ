import React, { useState } from "react";
import { type DocumentJsonValue } from "@levantamiento-rq/shared-contracts";
import {
  EmptyValue,
  TextList,
  Tags,
  HumanValue,
  EditorDisclosure,
  featureContextMeta,
  storyContextMeta,
} from "./primitives";
import { RequirementStoryDetail } from "./requirement-story-detail";
import {
  pendingFunctionalStories,
  commonEpicMilestoneRoots,
  functionalMilestoneGroupsWithRoots,
  integratedPoint6Point7Issues,
} from "./requirements-model";
import {
  PENDING,
  recordValue,
  recordList,
  stringValue,
  functionalStoryDescriptionForDisplay,
  stringList,
  displayText,
} from "./shared";

export type RequirementsTab = "functional" | "nonFunctional";

export function RequirementsTabList({
  active,
  onChange,
}: {
  active: RequirementsTab;
  onChange: (tab: RequirementsTab) => void;
}) {
  const tabs: readonly [RequirementsTab, string][] = [
    ["functional", "6.1 Requerimientos funcionales"],
    ["nonFunctional", "6.2 Requerimientos no funcionales"],
  ];
  return (
    <div
      aria-label="Tipos de requerimiento"
      className="rq-requirements-tabs"
      role="tablist"
    >
      {tabs.map(([id, label]) => (
        <button
          aria-controls={`requirements-panel-${id}`}
          aria-selected={active === id}
          id={`requirements-tab-${id}`}
          key={id}
          onClick={() => onChange(id)}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
            event.preventDefault();
            const next = id === "functional" ? "nonFunctional" : "functional";
            onChange(next);
            globalThis.setTimeout(() =>
              globalThis.document
                ?.getElementById(`requirements-tab-${next}`)
                ?.focus(),
            );
          }}
          role="tab"
          tabIndex={active === id ? 0 : -1}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function RequirementCards({ value }: { value: DocumentJsonValue | undefined }) {
  const items = recordList(value);

  if (items.length === 0) {
    return <EmptyValue>Sin requerimientos registrados.</EmptyValue>;
  }

  return (
    <div className="rq-document-master-list">
      {items.map((item, index) => {
        const fullUserStory = Boolean(
          stringValue(item.role) &&
          stringValue(item.want) &&
          stringValue(item.benefit),
        );

        return (
          <EditorDisclosure
            description={stringValue(item.title)}
            key={stringValue(item.code) || index}
            meta={stringValue(item.requirementType)}
            title={displayText(stringValue(item.code)) || `RQ-${index + 1}`}
          >
            {fullUserStory ? (
              <div>
                <div className="rq-document-detail-panel">
                  <p>
                    <strong>Epic:</strong>{" "}
                    {displayText(stringValue(item.epicCode))} ·{" "}
                    {displayText(stringValue(item.epicTitle))}
                  </p>

                  <p>
                    <strong>Feature:</strong>{" "}
                    {displayText(stringValue(item.featureCode))} ·{" "}
                    {displayText(stringValue(item.featureTitle))}
                  </p>
                </div>

                <RequirementStoryDetail story={item} />
              </div>
            ) : (
              /*
               * RNF:
               * conserva su presentación propia.
               */
              <div className="rq-document-detail-panel">
                <HumanValue value={item.description ?? ""} />

                {item.category ? (
                  <p>
                    <strong>Categoría:</strong>{" "}
                    {displayText(stringValue(item.category))}
                  </p>
                ) : null}

                {item.measure ? (
                  <p>
                    <strong>Medida:</strong>{" "}
                    {displayText(stringValue(item.measure))}
                  </p>
                ) : null}

                {item.target ? (
                  <p>
                    <strong>Objetivo:</strong>{" "}
                    {displayText(stringValue(item.target))}
                  </p>
                ) : null}

                <h4>Criterios de aceptación</h4>
                <TextList items={stringList(item.acceptanceCriteria)} />
              </div>
            )}
          </EditorDisclosure>
        );
      })}
    </div>
  );
}

export function IntegratedPoint6Point7Panel({
  requirementsValue,
  backlogValue,
  collapsed = false,
}: {
  requirementsValue?: DocumentJsonValue | null;
  backlogValue?: DocumentJsonValue | null;
  collapsed?: boolean;
}) {
  const roots = commonEpicMilestoneRoots(requirementsValue, backlogValue);
  const issues = integratedPoint6Point7Issues(requirementsValue, backlogValue);

  if (roots.length === 0 && issues.length === 0) return null;

  const content = (
    <section className="rq-requirement-milestone">
      <div className="rq-requirement-milestones__heading">
        <div>
          <strong>Raíz común Epic ↔ Hito</strong>
          <p>
            Cada Epic corresponde al Hito de la misma posición y título. En
            estructuras sugeridas la raíz sigue siendo propuesta por IA; HU-F y
            HU-P permanecen separadas y solo comparten esa raíz.
          </p>
        </div>
        <span>{roots.length} raíz(es)</span>
      </div>

      {roots.length > 0 ? (
        <div className="rq-document-disclosure-list">
          {roots.map((root) => (
            <article
              className="rq-document-detail-panel"
              key={`${root.milestoneCode}-${root.epicCode}`}
            >
              <strong>
                {root.milestoneCode} ↔ {root.epicCode}
              </strong>
              <p>{displayText(root.title)}</p>
              <small>
                {root.functionalStoryCount} HU-F · {root.featureCount} Feature ·{" "}
                {root.planningStoryCount} HU-P · {root.taskCount} Task
              </small>
            </article>
          ))}
        </div>
      ) : null}

      {issues.length > 0 ? (
        <div className="rq-document-validation">
          <strong>Validación integrada requiere revisión</strong>
          <ul>
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p>Integración Punto 6 ↔ Punto 7 consistente.</p>
      )}
    </section>
  );

  if (!collapsed) return content;

  return (
    <details className="rq-document-selected-structure">
      <summary>
        <span>
          <strong>Estructura seleccionada</strong>
          <small>Relación técnica Epic ↔ Hito</small>
        </span>
        <small>{roots.length} raíz(es)</small>
      </summary>
      <div className="rq-document-selected-structure__body">{content}</div>
    </details>
  );
}

export function PendingFunctionalNeedsView({
  value,
}: {
  value: DocumentJsonValue | undefined;
}) {
  const needs = recordList(value);
  if (needs.length === 0) return null;

  return (
    <section className="rq-requirement-milestone">
      <div className="rq-requirement-milestones__heading">
        <div>
          <strong>Necesidades funcionales pendientes de documentar</strong>

          <p>
            Evidencia conservada que todavía no tiene una HU-F completa. No se
            inventa COMO, QUIERO, PARA ni criterios de aceptación.
          </p>
        </div>

        <span>{needs.length} FN</span>
      </div>

      <div className="rq-document-disclosure-list">
        {needs.map((need, index) => (
          <EditorDisclosure
            description={stringValue(need.description)}
            key={stringValue(need.code) || index}
            meta="Pendiente de documentar"
            title={
              `${displayText(stringValue(need.code)) || `FN-${index + 1}`} · ` +
              displayText(stringValue(need.description))
            }
          >
            <div className="rq-document-detail-panel">
              <h4>Estado</h4>
              <p>Pendiente de documentar como HU-F</p>

              <h4>Motivo</h4>
              <HumanValue
                value={
                  need.reason ??
                  "La necesidad se conserva para documentación posterior."
                }
              />

              {stringList(need.sourceIds).length > 0 ? (
                <p>
                  Evidencia conservada: {stringList(need.sourceIds).length}{" "}
                  fuente(s).
                </p>
              ) : null}
            </div>
          </EditorDisclosure>
        ))}
      </div>
    </section>
  );
}

function FunctionalRequirementsByMilestoneView({
  value,
  pendingNeeds,
  backlogValue,
}: {
  value: DocumentJsonValue | undefined;
  pendingNeeds?: DocumentJsonValue;
  backlogValue?: DocumentJsonValue | null;
}) {
  const groups = functionalMilestoneGroupsWithRoots(value, backlogValue);
  const pending = pendingFunctionalStories(value);
  const pendingNeedCount = recordList(pendingNeeds).length;

  if (groups.length === 0 && pending.length === 0 && pendingNeedCount === 0) {
    return <EmptyValue>Sin requerimientos funcionales registrados.</EmptyValue>;
  }

  return (
    <div className="rq-requirement-milestones">
      <div className="rq-requirement-milestones__heading">
        <div>
          <strong>6.1 · Requerimientos funcionales por Hito</strong>

          <p>
            Cada bloque reúne el título y la descripción del Hito con todas sus
            Historias de Usuario y criterios de aceptación.
          </p>
        </div>

        <span>{groups.length} hito(s)</span>
      </div>

      {groups.map((group, groupIndex) => (
        <details
          className="rq-requirement-milestone"
          id={`functional-milestone-${groupIndex}`}
          key={group.key}
          open={groupIndex === 0}
        >
          <summary>
            <span
              aria-label="Hito"
              className="rq-work-item-icon rq-work-item-icon--milestone"
              role="img"
            >
              ♛
            </span>
            <span className="rq-requirement-milestone__identity">
              <span className="rq-requirement-milestone__kind">HITO</span>
              <strong>{displayText(group.code) || "Sin código"}</strong>
            </span>

            <span className="rq-requirement-milestone__title">
              <strong>{displayText(group.name)}</strong>
              <small>
                {displayText(group.description || "Sin descripción definida")}
              </small>
            </span>

            <span className="rq-requirement-milestone__count">
              {group.stories.length} HU
            </span>
          </summary>

          <div className="rq-requirement-milestone__body">
            <section className="rq-requirement-milestone__description">
              <h4>Descripción del hito</h4>

              <HumanValue value={group.description || PENDING} />
            </section>

            <section>
              <h4>Historias de usuario ({group.stories.length})</h4>

              {group.stories.length > 0 ? (
                <div className="rq-document-disclosure-list">
                  {group.stories.map(({ story, index }, storyPosition) => (
                    <article
                      className="rq-requirement-story-block"
                      key={stringValue(story.code) || index}
                    >
                      <EditorDisclosure
                        defaultOpen={groupIndex === 0 && storyPosition === 0}
                        description={functionalStoryDescriptionForDisplay(
                          story,
                        )}
                        id={`functional-story-${index}`}
                        leadingIcon="product-backlog-item"
                        meta={`${recordList(story.acceptanceCriteria).length} CA · ${recordList(story.fields).length} campos`}
                        title={
                          `${
                            displayText(stringValue(story.code)) ||
                            `HU-${index + 1}`
                          } · ` + displayText(stringValue(story.title))
                        }
                      >
                        <RequirementStoryDetail story={story} />
                      </EditorDisclosure>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyValue>
                  Hito confirmado sin Historias de Usuario documentadas.
                </EmptyValue>
              )}
            </section>
          </div>
        </details>
      ))}

      {pending.length > 0 ? (
        <section className="rq-requirement-milestone">
          <div className="rq-requirement-milestones__heading">
            <div>
              <strong>Historias de usuario pendientes por asignar</strong>

              <p>
                Historias funcionales completas y respaldadas que todavía no
                pueden ubicarse con seguridad en un Hito.
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
                <div className="rq-document-detail-panel">
                  <h4>Estado de asignación</h4>

                  <p>Pendiente por asignar</p>

                  <h4>Observación</h4>

                  <HumanValue
                    value={
                      story.assignmentObservation ??
                      "Pendiente de asignación estructural."
                    }
                  />

                  {stringList(story.functionalNeedCodes).length > 0 ? (
                    <>
                      <h4>Trazabilidad funcional</h4>
                      <Tags values={stringList(story.functionalNeedCodes)} />
                    </>
                  ) : null}

                  <RequirementStoryDetail story={story} />
                </div>
              </EditorDisclosure>
            ))}
          </div>
        </section>
      ) : null}

      <PendingFunctionalNeedsView value={pendingNeeds} />
    </div>
  );
}

function RequirementsTabsView({
  value,
  backlogValue,
}: {
  value: DocumentJsonValue;
  backlogValue?: DocumentJsonValue | null;
}) {
  const [active, setActive] = useState<RequirementsTab>("functional");
  const record = recordValue(value);
  if (!record) return <HumanValue value={value} />;
  return (
    <div className="rq-document-requirements-tabs-view">
      <RequirementsTabList active={active} onChange={setActive} />
      <section
        aria-labelledby="requirements-tab-functional"
        hidden={active !== "functional"}
        id="requirements-panel-functional"
        role="tabpanel"
      >
        <FunctionalRequirementsByMilestoneView
          backlogValue={backlogValue}
          pendingNeeds={record.pendingFunctionalNeeds}
          value={record.functionalRequirements}
        />
      </section>
      <section
        aria-labelledby="requirements-tab-nonFunctional"
        hidden={active !== "nonFunctional"}
        id="requirements-panel-nonFunctional"
        role="tabpanel"
      >
        <div className="rq-requirement-milestones">
          <div className="rq-requirement-milestones__heading">
            <div>
              <strong>6.2 · Requerimientos no funcionales</strong>
              <p>
                Condiciones de calidad, seguridad, rendimiento y operación que
                aplican de forma transversal a la solución.
              </p>
            </div>
            <span>
              {recordList(record.nonFunctionalRequirements).length} RNF
            </span>
          </div>
          <RequirementCards value={record.nonFunctionalRequirements} />
        </div>
      </section>
    </div>
  );
}

export function RequirementsView({
  value,
  backlogValue,
}: {
  value: DocumentJsonValue;
  backlogValue?: DocumentJsonValue | null;
}) {
  const record = recordValue(value);
  if (!record) return <HumanValue label="Funcionalidad" value={value} />;
  if (
    "functionalRequirements" in record ||
    "nonFunctionalRequirements" in record
  ) {
    return <RequirementsTabsView backlogValue={backlogValue} value={value} />;
  }
  const features = recordList(record.features);
  const stories = recordList(record.userStories);
  return (
    <div className="rq-document-requirements-view">
      <div className="rq-requirements-dual-column">
        <section>
          <h3>Funcionalidades ({features.length})</h3>
          {features.length === 0 ? <EmptyValue /> : null}
          <div className="rq-document-master-list">
            {features.map((feature, index) => (
              <EditorDisclosure
                description={stringValue(feature.title)}
                key={stringValue(feature.code) || index}
                meta={featureContextMeta(feature)}
                title={
                  displayText(stringValue(feature.code)) ||
                  `Funcionalidad ${index + 1}`
                }
              >
                <div className="rq-document-detail-panel">
                  <h4>Objetivo</h4>
                  <HumanValue value={feature.objective ?? ""} />
                  <h4>Descripción</h4>
                  <HumanValue value={feature.description ?? ""} />
                  <h4>Incluye</h4>
                  <TextList items={stringList(feature.inScope)} />
                  <h4>Fuera de alcance</h4>
                  <TextList
                    empty="Sin exclusiones explícitamente definidas."
                    items={stringList(feature.outOfScope)}
                  />
                  <h4>Historias relacionadas</h4>
                  <Tags values={stringList(feature.userStoryCodes)} />
                </div>
              </EditorDisclosure>
            ))}
          </div>
        </section>
        <section>
          <h3>Historias de usuario ({stories.length})</h3>
          {stories.length === 0 ? <EmptyValue /> : null}
          <div className="rq-document-master-list">
            {stories.map((story, index) => (
              <EditorDisclosure
                description={stringValue(story.title)}
                key={stringValue(story.code) || index}
                meta={storyContextMeta(story)}
                title={
                  displayText(stringValue(story.code)) || `HU ${index + 1}`
                }
              >
                <RequirementStoryDetail story={story} />
              </EditorDisclosure>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
