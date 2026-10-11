"use client";

// PROVIDER_COLUMNS_VIEW_V2
//
// Vista «Por proveedor»: tres columnas sin marcos.
//   1. IA — Ollama, ChatGPT (OpenAI), Claude, Gemini y ComfyUI, cada una con
//      Texto / Imágenes.
//   2. Modelos — todos los que existen para esa IA (los que ya tienes y los
//      disponibles), con una etiqueta que dice si están en uso.
//   3. Detalle — registro(s) del modelo elegido.
// Solo consulta (excepto «Editar», que abre el formulario existente). Claude,
// Gemini, Groq y Cerebras muestran un catálogo local recomendado (sin red ni
// claves) junto con los modelos que el administrador registró.
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  AiProviderConfigurationSummary,
  OllamaInstalledModelsResponse,
} from "@levantamiento-rq/shared-contracts";
import { RqActionButton, RqStatusBadge } from "@levantamiento-rq/shared-ui";

import {
  CLOUD_CATALOG_VERIFIED_AT,
  cloudRecommendations,
  type CloudModelRecommendation,
} from "./cloud-model-catalog";

export type ProviderFamily =
  "OLLAMA"
  | "COMPATIBLE"
  | "OPENAI"
  | "COMFYUI"
  | "CLAUDE"
  | "GEMINI"
  | "GROQ"
  | "CEREBRAS";
type Kind = "TEXT" | "IMAGE";
type StatusFilter = "" | "ENABLED" | "DISABLED";
type CredentialFilter = "" | "PROTECTED" | "MISSING" | "NOT_REQUIRED";

interface CatalogModel {
  readonly id: string;
  /** Línea resumen para la lista: parámetros · cuantización · tamaño · servidor. */
  readonly detail: string;
  readonly endpoint: string | null;
  readonly parameterSize: string | null;
  readonly quantization: string | null;
  readonly sizeBytes: number | null;
  readonly contextLength: number | null;
  readonly capabilities: readonly string[];
}

interface Catalog {
  readonly models: readonly CatalogModel[];
  readonly updatedAt: Date | null;
  readonly error: string | null;
  readonly loading: boolean;
}

const EMPTY_CATALOG: Catalog = {
  models: [],
  updatedAt: null,
  error: null,
  loading: false,
};

const FAMILIES: ReadonlyArray<{
  family: ProviderFamily;
  label: string;
  kinds: readonly Kind[];
}> = [
  { family: "OLLAMA", label: "Ollama", kinds: ["TEXT", "IMAGE"] },
  {
    family: "COMPATIBLE",
    label: "Compatible OpenAI (llama-swap)",
    kinds: ["TEXT"],
  },
  { family: "OPENAI", label: "ChatGPT (OpenAI)", kinds: ["TEXT", "IMAGE"] },
  { family: "CLAUDE", label: "Claude (Anthropic)", kinds: ["TEXT"] },
  { family: "GEMINI", label: "Gemini (Google AI Studio)", kinds: ["TEXT"] },
  { family: "GROQ", label: "Groq", kinds: ["TEXT"] },
  { family: "CEREBRAS", label: "Cerebras", kinds: ["TEXT"] },
  { family: "COMFYUI", label: "ComfyUI", kinds: ["IMAGE"] },
];

const KIND_LABEL: Record<Kind, string> = { TEXT: "Texto", IMAGE: "Imágenes" };

/** Modelos de texto de OpenAI; excluye imagen, audio, voz, búsqueda y embeddings. */
export function isOpenAiTextModel(id: string): boolean {
  return (
    /^(gpt|o\d|chatgpt)/u.test(id) &&
    !/(image|audio|realtime|tts|transcribe|search|embedding|moderation)/u.test(
      id,
    )
  );
}

/** Modelos de imágenes de OpenAI. */
export function isOpenAiImageModel(id: string): boolean {
  return /(^dall-e|image)/u.test(id);
}

function familyOf(
  provider: AiProviderConfigurationSummary,
): ProviderFamily | null {
  if (provider.providerType === "OPENAI") return "OPENAI";
  if (provider.providerType === "ANTHROPIC") return "CLAUDE";
  if (provider.providerType === "GEMINI") return "GEMINI";
  if (provider.providerType === "GROQ") return "GROQ";
  if (provider.providerType === "CEREBRAS") return "CEREBRAS";
  if (provider.providerType === "COMFYUI") return "COMFYUI";
  if (provider.providerType === "OPENAI_COMPATIBLE") return "COMPATIBLE";
  if (
    provider.providerType === "OLLAMA" ||
    provider.providerType === "OLLAMA_IMAGES"
  ) {
    return "OLLAMA";
  }
  return null;
}

function credentialOf(
  provider: AiProviderConfigurationSummary,
): Exclude<CredentialFilter, ""> {
  if (!provider.requiresCredential) return "NOT_REQUIRED";
  return provider.credentialConfigured ? "PROTECTED" : "MISSING";
}

async function failureMessage(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as unknown;
  if (payload && typeof payload === "object") {
    const record = payload as Readonly<Record<string, unknown>>;
    const text =
      typeof record.detail === "string"
        ? record.detail
        : typeof record.message === "string"
          ? record.message
          : null;
    if (text?.startsWith("Cannot GET")) {
      return "El gateway y el servicio de IA aún no tienen esta consulta: reinícialos para activarla.";
    }
    if (text) return text;
  }
  return "La operación no pudo completarse.";
}

const SAFE_MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;
const DEFAULT_OLLAMA_HOST = new Set(["127.0.0.1:11434", "localhost:11434"]);

const SAFE_FOLDER = /^[~A-Za-z0-9_./-]+$/u;
export const COMFYUI_DEFAULT_FOLDER = "~/AI/ComfyUI";

/**
 * Comandos de terminal de ComfyUI: iniciar el servidor y la instalación inicial.
 * La carpeta es la del usuario; solo se aceptan rutas sin espacios ni caracteres
 * de shell. El puerto sale del endpoint registrado (8188 por defecto).
 */
export function comfyUiCommands(
  folder: string,
  endpoint: string | null,
): { serve: string; install: string } | null {
  const path = folder.trim();
  if (!path || !SAFE_FOLDER.test(path) || path.startsWith("-")) return null;
  let port = "8188";
  try {
    const parsed = endpoint ? new URL(endpoint).port : "";
    if (/^\d{1,5}$/u.test(parsed)) port = parsed;
  } catch {
    port = "8188";
  }
  const portFlag = port === "8188" ? "" : ` --port ${port}`;
  return {
    serve: `cd ${path} && source .venv/bin/activate && python3 main.py${portFlag}`,
    install: `git clone https://github.com/comfyanonymous/ComfyUI.git ${path} && cd ${path} && python3.12 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`,
  };
}

function isRemoteHost(host: string | null): boolean {
  if (!host) return false;
  const name = host.replace(/:\d+$/u, "");
  return name !== "127.0.0.1" && name !== "localhost" && name !== "[::1]";
}

/**
 * Comando para iniciar el servidor Ollama de un endpoint. En un equipo remoto
 * debe ejecutarse en ese equipo y escuchar en la red (0.0.0.0).
 */
export function ollamaServeCommand(endpoint: string | null): string {
  let host: string | null = null;
  try {
    host = endpoint ? new URL(endpoint).host : null;
  } catch {
    host = null;
  }
  if (!host || DEFAULT_OLLAMA_HOST.has(host)) return "ollama serve";
  const port = host.match(/:(\d+)$/u)?.[1] ?? "11434";
  return `OLLAMA_HOST=${isRemoteHost(host) ? "0.0.0.0" : "127.0.0.1"}:${port} ollama serve`;
}

/**
 * Comandos de terminal para instalar o ejecutar un modelo en un servidor Ollama.
 * Si el servidor no es el predeterminado de este equipo, se antepone
 * `OLLAMA_HOST=…` para que el CLI de tu equipo actúe sobre ese servidor.
 * Devuelve `null` si el nombre contiene caracteres que no son de un modelo
 * (así nunca se sugiere pegar algo peligroso en una terminal).
 */
export function ollamaCommands(
  model: string,
  endpoint: string | null,
): {
  install: string;
  run: string;
  serve: string;
  host: string | null;
  remote: boolean;
} | null {
  if (!SAFE_MODEL_NAME.test(model)) return null;
  let host: string | null = null;
  if (endpoint) {
    try {
      host = new URL(endpoint).host;
    } catch {
      host = null;
    }
  }
  const prefix =
    host && !DEFAULT_OLLAMA_HOST.has(host) ? `OLLAMA_HOST=${host} ` : "";
  return {
    install: `${prefix}ollama pull ${model}`,
    run: `${prefix}ollama run ${model}`,
    serve: ollamaServeCommand(endpoint),
    host: prefix ? host : null,
    remote: isRemoteHost(host),
  };
}

function formatSize(bytes: number | null): string | null {
  return bytes === null ? null : `${(bytes / 1e9).toFixed(1)} GB`;
}

function time(value: Date | null): string {
  return value ? value.toLocaleTimeString("es-CO") : "";
}

interface ModelRow {
  readonly id: string;
  readonly detail: string;
  readonly catalogModel: CatalogModel | null;
  readonly recommendation: CloudModelRecommendation | null;
  readonly entries: readonly AiProviderConfigurationSummary[];
  readonly inCatalog: boolean;
  readonly state: "IN_USE" | "REGISTERED" | "AVAILABLE";
}

const STATE_ORDER = { IN_USE: 0, REGISTERED: 1, AVAILABLE: 2 } as const;

function stateLabel(row: ModelRow, catalogLoaded: boolean): string {
  if (row.state === "IN_USE") {
    return row.entries.some((entry) => entry.isDefault)
      ? "✓ En uso · predeterminado"
      : "✓ En uso";
  }
  if (row.state === "REGISTERED") return "Registrado · deshabilitado";
  if (row.recommendation) return "Recomendado · sin registrar";
  return catalogLoaded ? "Disponible · sin registrar" : "Sin registrar";
}

interface Props {
  /** Todos los registros (para saber qué endpoints y claves consultar). */
  readonly allItems: readonly AiProviderConfigurationSummary[];
  readonly gatewayUrl: string;
  readonly onEdit: (provider: AiProviderConfigurationSummary) => void;
  readonly busy?: boolean;
  readonly providerFilter?: "" | ProviderFamily;
  readonly statusFilter?: StatusFilter;
  readonly credentialFilter?: CredentialFilter;
}

function CommandBlock({ command, label }: { command: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="rq-ai-cmd">
      <span className="rq-ai-cmd__label">{label}</span>
      <div className="rq-ai-cmd__row">
        <code>{command}</code>
        <RqActionButton compact onClick={() => void copy()} tone="secondary">
          {copied ? "✓ Copiado" : "Copiar"}
        </RqActionButton>
      </div>
    </div>
  );
}

/** Terminal de ComfyUI: iniciar el servidor y primera instalación. */
function ComfyUiTerminal({ endpoint }: { endpoint: string | null }) {
  const [folder, setFolder] = useState(COMFYUI_DEFAULT_FOLDER);
  const commands = comfyUiCommands(folder, endpoint);
  return (
    <div className="rq-ai-cat__install">
      <h4 className="rq-ai-cat__section">Terminal</h4>
      <div className="rq-ai-cat__install-fields">
        <label>
          <span>Carpeta de ComfyUI</span>
          <input
            autoComplete="off"
            onChange={(event) => setFolder(event.target.value)}
            value={folder}
          />
        </label>
      </div>
      {commands ? (
        <>
          <CommandBlock
            command={commands.serve}
            label="Iniciar el servidor (déjalo abierto en otra terminal)"
          />
          <CommandBlock
            command={commands.install}
            label="Instalar (primera vez)"
          />
          <p className="rq-ai-cat__note">
            Los modelos (.safetensors) van en la carpeta models/ de ComfyUI.
            Cuando arranque, el servidor queda en{" "}
            {endpoint ?? "http://127.0.0.1:8188"}.
          </p>
        </>
      ) : (
        <p className="rq-ai-cat__error" role="alert">
          La carpeta solo puede tener letras, números y . _ / ~ - (sin
          espacios).
        </p>
      )}
    </div>
  );
}

/** Genera el comando para instalar un modelo que aún no tienes en un servidor Ollama. */
function InstallAnotherModel({ endpoints }: { endpoints: readonly string[] }) {
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState(endpoints[0] ?? "");
  const trimmed = name.trim();
  const commands = trimmed ? ollamaCommands(trimmed, endpoint || null) : null;
  return (
    <div className="rq-ai-cat__install">
      <h4 className="rq-ai-cat__section">Instalar otro modelo</h4>
      <div className="rq-ai-cat__install-fields">
        <label>
          <span>Nombre del modelo</span>
          <input
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
            placeholder="Ej. gemma4:31b"
            value={name}
          />
        </label>
        {endpoints.length > 1 ? (
          <label>
            <span>Servidor</span>
            <select
              onChange={(event) => setEndpoint(event.target.value)}
              value={endpoint}
            >
              {endpoints.map((item) => (
                <option key={item} value={item}>
                  {item.replace(/^http:\/\//u, "")}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {trimmed && !commands ? (
        <p className="rq-ai-cat__error" role="alert">
          El nombre solo puede tener letras, números y . _ : / -
        </p>
      ) : null}
      {commands ? (
        <CommandBlock command={commands.install} label="Instalar" />
      ) : null}
    </div>
  );
}

export function ProviderColumnsView({
  allItems,
  busy = false,
  credentialFilter = "",
  gatewayUrl,
  onEdit,
  providerFilter = "",
  statusFilter = "",
}: Props) {
  const [selection, setSelection] = useState<{
    family: ProviderFamily;
    kind: Kind;
  }>(() => {
    const family = providerFilter || "OLLAMA";
    const kinds = FAMILIES.find((item) => item.family === family)?.kinds;
    return { family, kind: kinds?.[0] ?? "TEXT" };
  });
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [catalogs, setCatalogs] = useState<Record<string, Catalog>>({});
  const requested = useRef(new Set<string>());

  const key = `${selection.family}:${selection.kind}`;
  const catalog = catalogs[key] ?? EMPTY_CATALOG;
  const hasCatalog =
    selection.family === "OLLAMA" ||
    selection.family === "COMPATIBLE" ||
    selection.family === "OPENAI";

  const recommendations = useMemo(
    () => (selection.kind === "TEXT" ? cloudRecommendations(selection.family) : []),
    [selection],
  );
  const hasRecommendations = recommendations.length > 0;

  const registered = useMemo(
    () =>
      allItems.filter(
        (item) =>
          familyOf(item) === selection.family &&
          item.purpose === selection.kind,
      ),
    [allItems, selection],
  );

  async function loadCatalog(): Promise<void> {
    const { family, kind } = selection;
    if (family !== "OLLAMA" && family !== "COMPATIBLE" && family !== "OPENAI") {
      return;
    }
    const cacheKey = `${family}:${kind}`;
    setCatalogs((current) => ({
      ...current,
      [cacheKey]: {
        ...(current[cacheKey] ?? EMPTY_CATALOG),
        loading: true,
        error: null,
      },
    }));
    let result: Catalog;
    try {
      if (family === "OLLAMA" || family === "COMPATIBLE") {
        const compatible = family === "COMPATIBLE";
        const wanted = compatible
          ? "OPENAI_COMPATIBLE"
          : kind === "TEXT"
            ? "OLLAMA"
            : "OLLAMA_IMAGES";
        const fallback = compatible
          ? null
          : kind === "TEXT"
            ? "http://127.0.0.1:11434"
            : "http://127.0.0.1:11435";
        const endpoints = [
          ...new Set([
            ...allItems
              .filter((item) => item.providerType === wanted)
              .map((item) => item.baseUrl),
            ...(fallback ? [fallback] : []),
          ]),
        ];
        if (endpoints.length === 0) {
          throw new Error(
            "Registra un servidor compatible con OpenAI (IP:puerto) para consultar sus modelos.",
          );
        }
        const models = new Map<string, CatalogModel>();
        const failures: string[] = [];
        for (const baseUrl of endpoints) {
          try {
            const response = await fetch(
              `${gatewayUrl}/api/v1/admin/ai-providers/${compatible ? "openai-compatible" : "ollama"}/models?baseUrl=${encodeURIComponent(baseUrl)}`,
              { credentials: "include" },
            );
            if (!response.ok) throw new Error(await failureMessage(response));
            const payload =
              (await response.json()) as OllamaInstalledModelsResponse;
            for (const model of payload.models) {
              models.set(`${baseUrl}|${model.name}`, {
                id: model.name,
                detail: [
                  model.parameterSize,
                  model.quantizationLevel,
                  formatSize(model.size),
                  baseUrl.replace(/^http:\/\//u, ""),
                ]
                  .filter(Boolean)
                  .join(" · "),
                endpoint: baseUrl,
                parameterSize: model.parameterSize,
                quantization: model.quantizationLevel,
                sizeBytes: model.size,
                contextLength: model.contextLength,
                capabilities: model.capabilities,
              });
            }
          } catch (error) {
            failures.push(
              `${baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        result = {
          models: [...models.values()],
          updatedAt: new Date(),
          error:
            models.size === 0 && failures.length > 0
              ? failures.join(" · ")
              : null,
          loading: false,
        };
      } else {
        const source = allItems.find(
          (item) => item.providerType === "OPENAI" && item.credentialConfigured,
        );
        if (!source) {
          throw new Error(
            "Registra un proveedor OpenAI con clave protegida para consultar sus modelos.",
          );
        }
        const response = await fetch(
          `${gatewayUrl}/api/v1/admin/ai-providers/${encodeURIComponent(source.id)}/openai/models`,
          { credentials: "include" },
        );
        if (!response.ok) throw new Error(await failureMessage(response));
        const payload = (await response.json()) as { models: { id: string }[] };
        const accepts =
          kind === "TEXT" ? isOpenAiTextModel : isOpenAiImageModel;
        result = {
          models: payload.models
            .filter((model) => accepts(model.id))
            .map((model) => ({
              id: model.id,
              detail: "api.openai.com",
              endpoint: source.baseUrl,
              parameterSize: null,
              quantization: null,
              sizeBytes: null,
              contextLength: null,
              capabilities: [],
            })),
          updatedAt: new Date(),
          error: null,
          loading: false,
        };
      }
    } catch (error) {
      result = {
        models: [],
        updatedAt: new Date(),
        error: error instanceof Error ? error.message : String(error),
        loading: false,
      };
    }
    setCatalogs((current) => ({ ...current, [cacheKey]: result }));
  }

  // Al elegir una IA se consulta su catálogo una sola vez; «Actualizar» lo repite.
  useEffect(() => {
    if (!hasCatalog || requested.current.has(key)) return;
    requested.current.add(key);
    void loadCatalog();
  }, [key, hasCatalog]);

  const rows = useMemo<readonly ModelRow[]>(() => {
    const byModel = new Map<string, AiProviderConfigurationSummary[]>();
    for (const entry of registered) {
      byModel.set(entry.model, [...(byModel.get(entry.model) ?? []), entry]);
    }
    const catalogById = new Map(catalog.models.map((m) => [m.id, m]));
    const recommendationById = new Map(recommendations.map((m) => [m.id, m]));
    const ids = new Set([
      ...byModel.keys(),
      ...catalogById.keys(),
      ...recommendationById.keys(),
    ]);
    const built = [...ids].map<ModelRow>((id) => {
      const entries = byModel.get(id) ?? [];
      return {
        id,
        detail:
          catalogById.get(id)?.detail ??
          (recommendationById.has(id)
            ? `${recommendationById.get(id)?.name} · ${recommendationById.get(id)?.costLabel}`
            : ""),
        catalogModel: catalogById.get(id) ?? null,
        recommendation: recommendationById.get(id) ?? null,
        entries,
        inCatalog: catalogById.has(id),
        state:
          entries.length === 0
            ? "AVAILABLE"
            : entries.some((entry) => entry.isEnabled)
              ? "IN_USE"
              : "REGISTERED",
      };
    });
    return built
      .filter((row) => {
        if (providerFilter && providerFilter !== selection.family) {
          return false;
        }
        // Estado y credencial describen registros: ocultan lo no registrado.
        if (statusFilter || credentialFilter) {
          if (row.entries.length === 0) return false;
          if (
            statusFilter &&
            !row.entries.some(
              (entry) => (statusFilter === "ENABLED") === entry.isEnabled,
            )
          ) {
            return false;
          }
          if (
            credentialFilter &&
            !row.entries.some(
              (entry) => credentialOf(entry) === credentialFilter,
            )
          ) {
            return false;
          }
        }
        return true;
      })
      .sort(
        (a, b) =>
          STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
          a.id.localeCompare(b.id),
      );
  }, [
    registered,
    recommendations,
    catalog.models,
    providerFilter,
    statusFilter,
    credentialFilter,
    selection.family,
  ]);

  const selected = rows.find((row) => row.id === selectedModel) ?? null;
  const commands = selected
    ? ollamaCommands(
        selected.id,
        selected.catalogModel?.endpoint ?? selected.entries[0]?.baseUrl ?? null,
      )
    : null;
  const inUse = rows.filter((row) => row.state === "IN_USE").length;
  const available = rows.filter((row) => row.state === "AVAILABLE").length;
  const catalogLoaded = catalog.updatedAt !== null && !catalog.error;
  const label = FAMILIES.find((f) => f.family === selection.family)?.label;

  return (
    <div className="rq-ai-cat">
      <nav aria-label="IA por proveedor" className="rq-ai-cat__families">
        <h3>IA</h3>
        <ul>
          {FAMILIES.filter(
            (item) => !providerFilter || item.family === providerFilter,
          ).map((item) => (
            <li key={item.family}>
              <strong>{item.label}</strong>
              <ul>
                {item.kinds.map((kind) => {
                  const count = allItems.filter(
                    (entry) =>
                      familyOf(entry) === item.family && entry.purpose === kind,
                  ).length;
                  const recommended =
                    kind === "TEXT"
                      ? cloudRecommendations(item.family).length
                      : 0;
                  const active =
                    selection.family === item.family && selection.kind === kind;
                  return (
                    <li key={kind}>
                      <button
                        aria-pressed={active}
                        className="rq-ai-cat__choice"
                        onClick={() => {
                          setSelection({ family: item.family, kind });
                          setSelectedModel(null);
                        }}
                        type="button"
                      >
                        <span>{KIND_LABEL[kind]}</span>
                        <small>
                          {count}
                          {recommended > 0
                            ? ` · ${recommended} recomendados`
                            : ""}
                        </small>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </nav>

      <section aria-label="Modelos" className="rq-ai-cat__models">
        <header className="rq-ai-cat__header">
          <h3>
            {label} · {KIND_LABEL[selection.kind]}
          </h3>
          {hasCatalog ? (
            <RqActionButton
              compact
              disabled={catalog.loading}
              onClick={() => void loadCatalog()}
              tone="consult"
            >
              {catalog.loading ? "Actualizando…" : "↻ Actualizar"}
            </RqActionButton>
          ) : null}
        </header>

        <p className="rq-ai-cat__note" role="status">
          {catalog.loading
            ? "Consultando al proveedor…"
            : catalog.error
              ? null
              : catalogLoaded
                ? `Actualizado ${time(catalog.updatedAt)} · ${inUse} en uso · ${available} disponibles sin registrar`
                : hasCatalog
                  ? "Aún no se consultó al proveedor."
                  : hasRecommendations
                    ? `Catálogo recomendado de referencia (verificado el ${CLOUD_CATALOG_VERIFIED_AT}), sin consultar al proveedor · ${recommendations.length} recomendados · ${inUse} en uso. Solo se pueden usar los modelos registrados.`
                    : selection.family === "COMFYUI"
                    ? "ComfyUI no ofrece un catálogo: se muestran los workflows registrados."
                    : "Este proveedor no ofrece un catálogo: se muestran los modelos que registraste."}
        </p>
        {catalog.error ? (
          <p className="rq-ai-cat__error" role="alert">
            {catalog.error}
          </p>
        ) : null}
        {catalog.error && selection.family === "OLLAMA" ? (
          <CommandBlock
            command={ollamaServeCommand(
              selection.kind === "TEXT"
                ? "http://127.0.0.1:11434"
                : "http://127.0.0.1:11435",
            )}
            label="Para iniciar el servidor local"
          />
        ) : null}
        {rows.length === 0 && !catalog.loading ? (
          <p className="rq-ai-cat__note">Sin modelos para mostrar.</p>
        ) : (
          <ul className="rq-ai-cat__list">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  aria-pressed={selected?.id === row.id}
                  className="rq-ai-cat__model"
                  data-state={row.state}
                  onClick={() => setSelectedModel(row.id)}
                  type="button"
                >
                  <span>
                    <strong>{row.id}</strong>
                    {row.detail ? <small>{row.detail}</small> : null}
                  </span>
                  <RqStatusBadge
                    tone={
                      row.state === "IN_USE"
                        ? "success"
                        : row.state === "REGISTERED"
                          ? "inactive"
                          : "neutral"
                    }
                  >
                    {stateLabel(row, catalogLoaded)}
                  </RqStatusBadge>
                </button>
              </li>
            ))}
          </ul>
        )}
        {selection.family === "COMFYUI" ? (
          <ComfyUiTerminal
            endpoint={
              allItems.find((item) => item.providerType === "COMFYUI")
                ?.baseUrl ?? null
            }
          />
        ) : null}
        {selection.family === "OLLAMA" ? (
          <InstallAnotherModel
            endpoints={[
              ...new Set([
                ...allItems
                  .filter(
                    (item) =>
                      item.providerType ===
                      (selection.kind === "TEXT" ? "OLLAMA" : "OLLAMA_IMAGES"),
                  )
                  .map((item) => item.baseUrl),
                selection.kind === "TEXT"
                  ? "http://127.0.0.1:11434"
                  : "http://127.0.0.1:11435",
              ]),
            ]}
            key={key}
          />
        ) : null}
      </section>

      <section aria-label="Detalle del modelo" className="rq-ai-cat__detail">
        <h3>Detalle</h3>
        {selected ? (
          <>
            <div className="rq-ai-cat__title">
              <strong>{selected.id}</strong>
              <RqStatusBadge
                tone={
                  selected.state === "IN_USE"
                    ? "success"
                    : selected.state === "REGISTERED"
                      ? "inactive"
                      : "neutral"
                }
              >
                {stateLabel(selected, catalogLoaded)}
              </RqStatusBadge>
            </div>

            <h4 className="rq-ai-cat__section">Datos del modelo</h4>
            {selected.catalogModel ? (
              <dl className="rq-ai-cat__facts">
                <div>
                  <dt>Proveedor</dt>
                  <dd>
                    {label} · {KIND_LABEL[selection.kind]}
                  </dd>
                </div>
                {selected.catalogModel.endpoint ? (
                  <div>
                    <dt>Servidor</dt>
                    <dd>{selected.catalogModel.endpoint}</dd>
                  </div>
                ) : null}
                {selected.catalogModel.parameterSize ? (
                  <div>
                    <dt>Parámetros</dt>
                    <dd>{selected.catalogModel.parameterSize}</dd>
                  </div>
                ) : null}
                {selected.catalogModel.quantization ? (
                  <div>
                    <dt>Cuantización</dt>
                    <dd>{selected.catalogModel.quantization}</dd>
                  </div>
                ) : null}
                {selected.catalogModel.sizeBytes !== null ? (
                  <div>
                    <dt>Tamaño en disco</dt>
                    <dd>{formatSize(selected.catalogModel.sizeBytes)}</dd>
                  </div>
                ) : null}
                {selected.catalogModel.contextLength !== null ? (
                  <div>
                    <dt>Contexto máximo</dt>
                    <dd>
                      {selected.catalogModel.contextLength.toLocaleString(
                        "es-CO",
                      )}{" "}
                      tokens
                    </dd>
                  </div>
                ) : null}
                {selected.catalogModel.capabilities.length > 0 ? (
                  <div>
                    <dt>Capacidades</dt>
                    <dd>{selected.catalogModel.capabilities.join(", ")}</dd>
                  </div>
                ) : null}
              </dl>
            ) : selected.recommendation ? null : (
              <p className="rq-ai-cat__note">
                El proveedor no reporta datos de este modelo
                {catalogLoaded ? " (ya no aparece en su catálogo)" : ""}.
              </p>
            )}

            {selected.recommendation ? (
              <>
                <dl className="rq-ai-cat__facts">
                  <div>
                    <dt>Proveedor</dt>
                    <dd>
                      {label} · {KIND_LABEL[selection.kind]}
                    </dd>
                  </div>
                  <div>
                    <dt>Modelo</dt>
                    <dd>{selected.recommendation.name}</dd>
                  </div>
                  <div>
                    <dt>Uso recomendado</dt>
                    <dd>{selected.recommendation.usage}</dd>
                  </div>
                  <div>
                    <dt>Costo de la API</dt>
                    <dd>{selected.recommendation.costLabel}</dd>
                  </div>
                </dl>
                <p className="rq-ai-cat__note">
                  {selected.recommendation.costNotice} Referencia verificada el{" "}
                  {selected.recommendation.verifiedAt}; confirma las condiciones
                  vigentes con el proveedor.
                </p>
                <a
                  href={selected.recommendation.pricingUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Ver condiciones del proveedor
                </a>
              </>
            ) : null}

            <h4 className="rq-ai-cat__section">Uso en el sistema</h4>
            {selected.entries.length === 0 ? (
              <p className="rq-ai-cat__note">
                {selected.recommendation
                  ? "Es una recomendación de referencia: todavía no está registrado, así que no se puede usar."
                  : "Existe en el proveedor, pero todavía no está registrado, así que no se puede usar."}
              </p>
            ) : (
              <ul className="rq-ai-cat__records">
                {selected.entries.map((entry) => (
                  <li key={entry.id}>
                    <span>
                      <strong>{entry.name}</strong>
                      <small>
                        {entry.isEnabled ? "Habilitado" : "Deshabilitado"}
                        {entry.isDefault ? " · Predeterminado" : ""}
                      </small>
                    </span>
                    <RqActionButton
                      compact
                      disabled={busy}
                      onClick={() => onEdit(entry)}
                      tone="operation"
                    >
                      Editar
                    </RqActionButton>
                  </li>
                ))}
              </ul>
            )}

            {selection.family === "OLLAMA" && commands ? (
              <>
                <h4 className="rq-ai-cat__section">Terminal</h4>
                <CommandBlock
                  command={commands.serve}
                  label={
                    commands.remote
                      ? "Iniciar el servidor (en ese equipo)"
                      : "Iniciar el servidor (déjalo abierto en otra terminal)"
                  }
                />
                <CommandBlock command={commands.install} label="Instalar" />
                <CommandBlock command={commands.run} label="Ejecutar" />
                {commands.host ? (
                  <p className="rq-ai-cat__note">
                    Instalar y ejecutar usan tu terminal contra el servidor{" "}
                    {commands.host}, que debe estar iniciado.
                  </p>
                ) : null}
              </>
            ) : null}
          </>
        ) : (
          <p className="rq-ai-cat__note">
            Elige un modelo para ver sus datos, su registro y si está en uso.
          </p>
        )}
      </section>
    </div>
  );
}
