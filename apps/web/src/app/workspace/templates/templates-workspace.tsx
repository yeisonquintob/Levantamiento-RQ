"use client";

import { useEffect, useMemo, useState } from "react";

import type {
  DocumentTemplateDetail,
  DocumentTemplateListResponse,
  DocumentTemplateLogo,
  DocumentTemplateMetrics,
  DocumentTemplateSection,
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

import { WorkspaceKpiIcon } from "../workspace-kpi-icon";
import { useDialogAccessibility } from "../../use-dialog-accessibility";
import { useAutoDismiss } from "../../use-auto-dismiss";
import { useConfirm } from "../../confirm-dialog";

const GATEWAY_URL =
  process.env.NODE_ENV === "development" && typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : (process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000");

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
  sections: DocumentTemplateSection[];
}

type ModalMode = "create" | "view" | "edit" | "clone" | "logo";

interface LogoSelection {
  fileName: string;
  mediaType: "image/png" | "image/jpeg";
  sizeBytes: number;
  dataBase64: string;
}

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
    sections: [],
  };
}

function typeLabel(value: DocumentTemplateType): string {
  return TEMPLATE_TYPES.find((item) => item.value === value)?.label ?? value;
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
      detail?: string;
      message?: string | readonly string[];
      correlationId?: string;
    };

    const suffix = payload.correlationId
      ? ` Código de seguimiento: ${payload.correlationId}.`
      : "";

    if (typeof payload.detail === "string") {
      return `${payload.detail}${suffix}`;
    }

    if (Array.isArray(payload.message)) {
      return `${payload.message.join(" ")}${suffix}`;
    }

    if (typeof payload.message === "string") {
      return `${payload.message}${suffix}`;
    }
  } catch {
    return text;
  }

  return "La operación no pudo completarse.";
}

export function TemplatesWorkspace({
  initialList,
  initialMetrics,
  initialError,
}: TemplatesWorkspaceProps) {
  const confirm = useConfirm();
  const [list, setList] = useState(initialList ?? EMPTY_LIST);
  const [metrics, setMetrics] = useState(initialMetrics ?? EMPTY_METRICS);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("PUBLISHED");
  const [templateType, setTemplateType] = useState("");
  const [alert, setAlert] = useState<string | null>(initialError ?? null);
  useAutoDismiss(alert, () => setAlert(null));
  const [alertTone, setAlertTone] = useState<"success" | "danger">("danger");
  const [busy, setBusy] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode | null>(null);
  const dialogRef = useDialogAccessibility<HTMLDivElement>(
    Boolean(modalMode),
    () => {
      if (!busy) closeModal();
    },
  );
  const [selected, setSelected] = useState<DocumentTemplateDetail | null>(null);
  const [currentLogo, setCurrentLogo] = useState<DocumentTemplateLogo | null>(
    null,
  );
  const [logoSelection, setLogoSelection] = useState<LogoSelection | null>(
    null,
  );
  const [form, setForm] = useState<TemplateForm>(emptyForm());

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ page: "1", pageSize: "50" });
    if (debouncedSearch.trim()) query.set("search", debouncedSearch.trim());
    if (status) query.set("status", status);
    if (templateType) query.set("templateType", templateType);

    async function filterTemplates(): Promise<void> {
      try {
        const response = await fetch(
          `${GATEWAY_URL}/api/v1/templates?${query.toString()}`,
          { credentials: "include", signal: controller.signal },
        );
        if (!response.ok) throw new Error(await errorMessage(response));
        const result = (await response.json()) as DocumentTemplateListResponse;
        if (!controller.signal.aborted) setList(result);
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        setAlert(error instanceof Error ? error.message : String(error));
        setAlertTone("danger");
      }
    }

    void filterTemplates();
    return () => controller.abort();
  }, [debouncedSearch, status, templateType]);

  const canManage = list.canManage || metrics.canManage;

  const modalTitle = useMemo(() => {
    if (modalMode === "create") return "Nueva plantilla";
    if (modalMode === "edit") return "Editar plantilla";
    if (modalMode === "clone") return "Crear nueva versión";
    if (modalMode === "logo") return "Editar logo de plantilla";
    return "Detalle de plantilla";
  }, [modalMode]);

  function showAlert(message: string, tone: "success" | "danger"): void {
    setAlert(message);
    setAlertTone(tone);
  }

  function closeModal(force = false): void {
    if (busy && !force) return;
    setModalMode(null);
    setSelected(null);
    setCurrentLogo(null);
    setLogoSelection(null);
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

    setList((await listResponse.json()) as DocumentTemplateListResponse);
    setMetrics((await metricsResponse.json()) as DocumentTemplateMetrics);
    setAlert(null);
  }

  async function loadDetail(
    template: DocumentTemplateSummary,
    mode: Exclude<ModalMode, "create">,
  ): Promise<void> {
    setBusy(true);

    try {
      const [response, logoResponse] = await Promise.all([
        fetch(
          `${GATEWAY_URL}/api/v1/templates/${encodeURIComponent(template.id)}`,
          { credentials: "include" },
        ),
        mode === "logo"
          ? fetch(
              `${GATEWAY_URL}/api/v1/templates/${encodeURIComponent(template.id)}/logo`,
              { credentials: "include" },
            )
          : Promise.resolve(null),
      ]);

      if (!response.ok) {
        throw new Error(await errorMessage(response));
      }

      const detail = (await response.json()) as DocumentTemplateDetail;

      if (logoResponse && !logoResponse.ok) {
        throw new Error(await errorMessage(logoResponse));
      }

      setCurrentLogo(
        logoResponse
          ? ((await logoResponse.json()) as DocumentTemplateLogo | null)
          : null,
      );
      setLogoSelection(null);

      setSelected(detail);
      setForm({
        code: detail.code,
        name: detail.name,
        description: detail.description ?? "",
        templateType: detail.templateType,
        version:
          mode === "clone" ? nextVersion(detail.version) : detail.version,
        includesScrum: detail.includesScrum,
        sections: detail.definition.sections.map((section) => ({
          ...section,
        })),
      });
      setAlert(null);
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

  function normalizedSections(): DocumentTemplateSection[] | undefined {
    if (form.sections.length === 0) {
      return undefined;
    }

    return form.sections.map((section, index) => ({
      ...section,
      order: index + 1,
      title: section.title.trim(),
      guidance: section.guidance.trim(),
    }));
  }

  function addSection(): void {
    setForm((current) => {
      const usedKeys = new Set(current.sections.map((section) => section.key));
      const prefix = `customSection${Date.now().toString(36)}`;
      let key = prefix;
      let suffix = 1;

      while (usedKeys.has(key)) {
        key = `${prefix}${suffix}`;
        suffix += 1;
      }

      return {
        ...current,
        sections: [
          ...current.sections,
          {
            key,
            order: current.sections.length + 1,
            title: "Nuevo punto",
            required: true,
            guidance:
              "Describe qué debe analizar y redactar la IA en este punto.",
          },
        ],
      };
    });
  }

  function updateSection(
    index: number,
    change: Partial<DocumentTemplateSection>,
  ): void {
    setForm((current) => ({
      ...current,
      sections: current.sections.map((section, currentIndex) =>
        currentIndex === index ? { ...section, ...change } : section,
      ),
    }));
  }

  function moveSection(index: number, offset: -1 | 1): void {
    setForm((current) => {
      const nextIndex = index + offset;

      if (nextIndex < 0 || nextIndex >= current.sections.length) {
        return current;
      }

      const sections = [...current.sections];
      const currentSection = sections[index];
      const targetSection = sections[nextIndex];

      if (!currentSection || !targetSection) {
        return current;
      }

      sections[index] = targetSection;
      sections[nextIndex] = currentSection;

      return {
        ...current,
        sections: sections.map((section, sectionIndex) => ({
          ...section,
          order: sectionIndex + 1,
        })),
      };
    });
  }

  function removeSection(index: number): void {
    setForm((current) => {
      if (current.sections.length <= 1) {
        return current;
      }

      return {
        ...current,
        sections: current.sections
          .filter((_, currentIndex) => currentIndex !== index)
          .map((section, sectionIndex) => ({
            ...section,
            order: sectionIndex + 1,
          })),
      };
    });
  }

  function selectLogo(file: File | undefined): void {
    if (!file) return;

    if (file.type !== "image/png" && file.type !== "image/jpeg") {
      showAlert("El logo debe ser una imagen PNG o JPEG.", "danger");
      return;
    }

    if (file.size < 1 || file.size > 512 * 1024) {
      showAlert("El logo debe pesar máximo 512 KB.", "danger");
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => {
      showAlert("No fue posible leer la imagen seleccionada.", "danger");
    };
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      const dataBase64 = value.split(",", 2)[1];

      if (!dataBase64) {
        showAlert("La imagen seleccionada no es válida.", "danger");
        return;
      }

      setLogoSelection({
        fileName: file.name,
        mediaType: file.type as "image/png" | "image/jpeg",
        sizeBytes: file.size,
        dataBase64,
      });
      setAlert(null);
    };
    reader.readAsDataURL(file);
  }

  async function submitModal(): Promise<void> {
    if (!modalMode || modalMode === "view") return;

    setBusy(true);

    try {
      let response: Response;

      if (modalMode === "logo" && selected) {
        if (!logoSelection) {
          throw new Error("Selecciona un logo PNG o JPEG antes de guardar.");
        }

        response = await fetch(
          `${GATEWAY_URL}/api/v1/templates/${encodeURIComponent(selected.id)}/logo`,
          {
            method: "PUT",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              fileName: logoSelection.fileName,
              mediaType: logoSelection.mediaType,
              dataBase64: logoSelection.dataBase64,
            }),
          },
        );

        if (!response.ok) {
          throw new Error(await errorMessage(response));
        }

        closeModal(true);
        await refresh();
        showAlert(
          "El logo quedó guardado y se usará en las nuevas exportaciones PDF.",
          "success",
        );
        return;
      }

      const sections = normalizedSections();

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
            sections,
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
              sections,
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
              sections,
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
        ? "La versión publicada será inmutable."
        : "La plantilla dejará de estar disponible como versión activa.";

    if (
      !(await confirm({
        title: action === "publish" ? "Publicar versión" : "Retirar plantilla",
        message,
        confirmLabel: action === "publish" ? "Publicar" : "Retirar",
        destructive: action === "retire",
      }))
    )
      return;

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
            icon={<WorkspaceKpiIcon name="layers" />}
            title="Total"
            value={String(metrics.total)}
          />
          <RqKpiCard
            description="Editables / fuera de uso"
            icon={<WorkspaceKpiIcon name="drafts" />}
            title="Borradores / retiradas"
            value={`${metrics.draft} / ${metrics.retired}`}
          />
          <RqKpiCard
            description="Versiones inmutables"
            icon={<WorkspaceKpiIcon name="check" />}
            title="Publicadas"
            value={String(metrics.published)}
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
        <div className="rq-project-alert" data-tone={alertTone} role="alert">
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
        className="rq-projects-filters"
        onSubmit={(event) => event.preventDefault()}
      >
        <label className="rq-projects-filter rq-projects-filter--search">
          <span>Buscar plantilla:</span>
          <svg
            aria-hidden="true"
            fill="none"
            height="17"
            viewBox="0 0 24 24"
            width="17"
          >
            <circle
              cx="10.5"
              cy="10.5"
              r="6.5"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <path
              d="m15.5 15.5 5 5"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.8"
            />
          </svg>
          <input
            aria-label="Buscar plantilla por código, nombre o versión"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Código, nombre o versión"
            type="search"
            value={search}
          />
        </label>

        <label className="rq-projects-filter">
          <span>Tipo:</span>
          <select
            aria-label="Tipo"
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

        <label className="rq-projects-filter">
          <span>Estado:</span>
          <select
            aria-label="Estado"
            onChange={(event) => setStatus(event.target.value)}
            value={status}
          >
            <option value="">Todos</option>
            <option value="DRAFT">Borrador</option>
            <option value="PUBLISHED">Publicada</option>
            <option value="RETIRED">Retirada</option>
          </select>
        </label>

        <RqActionButton
          disabled={busy}
          onClick={() => {
            setSearch("");
            setStatus("PUBLISHED");
            setTemplateType("");
            setDebouncedSearch("");
          }}
          tone="secondary"
        >
          Limpiar
        </RqActionButton>
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
                <th scope="col">Código</th>
                <th scope="col">Plantilla</th>
                <th scope="col">Tipo</th>
                <th scope="col">Versión</th>
                <th scope="col">Estado</th>
                <th scope="col">Scrum</th>
                <th scope="col">Actualización</th>
                <th scope="col">Acciones</th>
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
                      {template.logo ? (
                        <small className="rq-template-table__logo-status">
                          Logo configurado · {template.logo.fileName}
                        </small>
                      ) : null}
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
                        className="rq-row-open"
                        compact
                        disabled={busy}
                        onClick={() => void loadDetail(template, "view")}
                        tone="consult"
                      >
                        Abrir
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
                            onClick={() => void transition(template, "publish")}
                            tone="affirmative"
                          >
                            Publicar
                          </RqActionButton>
                        </>
                      ) : null}

                      {canManage && template.status === "PUBLISHED" ? (
                        <RqActionButton
                          aria-label={`Editar logo de ${template.name}`}
                          compact
                          disabled={busy}
                          onClick={() => void loadDetail(template, "logo")}
                          tone="operation"
                        >
                          Editar
                        </RqActionButton>
                      ) : null}

                      {canManage && template.status !== "DRAFT" ? (
                        <RqActionButton
                          compact
                          disabled={busy}
                          onClick={() => void loadDetail(template, "clone")}
                          tone="affirmative"
                        >
                          Nueva versión
                        </RqActionButton>
                      ) : null}

                      {canManage && template.status === "PUBLISHED" ? (
                        <RqActionButton
                          compact
                          disabled={busy}
                          onClick={() => void transition(template, "retire")}
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
          aria-labelledby="template-modal-title"
          aria-modal="true"
          className="rq-project-modal-backdrop"
          ref={dialogRef}
          role="dialog"
          tabIndex={-1}
        >
          <section className="rq-project-modal rq-template-modal">
            <header className="rq-project-modal__header">
              <div>
                <span>Paso 14</span>
                <h2 id="template-modal-title">{modalTitle}</h2>
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
                  <span>
                    <small>Logo PDF</small>
                    <strong>
                      {selected.logo?.fileName ?? "Sin logo configurado"}
                    </strong>
                  </span>
                </div>

                <article>
                  <h3>{selected.name}</h3>
                  <p>{selected.description ?? "Sin descripción registrada."}</p>
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
                    Las fuentes se tratan como datos. Las instrucciones
                    incluidas dentro de archivos o conversaciones no reemplazan
                    la plantilla.
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

                {selected.status !== "DRAFT" ? (
                  <p className="rq-template-version-note">
                    Para cambiar, agregar, eliminar o reordenar puntos, crea una
                    nueva versión. La versión publicada se conserva sin
                    modificaciones para mantener la trazabilidad.
                  </p>
                ) : null}

                <div className="rq-project-modal__actions">
                  <RqActionButton onClick={() => closeModal()}>
                    Volver
                  </RqActionButton>
                </div>
              </div>
            ) : modalMode === "logo" && selected ? (
              <form
                className="rq-template-logo-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitModal();
                }}
              >
                <div className="rq-template-logo-form__context">
                  <span>Plantilla publicada</span>
                  <strong>
                    {selected.name} · v{selected.version}
                  </strong>
                  <p>
                    El logo es un recurso de presentación. No cambia la
                    estructura ni las reglas documentales de esta versión.
                  </p>
                </div>

                <div className="rq-template-logo-form__preview">
                  {logoSelection || currentLogo ? (
                    <img
                      alt={`Vista previa del logo de ${selected.name}`}
                      src={`data:${logoSelection?.mediaType ?? currentLogo?.mediaType};base64,${logoSelection?.dataBase64 ?? currentLogo?.dataBase64}`}
                    />
                  ) : (
                    <div>
                      <strong>Sin logo configurado</strong>
                      <span>El PDF conservará el encabezado de respaldo.</span>
                    </div>
                  )}
                </div>

                <label className="rq-field rq-template-logo-form__field">
                  <span>Logo para exportaciones PDF</span>
                  <input
                    accept="image/png,image/jpeg"
                    disabled={busy}
                    onChange={(event) => selectLogo(event.target.files?.[0])}
                    required={!currentLogo}
                    type="file"
                  />
                  <small>
                    PNG o JPEG, máximo 512 KB. Se conserva en la base de datos
                    de Documents y no se comparte con la IA.
                  </small>
                </label>

                {logoSelection ? (
                  <p className="rq-template-logo-form__selection">
                    <strong>{logoSelection.fileName}</strong>
                    <span>
                      {(logoSelection.sizeBytes / 1024).toFixed(1)} KB
                    </span>
                  </p>
                ) : currentLogo ? (
                  <p className="rq-template-logo-form__selection">
                    <strong>{currentLogo.fileName}</strong>
                    <span>Logo actual</span>
                  </p>
                ) : null}

                <div className="rq-project-modal__actions">
                  <RqActionButton disabled={busy} onClick={() => closeModal()}>
                    Cancelar
                  </RqActionButton>
                  <RqActionButton
                    disabled={busy || !logoSelection}
                    tone="affirmative"
                    type="submit"
                  >
                    Guardar logo
                  </RqActionButton>
                </div>
              </form>
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
                      const nextType = event.target
                        .value as DocumentTemplateType;
                      setForm((current) => ({
                        ...current,
                        templateType: nextType,
                        includesScrum: nextType === "ERP_FDD" ? false : true,
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
                    disabled={busy || form.templateType !== "ERP_FDD"}
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

                <section className="rq-template-section-editor">
                  <header>
                    <div>
                      <h3>Puntos de la plantilla</h3>
                      <p>
                        Cambia el título y la instrucción de cada punto, agrega
                        nuevos, elimina los innecesarios o modifica el orden.
                        Estos puntos serán la estructura y el contexto que
                        recibirá la IA.
                      </p>
                    </div>
                    <RqActionButton
                      compact
                      disabled={busy || form.sections.length >= 50}
                      onClick={addSection}
                      tone="affirmative"
                      type="button"
                    >
                      Agregar punto
                    </RqActionButton>
                  </header>

                  {modalMode === "create" && form.sections.length === 0 ? (
                    <div className="rq-template-section-editor__empty">
                      La plantilla se creará con los trece puntos base del tipo
                      seleccionado. También puedes agregar aquí una estructura
                      personalizada desde el inicio.
                    </div>
                  ) : (
                    <ol className="rq-template-section-editor__list">
                      {form.sections.map((section, index) => (
                        <li key={section.key}>
                          <div className="rq-template-section-editor__heading">
                            <span>{index + 1}</span>
                            <div>
                              <button
                                aria-label={`Subir punto ${index + 1}`}
                                disabled={busy || index === 0}
                                onClick={() => moveSection(index, -1)}
                                type="button"
                              >
                                ↑
                              </button>
                              <button
                                aria-label={`Bajar punto ${index + 1}`}
                                disabled={
                                  busy || index === form.sections.length - 1
                                }
                                onClick={() => moveSection(index, 1)}
                                type="button"
                              >
                                ↓
                              </button>
                              <button
                                aria-label={`Eliminar punto ${index + 1}`}
                                disabled={busy || form.sections.length <= 1}
                                onClick={() => removeSection(index)}
                                type="button"
                              >
                                Eliminar
                              </button>
                            </div>
                          </div>

                          <label className="rq-field">
                            <span>Título del punto</span>
                            <input
                              disabled={busy}
                              maxLength={200}
                              onChange={(event) =>
                                updateSection(index, {
                                  title: event.target.value,
                                })
                              }
                              required
                              value={section.title}
                            />
                          </label>

                          <label className="rq-field">
                            <span>
                              Instrucción de análisis y redacción para la IA
                            </span>
                            <textarea
                              disabled={busy}
                              maxLength={2000}
                              onChange={(event) =>
                                updateSection(index, {
                                  guidance: event.target.value,
                                })
                              }
                              required
                              rows={3}
                              value={section.guidance}
                            />
                          </label>

                          <label className="rq-template-section-required">
                            <input
                              checked={section.required}
                              disabled={busy}
                              onChange={(event) =>
                                updateSection(index, {
                                  required: event.target.checked,
                                })
                              }
                              type="checkbox"
                            />
                            <span>Punto obligatorio</span>
                          </label>
                        </li>
                      ))}
                    </ol>
                  )}

                  {modalMode === "clone" ? (
                    <small>
                      Los cambios se guardarán en una nueva versión borrador. La
                      versión publicada permanecerá intacta.
                    </small>
                  ) : null}
                </section>

                <div className="rq-project-modal__actions">
                  <RqActionButton disabled={busy} onClick={() => closeModal()}>
                    Volver
                  </RqActionButton>
                  <RqActionButton
                    disabled={busy}
                    tone="affirmative"
                    type="submit"
                  >
                    {modalMode === "clone" ? "Crear versión" : "Guardar"}
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
