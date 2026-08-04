"use client";

import { useMemo, useState } from "react";

import type {
  DocumentTemplateDetail,
  DocumentTemplateListResponse,
  DocumentTemplateMetrics,
  DocumentTemplateStatus,
  DocumentTemplateSummary,
  DocumentTemplateType,
} from "@levantamiento-rq/shared-contracts";
import {
  RqActionButton,
  RqEmptyState,
  RqKpiCard,
  RqKpiGrid,
  RqStatusBadge,
  RqTableShell,
} from "@levantamiento-rq/shared-ui";

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000";

const EMPTY_METRICS: DocumentTemplateMetrics = {
  total: 0,
  draft: 0,
  published: 0,
  retired: 0,
  small: 0,
  medium: 0,
  large: 0,
  erpFdd: 0,
  canManage: false,
};

const EMPTY_LIST: DocumentTemplateListResponse = {
  items: [],
  page: 1,
  pageSize: 50,
  totalItems: 0,
  totalPages: 0,
  canManage: false,
};

const TEMPLATE_TYPES: readonly {
  value: DocumentTemplateType;
  label: string;
}[] = [
  { value: "SMALL_REQUIREMENT", label: "Requerimiento pequeño" },
  { value: "MEDIUM_REQUIREMENT", label: "Requerimiento mediano" },
  { value: "LARGE_REQUIREMENT", label: "Requerimiento grande" },
  { value: "ERP_FDD", label: "FDD ERP" },
];

interface TemplateForm {
  code: string;
  name: string;
  description: string;
  templateType: DocumentTemplateType;
  version: string;
  includesScrum: boolean;
}

type ModalMode = "create" | "view" | "edit" | "clone";

interface TemplatesWorkspaceProps {
  initialList?: DocumentTemplateListResponse;
  initialMetrics?: DocumentTemplateMetrics;
  initialError?: string | null;
}

function emptyForm(): TemplateForm {
  return {
    code: "",
    name: "",
    description: "",
    templateType: "SMALL_REQUIREMENT",
    version: "1.0.0",
    includesScrum: true,
  };
}

function typeLabel(value: DocumentTemplateType): string {
  return (
    TEMPLATE_TYPES.find((item) => item.value === value)?.label ??
    value
  );
}

function statusLabel(value: DocumentTemplateStatus): string {
  if (value === "PUBLISHED") return "Publicada";
  if (value === "RETIRED") return "Retirada";
  return "Borrador";
}

function statusTone(
  value: DocumentTemplateStatus,
): "success" | "pending" | "inactive" {
  if (value === "PUBLISHED") return "success";
  if (value === "RETIRED") return "inactive";
  return "pending";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
  }).format(new Date(value));
}

async function errorMessage(response: Response): Promise<string> {
  if (response.status === 401) {
    window.location.assign("/sign-in");
    return "Sesión vencida.";
  }

  const text = await response.text();

  if (!text) {
    return "La operación no pudo completarse.";
  }

  try {
    const payload = JSON.parse(text) as {
      message?: string | readonly string[];
    };

    if (Array.isArray(payload.message)) {
      return payload.message.join(" ");
    }

    if (typeof payload.message === "string") {
      return payload.message;
    }
  } catch {
    return text;
  }

  return text;
}

export function TemplatesWorkspace({
  initialList,
  initialMetrics,
  initialError,
}: TemplatesWorkspaceProps) {
  const [list, setList] = useState(initialList ?? EMPTY_LIST);
  const [metrics, setMetrics] = useState(
    initialMetrics ?? EMPTY_METRICS,
  );
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [templateType, setTemplateType] = useState("");
  const [alert, setAlert] = useState<string | null>(
    initialError ?? null,
  );
  const [alertTone, setAlertTone] = useState<
    "success" | "danger"
  >("danger");
  const [busy, setBusy] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode | null>(null);
  const [selected, setSelected] =
    useState<DocumentTemplateDetail | null>(null);
  const [form, setForm] = useState<TemplateForm>(emptyForm());

  const canManage = list.canManage || metrics.canManage;

  const modalTitle = useMemo(() => {
    if (modalMode === "create") return "Nueva plantilla";
    if (modalMode === "edit") return "Editar plantilla";
    if (modalMode === "clone") return "Crear nueva versión";
    return "Detalle de plantilla";
  }, [modalMode]);

  function showAlert(
    message: string,
    tone: "success" | "danger",
  ): void {
    setAlert(message);
    setAlertTone(tone);
  }

  function closeModal(force = false): void {
    if (busy && !force) return;
    setModalMode(null);
    setSelected(null);
    setForm(emptyForm());
  }

  async function refresh(
    nextSearch = search,
    nextStatus = status,
    nextType = templateType,
  ): Promise<void> {
    const query = new URLSearchParams({
      page: "1",
      pageSize: "50",
    });

    if (nextSearch.trim()) query.set("search", nextSearch.trim());
    if (nextStatus) query.set("status", nextStatus);
    if (nextType) query.set("templateType", nextType);

    const [listResponse, metricsResponse] = await Promise.all([
      fetch(`${GATEWAY_URL}/api/v1/templates?${query.toString()}`, {
        credentials: "include",
      }),
      fetch(`${GATEWAY_URL}/api/v1/templates/summary`, {
        credentials: "include",
      }),
    ]);

    if (!listResponse.ok || !metricsResponse.ok) {
      throw new Error(
        !listResponse.ok
          ? await errorMessage(listResponse)
          : await errorMessage(metricsResponse),
      );
    }

    setList(
      (await listResponse.json()) as DocumentTemplateListResponse,
    );
    setMetrics(
      (await metricsResponse.json()) as DocumentTemplateMetrics,
    );
  }

  async function loadDetail(
    template: DocumentTemplateSummary,
    mode: Exclude<ModalMode, "create">,
  ): Promise<void> {
    setBusy(true);

    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/templates/${encodeURIComponent(template.id)}`,
        { credentials: "include" },
      );

      if (!response.ok) {
        throw new Error(await errorMessage(response));
      }

      const detail =
        (await response.json()) as DocumentTemplateDetail;

      setSelected(detail);
      setForm({
        code: detail.code,
        name: detail.name,
        description: detail.description ?? "",
        templateType: detail.templateType,
        version:
          mode === "clone" ? nextVersion(detail.version) : detail.version,
        includesScrum: detail.includesScrum,
      });
      setModalMode(mode);
    } catch (error) {
      showAlert(
        error instanceof Error ? error.message : String(error),
        "danger",
      );
    } finally {
      setBusy(false);
    }
  }

  function nextVersion(version: string): string {
    const parts = version.split(".").map(Number);
    return `${parts[0] ?? 1}.${(parts[1] ?? 0) + 1}.0`;
  }

  async function submitModal(): Promise<void> {
    if (!modalMode || modalMode === "view") return;

    setBusy(true);

    try {
      let response: Response;

      if (modalMode === "create") {
        response = await fetch(`${GATEWAY_URL}/api/v1/templates`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            code: form.code,
            name: form.name,
            description: form.description || null,
            templateType: form.templateType,
            version: form.version,
            includesScrum: form.includesScrum,
          }),
        });
      } else if (modalMode === "edit" && selected) {
        response = await fetch(
          `${GATEWAY_URL}/api/v1/templates/${encodeURIComponent(selected.id)}`,
          {
            method: "PATCH",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: form.name,
              description: form.description || null,
              includesScrum: form.includesScrum,
            }),
          },
        );
      } else if (modalMode === "clone" && selected) {
        response = await fetch(
          `${GATEWAY_URL}/api/v1/templates/${encodeURIComponent(selected.id)}/clone`,
          {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              version: form.version,
              name: form.name,
              description: form.description || null,
              includesScrum: form.includesScrum,
            }),
          },
        );
      } else {
        return;
      }

      if (!response.ok) {
        throw new Error(await errorMessage(response));
      }

      closeModal(true);
      await refresh();
      showAlert(
        modalMode === "clone"
          ? "La nueva versión quedó en borrador."
          : "La plantilla se guardó correctamente.",
        "success",
      );
    } catch (error) {
      showAlert(
        error instanceof Error ? error.message : String(error),
        "danger",
      );
    } finally {
      setBusy(false);
    }
  }

  async function transition(
    template: DocumentTemplateSummary,
    action: "publish" | "retire",
  ): Promise<void> {
    const message =
      action === "publish"
        ? "La versión publicada será inmutable. ¿Deseas continuar?"
        : "La plantilla dejará de estar disponible como versión activa. ¿Deseas continuar?";

    if (!window.confirm(message)) return;

    setBusy(true);

    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/templates/${encodeURIComponent(template.id)}/${action}`,
        {
          method: "POST",
          credentials: "include",
        },
      );

      if (!response.ok) {
        throw new Error(await errorMessage(response));
      }

      await refresh();
      showAlert(
        action === "publish"
          ? "Plantilla publicada correctamente."
          : "Plantilla retirada correctamente.",
        "success",
      );
    } catch (error) {
      showAlert(
        error instanceof Error ? error.message : String(error),
        "danger",
      );
    } finally {
      setBusy(false);
    }
  }

  function openCreate(): void {
    setSelected(null);
    setForm(emptyForm());
    setModalMode("create");
  }

  return (
    <section className="rq-template-workspace">
      <section className="rq-module-commandbar">
        <RqKpiGrid label="Resumen de plantillas">
          <RqKpiCard
            description="Versiones registradas"
            icon="T"
            title="Total"
            value={String(metrics.total)}
          />
          <RqKpiCard
            description="Editables"
            icon="B"
            title="Borradores"
            value={String(metrics.draft)}
          />
          <RqKpiCard
            description="Versiones inmutables"
            icon="P"
            title="Publicadas"
            value={String(metrics.published)}
          />
          <RqKpiCard
            description="Fuera de uso"
            icon="R"
            title="Retiradas"
            value={String(metrics.retired)}
          />
        </RqKpiGrid>

        <div className="rq-module-commandbar__actions">
          <RqActionButton
            disabled={!canManage || busy}
            onClick={openCreate}
            tone="affirmative"
          >
            Nueva plantilla
          </RqActionButton>
        </div>
      </section>

      {alert ? (
        <div
          className="rq-project-alert"
          data-tone={alertTone}
          role="alert"
        >
          <span>{alert}</span>
          <button
            aria-label="Cerrar mensaje"
            onClick={() => setAlert(null)}
            type="button"
          >
            ×
          </button>
        </div>
      ) : null}

      <form
        className="rq-filter-bar rq-template-filter-bar"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          void refresh()
            .catch((error: unknown) => {
              showAlert(
                error instanceof Error
                  ? error.message
                  : String(error),
                "danger",
              );
            })
            .finally(() => setBusy(false));
        }}
      >
        <label className="rq-field">
          <span>Buscar</span>
          <input
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Código, nombre o versión"
            value={search}
          />
        </label>

        <label className="rq-field">
          <span>Tipo</span>
          <select
            onChange={(event) => setTemplateType(event.target.value)}
            value={templateType}
          >
            <option value="">Todos</option>
            {TEMPLATE_TYPES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className="rq-field">
          <span>Estado</span>
          <select
            onChange={(event) => setStatus(event.target.value)}
            value={status}
          >
            <option value="">Todos</option>
            <option value="DRAFT">Borrador</option>
            <option value="PUBLISHED">Publicada</option>
            <option value="RETIRED">Retirada</option>
          </select>
        </label>

        <div className="rq-filter-bar__actions">
          <RqActionButton disabled={busy} tone="consult" type="submit">
            Consultar
          </RqActionButton>
          <RqActionButton
            disabled={busy}
            onClick={() => {
              setSearch("");
              setStatus("");
              setTemplateType("");
              setBusy(true);
              void refresh("", "", "")
                .catch((error: unknown) => {
                  showAlert(
                    error instanceof Error
                      ? error.message
                      : String(error),
                    "danger",
                  );
                })
                .finally(() => setBusy(false));
            }}
          >
            Limpiar
          </RqActionButton>
        </div>
      </form>

      <RqTableShell
        count={list.totalItems}
        description="Versiones configuradas para requerimientos pequeños, medianos, grandes y FDD ERP."
        title="Catálogo de plantillas"
      >
        {list.items.length === 0 ? (
          <RqEmptyState
            description="No hay plantillas que coincidan con los filtros seleccionados."
            title="Sin resultados"
          />
        ) : (
          <table className="rq-table rq-template-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Plantilla</th>
                <th>Tipo</th>
                <th>Versión</th>
                <th>Estado</th>
                <th>Scrum</th>
                <th>Actualización</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((template) => (
                <tr key={template.id}>
                  <td>
                    <strong>{template.code}</strong>
                  </td>
                  <td>
                    <span className="rq-template-table__name">
                      <strong>{template.name}</strong>
                      <span>{template.description ?? "Sin descripción"}</span>
                    </span>
                  </td>
                  <td>{typeLabel(template.templateType)}</td>
                  <td>{template.version}</td>
                  <td>
                    <RqStatusBadge tone={statusTone(template.status)}>
                      {statusLabel(template.status)}
                    </RqStatusBadge>
                  </td>
                  <td>{template.includesScrum ? "Sí" : "No"}</td>
                  <td>{formatDate(template.updatedAt)}</td>
                  <td>
                    <div className="rq-template-table__actions">
                      <RqActionButton
                        compact
                        disabled={busy}
                        onClick={() => void loadDetail(template, "view")}
                        tone="consult"
                      >
                        Ver
                      </RqActionButton>

                      {canManage && template.status === "DRAFT" ? (
                        <>
                          <RqActionButton
                            compact
                            disabled={busy}
                            onClick={() => void loadDetail(template, "edit")}
                            tone="operation"
                          >
                            Editar
                          </RqActionButton>
                          <RqActionButton
                            compact
                            disabled={busy}
                            onClick={() =>
                              void transition(template, "publish")
                            }
                            tone="affirmative"
                          >
                            Publicar
                          </RqActionButton>
                        </>
                      ) : null}

                      {canManage && template.status !== "DRAFT" ? (
                        <RqActionButton
                          compact
                          disabled={busy}
                          onClick={() => void loadDetail(template, "clone")}
                          tone="operation"
                        >
                          Nueva versión
                        </RqActionButton>
                      ) : null}

                      {canManage && template.status === "PUBLISHED" ? (
                        <RqActionButton
                          compact
                          disabled={busy}
                          onClick={() =>
                            void transition(template, "retire")
                          }
                          tone="danger"
                        >
                          Retirar
                        </RqActionButton>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </RqTableShell>

      {modalMode ? (
        <div
          aria-modal="true"
          className="rq-project-modal-backdrop"
          role="dialog"
        >
          <section className="rq-project-modal rq-template-modal">
            <header className="rq-project-modal__header">
              <div>
                <span>Paso 14</span>
                <h2>{modalTitle}</h2>
              </div>
              <button
                aria-label="Cerrar"
                disabled={busy}
                onClick={() => closeModal()}
                type="button"
              >
                ×
              </button>
            </header>

            {modalMode === "view" && selected ? (
              <div className="rq-template-detail">
                <div className="rq-template-detail__metadata">
                  <span>
                    <small>Código</small>
                    <strong>{selected.code}</strong>
                  </span>
                  <span>
                    <small>Versión</small>
                    <strong>{selected.version}</strong>
                  </span>
                  <span>
                    <small>Tipo</small>
                    <strong>{typeLabel(selected.templateType)}</strong>
                  </span>
                  <span>
                    <small>Estado</small>
                    <strong>{statusLabel(selected.status)}</strong>
                  </span>
                  <span>
                    <small>Scrum</small>
                    <strong>
                      {selected.includesScrum
                        ? "Epic, Feature, HU y criterios"
                        : "No automático"}
                    </strong>
                  </span>
                  <span>
                    <small>Estándar</small>
                    <strong>ISO/IEC/IEEE 29148:2018</strong>
                  </span>
                  <span>
                    <small>Uso con IA</small>
                    <strong>Contexto y contrato de salida</strong>
                  </span>
                </div>

                <article>
                  <h3>{selected.name}</h3>
                  <p>
                    {selected.description ?? "Sin descripción registrada."}
                  </p>
                </article>

                <article className="rq-template-ai-context">
                  <h3>Contexto para análisis con IA</h3>
                  <p>{selected.definition.aiPrompt.purpose}</p>
                  <p>
                    <strong>Instrucción del sistema:</strong>{" "}
                    {selected.definition.aiPrompt.systemInstruction}
                  </p>
                  <p>
                    <strong>Tratamiento de fuentes:</strong>{" "}
                    {selected.definition.aiPrompt.sourceInstruction}
                  </p>
                  <p>
                    <strong>Contrato de salida:</strong>{" "}
                    {selected.definition.outputContract.format} · esquema{" "}
                    {selected.definition.outputContract.schemaVersion} · raíz{" "}
                    {selected.definition.outputContract.rootKey}
                  </p>
                  <small>
                    Las fuentes se tratan como datos. Las instrucciones incluidas
                    dentro de archivos o conversaciones no reemplazan la plantilla.
                  </small>
                </article>

                <ol className="rq-template-sections">
                  {selected.definition.sections.map((section) => (
                    <li key={section.key}>
                      <span>{section.order}</span>
                      <div>
                        <strong>{section.title}</strong>
                        <p>{section.guidance}</p>
                      </div>
                    </li>
                  ))}
                </ol>

                <div className="rq-project-modal__actions">
                  <RqActionButton onClick={() => closeModal()}>
                    Volver
                  </RqActionButton>
                </div>
              </div>
            ) : (
              <form
                className="rq-project-form rq-template-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitModal();
                }}
              >
                <label className="rq-field">
                  <span>Código</span>
                  <input
                    disabled={modalMode !== "create" || busy}
                    maxLength={40}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        code: event.target.value.toUpperCase(),
                      }))
                    }
                    required
                    value={form.code}
                  />
                </label>

                <label className="rq-field">
                  <span>Versión SemVer</span>
                  <input
                    disabled={modalMode === "edit" || busy}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        version: event.target.value,
                      }))
                    }
                    pattern="[0-9]+\.[0-9]+\.[0-9]+"
                    required
                    value={form.version}
                  />
                </label>

                <label className="rq-field">
                  <span>Tipo</span>
                  <select
                    disabled={modalMode !== "create" || busy}
                    onChange={(event) => {
                      const nextType =
                        event.target.value as DocumentTemplateType;
                      setForm((current) => ({
                        ...current,
                        templateType: nextType,
                        includesScrum:
                          nextType === "ERP_FDD"
                            ? false
                            : true,
                      }));
                    }}
                    value={form.templateType}
                  >
                    {TEMPLATE_TYPES.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="rq-field">
                  <span>Nombre</span>
                  <input
                    disabled={busy}
                    maxLength={200}
                    minLength={3}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    required
                    value={form.name}
                  />
                </label>

                <label className="rq-field rq-template-form__description">
                  <span>Descripción</span>
                  <textarea
                    disabled={busy}
                    maxLength={2000}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    rows={4}
                    value={form.description}
                  />
                </label>

                <label className="rq-template-scrum-option">
                  <input
                    checked={form.includesScrum}
                    disabled={
                      busy ||
                      form.templateType !== "ERP_FDD"
                    }
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        includesScrum: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  <span>
                    <strong>Incluir Scrum en esta plantilla</strong>
                    <small>
                      Epic, Feature, historia de usuario y criterios de
                      aceptación. En pequeño, mediano y grande es obligatorio;
                      en FDD ERP es opcional.
                    </small>
                  </span>
                </label>

                <div className="rq-project-modal__actions">
                  <RqActionButton
                    disabled={busy}
                    onClick={() => closeModal()}
                  >
                    Volver
                  </RqActionButton>
                  <RqActionButton
                    disabled={busy}
                    tone="affirmative"
                    type="submit"
                  >
                    {modalMode === "clone"
                      ? "Crear versión"
                      : "Guardar"}
                  </RqActionButton>
                </div>
              </form>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}
