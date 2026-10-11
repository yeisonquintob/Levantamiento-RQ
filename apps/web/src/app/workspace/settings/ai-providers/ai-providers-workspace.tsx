"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  AiProviderConfigurationListResponse,
  AiProviderConfigurationSummary,
  AiProviderConnectionTestResult,
  OllamaInstalledModelsResponse,
} from "@levantamiento-rq/shared-contracts";
import {
  RqActionButton,
  RqEmptyState,
  RqKpiCard,
  RqKpiGrid,
  RqStatusBadge,
  RqTableShell,
} from "@levantamiento-rq/shared-ui";

import { useDialogAccessibility } from "../../../use-dialog-accessibility";
import { WorkspaceKpiIcon } from "../../workspace-kpi-icon";
import { ProviderColumnsView } from "./provider-columns-view";
import { useAutoDismiss } from "../../../use-auto-dismiss";

const GATEWAY_URL =
  process.env.NODE_ENV === "development" && typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : (process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000");

const EMPTY_LIST: AiProviderConfigurationListResponse = {
  items: [],
  totalItems: 0,
  enabled: 0,
  credentialConfigured: 0,
};

type ModalMode = "create" | "duplicate" | "edit" | "credential" | "delete";
type ProviderPurpose = "TEXT" | "IMAGE";
type ProviderKind =
  | "OPENAI"
  | "ANTHROPIC"
  | "GEMINI"
  | "GROQ"
  | "CEREBRAS"
  | "OLLAMA"
  | "OPENAI_COMPATIBLE"
  | "COMFYUI"
  | "OLLAMA_IMAGES";
type ProviderView = "TEXT" | "IMAGE" | "PROVIDERS";
type ProviderFamily =
  | "OLLAMA"
  | "OPENAI"
  | "COMFYUI"
  | "COMPATIBLE"
  | "CLAUDE"
  | "GEMINI"
  | "GROQ"
  | "CEREBRAS";
type StatusFilter = "" | "ENABLED" | "DISABLED";
type CredentialFilter = "" | "PROTECTED" | "MISSING" | "NOT_REQUIRED";

/** Proveedores de nube cuya API key vive en la bóveda del servidor. */
function isKeyProviderKind(kind: ProviderKind): boolean {
  return (
    kind === "OPENAI" ||
    kind === "ANTHROPIC" ||
    kind === "GEMINI" ||
    kind === "GROQ" ||
    kind === "CEREBRAS"
  );
}

function providerFamily(kind: ProviderKind): ProviderFamily {
  if (kind === "OPENAI") return "OPENAI";
  if (kind === "ANTHROPIC") return "CLAUDE";
  if (kind === "GEMINI") return "GEMINI";
  if (kind === "GROQ") return "GROQ";
  if (kind === "CEREBRAS") return "CEREBRAS";
  if (kind === "COMFYUI") return "COMFYUI";
  if (kind === "OPENAI_COMPATIBLE") return "COMPATIBLE";
  return "OLLAMA";
}

function credentialState(
  provider: AiProviderConfigurationSummary,
): Exclude<CredentialFilter, ""> {
  if (!provider.requiresCredential) return "NOT_REQUIRED";
  return provider.credentialConfigured ? "PROTECTED" : "MISSING";
}

function isOllamaKind(
  providerType: ProviderKind,
): providerType is "OLLAMA" | "OLLAMA_IMAGES" | "OPENAI_COMPATIBLE" {
  return (
    providerType === "OLLAMA" ||
    providerType === "OLLAMA_IMAGES" ||
    providerType === "OPENAI_COMPATIBLE"
  );
}

/** Ruta del gateway que lista los modelos del servidor según el tipo. */
function modelsRoute(providerType: ProviderKind): string {
  return providerType === "OPENAI_COMPATIBLE"
    ? "openai-compatible/models"
    : "ollama/models";
}

interface ProviderForm {
  purpose: ProviderPurpose;
  providerType: ProviderKind;
  name: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  timeoutMinutes: string;
  maxInputTokens: string;
  maxOutputTokens: string;
  maxAttempts: string;
  isEnabled: boolean;
  isDefault: boolean;
}

interface Props {
  initialList?: AiProviderConfigurationListResponse;
  initialError?: string;
}

function providerDefaults(
  purpose: ProviderPurpose,
  providerType: ProviderKind,
): Pick<
  ProviderForm,
  "model" | "baseUrl" | "timeoutMinutes" | "maxInputTokens" | "maxOutputTokens"
> {
  if (providerType === "OLLAMA") {
    return {
      model: "gemma4:12b",
      baseUrl: "http://127.0.0.1:11434",
      timeoutMinutes: "10",
      maxInputTokens: "131072",
      maxOutputTokens: "12000",
    };
  }
  if (
    providerType === "ANTHROPIC" ||
    providerType === "GEMINI" ||
    providerType === "GROQ" ||
    providerType === "CEREBRAS"
  ) {
    return {
      model: "",
      baseUrl:
        providerType === "ANTHROPIC"
          ? "https://api.anthropic.com/v1"
          : providerType === "GEMINI"
            ? "https://generativelanguage.googleapis.com/v1beta"
            : providerType === "GROQ"
              ? "https://api.groq.com/openai/v1"
              : "https://api.cerebras.ai/v1",
      timeoutMinutes: "5",
      maxInputTokens: "120000",
      maxOutputTokens: "12000",
    };
  }
  if (providerType === "OPENAI_COMPATIBLE") {
    return {
      model: "",
      baseUrl: "http://192.168.1.129:8080",
      timeoutMinutes: "10",
      maxInputTokens: "131072",
      maxOutputTokens: "12000",
    };
  }
  if (providerType === "OLLAMA_IMAGES") {
    return {
      model: "x/z-image-turbo:latest",
      baseUrl: "http://127.0.0.1:11435",
      timeoutMinutes: "15",
      maxInputTokens: "32000",
      maxOutputTokens: "1000",
    };
  }
  if (providerType === "COMFYUI") {
    return {
      model: "workflow-pendiente",
      baseUrl: "http://127.0.0.1:8188",
      timeoutMinutes: "5",
      maxInputTokens: "32000",
      maxOutputTokens: "1000",
    };
  }
  return {
    model: purpose === "IMAGE" ? "gpt-image-2.5-sunburst" : "",
    baseUrl: "https://api.openai.com/v1",
    timeoutMinutes: "1",
    maxInputTokens: purpose === "IMAGE" ? "32000" : "120000",
    maxOutputTokens: purpose === "IMAGE" ? "1000" : "12000",
  };
}

/** El servicio guarda milisegundos; la pantalla los muestra en minutos. */
function minutesFromMs(ms: number): string {
  return String(Number((ms / 60_000).toFixed(2)));
}

/**
 * Menú «Más acciones» de cada fila: deja visibles solo las acciones frecuentes
 * y agrupa el resto. Se posiciona con `fixed` para no quedar recortado por el
 * desplazamiento de la tabla; Escape o un clic fuera lo cierran.
 */
function ProviderMoreMenu({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  const [position, setPosition] = useState<{
    top: number;
    right: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const open = position !== null;

  function toggle(): void {
    if (open) {
      setPosition(null);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      top: rect.bottom + 4,
      right: Math.max(8, window.innerWidth - rect.right),
    });
  }

  useEffect(() => {
    if (!open) return;
    const close = () => setPosition(null);
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  return (
    <div className="rq-ai-row-menu" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        className="rq-ai-row-menu__trigger"
        onClick={toggle}
        ref={triggerRef}
        type="button"
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {position ? (
        <div
          className="rq-ai-row-menu__panel"
          onClick={() => setPosition(null)}
          role="menu"
          style={{ top: position.top, right: position.right }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function emptyForm(purpose: ProviderPurpose = "TEXT"): ProviderForm {
  const providerType: ProviderKind = "OPENAI";
  return {
    purpose,
    providerType,
    name: purpose === "IMAGE" ? "OpenAI Images" : "",
    ...providerDefaults(purpose, providerType),
    apiKey: "",
    maxAttempts: "3",
    isEnabled: false,
    isDefault: false,
  };
}

function fromProvider(provider: AiProviderConfigurationSummary): ProviderForm {
  return {
    purpose: provider.purpose,
    providerType: provider.providerType,
    name: provider.name,
    model: provider.model,
    baseUrl: provider.baseUrl,
    apiKey: "",
    timeoutMinutes: minutesFromMs(provider.timeoutMs),
    maxInputTokens: String(provider.maxInputTokens),
    maxOutputTokens: String(provider.maxOutputTokens),
    maxAttempts: String(provider.maxAttempts),
    isEnabled: provider.isEnabled,
    isDefault: provider.isDefault,
  };
}

function duplicateName(
  provider: AiProviderConfigurationSummary,
  items: readonly AiProviderConfigurationSummary[],
): string {
  const names = new Set(items.map((item) => item.name.toLocaleLowerCase("es")));
  for (let copy = 1; copy <= items.length + 1; copy += 1) {
    const suffix = copy === 1 ? " - copia" : ` - copia ${copy}`;
    const candidate = `${provider.name.slice(0, 120 - suffix.length)}${suffix}`;
    if (!names.has(candidate.toLocaleLowerCase("es"))) return candidate;
  }
  return `${provider.name.slice(0, 111)} - copia`;
}

function dateTime(value: string | null): string {
  if (!value) return "Sin prueba";
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

async function failure(response: Response): Promise<string> {
  if (response.status === 401) {
    window.location.assign("/sign-in");
    return "Sesión vencida.";
  }
  const payload = (await response.json().catch(() => null)) as unknown;
  if (payload && typeof payload === "object") {
    const record = payload as Readonly<Record<string, unknown>>;
    if (typeof record.detail === "string") return record.detail;
    if (typeof record.message === "string") return record.message;
  }
  return "La operación no pudo completarse.";
}

export function AiProvidersWorkspace({ initialList, initialError }: Props) {
  const [list, setList] = useState(initialList ?? EMPTY_LIST);
  const [view, setView] = useState<ProviderView>("TEXT");
  // «Por proveedor» agrupa los módulos de texto e imágenes; al crear, es texto.
  const tab: ProviderPurpose = view === "IMAGE" ? "IMAGE" : "TEXT";
  const [providerFilter, setProviderFilter] = useState<"" | ProviderFamily>("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [credentialFilter, setCredentialFilter] =
    useState<CredentialFilter>("");
  const [alert, setAlert] = useState(initialError ?? "");
  useAutoDismiss(alert, () => setAlert(""));
  const [alertTone, setAlertTone] = useState<"success" | "danger">("danger");
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<ModalMode | null>(null);
  const dialogRef = useDialogAccessibility<HTMLDivElement>(
    Boolean(modal),
    () => {
      if (!busy) close();
    },
  );
  const [selected, setSelected] =
    useState<AiProviderConfigurationSummary | null>(null);
  const [form, setForm] = useState<ProviderForm>(emptyForm());
  const [ollamaModels, setOllamaModels] = useState<
    OllamaInstalledModelsResponse["models"]
  >([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [connection, setConnection] = useState<{
    tone: "success" | "danger";
    message: string;
  } | null>(null);
  const filteredItems = useMemo(
    () =>
      list.items.filter(
        (item) =>
          (!providerFilter ||
            providerFamily(item.providerType) === providerFilter) &&
          (!statusFilter || (statusFilter === "ENABLED") === item.isEnabled) &&
          (!credentialFilter || credentialState(item) === credentialFilter),
      ),
    [list.items, providerFilter, statusFilter, credentialFilter],
  );
  const filtersActive = Boolean(
    providerFilter || statusFilter || credentialFilter,
  );
  const visibleItems = useMemo(
    () => filteredItems.filter((item) => item.purpose === tab),
    [filteredItems, tab],
  );
  const textCount = useMemo(
    () => list.items.filter((item) => item.purpose === "TEXT").length,
    [list.items],
  );
  const imageCount = useMemo(
    () => list.items.filter((item) => item.purpose === "IMAGE").length,
    [list.items],
  );

  const modalTitle = useMemo(() => {
    if (modal === "create") return "Nuevo proveedor";
    if (modal === "duplicate") return "Duplicar proveedor";
    if (modal === "edit") return "Editar proveedor";
    if (modal === "credential") return "Configurar credencial";
    return "Eliminar proveedor";
  }, [modal]);

  function show(message: string, tone: "success" | "danger") {
    setAlert(message);
    setAlertTone(tone);
  }

  function close(force = false) {
    if (busy && !force) return;
    setConnection(null);
    setForm(emptyForm(tab));
    setSelected(null);
    setModal(null);
  }

  async function refresh() {
    const response = await fetch(`${GATEWAY_URL}/api/v1/admin/ai-providers`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error(await failure(response));
    setList((await response.json()) as AiProviderConfigurationListResponse);
  }

  async function loadOllamaModels(baseUrl: string, kind: ProviderKind) {
    setModelsLoading(true);
    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/admin/ai-providers/${modelsRoute(kind)}?baseUrl=${encodeURIComponent(baseUrl)}`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error(await failure(response));
      const payload = (await response.json()) as OllamaInstalledModelsResponse;
      setOllamaModels(payload.models);
    } catch (error) {
      setOllamaModels([]);
      const message = error instanceof Error ? error.message : String(error);
      show(message, "danger");
      setConnection({ tone: "danger", message });
    } finally {
      setModelsLoading(false);
    }
  }

  function openCreate() {
    setConnection(null);
    setForm(emptyForm(tab));
    setSelected(null);
    setModal("create");
  }

  function open(provider: AiProviderConfigurationSummary, mode: ModalMode) {
    setSelected(provider);
    setForm(fromProvider(provider));
    setModal(mode);
    if (isOllamaKind(provider.providerType) && mode === "edit") {
      void loadOllamaModels(provider.baseUrl, provider.providerType);
    }
  }

  function openDuplicate(provider: AiProviderConfigurationSummary) {
    setSelected(provider);
    setForm({
      ...fromProvider(provider),
      name: duplicateName(provider, list.items),
      isEnabled: false,
      isDefault: false,
    });
    setModal("duplicate");
    if (isOllamaKind(provider.providerType)) {
      void loadOllamaModels(provider.baseUrl, provider.providerType);
    }
  }

  async function submit() {
    const isCreate = modal === "create";
    const isDuplicate = modal === "duplicate";
    if (!isCreate && !selected) return;
    const selectedId = selected?.id ?? "";
    setBusy(true);
    try {
      const response = await fetch(
        isCreate
          ? `${GATEWAY_URL}/api/v1/admin/ai-providers`
          : isDuplicate
            ? `${GATEWAY_URL}/api/v1/admin/ai-providers/${encodeURIComponent(selectedId)}/duplicate`
            : `${GATEWAY_URL}/api/v1/admin/ai-providers/${encodeURIComponent(selectedId)}`,
        {
          method: isCreate || isDuplicate ? "POST" : "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: form.name,
            purpose: form.purpose,
            providerType: form.providerType,
            model: form.model,
            baseUrl: form.baseUrl,
            timeoutMs: Math.round(Number(form.timeoutMinutes) * 60_000),
            maxInputTokens: Number(form.maxInputTokens),
            maxOutputTokens: Number(form.maxOutputTokens),
            maxAttempts: Number(form.maxAttempts),
            isEnabled: isDuplicate ? false : form.isEnabled,
            isDefault: isDuplicate ? false : form.isDefault,
            ...(isCreate && isKeyProviderKind(form.providerType)
              ? { apiKey: form.apiKey }
              : {}),
          }),
        },
      );
      if (!response.ok) throw new Error(await failure(response));
      close(true);
      await refresh();
      show(
        isDuplicate
          ? "Proveedor duplicado con su configuración y credencial protegida."
          : "Proveedor guardado de forma segura.",
        "success",
      );
    } catch (error) {
      show(error instanceof Error ? error.message : String(error), "danger");
    } finally {
      setBusy(false);
      setForm((current) => ({ ...current, apiKey: "" }));
    }
  }

  async function rotateCredential() {
    if (!selected) return;
    setBusy(true);
    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/admin/ai-providers/${encodeURIComponent(selected.id)}/credential`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ apiKey: form.apiKey }),
        },
      );
      if (!response.ok) throw new Error(await failure(response));
      const testResponse = await fetch(
        `${GATEWAY_URL}/api/v1/admin/ai-providers/${encodeURIComponent(selected.id)}/test`,
        { method: "POST", credentials: "include" },
      );
      if (!testResponse.ok) throw new Error(await failure(testResponse));
      const testResult =
        (await testResponse.json()) as AiProviderConnectionTestResult;
      close(true);
      await refresh();
      show(
        `Credencial guardada de forma segura. ${testResult.message}`,
        testResult.succeeded ? "success" : "danger",
      );
    } catch (error) {
      show(error instanceof Error ? error.message : String(error), "danger");
    } finally {
      setBusy(false);
      setForm((current) => ({ ...current, apiKey: "" }));
    }
  }

  async function testProvider(provider: AiProviderConfigurationSummary) {
    setBusy(true);
    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/admin/ai-providers/${encodeURIComponent(provider.id)}/test`,
        { method: "POST", credentials: "include" },
      );
      if (!response.ok) throw new Error(await failure(response));
      const result = (await response.json()) as AiProviderConnectionTestResult;
      await refresh();
      show(result.message, result.succeeded ? "success" : "danger");
    } catch (error) {
      show(error instanceof Error ? error.message : String(error), "danger");
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(provider: AiProviderConfigurationSummary) {
    setBusy(true);
    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/admin/ai-providers/${encodeURIComponent(provider.id)}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ isEnabled: !provider.isEnabled }),
        },
      );
      if (!response.ok) throw new Error(await failure(response));
      await refresh();
      show(
        provider.isEnabled
          ? "Proveedor deshabilitado."
          : provider.purpose === "IMAGE"
            ? "Proveedor de imágenes habilitado."
            : "Proveedor habilitado. Con una prueba de conexión correcta podrás seleccionarlo en Procesamiento.",
        "success",
      );
    } catch (error) {
      show(error instanceof Error ? error.message : String(error), "danger");
    } finally {
      setBusy(false);
    }
  }

  async function testOllamaDraft() {
    setBusy(true);
    setConnection(null);
    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/admin/ai-providers/${modelsRoute(form.providerType)}?baseUrl=${encodeURIComponent(form.baseUrl)}`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error(await failure(response));
      const result = (await response.json()) as OllamaInstalledModelsResponse;
      setOllamaModels(result.models);
      const model = form.model.trim();
      if (!result.models.some((item) => item.name === model)) {
        throw new Error(
          form.providerType === "OPENAI_COMPATIBLE"
            ? `El modelo ${model} no aparece en el servidor.`
            : `El modelo ${model} no está instalado en Ollama.`,
        );
      }
      setConnection({
        tone: "success",
        message: `Conexión validada. El modelo ${model} está disponible.`,
      });
    } catch (error) {
      setConnection({
        tone: "danger",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!selected) return;
    setBusy(true);
    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/admin/ai-providers/${encodeURIComponent(selected.id)}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!response.ok) throw new Error(await failure(response));
      close(true);
      await refresh();
      show(
        selected.requiresCredential
          ? "Proveedor y referencia de credencial eliminados."
          : "Proveedor eliminado.",
        "success",
      );
    } catch (error) {
      show(error instanceof Error ? error.message : String(error), "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rq-ai-providers-workspace">
      <section className="rq-module-commandbar">
        <RqKpiGrid label="Resumen de proveedores de inteligencia artificial">
          <RqKpiCard
            description="Configuraciones registradas"
            icon={<WorkspaceKpiIcon name="server" />}
            title="Proveedores"
            value={String(list.totalItems)}
          />
          <RqKpiCard
            description="Disponibles para ejecución / con credencial protegida fuera de SQL"
            icon={<WorkspaceKpiIcon name="key" />}
            title="Habilitados / credenciales"
            value={`${list.enabled} / ${list.credentialConfigured}`}
          />
          <RqKpiCard
            description="Uno por módulo y tipo de proveedor"
            icon={<WorkspaceKpiIcon name="star" />}
            title="Predeterminado"
            value={String(list.items.filter((item) => item.isDefault).length)}
          />
        </RqKpiGrid>
        <div className="rq-module-commandbar__actions">
          <RqActionButton
            disabled={busy}
            onClick={openCreate}
            tone="affirmative"
          >
            Nuevo proveedor
          </RqActionButton>
        </div>
      </section>

      {alert ? (
        <div className="rq-project-alert" data-tone={alertTone} role="alert">
          <span>{alert}</span>
          <button
            aria-label="Cerrar mensaje"
            onClick={() => setAlert("")}
            type="button"
          >
            ×
          </button>
        </div>
      ) : null}

      <details className="rq-ai-security-note">
        <summary>
          <strong>Administración segura</strong>
          <span>
            Las claves nunca se muestran: OpenAI, Claude, Gemini, Groq y
            Cerebras las guardan en la bóveda protegida del servidor; Ollama y
            ComfyUI no usan credenciales.
          </span>
        </summary>
        <span>
          Los proveedores están separados en dos módulos: generadores de texto y
          generadores de imágenes. Texto admite OpenAI, Claude, Gemini, Groq,
          Cerebras y Ollama; Imágenes admite OpenAI y ComfyUI local. Cada
          registro conserva su propia configuración y puede editarse de forma
          independiente.
        </span>
        <span>
          Ollama y ComfyUI solo admiten endpoints locales o de tu red local
          autorizados. La pantalla nunca devuelve secretos.
        </span>
      </details>

      <div className="rq-ai-tabbar">
        <div
          aria-label="Vista de proveedores de inteligencia artificial"
          className="rq-ai-tabs"
          role="tablist"
        >
          <button
            aria-controls="ai-provider-panel"
            aria-selected={view === "TEXT"}
            id="ai-provider-tab-TEXT"
            onClick={() => setView("TEXT")}
            role="tab"
            type="button"
          >
            Generadores de texto <span>{textCount}</span>
          </button>
          <button
            aria-controls="ai-provider-panel"
            aria-selected={view === "IMAGE"}
            id="ai-provider-tab-IMAGE"
            onClick={() => setView("IMAGE")}
            role="tab"
            type="button"
          >
            Generadores de imágenes <span>{imageCount}</span>
          </button>
          <button
            aria-controls="ai-provider-panel"
            aria-selected={view === "PROVIDERS"}
            id="ai-provider-tab-PROVIDERS"
            onClick={() => setView("PROVIDERS")}
            role="tab"
            type="button"
          >
            Por proveedor <span>{list.items.length}</span>
          </button>
        </div>
        <form
          aria-label="Filtros de proveedores"
          className="rq-projects-filters"
          onSubmit={(event) => event.preventDefault()}
        >
          <label className="rq-projects-filter">
            <span>Proveedor:</span>
            <select
              aria-label="Proveedor"
              onChange={(event) =>
                setProviderFilter(event.target.value as "" | ProviderFamily)
              }
              value={providerFilter}
            >
              <option value="">Todos</option>
              <option value="OLLAMA">Ollama</option>
              <option value="COMPATIBLE">Compatible OpenAI</option>
              <option value="OPENAI">ChatGPT (OpenAI)</option>
              <option value="CLAUDE">Claude (Anthropic)</option>
              <option value="GEMINI">Gemini (Google AI Studio)</option>
              <option value="GROQ">Groq</option>
              <option value="CEREBRAS">Cerebras</option>
              <option value="COMFYUI">ComfyUI</option>
            </select>
          </label>
          <label className="rq-projects-filter">
            <span>Estado:</span>
            <select
              aria-label="Estado"
              onChange={(event) =>
                setStatusFilter(event.target.value as StatusFilter)
              }
              value={statusFilter}
            >
              <option value="">Todos</option>
              <option value="ENABLED">Habilitado</option>
              <option value="DISABLED">Deshabilitado</option>
            </select>
          </label>
          <label className="rq-projects-filter">
            <span>Credencial:</span>
            <select
              aria-label="Credencial"
              onChange={(event) =>
                setCredentialFilter(event.target.value as CredentialFilter)
              }
              value={credentialFilter}
            >
              <option value="">Todas</option>
              <option value="PROTECTED">Protegida</option>
              <option value="MISSING">Ausente</option>
              <option value="NOT_REQUIRED">No requerida</option>
            </select>
          </label>
          {filtersActive ? (
            <RqActionButton
              onClick={() => {
                setProviderFilter("");
                setStatusFilter("");
                setCredentialFilter("");
              }}
              tone="secondary"
            >
              Limpiar
            </RqActionButton>
          ) : null}
        </form>
      </div>

      <div
        aria-labelledby={`ai-provider-tab-${view}`}
        id="ai-provider-panel"
        role="tabpanel"
      >
        {view === "PROVIDERS" ? (
          <ProviderColumnsView
            allItems={list.items}
            credentialFilter={credentialFilter}
            gatewayUrl={GATEWAY_URL}
            busy={busy}
            onEdit={(provider) => open(provider, "edit")}
            providerFilter={providerFilter}
            statusFilter={statusFilter}
          />
        ) : null}

        {view !== "PROVIDERS" ? (
          <RqTableShell
            count={visibleItems.length}
            description={
              tab === "TEXT"
                ? "Modelos para análisis, conversación e interpretación de texto."
                : "Motores para generación visual y prototipos."
            }
            title={
              tab === "TEXT" ? "Generadores de texto" : "Generadores de imágenes"
            }
          >
            {visibleItems.length === 0 ? (
              <RqEmptyState
                description={
                  tab === "TEXT"
                    ? "Registra OpenAI, Claude, Gemini, Groq o Cerebras con una API key protegida, u Ollama local sin credenciales."
                    : "Registra OpenAI Images o ComfyUI local. ComfyUI usa por defecto http://127.0.0.1:8188."
                }
                title={
                  tab === "TEXT"
                    ? "Sin generadores de texto configurados"
                    : "Sin generadores de imágenes configurados"
                }
              />
            ) : (
              <table className="rq-table rq-ai-providers-table">
                <thead>
                  <tr>
                    <th scope="col">Proveedor</th>
                    <th scope="col">
                      {tab === "IMAGE" ? "Modelo / workflow" : "Modelo"}
                    </th>
                    <th scope="col">Estado</th>
                    <th scope="col">Credencial</th>
                    <th scope="col">Última prueba</th>
                    <th scope="col">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((provider) => (
                    <tr key={provider.id}>
                      <td>
                        <strong>{provider.name}</strong>
                        <small>
                          {provider.providerType}
                          {provider.isDefault ? " · Predeterminado" : ""}
                        </small>
                      </td>
                      <td>
                        <strong>{provider.model}</strong>
                        <small>{provider.baseUrl}</small>
                      </td>
                      <td>
                        <RqStatusBadge
                          tone={provider.isEnabled ? "success" : "inactive"}
                        >
                          {provider.isEnabled ? "Habilitado" : "Deshabilitado"}
                        </RqStatusBadge>
                      </td>
                      <td>
                        <RqStatusBadge
                          tone={
                            !provider.requiresCredential ||
                            provider.credentialConfigured
                              ? "success"
                              : "pending"
                          }
                        >
                          {provider.requiresCredential
                            ? provider.credentialConfigured
                              ? "Protegida"
                              : "Ausente"
                            : "No requerida"}
                        </RqStatusBadge>
                      </td>
                      <td>
                        <strong>
                          {provider.lastConnectionTestStatus === "SUCCEEDED"
                            ? "Correcta"
                            : provider.lastConnectionTestStatus === "FAILED"
                              ? "Fallida"
                              : "No probada"}
                        </strong>
                        <small>{dateTime(provider.lastConnectionTestAt)}</small>
                      </td>
                      <td>
                        <div className="rq-users-table__actions">
                          <RqActionButton
                            compact
                            disabled={busy}
                            onClick={() => open(provider, "edit")}
                            tone="operation"
                          >
                            Editar
                          </RqActionButton>
                          <RqActionButton
                            compact
                            disabled={busy}
                            onClick={() => {
                              if (
                                provider.requiresCredential &&
                                !provider.credentialConfigured
                              ) {
                                open(provider, "credential");
                                show(
                                  "Agrega la API key para probar la conexión con el proveedor.",
                                  "danger",
                                );
                                return;
                              }
                              void testProvider(provider);
                            }}
                            tone="consult"
                          >
                            Probar
                          </RqActionButton>
                          <ProviderMoreMenu
                            label={`Más acciones de ${provider.name}`}
                          >
                            <button
                              className="rq-ai-row-menu__item"
                              disabled={
                                busy || (provider.isEnabled && provider.isDefault)
                              }
                              onClick={() => void toggleEnabled(provider)}
                              role="menuitem"
                              title={
                                provider.isEnabled && provider.isDefault
                                  ? "Es el proveedor predeterminado: elige otro antes de deshabilitarlo."
                                  : undefined
                              }
                              type="button"
                            >
                              {provider.isEnabled ? "Deshabilitar" : "Habilitar"}
                            </button>
                            <button
                              className="rq-ai-row-menu__item"
                              disabled={
                                busy ||
                                (provider.requiresCredential &&
                                  !provider.credentialConfigured)
                              }
                              onClick={() => openDuplicate(provider)}
                              role="menuitem"
                              type="button"
                            >
                              Duplicar
                            </button>
                            {provider.requiresCredential ? (
                              <button
                                className="rq-ai-row-menu__item"
                                disabled={busy}
                                onClick={() => open(provider, "credential")}
                                role="menuitem"
                                type="button"
                              >
                                Rotar clave
                              </button>
                            ) : null}
                            <button
                              className="rq-ai-row-menu__item rq-ai-row-menu__item--danger"
                              disabled={
                                busy || provider.isEnabled || provider.isDefault
                              }
                              onClick={() => open(provider, "delete")}
                              role="menuitem"
                              title={
                                provider.isEnabled || provider.isDefault
                                  ? "Para eliminarlo, deshabilítalo y quítale la condición de predeterminado."
                                  : undefined
                              }
                              type="button"
                            >
                              Eliminar
                            </button>
                          </ProviderMoreMenu>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </RqTableShell>
        ) : null}
      </div>

      {modal ? (
        <div
          aria-labelledby="ai-provider-modal-title"
          aria-modal="true"
          className="rq-project-modal-backdrop"
          ref={dialogRef}
          role="dialog"
          tabIndex={-1}
        >
          <section className="rq-project-modal rq-ai-provider-modal">
            <header className="rq-project-modal__header">
              <div>
                <span>Configuración · Inteligencia artificial</span>
                <h2 id="ai-provider-modal-title">{modalTitle}</h2>
              </div>
              <button
                aria-label="Cerrar"
                disabled={busy}
                onClick={() => close()}
                type="button"
              >
                ×
              </button>
            </header>
            {modal === "delete" && selected ? (
              <div className="rq-users-confirm">
                <p>
                  ¿Deseas eliminar <strong>{selected.name}</strong>? Esta acción
                  {selected.requiresCredential
                    ? "? Esta acción también borra su referencia protegida en Keychain."
                    : "? Esta acción elimina su configuración local."}
                </p>
                <div className="rq-project-modal__actions">
                  <RqActionButton disabled={busy} onClick={() => close()}>
                    Cancelar
                  </RqActionButton>
                  <RqActionButton
                    disabled={busy}
                    onClick={() => void remove()}
                    tone="danger"
                  >
                    Eliminar
                  </RqActionButton>
                </div>
              </div>
            ) : modal === "credential" ? (
              <form
                className="rq-project-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void rotateCredential();
                }}
              >
                <label className="rq-field">
                  <span>Nueva API key</span>
                  <input
                    autoComplete="new-password"
                    disabled={busy}
                    maxLength={4096}
                    minLength={20}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        apiKey: event.target.value,
                      }))
                    }
                    required
                    type="password"
                    value={form.apiKey}
                  />
                </label>
                <p>
                  El valor no se mostrará nuevamente ni se guardará en SQL, logs
                  o almacenamiento del navegador.
                </p>
                <div className="rq-project-modal__actions">
                  <RqActionButton disabled={busy} onClick={() => close()}>
                    Cancelar
                  </RqActionButton>
                  <RqActionButton
                    disabled={busy}
                    tone="affirmative"
                    type="submit"
                  >
                    Guardar y probar
                  </RqActionButton>
                </div>
              </form>
            ) : (
              <form
                className="rq-project-form rq-ai-provider-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                <label className="rq-field">
                  <span>Nombre</span>
                  <input
                    disabled={busy}
                    maxLength={120}
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
                <label className="rq-field">
                  <span>Proveedor</span>
                  <select
                    disabled={busy || modal !== "create"}
                    onChange={(event) => {
                      const providerType = event.target.value as ProviderKind;
                      setForm((current) => ({
                        ...current,
                        providerType,
                        ...providerDefaults(current.purpose, providerType),
                        apiKey: "",
                      }));
                      if (isOllamaKind(providerType)) {
                        void loadOllamaModels(
                          providerDefaults(form.purpose, providerType).baseUrl,
                          providerType,
                        );
                      }
                    }}
                    value={form.providerType}
                  >
                    <option value="OPENAI">OpenAI</option>
                    {form.purpose === "TEXT" ? (
                      <>
                        <option value="ANTHROPIC">Claude (Anthropic)</option>
                        <option value="GEMINI">
                          Gemini (Google AI Studio)
                        </option>
                        <option value="GROQ">Groq</option>
                        <option value="CEREBRAS">Cerebras</option>
                        <option value="OLLAMA">Ollama local</option>
                        <option value="OPENAI_COMPATIBLE">
                          Compatible con OpenAI (llama.cpp / llama-swap)
                        </option>
                      </>
                    ) : (
                      <>
                        <option value="COMFYUI">ComfyUI local</option>
                        <option value="OLLAMA_IMAGES">
                          Ollama Images local
                        </option>
                      </>
                    )}
                  </select>
                  <small>
                    {form.purpose === "TEXT"
                      ? "Módulo de texto: OpenAI, Claude, Gemini, Groq, Cerebras u Ollama."
                      : "Módulo de imágenes: OpenAI, ComfyUI u Ollama Images."}
                  </small>
                </label>
                <label className="rq-field">
                  <span>Endpoint</span>
                  <input
                    disabled={busy || isKeyProviderKind(form.providerType)}
                    onChange={(event) => {
                      setConnection(null);
                      setForm((current) => ({
                        ...current,
                        baseUrl: event.target.value,
                      }));
                    }}
                    onBlur={(event) => {
                      if (isOllamaKind(form.providerType)) {
                        void loadOllamaModels(
                          event.target.value,
                          form.providerType,
                        );
                      }
                    }}
                    readOnly={isKeyProviderKind(form.providerType)}
                    required
                    value={form.baseUrl}
                  />
                  {form.providerType === "COMFYUI" ? (
                    <small>
                      Endpoint local sugerido: http://127.0.0.1:8188
                    </small>
                  ) : null}
                  {isOllamaKind(form.providerType) ? (
                    <small>
                      {form.providerType === "OPENAI_COMPATIBLE"
                        ? "Ej. http://192.168.1.129:8080 (IP de tu red, VPN o nombre .local)"
                        : "Ej. http://192.168.1.50:11434 (equipo de tu red)"}
                    </small>
                  ) : null}
                </label>
                <label className="rq-field">
                  <span>
                    {form.providerType === "COMFYUI"
                      ? "Workflow / modelo"
                      : "Modelo"}
                  </span>
                  {isOllamaKind(form.providerType) &&
                  ollamaModels.length > 0 ? (
                    <select
                      disabled={busy}
                      onChange={(event) => {
                        setConnection(null);
                        setForm((current) => ({
                          ...current,
                          model: event.target.value,
                        }));
                      }}
                      required
                      value={form.model}
                    >
                      {ollamaModels.some(
                        (item) => item.name === form.model,
                      ) ? null : (
                        <option value={form.model}>
                          {form.model
                            ? `${form.model} (no instalado en este servidor)`
                            : "Selecciona un modelo"}
                        </option>
                      )}
                      {ollamaModels.map((item) => (
                        <option key={item.name} value={item.name}>
                          {[
                            item.name,
                            item.parameterSize,
                            item.quantizationLevel,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      disabled={busy}
                      maxLength={120}
                      minLength={2}
                      onChange={(event) => {
                        setConnection(null);
                        setForm((current) => ({
                          ...current,
                          model: event.target.value,
                        }));
                      }}
                      placeholder={
                        form.providerType === "OLLAMA"
                          ? "Ej. gemma4:12b"
                          : form.providerType === "OPENAI_COMPATIBLE"
                            ? "Ej. A/gemma-4-31b"
                            : form.providerType === "OLLAMA_IMAGES"
                              ? "Ej. x/z-image-turbo:latest"
                              : form.providerType === "COMFYUI"
                                ? "Ej. workflow-pendiente"
                                : form.providerType === "ANTHROPIC"
                                  ? "Ej. claude-sonnet-5-5"
                                  : form.providerType === "GEMINI"
                                    ? "Ej. gemini-2.5-pro"
                                    : form.providerType === "GROQ"
                                      ? "Ej. openai/gpt-oss-120b"
                                      : form.providerType === "CEREBRAS"
                                        ? "Ej. gpt-oss-120b"
                                        : form.purpose === "IMAGE"
                                          ? "Modelo de imágenes de OpenAI"
                                          : "Modelo habilitado para tu proyecto OpenAI"
                      }
                      required
                      value={form.model}
                    />
                  )}
                  {isOllamaKind(form.providerType) ? (
                    <>
                      <small>
                        {modelsLoading
                          ? "Consultando modelos instalados…"
                          : ollamaModels.length > 0
                            ? `${ollamaModels.length} modelo(s) instalado(s) en el servidor.`
                            : "No se pudo listar: escribe el modelo o revisa el endpoint."}
                      </small>
                    </>
                  ) : null}
                </label>
                {modal === "create" && isKeyProviderKind(form.providerType) ? (
                  <label className="rq-field rq-ai-provider-form__wide">
                    <span>API key</span>
                    <input
                      autoComplete="new-password"
                      disabled={busy}
                      maxLength={4096}
                      minLength={20}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          apiKey: event.target.value,
                        }))
                      }
                      required
                      type="password"
                      value={form.apiKey}
                    />
                    <small>
                      Se transfiere una vez y queda protegida en la bóveda del
                      servidor.
                    </small>
                  </label>
                ) : null}
                <label className="rq-field">
                  <span>Tiempo máximo por respuesta (minutos)</span>
                  <input
                    disabled={busy}
                    max={isKeyProviderKind(form.providerType) ? 10 : 15}
                    min={0.1}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        timeoutMinutes: event.target.value,
                      }))
                    }
                    required
                    step="any"
                    type="number"
                    value={form.timeoutMinutes}
                  />
                  <small>
                    {isKeyProviderKind(form.providerType)
                      ? "Los proveedores en la nube admiten hasta 10 minutos."
                      : "Admite hasta 15 minutos."}
                  </small>
                </label>
                <label className="rq-field">
                  <span>Intentos máximos por solicitud</span>
                  <input
                    disabled={busy}
                    max={10}
                    min={1}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        maxAttempts: event.target.value,
                      }))
                    }
                    required
                    type="number"
                    value={form.maxAttempts}
                  />
                </label>
                {form.purpose === "TEXT" ? (
                  <>
                    <label className="rq-field">
                      <span>Contexto máximo (tokens de entrada)</span>
                      <input
                        disabled={busy}
                        max={1000000}
                        min={1000}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            maxInputTokens: event.target.value,
                          }))
                        }
                        required
                        type="number"
                        value={form.maxInputTokens}
                      />
                    </label>
                    <label className="rq-field">
                      <span>Respuesta máxima (tokens de salida)</span>
                      <input
                        disabled={busy}
                        max={128000}
                        min={100}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            maxOutputTokens: event.target.value,
                          }))
                        }
                        required
                        type="number"
                        value={form.maxOutputTokens}
                      />
                    </label>
                  </>
                ) : null}
                <label className="rq-ai-checkbox">
                  <input
                    checked={form.isEnabled}
                    disabled={busy || modal === "duplicate"}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        isEnabled: event.target.checked,
                        isDefault: event.target.checked
                          ? current.isDefault
                          : false,
                      }))
                    }
                    type="checkbox"
                  />
                  <span>Habilitado para ejecuciones</span>
                </label>
                <label className="rq-ai-checkbox">
                  <input
                    checked={form.isDefault}
                    disabled={busy || modal === "duplicate" || !form.isEnabled}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        isDefault: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  <span>Proveedor predeterminado</span>
                </label>
                {!form.isEnabled ? (
                  <small className="rq-ai-provider-form__wide">
                    Habilita el proveedor para poder marcarlo como
                    predeterminado.
                  </small>
                ) : form.providerType === "OLLAMA" ||
                  form.providerType === "OPENAI_COMPATIBLE" ? (
                  <small className="rq-ai-provider-form__wide">
                    Un proveedor local predeterminado debe superar «Probar
                    conexión» antes de procesar fuentes.
                  </small>
                ) : null}
                {modal === "duplicate" ? (
                  <p className="rq-ai-duplicate-note rq-ai-provider-form__wide">
                    La copia se crea deshabilitada y conserva la configuración y
                    la credencial protegida. Cambia el nombre y el modelo antes
                    de guardarla.
                  </p>
                ) : null}
                {connection ? (
                  <p
                    className="rq-ai-connection rq-ai-provider-form__wide"
                    data-tone={connection.tone}
                    role="status"
                  >
                    <span aria-hidden="true">
                      {connection.tone === "success" ? "✓ " : "✕ "}
                    </span>
                    {connection.message}
                  </p>
                ) : null}
                <div className="rq-project-modal__actions rq-ai-provider-form__wide">
                  <RqActionButton disabled={busy} onClick={() => close()}>
                    Cancelar
                  </RqActionButton>
                  {form.providerType === "OLLAMA" ||
                  form.providerType === "OPENAI_COMPATIBLE" ? (
                    <RqActionButton
                      disabled={
                        busy || !form.baseUrl.trim() || !form.model.trim()
                      }
                      onClick={() => void testOllamaDraft()}
                      tone="consult"
                      type="button"
                    >
                      Probar conexión
                    </RqActionButton>
                  ) : null}
                  <RqActionButton
                    disabled={busy}
                    tone="affirmative"
                    type="submit"
                  >
                    {modal === "duplicate"
                      ? "Duplicar proveedor"
                      : "Guardar proveedor"}
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
