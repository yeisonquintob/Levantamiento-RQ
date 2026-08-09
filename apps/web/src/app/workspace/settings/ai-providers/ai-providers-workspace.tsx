"use client";

import { useMemo, useState } from "react";

import type {
  AiProviderConfigurationListResponse,
  AiProviderConfigurationSummary,
  AiProviderConnectionTestResult,
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

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000";

const EMPTY_LIST: AiProviderConfigurationListResponse = {
  items: [],
  totalItems: 0,
  enabled: 0,
  credentialConfigured: 0,
};

type ModalMode = "create" | "edit" | "credential" | "delete";

interface ProviderForm {
  name: string;
  model: string;
  apiKey: string;
  timeoutMs: string;
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

function emptyForm(): ProviderForm {
  return {
    name: "",
    model: "",
    apiKey: "",
    timeoutMs: "60000",
    maxInputTokens: "120000",
    maxOutputTokens: "12000",
    maxAttempts: "3",
    isEnabled: false,
    isDefault: false,
  };
}

function fromProvider(provider: AiProviderConfigurationSummary): ProviderForm {
  return {
    name: provider.name,
    model: provider.model,
    apiKey: "",
    timeoutMs: String(provider.timeoutMs),
    maxInputTokens: String(provider.maxInputTokens),
    maxOutputTokens: String(provider.maxOutputTokens),
    maxAttempts: String(provider.maxAttempts),
    isEnabled: provider.isEnabled,
    isDefault: provider.isDefault,
  };
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
  const [alert, setAlert] = useState(initialError ?? "");
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

  const modalTitle = useMemo(() => {
    if (modal === "create") return "Nuevo proveedor";
    if (modal === "edit") return "Editar proveedor";
    if (modal === "credential") return "Rotar credencial";
    return "Eliminar proveedor";
  }, [modal]);

  function show(message: string, tone: "success" | "danger") {
    setAlert(message);
    setAlertTone(tone);
  }

  function close(force = false) {
    if (busy && !force) return;
    setForm(emptyForm());
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

  function openCreate() {
    setForm(emptyForm());
    setSelected(null);
    setModal("create");
  }

  function open(provider: AiProviderConfigurationSummary, mode: ModalMode) {
    setSelected(provider);
    setForm(fromProvider(provider));
    setModal(mode);
  }

  async function submit() {
    const isCreate = modal === "create";
    if (!isCreate && !selected) return;
    const selectedId = selected?.id ?? "";
    setBusy(true);
    try {
      const response = await fetch(
        isCreate
          ? `${GATEWAY_URL}/api/v1/admin/ai-providers`
          : `${GATEWAY_URL}/api/v1/admin/ai-providers/${encodeURIComponent(selectedId)}`,
        {
          method: isCreate ? "POST" : "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: form.name,
            providerType: "OPENAI",
            model: form.model,
            baseUrl: "https://api.openai.com/v1",
            timeoutMs: Number(form.timeoutMs),
            maxInputTokens: Number(form.maxInputTokens),
            maxOutputTokens: Number(form.maxOutputTokens),
            maxAttempts: Number(form.maxAttempts),
            isEnabled: form.isEnabled,
            isDefault: form.isDefault,
            ...(isCreate ? { apiKey: form.apiKey } : {}),
          }),
        },
      );
      if (!response.ok) throw new Error(await failure(response));
      close(true);
      await refresh();
      show("Proveedor guardado de forma segura.", "success");
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
      close(true);
      await refresh();
      show(
        "Credencial rotada. Su valor no se almacena ni se muestra en la aplicación.",
        "success",
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
      show("Proveedor y referencia de credencial eliminados.", "success");
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
            icon="P"
            title="Proveedores"
            value={String(list.totalItems)}
          />
          <RqKpiCard
            description="Disponibles para ejecución"
            icon="A"
            title="Habilitados"
            value={String(list.enabled)}
          />
          <RqKpiCard
            description="Protegidas fuera de SQL"
            icon="K"
            title="Credenciales"
            value={String(list.credentialConfigured)}
          />
          <RqKpiCard
            description="Solo una puede estar activa"
            icon="D"
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

      <div className="rq-ai-security-note" role="note">
        <strong>Administración segura</strong>
        <span>
          La clave se envía una sola vez al backend y se protege en macOS
          Keychain. La base de datos, la API y esta pantalla nunca conservan ni
          devuelven su valor.
        </span>
      </div>

      <RqTableShell
        count={list.totalItems}
        description="Endpoint oficial, modelo, límites, estado de conexión y credencial protegida."
        title="Proveedores de IA"
      >
        {list.items.length === 0 ? (
          <RqEmptyState
            description="Registra OpenAI cuando dispongas de una API key. No necesitas compartirla por chat."
            title="Sin proveedores configurados"
          />
        ) : (
          <table className="rq-table rq-ai-providers-table">
            <thead>
              <tr>
                <th scope="col">Proveedor</th>
                <th scope="col">Modelo</th>
                <th scope="col">Estado</th>
                <th scope="col">Credencial</th>
                <th scope="col">Última prueba</th>
                <th scope="col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((provider) => (
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
                        provider.credentialConfigured ? "success" : "pending"
                      }
                    >
                      {provider.credentialConfigured ? "Protegida" : "Ausente"}
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
                        onClick={() => open(provider, "credential")}
                        tone="operation"
                      >
                        Rotar clave
                      </RqActionButton>
                      <RqActionButton
                        compact
                        disabled={busy || !provider.credentialConfigured}
                        onClick={() => void testProvider(provider)}
                        tone="consult"
                      >
                        Probar
                      </RqActionButton>
                      <RqActionButton
                        compact
                        disabled={
                          busy || provider.isEnabled || provider.isDefault
                        }
                        onClick={() => open(provider, "delete")}
                        tone="danger"
                      >
                        Eliminar
                      </RqActionButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </RqTableShell>

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
                  también borra su referencia protegida en Keychain.
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
                    Rotar de forma segura
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
                  <input disabled readOnly value="OpenAI" />
                </label>
                <label className="rq-field">
                  <span>Modelo</span>
                  <input
                    disabled={busy}
                    maxLength={120}
                    minLength={2}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        model: event.target.value,
                      }))
                    }
                    placeholder="Modelo habilitado para tu proyecto OpenAI"
                    required
                    value={form.model}
                  />
                </label>
                <label className="rq-field">
                  <span>Endpoint</span>
                  <input disabled readOnly value="https://api.openai.com/v1" />
                </label>
                {modal === "create" ? (
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
                      Se transfiere una vez y queda protegida en Keychain.
                    </small>
                  </label>
                ) : null}
                <label className="rq-field">
                  <span>Timeout (ms)</span>
                  <input
                    disabled={busy}
                    max={300000}
                    min={1000}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        timeoutMs: event.target.value,
                      }))
                    }
                    required
                    type="number"
                    value={form.timeoutMs}
                  />
                </label>
                <label className="rq-field">
                  <span>Máximo de intentos</span>
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
                <label className="rq-field">
                  <span>Máximo de tokens de entrada</span>
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
                  <span>Máximo de tokens de salida</span>
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
                <label className="rq-ai-checkbox">
                  <input
                    checked={form.isEnabled}
                    disabled={busy}
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
                    disabled={busy || !form.isEnabled}
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
                <div className="rq-project-modal__actions rq-ai-provider-form__wide">
                  <RqActionButton disabled={busy} onClick={() => close()}>
                    Cancelar
                  </RqActionButton>
                  <RqActionButton
                    disabled={busy}
                    tone="affirmative"
                    type="submit"
                  >
                    Guardar proveedor
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
