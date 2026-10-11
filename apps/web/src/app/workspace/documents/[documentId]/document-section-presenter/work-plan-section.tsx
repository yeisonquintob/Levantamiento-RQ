"use client";

import React, { useMemo, useState } from "react";
import { type DocumentJsonValue } from "@levantamiento-rq/shared-contracts";
import {
  computeWorkPlanTimeline,
  workPlanAxisLabels,
  type TimelineGranularity,
} from "../../../work-plan-timeline";
import { EmptyValue, type BusinessEditorProps } from "./primitives";
import { ScrumView, ScrumEditor } from "./scrum-section";
import { displayText } from "./shared";

type WorkPlanTab = "SPRINT" | "STAGES";

function WorkPlanTimeline({
  value,
  backlogValue,
}: {
  value: DocumentJsonValue;
  backlogValue?: DocumentJsonValue | null;
}) {
  const [granularity, setGranularity] = useState<TimelineGranularity>("EPIC");
  const { sprints, items, timelineStart, timelineEnd } = useMemo(
    () => computeWorkPlanTimeline(value, backlogValue, granularity),
    [value, backlogValue, granularity],
  );
  const timelineLength = Math.max(1, timelineEnd - timelineStart);
  const axisLabels = workPlanAxisLabels(timelineStart, timelineEnd);

  return (
    <section
      className="rq-work-plan-timeline"
      aria-labelledby="work-plan-timeline-title"
    >
      <header>
        <div>
          <span>Línea de tiempo</span>
          <h3 id="work-plan-timeline-title">Programación según las tareas</h3>
          <p>
            El inicio y el cierre se calculan con los Sprints que contienen las
            tareas de cada elemento.
          </p>
        </div>
        <div
          aria-label="Nivel de la línea de tiempo"
          className="rq-work-plan-granularity"
          role="group"
        >
          {(
            [
              ["EPIC", "Épicas"],
              ["FEATURE", "Features"],
              ["USER_STORY", "Historias de usuario"],
            ] as const
          ).map(([key, label]) => (
            <button
              aria-pressed={granularity === key}
              key={key}
              onClick={() => setGranularity(key)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {sprints.length === 0 || items.length === 0 ? (
        <EmptyValue>
          Aún no hay tareas calendarizadas para este nivel del plan.
        </EmptyValue>
      ) : (
        <div className="rq-work-plan-timeline__viewport">
          <div className="rq-work-plan-timeline__axis">
            <strong>Elemento</strong>
            <div>
              {axisLabels.map((label, index) => (
                <span key={`${label}-${index}`}>{label}</span>
              ))}
            </div>
          </div>
          <div className="rq-work-plan-timeline__rows">
            {items.map((item, index) => {
              const left =
                ((item.start - timelineStart) / timelineLength) * 100;
              const width = Math.max(
                3,
                ((item.end - item.start) / timelineLength) * 100,
              );
              return (
                <article key={`${granularity}-${item.code}`}>
                  <div className="rq-work-plan-timeline__label">
                    <strong>{displayText(item.code)}</strong>
                    <span title={item.title}>{displayText(item.title)}</span>
                  </div>
                  <div className="rq-work-plan-timeline__track">
                    <div
                      className="rq-work-plan-timeline__bar"
                      data-color={String((index % 3) + 1)}
                      style={{
                        left: `${left}%`,
                        width: `${Math.min(width, 100 - left)}%`,
                      }}
                    >
                      <span>{item.startLabel}</span>
                      <span>{item.endLabel}</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

export function WorkPlanStages({
  value,
  backlogValue,
}: {
  value: DocumentJsonValue;
  backlogValue?: DocumentJsonValue | null;
}) {
  return (
    <div className="rq-work-plan-stages">
      <WorkPlanTimeline backlogValue={backlogValue} value={value} />
    </div>
  );
}

function WorkPlanTabs({
  activeTab,
  idPrefix,
  onChange,
}: {
  activeTab: WorkPlanTab;
  idPrefix: string;
  onChange: (tab: WorkPlanTab) => void;
}) {
  return (
    <div
      aria-label="Vistas del plan de trabajo"
      className="rq-work-plan-tabs"
      role="tablist"
    >
      <button
        aria-controls={`${idPrefix}-panel`}
        aria-selected={activeTab === "SPRINT"}
        id={`${idPrefix}-tab-SPRINT`}
        onClick={() => onChange("SPRINT")}
        role="tab"
        type="button"
      >
        Sprint
      </button>
      <button
        aria-controls={`${idPrefix}-panel`}
        aria-selected={activeTab === "STAGES"}
        id={`${idPrefix}-tab-STAGES`}
        onClick={() => onChange("STAGES")}
        role="tab"
        type="button"
      >
        Etapas
      </button>
    </div>
  );
}

export function WorkPlanView({
  value,
  backlogValue,
}: {
  value: DocumentJsonValue;
  backlogValue?: DocumentJsonValue | null;
}) {
  const [activeTab, setActiveTab] = useState<WorkPlanTab>("STAGES");
  const idPrefix = React.useId();
  return (
    <div className="rq-work-plan">
      <WorkPlanTabs
        activeTab={activeTab}
        idPrefix={idPrefix}
        onChange={setActiveTab}
      />
      <div
        aria-labelledby={`${idPrefix}-tab-${activeTab}`}
        id={`${idPrefix}-panel`}
        role="tabpanel"
      >
        {activeTab === "SPRINT" ? (
          <ScrumView value={value} />
        ) : (
          <WorkPlanStages backlogValue={backlogValue} value={value} />
        )}
      </div>
    </div>
  );
}

export function WorkPlanEditor({
  value,
  readOnly,
  onChange,
  backlogValue,
}: BusinessEditorProps & {
  backlogValue?: DocumentJsonValue | null;
}) {
  const [activeTab, setActiveTab] = useState<WorkPlanTab>("STAGES");
  const idPrefix = React.useId();
  return (
    <div className="rq-work-plan">
      <WorkPlanTabs
        activeTab={activeTab}
        idPrefix={idPrefix}
        onChange={setActiveTab}
      />
      <div
        aria-labelledby={`${idPrefix}-tab-${activeTab}`}
        id={`${idPrefix}-panel`}
        role="tabpanel"
      >
        {activeTab === "SPRINT" ? (
          <ScrumEditor onChange={onChange} readOnly={readOnly} value={value} />
        ) : (
          <WorkPlanStages backlogValue={backlogValue} value={value} />
        )}
      </div>
    </div>
  );
}
