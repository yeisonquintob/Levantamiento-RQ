"use client";

import { useCallback, useEffect, useState } from "react";

import {
  PROJECT_AREA_COLORS,
  PROJECT_AREA_ICONS,
  type ProjectAreaColor,
  type ProjectAreaIcon,
  type ProjectAreaListResponse,
  type ProjectAreaSummary,
} from "@levantamiento-rq/shared-contracts";
import {
  RqActionButton,
  RqKpiCard,
  RqKpiGrid,
} from "@levantamiento-rq/shared-ui";

import {
  AREA_COLOR_LABELS,
  AREA_ICON_LABELS,
  AreaIcon,
  areaColorClass,
} from "../../area-icon";
import { WorkspaceKpiIcon } from "../../workspace-kpi-icon";
import { useConfirm } from "../../../confirm-dialog";

function AreaIconPicker({
  color,
  icon,
  label,
  onColor,
  onIcon,
}: {
  color: ProjectAreaColor | null;
  icon: ProjectAreaIcon | null;
  label: string;
  onColor: (color: ProjectAreaColor) => void;
  onIcon: (icon: ProjectAreaIcon) => void;
}) {
  return (
    <div className="rq-area-picker-group">
      <div
        aria-label={`${label}: icono`}
        className="rq-area-picker"
        role="radiogroup"
      >
        {PROJECT_AREA_ICONS.map((option) => (
          <button
            aria-checked={(icon ?? "building") === option}
            aria-label={AREA_ICON_LABELS[option]}
            className="rq-area-picker__option"
            key={option}
            onClick={() => onIcon(option)}
            role="radio"
            title={AREA_ICON_LABELS[option]}
            type="button"
          >
            <AreaIcon color={color} name={option} size={18} />
          </button>
        ))}
      </div>
      <div
        aria-label={`${label}: color`}
        className="rq-area-swatches"
        role="radiogroup"
      >
        {PROJECT_AREA_COLORS.map((option) => (
          <button
            aria-checked={(color ?? "slate") === option}
            aria-label={AREA_COLOR_LABELS[option]}
            className={`rq-area-swatch ${areaColorClass(option)}`}
            key={option}
            onClick={() => onColor(option)}
            role="radio"
            title={AREA_COLOR_LABELS[option]}
            type="button"
          />
        ))}
      </div>
    </div>
  );
}

const GATEWAY_URL =
  process.env.NODE_ENV === "development" && typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : (process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${GATEWAY_URL}/api/v1/project-areas${path}`, {
    ...init,
    credentials: "include",
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      message?: unknown;
    } | null;
    throw new Error(
      typeof payload?.message === "string"
        ? payload.message
        : `La solicitud no pudo completarse (${response.status}).`,
    );
  }
  return (await response.json()) as T;
}

export function AreasSettings({ canManage }: { canManage: boolean }) {
  const confirm = useConfirm();
  const [areas, setAreas] = useState<readonly ProjectAreaSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<ProjectAreaIcon | null>(null);
  const [color, setColor] = useState<ProjectAreaColor | null>(null);
  const [editingIcon, setEditingIcon] = useState<ProjectAreaIcon | null>(null);
  const [editingColor, setEditingColor] = useState<ProjectAreaColor | null>(
    null,
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [message, setMessage] = useState<{
    tone: "success" | "danger";
    text: string;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await request<ProjectAreaListResponse>("");
      setAreas(result.items);
    } catch (error) {
      setMessage({
        tone: "danger",
        text: error instanceof Error ? error.message : "No se pudo cargar.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>, success: string) {
    setMessage(null);
    try {
      await action();
      setMessage({ tone: "success", text: success });
      await load();
    } catch (error) {
      setMessage({
        tone: "danger",
        text: error instanceof Error ? error.message : "No se pudo guardar.",
      });
    }
  }

  return (
    <section aria-label="Áreas solicitantes" className="rq-params-areas">
      <p className="rq-params-areas__intro">
        Áreas que aparecen en el filtro «Área» de Proyectos y como sugerencia al
        crear un proyecto.
        {canManage
          ? " Cambiar el nombre de un área también lo actualiza en sus proyectos."
          : " Solo un administrador puede modificar esta lista."}
      </p>

      {!loading && areas.length > 0 ? (
        <RqKpiGrid label="Resumen de áreas">
          <RqKpiCard
            description="Áreas en la lista"
            icon={<WorkspaceKpiIcon name="layers" />}
            title="Áreas"
            value={String(areas.length)}
          />
          <RqKpiCard
            description="Proyectos con área asignada"
            icon={<WorkspaceKpiIcon name="projects" />}
            title="Proyectos"
            value={String(
              areas.reduce((total, area) => total + area.projectCount, 0),
            )}
          />
        </RqKpiGrid>
      ) : null}

      {message ? (
        <p
          className="rq-params-areas__message"
          data-tone={message.tone}
          role="status"
        >
          {message.text}
        </p>
      ) : null}

      {canManage ? (
        <form
          className="rq-params-areas__add"
          onSubmit={(event) => {
            event.preventDefault();
            const value = name.trim();
            if (!value) return;
            void run(
              () =>
                request<ProjectAreaSummary>("", {
                  method: "POST",
                  body: JSON.stringify({
                    name: value,
                    icon: icon ?? "building",
                    color: color ?? "slate",
                  }),
                }),
              `Área «${value}» agregada.`,
            ).then(() => {
              setName("");
              setIcon(null);
              setColor(null);
            });
          }}
        >
          <input
            aria-label="Nombre del área nueva"
            maxLength={160}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nueva área (por ejemplo, Cartera)"
            value={name}
          />
          <RqActionButton
            disabled={!name.trim()}
            tone="affirmative"
            type="submit"
          >
            Agregar área
          </RqActionButton>
          <AreaIconPicker
            color={color}
            icon={icon}
            label="Área nueva"
            onColor={setColor}
            onIcon={setIcon}
          />
        </form>
      ) : null}

      {loading ? (
        <p>Cargando áreas…</p>
      ) : areas.length === 0 ? (
        <p>Todavía no hay áreas registradas.</p>
      ) : (
        <ul className="rq-params-areas__list">
          {areas.map((area) => (
            <li key={area.id}>
              {editingId === area.id ? (
                <form
                  className="rq-params-areas__edit"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const value = editingName.trim();
                    if (!value) return;
                    void run(
                      () =>
                        request<ProjectAreaSummary>(`/${area.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({
                            name: value,
                            icon: editingIcon ?? area.icon ?? "building",
                            color: editingColor ?? area.color ?? "slate",
                          }),
                        }),
                      `Área «${value}» actualizada.`,
                    ).then(() => setEditingId(null));
                  }}
                >
                  <input
                    aria-label={`Nuevo nombre para ${area.name}`}
                    autoFocus
                    maxLength={160}
                    onChange={(event) => setEditingName(event.target.value)}
                    value={editingName}
                  />
                  <AreaIconPicker
                    color={editingColor ?? area.color}
                    icon={editingIcon ?? area.icon}
                    label={area.name}
                    onColor={setEditingColor}
                    onIcon={setEditingIcon}
                  />
                  <RqActionButton compact tone="affirmative" type="submit">
                    Guardar
                  </RqActionButton>
                  <RqActionButton
                    compact
                    onClick={() => setEditingId(null)}
                    tone="secondary"
                    type="button"
                  >
                    Cancelar
                  </RqActionButton>
                </form>
              ) : (
                <>
                  <span
                    className={`rq-params-areas__icon ${areaColorClass(area.color)}`.trim()}
                  >
                    <AreaIcon color={area.color} name={area.icon} size={20} />
                  </span>
                  <span className="rq-params-areas__name">{area.name}</span>
                  <small>
                    {area.projectCount} proyecto
                    {area.projectCount === 1 ? "" : "s"}
                  </small>
                  {canManage ? (
                    <span className="rq-params-areas__actions">
                      <RqActionButton
                        compact
                        onClick={() => {
                          setEditingId(area.id);
                          setEditingName(area.name);
                          setEditingIcon(area.icon);
                          setEditingColor(area.color);
                        }}
                        tone="secondary"
                        type="button"
                      >
                        Editar
                      </RqActionButton>
                      <RqActionButton
                        compact
                        onClick={async () => {
                          if (
                            await confirm({
                              title: "Quitar área",
                              message: `Se quitará «${area.name}» de la lista. Los proyectos que ya la usan conservan su área.`,
                              confirmLabel: "Quitar área",
                              destructive: true,
                            })
                          ) {
                            void run(
                              () =>
                                request<{ id: string }>(`/${area.id}`, {
                                  method: "DELETE",
                                }),
                              `Área «${area.name}» quitada de la lista.`,
                            );
                          }
                        }}
                        tone="danger"
                        type="button"
                      >
                        Quitar
                      </RqActionButton>
                    </span>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
