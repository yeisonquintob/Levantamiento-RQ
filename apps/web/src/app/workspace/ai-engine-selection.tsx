"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AiEngine,
  AiProviderSelections,
  AiSelectableProvider,
  RequirementDiscussionCapabilitiesResponse,
} from "@levantamiento-rq/shared-contracts";

import { authenticatedFetch } from "../authenticated-fetch";

const GATEWAY_URL =
  process.env.NODE_ENV === "development" && typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : (process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000");

interface AiEngineSelection {
  local: boolean;
  cloud: boolean;
  /**
   * Verdadero solo cuando la persona accionó un interruptor. Una selección de
   * nube guardada sin este gesto (p. ej. el antiguo valor predeterminado) se
   * ignora: la IA nube nunca se preselecciona.
   */
  explicit?: boolean;
  providerSelections?: AiProviderSelections;
}

const EMPTY_SELECTION: AiEngineSelection = { local: false, cloud: false };

function selectionStorageKey(projectId: string, storageScope: string): string {
  return storageScope === "shared"
    ? `rq-ai-engine-selection-v2:sources:${projectId}`
    : `rq-ai-engine-selection-v1:${storageScope}:${projectId}`;
}

function storedSelection(
  projectId: string,
  storageScope: string,
): AiEngineSelection | null {
  try {
    const current = window.localStorage.getItem(
      selectionStorageKey(projectId, storageScope),
    );
    // Conserva los interruptores históricos al pasar a una elección por proyecto.
    const legacy =
      storageScope === "shared"
        ? (window.localStorage.getItem("rq-ai-engine-selection-v1:shared") ??
          window.localStorage.getItem(`rq-ai-engine-selection-v1:${projectId}`))
        : null;
    const value = JSON.parse(
      current ?? legacy ?? "null",
    ) as Partial<AiEngineSelection> | null;
    return value &&
      typeof value.local === "boolean" &&
      typeof value.cloud === "boolean"
      ? {
          local: value.local,
          cloud: value.cloud,
          explicit: value.explicit === true,
          providerSelections: value.providerSelections,
        }
      : null;
  } catch {
    return null;
  }
}

export function useAiEngineSelection(
  projectId: string,
  storageScope = "shared",
) {
  const [capabilities, setCapabilities] =
    useState<RequirementDiscussionCapabilitiesResponse | null>(null);
  const [selection, setSelection] =
    useState<AiEngineSelection>(EMPTY_SELECTION);
  const [loading, setLoading] = useState(true);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!projectId) {
      setCapabilities(null);
      setSelection(EMPTY_SELECTION);
      setError(null);
      setLoading(false);
      return () => {
        active = false;
      };
    }
    setLoading(true);
    setLoadedScope(null);
    setError(null);
    setCapabilities(null);
    setSelection(EMPTY_SELECTION);
    void authenticatedFetch(
      `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(projectId)}/analysis-requests/discussion/capabilities`,
      { cache: "no-store", headers: { accept: "application/json" } },
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("No fue posible consultar los motores de IA.");
        }
        return (await response.json()) as RequirementDiscussionCapabilitiesResponse;
      })
      .then((result) => {
        if (!active) return;
        const stored = storedSelection(projectId, storageScope);
        setLoadedScope(selectionStorageKey(projectId, storageScope));
        setCapabilities(result);
        setSelection({
          providerSelections: Object.fromEntries(
            (["LOCAL", "CLOUD"] as const).flatMap((engine) => {
              const saved = stored?.providerSelections?.[engine];
              const candidates =
                result.providers?.filter(
                  (p) => p.engine === engine && p.available,
                ) ?? [];
              const id =
                saved ??
                candidates.find((p) => p.isDefault)?.id ??
                candidates[0]?.id;
              return id ? [[engine, id]] : [];
            }),
          ),
          local:
            (stored?.local ?? result.local.enabled) && result.local.enabled,
          // La nube solo se restaura desde una elección explícita previa.
          cloud:
            stored?.explicit === true && stored.cloud && result.cloud.enabled,
          explicit: stored?.explicit === true,
        });
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(
          reason instanceof Error
            ? reason.message
            : "No fue posible consultar los motores de IA.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId, storageScope]);

  useEffect(() => {
    if (
      loading ||
      !capabilities ||
      loadedScope !== selectionStorageKey(projectId, storageScope)
    )
      return;
    window.localStorage.setItem(
      selectionStorageKey(projectId, storageScope),
      JSON.stringify(selection),
    );
  }, [capabilities, loading, loadedScope, projectId, selection, storageScope]);

  const toggle = useCallback(
    (engine: AiEngine) => {
      const capability =
        engine === "LOCAL" ? capabilities?.local : capabilities?.cloud;
      setSelection((current) => {
        if (
          !capability?.enabled &&
          !(engine === "LOCAL" ? current.local : current.cloud)
        )
          return current;
        const next =
          engine === "LOCAL"
            ? { ...current, local: !current.local, explicit: true }
            : { ...current, cloud: !current.cloud, explicit: true };
        // Persistimos en el mismo gesto de la persona. Así una navegación o
        // recarga inmediata no puede adelantarse al efecto de React y restaurar
        // el valor predeterminado del proveedor.
        window.localStorage.setItem(
          selectionStorageKey(projectId, storageScope),
          JSON.stringify(next),
        );
        return next;
      });
    },
    [capabilities, projectId, storageScope],
  );

  const engines = useMemo<AiEngine[]>(
    () =>
      [
        ...(selection.local && capabilities?.local.enabled
          ? (["LOCAL"] as const)
          : []),
        ...(selection.cloud && capabilities?.cloud.enabled
          ? (["CLOUD"] as const)
          : []),
      ].filter(
        (engine) =>
          !capabilities?.providers ||
          capabilities.providers.some(
            (p) =>
              p.id === selection.providerSelections?.[engine] &&
              p.engine === engine &&
              p.available,
          ),
      ),
    [capabilities, selection],
  );

  const selectProvider = useCallback(
    (engine: AiEngine, id: string) => {
      if (
        !capabilities?.providers?.some(
          (p) => p.engine === engine && p.id === id && p.available,
        )
      )
        return;
      setSelection((current) => ({
        ...current,
        providerSelections: { ...current.providerSelections, [engine]: id },
      }));
    },
    [capabilities],
  );
  return {
    capabilities,
    engines,
    error,
    loading,
    selection,
    toggle,
    providerSelections: selection.providerSelections,
    selectProvider,
  };
}

function AiEngineModelOption({
  engine,
  label,
  capability,
  selected,
  loading,
  locked,
  providers,
  selectedId,
  selectProvider,
  toggle,
}: {
  engine: AiEngine;
  label: string;
  capability: RequirementDiscussionCapabilitiesResponse["local"] | undefined;
  selected: boolean;
  loading: boolean;
  locked: boolean;
  providers?: readonly AiSelectableProvider[];
  selectedId?: string;
  selectProvider?: (engine: AiEngine, id: string) => void;
  toggle: (engine: AiEngine) => void;
}) {
  const options = providers?.filter((p) => p.engine === engine);
  const chosen = options?.find((p) => p.id === selectedId);
  const available = options
    ? Boolean(chosen?.available)
    : Boolean(capability?.enabled);
  const active = selected && available;
  const status = loading
    ? "Comprobando"
    : !available
      ? "Selecciona un modelo disponible"
      : locked && active
        ? "En proceso"
        : active
          ? "Encendida"
          : "Apagada";
  return (
    <div
      className="rq-ai-model-card"
      data-rq-active={active}
      data-rq-unavailable={!available}
    >
      <div className="rq-ai-model-card__head">
        <span aria-hidden="true" className="rq-ai-engine-chip__dot" />
        <strong>{label}</strong>
        <span className="rq-ai-model-card__status">{status}</span>
        <button
          type="button"
          role="switch"
          aria-label={`${active ? "Apagar" : "Encender"} ${label}`}
          aria-checked={active}
          className="rq-ai-switch"
          disabled={loading || locked || (!available && !selected)}
          onClick={() => toggle(engine)}
        />
      </div>
      <select
        aria-label={`Modelo de ${label}`}
        value={selectedId ?? ""}
        disabled={loading || locked || !selectProvider}
        onChange={(event) => selectProvider?.(engine, event.target.value)}
      >
        <option value="" disabled>
          Selecciona un modelo
        </option>
        {selectedId && !chosen ? (
          <option value={selectedId} disabled>
            Proveedor no disponible
          </option>
        ) : null}
        {options?.map((p) => (
          <option key={p.id} value={p.id} disabled={!p.available}>
            {p.name} · {p.model}
            {p.available ? "" : ` · ${p.message}`}
          </option>
        ))}
      </select>
      {chosen ? (
        <small>
          Límite de entrada: {chosen.maxInputTokens.toLocaleString("es-CO")}{" "}
          tokens
        </small>
      ) : null}
      {options?.length === 0 ? (
        <small>
          Registra un proveedor en Configuración → Proveedores de IA.
        </small>
      ) : null}
    </div>
  );
}

export function AiEngineChips({
  capabilities,
  locked = false,
  loading,
  menu = false,
  selection,
  toggle,
  providerSelections,
  selectProvider,
}: {
  capabilities: RequirementDiscussionCapabilitiesResponse | null;
  locked?: boolean;
  loading: boolean;
  menu?: boolean;
  selection: AiEngineSelection;
  toggle: (engine: AiEngine) => void;
  providerSelections?: AiProviderSelections;
  selectProvider?: (engine: AiEngine, id: string) => void;
}) {
  const engineOptions = [
    ["LOCAL", "IA local", capabilities?.local, selection.local],
    ["CLOUD", "IA nube", capabilities?.cloud, selection.cloud],
  ] as const;
  const activeCount = engineOptions.filter(
    ([, , capability, selected]) => capability?.enabled && selected,
  ).length;
  const controls = engineOptions.map(
    ([engine, label, capability, selected]) => {
      if (selectProvider)
        return (
          <AiEngineModelOption
            key={engine}
            engine={engine}
            label={label}
            capability={capability}
            selected={selected}
            loading={loading}
            locked={locked}
            providers={capabilities?.providers}
            selectedId={providerSelections?.[engine]}
            selectProvider={selectProvider}
            toggle={toggle}
          />
        );
      const available = capability?.enabled ?? false;
      const active = available && selected;
      return (
        <button
          aria-checked={active}
          className="rq-ai-engine-chip"
          data-rq-active={active}
          disabled={loading || locked || !available}
          key={engine}
          onClick={() => toggle(engine)}
          role="switch"
          title={capability?.message}
          type="button"
        >
          <span aria-hidden="true" className="rq-ai-engine-chip__dot" />
          <span>{label}</span>
          <small>
            {loading
              ? "Comprobando"
              : !available
                ? "No disponible"
                : locked && active
                  ? "En proceso"
                  : active
                    ? "Encendida"
                    : "Apagada"}
          </small>
        </button>
      );
    },
  );

  if (menu) {
    return (
      <details className="rq-ai-engine-menu">
        <summary
          aria-label="Configurar motores de IA"
          data-rq-active={activeCount > 0}
        >
          <span aria-hidden="true" className="rq-ai-engine-chip__dot" />
          <span>IA</span>
          <small>
            {loading
              ? "Comprobando"
              : `${activeCount} ${activeCount === 1 ? "encendida" : "encendidas"}`}
          </small>
        </summary>
        <aside aria-label="Motores de IA" className="rq-ai-engine-menu__panel">
          {controls}
        </aside>
      </details>
    );
  }

  return (
    <aside aria-label="Motores de IA" className="rq-ai-engine-chips">
      {controls}
    </aside>
  );
}

/**
 * Compact selector for source processing.  Keeping the three switches inside
 * one disclosure avoids competing for command-bar space while preserving the
 * individual, persisted IA selections.
 */
export function AiProcessingMenu({
  capabilities,
  includePrototype,
  loading,
  label = "Procesamiento IA",
  locked = false,
  selection,
  toggle,
  togglePrototype,
  providerSelections,
  selectProvider,
}: {
  label?: string;
  capabilities: RequirementDiscussionCapabilitiesResponse | null;
  includePrototype: boolean;
  loading: boolean;
  locked?: boolean;
  selection: AiEngineSelection;
  toggle: (engine: AiEngine) => void;
  togglePrototype: () => void;
  providerSelections?: AiProviderSelections;
  selectProvider?: (engine: AiEngine, id: string) => void;
}) {
  const engineOptions = [
    ["LOCAL", "IA local", capabilities?.local, selection.local],
    ["CLOUD", "IA nube", capabilities?.cloud, selection.cloud],
  ] as const;
  const activeEngineCount = engineOptions.filter(
    ([engine, , capability, selected]) =>
      capability?.enabled &&
      selected &&
      (!capabilities?.providers ||
        capabilities.providers.some(
          (p) =>
            p.id === providerSelections?.[engine] &&
            p.engine === engine &&
            p.available,
        )),
  ).length;
  const activeCount = activeEngineCount + Number(includePrototype);
  const activeCountLabel = `${activeCount} ${
    activeCount === 1 ? "opción activada" : "opciones activadas"
  }`;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, [menuOpen]);

  return (
    <details
      className="rq-ai-processing-menu"
      ref={menuRef}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (next && !event.currentTarget.contains(next)) setMenuOpen(false);
      }}
      onToggle={(event) => {
        // El selector es una herramienta de configuración persistente. Algunos
        // navegadores pueden cerrar un <details> al cambiar el foco o cuando un
        // control interno provoca un rerender; solo el summary debe plegarlo.
        if (event.currentTarget.open !== menuOpen) {
          event.currentTarget.open = menuOpen;
        }
      }}
      open={menuOpen}
    >
      <summary
        aria-label={`Configurar procesamiento IA. ${
          loading ? "Comprobando opciones disponibles" : activeCountLabel
        }`}
        data-rq-active={activeCount > 0}
        onClick={(event) => {
          event.preventDefault();
          setMenuOpen((current) => !current);
        }}
      >
        <span aria-hidden="true" className="rq-ai-engine-chip__dot" />
        <span>{label}</span>
      </summary>
      <aside
        aria-label="Opciones de procesamiento"
        className="rq-ai-processing-menu__panel"
      >
        <div className="rq-ai-model-card" data-rq-active={includePrototype}>
          <div className="rq-ai-model-card__head">
            <span aria-hidden="true" className="rq-ai-engine-chip__dot" />
            <strong>Prototipo</strong>
            <span className="rq-ai-model-card__status">
              {includePrototype ? "Activado" : "Desactivado"}
            </span>
            <button
              type="button"
              role="switch"
              aria-label={`${includePrototype ? "Desactivar" : "Activar"} prototipo`}
              aria-checked={includePrototype}
              className="rq-ai-switch"
              disabled={locked}
              onClick={togglePrototype}
            />
          </div>
        </div>
        {engineOptions.map(([engine, label, capability, selected]) => {
          if (selectProvider)
            return (
              <AiEngineModelOption
                key={engine}
                engine={engine}
                label={label}
                capability={capability}
                selected={selected}
                loading={loading}
                locked={locked}
                providers={capabilities?.providers}
                selectedId={providerSelections?.[engine]}
                selectProvider={selectProvider}
                toggle={toggle}
              />
            );
          const available = capability?.enabled ?? false;
          const active = available && selected;
          return (
            <button
              aria-checked={active}
              className="rq-ai-engine-chip"
              data-rq-active={active}
              disabled={loading || locked || !available}
              key={engine}
              onClick={() => toggle(engine)}
              role="switch"
              title={capability?.message}
              type="button"
            >
              <span aria-hidden="true" className="rq-ai-engine-chip__dot" />
              <span>{label}</span>
              <small>
                {loading
                  ? "Comprobando"
                  : !available
                    ? "No disponible"
                    : locked && active
                      ? "En proceso"
                      : active
                        ? "Encendida"
                        : "Apagada"}
              </small>
            </button>
          );
        })}
      </aside>
    </details>
  );
}
