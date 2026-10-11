"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type {
  ExecutionTaskState,
  ExecutionTaskStatusUpdate,
} from "@levantamiento-rq/shared-contracts";

import type { ExecutionPlan, ExecutionTask } from "./azure-devops-csv";
import {
  type ExecutionKpis,
  type ExecutionStatusMap,
  normalizeTaskCode,
} from "./execution-tracking";

const DATE_FORMAT = new Intl.DateTimeFormat("es-CO", {
  day: "2-digit",
  month: "short",
});

/** Anillo de avance con el porcentaje al centro. */
export function KpiRing({ value }: Readonly<{ value: number }>) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg aria-hidden="true" className="rq-exec-kpi__ring" viewBox="0 0 64 64">
      <circle className="rq-exec-kpi__ring-track" cx="32" cy="32" r={radius} />
      <circle
        className="rq-exec-kpi__ring-value"
        cx="32"
        cy="32"
        r={radius}
        strokeDasharray={`${(circumference * Math.min(100, value)) / 100} ${circumference}`}
        transform="rotate(-90 32 32)"
      />
    </svg>
  );
}

/** Los tres KPI de ejecución. Se actualizan al instante cuando cambia una tarea. */
export function ExecutionKpiStrip({
  kpis,
  hasExecution,
}: Readonly<{ kpis: ExecutionKpis; hasExecution: boolean }>) {
  const items = [
    {
      key: "progress",
      title: "Avance general",
      value: kpis.progress,
      detail: hasExecution
        ? `${kpis.doneTasks} de ${kpis.totalTasks} tareas hechas`
        : "Aún no inicia la ejecución",
    },
    {
      key: "objectives",
      title: "Cumplimiento de objetivos",
      value: kpis.objectiveCompliance,
      detail: `${kpis.doneStories} de ${kpis.totalStories} historias completas`,
    },
    {
      key: "deliverables",
      title: "Cumplimiento de entregables",
      value: kpis.deliverableCompliance,
      detail: `${kpis.doneEpics} de ${kpis.totalEpics} hitos finalizados`,
    },
  ];
  return (
    <section aria-label="Indicadores de ejecución" className="rq-exec-kpis">
      {items.map((item) => (
        <article
          data-complete={item.value >= 100}
          data-empty={item.value === 0}
          key={item.key}
        >
          <div className="rq-exec-kpi__gauge">
            <KpiRing value={item.value} />
            <strong>{item.value}%</strong>
          </div>
          <div className="rq-exec-kpi__copy">
            <span>{item.title}</span>
            <small>{item.detail}</small>
            <div className="rq-exec-kpi__bar" aria-hidden="true">
              <i style={{ width: `${item.value}%` }} />
              <b />
            </div>
            <em>Meta 100 %</em>
          </div>
        </article>
      ))}
    </section>
  );
}

interface StoryNode {
  key: string;
  code: string;
  title: string;
  tasks: readonly ExecutionTask[];
}

interface EpicNode {
  code: string;
  title: string;
  stories: readonly StoryNode[];
  tasks: readonly ExecutionTask[];
}

function buildTree(plan: ExecutionPlan): EpicNode[] {
  return plan.epics.map((epic) => {
    const tasks = plan.tasks.filter((task) => task.epicCode === epic.code);
    const stories = new Map<string, StoryNode>();
    for (const task of tasks) {
      const key = normalizeTaskCode(task.storyCode) || "SIN-HISTORIA";
      const existing = stories.get(key);
      stories.set(key, {
        key,
        code: task.storyCode || "Sin historia",
        title: existing?.title || task.storyTitle,
        tasks: [...(existing?.tasks ?? []), task],
      });
    }
    return { code: epic.code, title: epic.title, stories: [...stories.values()], tasks };
  });
}

const STATE_FILTERS: readonly { value: "ALL" | ExecutionTaskState; label: string }[] = [
  { value: "ALL", label: "Todas" },
  { value: "PENDING", label: "Pendientes" },
  { value: "IN_PROGRESS", label: "En curso" },
  { value: "DONE", label: "Hechas" },
];

/** Casilla que admite el estado «parcial» (algunas tareas hechas). */
function TriCheckbox({
  checked,
  label,
  mixed,
  onChange,
  disabled,
}: Readonly<{
  checked: boolean;
  label: string;
  mixed: boolean;
  onChange: () => void;
  disabled: boolean;
}>) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed && !checked;
  }, [checked, mixed]);
  return (
    <input
      aria-label={label}
      checked={checked}
      className="rq-exec-check"
      disabled={disabled}
      onChange={onChange}
      ref={ref}
      type="checkbox"
    />
  );
}

export function ExecutionChecklist({
  plan,
  statuses,
  kpis,
  busy,
  onUpdate,
}: Readonly<{
  plan: ExecutionPlan;
  statuses: ExecutionStatusMap;
  kpis: ExecutionKpis;
  busy: boolean;
  onUpdate: (updates: ExecutionTaskStatusUpdate[]) => Promise<void>;
}>) {
  const tree = useMemo(() => buildTree(plan), [plan]);
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<"ALL" | ExecutionTaskState>("ALL");
  const [sprint, setSprint] = useState("");
  const [role, setRole] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  const stateOf = (task: ExecutionTask): ExecutionTaskState =>
    statuses.get(normalizeTaskCode(task.code))?.state ?? "PENDING";
  const sprints = [...new Set(plan.tasks.map((task) => task.sprintCode).filter(Boolean))].sort();
  const roles = [...new Set(plan.tasks.map((task) => task.role).filter(Boolean))].sort();
  const query = search.trim().toLowerCase();

  const matches = (task: ExecutionTask): boolean =>
    (stateFilter === "ALL" || stateOf(task) === stateFilter) &&
    (!sprint || task.sprintCode === sprint) &&
    (!role || task.role === role) &&
    (!query ||
      [task.code, task.title, task.description, task.storyCode, task.storyTitle]
        .join(" ")
        .toLowerCase()
        .includes(query));

  const filtering = Boolean(query || sprint || role || stateFilter !== "ALL");

  function toggle(key: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** Marca o desmarca un conjunto de tareas: si todas están hechas las devuelve a pendiente. */
  function setGroup(tasks: readonly ExecutionTask[]) {
    const allDone = tasks.every((task) => stateOf(task) === "DONE");
    void onUpdate(
      tasks
        .filter((task) => (allDone ? true : stateOf(task) !== "DONE"))
        .map((task) => ({
          taskCode: normalizeTaskCode(task.code),
          state: allDone ? "PENDING" : "DONE",
          source: "MANUAL",
        })),
    );
  }

  function setTask(task: ExecutionTask, state: ExecutionTaskState) {
    void onUpdate([
      { taskCode: normalizeTaskCode(task.code), state, source: "MANUAL" },
    ]);
  }

  function saveNote(task: ExecutionTask) {
    const current = statuses.get(normalizeTaskCode(task.code));
    const note = noteDraft.trim() || null;
    setNoteOpen(null);
    if ((current?.note ?? null) === note) return;
    void onUpdate([
      {
        taskCode: normalizeTaskCode(task.code),
        state: current?.state ?? "PENDING",
        source: "MANUAL",
        note,
      },
    ]);
  }

  if (plan.tasks.length === 0) {
    return (
      <div className="rq-execution-empty">
        <strong>Sin tareas en el plan</strong>
        <span>
          El documento todavía no tiene estructura de trabajo con tareas para
          hacer seguimiento.
        </span>
      </div>
    );
  }

  const visibleEpics = tree
    .map((epic) => ({
      ...epic,
      visibleStories: epic.stories
        .map((story) => ({
          ...story,
          visibleTasks: story.tasks.filter(matches),
        }))
        .filter((story) => story.visibleTasks.length > 0),
    }))
    .filter((epic) => epic.visibleStories.length > 0);

  return (
    <section className="rq-exec-tracking" data-busy={busy}>
      <ExecutionKpiStrip hasExecution={kpis.doneTasks > 0} kpis={kpis} />

      <form
        className="rq-exec-filters"
        onSubmit={(event) => event.preventDefault()}
      >
        <input
          aria-label="Buscar tarea o historia"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar tarea o historia…"
          type="search"
          value={search}
        />
        <div aria-label="Estado" className="rq-exec-filters__states" role="group">
          {STATE_FILTERS.map((option) => (
            <button
              aria-pressed={stateFilter === option.value}
              key={option.value}
              onClick={() => setStateFilter(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
        <select
          aria-label="Sprint"
          onChange={(event) => setSprint(event.target.value)}
          value={sprint}
        >
          <option value="">Todos los sprints</option>
          {sprints.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          aria-label="Rol"
          onChange={(event) => setRole(event.target.value)}
          value={role}
        >
          <option value="">Todos los roles</option>
          {roles.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </form>

      {visibleEpics.length === 0 ? (
        <div className="rq-execution-empty">
          <strong>Ninguna tarea coincide con el filtro</strong>
          <span>Cambia la búsqueda o el estado para ver más tareas.</span>
        </div>
      ) : (
        <ul className="rq-exec-tree">
          {visibleEpics.map((epic) => {
            const done = epic.tasks.filter((task) => stateOf(task) === "DONE").length;
            const progress = Math.round((done / Math.max(1, epic.tasks.length)) * 100);
            const open = filtering || !collapsed.has(epic.code);
            return (
              <li data-complete={progress === 100} key={epic.code}>
                <div className="rq-exec-node rq-exec-node--epic">
                  <TriCheckbox
                    checked={done === epic.tasks.length}
                    disabled={busy}
                    label={`Marcar todo el hito ${epic.code}`}
                    mixed={done > 0}
                    onChange={() => setGroup(epic.tasks)}
                  />
                  <button
                    aria-expanded={open}
                    className="rq-exec-node__title"
                    onClick={() => toggle(epic.code)}
                    type="button"
                  >
                    <b aria-hidden="true">{open ? "▾" : "▸"}</b>
                    <span className="rq-exec-code">{epic.code}</span>
                    <strong>{epic.title}</strong>
                  </button>
                  <div className="rq-exec-node__progress">
                    <div aria-hidden="true">
                      <i style={{ width: `${progress}%` }} />
                    </div>
                    <output>
                      {done}/{epic.tasks.length}
                    </output>
                  </div>
                </div>

                {open ? (
                  <ul>
                    {epic.visibleStories.map((story) => {
                      const storyDone = story.tasks.filter(
                        (task) => stateOf(task) === "DONE",
                      ).length;
                      const storyKey = `${epic.code}|${story.key}`;
                      const storyOpen = filtering || !collapsed.has(storyKey);
                      return (
                        <li
                          data-complete={storyDone === story.tasks.length}
                          key={story.key}
                        >
                          <div className="rq-exec-node rq-exec-node--story">
                            <TriCheckbox
                              checked={storyDone === story.tasks.length}
                              disabled={busy}
                              label={`Marcar toda la historia ${story.code}`}
                              mixed={storyDone > 0}
                              onChange={() => setGroup(story.tasks)}
                            />
                            <button
                              aria-expanded={storyOpen}
                              className="rq-exec-node__title"
                              onClick={() => toggle(storyKey)}
                              type="button"
                            >
                              <b aria-hidden="true">{storyOpen ? "▾" : "▸"}</b>
                              <span className="rq-exec-code">{story.code}</span>
                              <strong>{story.title || "Historia de usuario"}</strong>
                            </button>
                            <output>
                              {storyDone}/{story.tasks.length}
                            </output>
                          </div>

                          {storyOpen ? (
                            <ul>
                              {story.visibleTasks.map((task) => {
                                const code = normalizeTaskCode(task.code);
                                const status = statuses.get(code);
                                const state = stateOf(task);
                                const editing = noteOpen === code;
                                return (
                                  <li data-state={state} key={code}>
                                    <div className="rq-exec-node rq-exec-node--task">
                                      <input
                                        aria-label={`Tarea ${task.code} hecha`}
                                        checked={state === "DONE"}
                                        className="rq-exec-check"
                                        disabled={busy}
                                        onChange={() =>
                                          setTask(task, state === "DONE" ? "PENDING" : "DONE")
                                        }
                                        type="checkbox"
                                      />
                                      <div className="rq-exec-task">
                                        <span>
                                          <em className="rq-exec-code">{task.code}</em>
                                          <strong>{task.title}</strong>
                                        </span>
                                        <small>
                                          {[
                                            task.sprintCode,
                                            task.role,
                                            `${task.startLabel} → ${task.endLabel}`,
                                            status?.state === "DONE" && status.completedAt
                                              ? `Hecha ${DATE_FORMAT.format(new Date(status.completedAt))}`
                                              : "",
                                            status?.source === "AZURE_CSV" ? "Azure" : "",
                                          ]
                                            .filter(Boolean)
                                            .join(" · ")}
                                        </small>
                                        {status?.note && !editing ? (
                                          <p>{status.note}</p>
                                        ) : null}
                                        {editing ? (
                                          <input
                                            aria-label={`Nota de ${task.code}`}
                                            autoFocus
                                            className="rq-exec-note"
                                            maxLength={1000}
                                            onBlur={() => saveNote(task)}
                                            onChange={(event) => setNoteDraft(event.target.value)}
                                            onKeyDown={(event) => {
                                              if (event.key === "Enter") saveNote(task);
                                              if (event.key === "Escape") setNoteOpen(null);
                                            }}
                                            placeholder="Nota o evidencia de la tarea"
                                            value={noteDraft}
                                          />
                                        ) : null}
                                      </div>
                                      <div className="rq-exec-task__actions">
                                        <button
                                          aria-pressed={state === "IN_PROGRESS"}
                                          disabled={busy || state === "DONE"}
                                          onClick={() =>
                                            setTask(task, state === "IN_PROGRESS" ? "PENDING" : "IN_PROGRESS")
                                          }
                                          type="button"
                                        >
                                          En curso
                                        </button>
                                        <button
                                          onClick={() => {
                                            setNoteDraft(status?.note ?? "");
                                            setNoteOpen(code);
                                          }}
                                          type="button"
                                        >
                                          Nota
                                        </button>
                                      </div>
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
