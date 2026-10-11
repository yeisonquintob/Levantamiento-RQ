"use client";

import { useMemo, useState } from "react";
import type {
  ViabilityConfiguration,
  ViabilityCriterion,
} from "@levantamiento-rq/shared-contracts";
import { validateViabilityCriteria } from "@levantamiento-rq/shared-contracts";
import {
  RqActionButton,
  RqKpiCard,
  RqKpiGrid,
  RqStatusBadge,
} from "@levantamiento-rq/shared-ui";
import styles from "./viability-workspace.module.css";
import { WorkspaceKpiIcon } from "../../workspace-kpi-icon";
import { useAutoDismiss } from "../../../use-auto-dismiss";

const GATEWAY_URL =
  process.env.NODE_ENV === "development" && typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : (process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000");

export function ViabilityWorkspace({
  initialConfiguration,
  initialError,
}: {
  initialConfiguration?: ViabilityConfiguration;
  initialError?: string;
}) {
  const [configuration, setConfiguration] = useState(initialConfiguration);
  const [message, setMessage] = useState(initialError ?? "");
  useAutoDismiss(message, () => setMessage(""));
  const [saving, setSaving] = useState(false);
  const summary = useMemo(() => {
    const active = configuration?.criteria.filter((item) => item.active) ?? [];
    return {
      active: active.length,
      viable: active.filter((item) => item.viable).length,
      coverage:
        validateViabilityCriteria(configuration?.criteria ?? []).length === 0,
    };
  }, [configuration]);

  if (!configuration)
    return (
      <section className={`rq-module-page ${styles.empty}`}>
        <strong>No se pudo abrir el maestro.</strong>
        <p className="rq-inline-alert" data-tone="danger" role="alert">
          <span>{message || "No hay configuración disponible."}</span>
        </p>
      </section>
    );

  function update(index: number, patch: Partial<ViabilityCriterion>): void {
    setConfiguration((current) =>
      current
        ? {
            ...current,
            criteria: current.criteria.map((item, position) =>
              position === index ? { ...item, ...patch } : item,
            ),
          }
        : current,
    );
  }

  async function save(): Promise<void> {
    const current = configuration;
    if (!current) return;
    const errors = validateViabilityCriteria(current.criteria);
    if (errors.length) {
      setMessage(errors.join(" "));
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`${GATEWAY_URL}/api/v1/viability-criteria`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(current),
      });
      const payload = (await response.json().catch(() => null)) as
        ViabilityConfiguration | { message?: string } | null;
      if (!response.ok)
        throw new Error(
          payload && "message" in payload
            ? payload.message
            : "No fue posible guardar.",
        );
      setConfiguration(payload as ViabilityConfiguration);
      setMessage("Configuración guardada correctamente.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "No fue posible guardar.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className={`rq-module-page rq-viability-workspace ${styles.workspace}`}
    >
      <header className={`rq-viability-hero ${styles.hero}`}>
        <div>
          <span className={styles.eyebrow}>Evaluación determinística</span>
          <h2>Criterios de viabilidad</h2>
          <p>
            Define cómo se interpreta el nivel de información de cada respuesta
            y cuándo requiere intervención.
          </p>
        </div>
        <RqActionButton
          disabled={saving}
          onClick={() => void save()}
          tone="operation"
        >
          {saving ? "Guardando…" : "Guardar cambios"}
        </RqActionButton>
      </header>

      <section
        className={`rq-viability-overview ${styles.overview}`}
        aria-label="Resumen del maestro"
      >
        <article className={`rq-viability-threshold ${styles.thresholdCard}`}>
          <div className={styles.cardIcon} aria-hidden="true">
            Δ
          </div>
          <div className={styles.thresholdCopy}>
            <strong>Umbral de discrepancia</strong>
            <span>
              Alerta cuando dos orígenes difieren este número de puntos.
            </span>
          </div>
          <label className={styles.percentageField}>
            <input
              aria-label="Umbral de discrepancia entre orígenes"
              max={100}
              min={0}
              onChange={(event) =>
                setConfiguration({
                  ...configuration,
                  discrepancyThreshold: Number(event.target.value),
                })
              }
              type="number"
              value={configuration.discrepancyThreshold}
            />
            <span>%</span>
          </label>
        </article>
        <RqKpiGrid label="Indicadores de criterios">
          <RqKpiCard
            description={`de ${configuration.criteria.length} configurados`}
            icon={<WorkspaceKpiIcon name="check" />}
            title="Criterios activos"
            value={String(summary.active)}
          />
          <RqKpiCard
            description="clasificados para continuar"
            icon={<WorkspaceKpiIcon name="viable" />}
            title="Niveles viables"
            value={String(summary.viable)}
          />
          <RqKpiCard
            description={
              summary.coverage
                ? "sin vacíos ni cruces"
                : "rangos inconsistentes"
            }
            icon={
              <WorkspaceKpiIcon name={summary.coverage ? "layers" : "alert"} />
            }
            title="Cobertura"
            value={summary.coverage ? "0–100%" : "Revisar"}
            valueTone={summary.coverage ? "success" : "danger"}
          />
        </RqKpiGrid>
      </section>

      {message ? (
        <div
          aria-live="polite"
          className={styles.message}
          data-success={message.includes("correctamente")}
          role={message.includes("correctamente") ? "status" : "alert"}
        >
          {message}
        </div>
      ) : null}

      <section className={`rq-viability-criteria ${styles.criteriaSection}`}>
        <header className={`rq-viability-heading ${styles.sectionHeading}`}>
          <div>
            <h3>Rangos configurados</h3>
            <p>
              Cada porcentaje debe pertenecer exactamente a un criterio activo.
            </p>
          </div>
          <span>{configuration.criteria.length} niveles</span>
        </header>
        <div className={`rq-viability-grid ${styles.criteriaGrid}`}>
          {configuration.criteria.map((item, index) => (
            <article
              className={`rq-viability-card ${styles.criterionCard}`}
              data-active={item.active}
              data-viable={item.viable}
              key={item.id}
            >
              <header className={styles.criterionHeader}>
                <div className={styles.levelBadge}>
                  <span>Nivel</span>
                  <input
                    aria-label={`Nivel ${index + 1}`}
                    min={1}
                    onChange={(event) =>
                      update(index, {
                        level: Number(event.target.value),
                        order: Number(event.target.value),
                      })
                    }
                    type="number"
                    value={item.level}
                  />
                </div>
                <label className={styles.rangeField}>
                  <span>Rango de definición</span>
                  <span className={styles.rangeInputs}>
                    <input
                      aria-label={`Porcentaje mínimo del nivel ${item.level}`}
                      max={100}
                      min={0}
                      onChange={(event) =>
                        update(index, {
                          minimumPercentage: Number(event.target.value),
                        })
                      }
                      type="number"
                      value={item.minimumPercentage}
                    />
                    <i>—</i>
                    <input
                      aria-label={`Porcentaje máximo del nivel ${item.level}`}
                      max={100}
                      min={0}
                      onChange={(event) =>
                        update(index, {
                          maximumPercentage: Number(event.target.value),
                        })
                      }
                      type="number"
                      value={item.maximumPercentage}
                    />
                    <b>%</b>
                  </span>
                </label>
                <button
                  aria-pressed={item.viable}
                  className={styles.classificationButton}
                  onClick={() => update(index, { viable: !item.viable })}
                  type="button"
                >
                  <RqStatusBadge tone={item.viable ? "success" : "pending"}>
                    {item.viable ? "Viable" : "No viable"}
                  </RqStatusBadge>
                </button>
              </header>
              <div className={`rq-viability-fields ${styles.fieldsGrid}`}>
                <label className={styles.field}>
                  <span>Nombre del criterio</span>
                  <input
                    onChange={(event) =>
                      update(index, { name: event.target.value })
                    }
                    value={item.name}
                  />
                </label>
                <label className={styles.field}>
                  <span>Descripción</span>
                  <textarea
                    onChange={(event) =>
                      update(index, { description: event.target.value })
                    }
                    rows={3}
                    value={item.description}
                  />
                </label>
                <label className={`${styles.field} ${styles.fullWidth}`}>
                  <span>Recomendación</span>
                  <textarea
                    onChange={(event) =>
                      update(index, { recommendation: event.target.value })
                    }
                    rows={2}
                    value={item.recommendation}
                  />
                </label>
              </div>
              <footer className={styles.criterionFooter}>
                <span>
                  {item.viable
                    ? "El resultado puede continuar en el flujo."
                    : "El resultado requiere completar información."}
                </span>
                <label className={styles.switchLabel}>
                  <span>{item.active ? "Activo" : "Inactivo"}</span>
                  <input
                    checked={item.active}
                    onChange={(event) =>
                      update(index, { active: event.target.checked })
                    }
                    type="checkbox"
                  />
                </label>
              </footer>
            </article>
          ))}
        </div>
      </section>

      <footer className={`rq-viability-footer ${styles.stickyFooter}`}>
        <span>
          {summary.coverage
            ? "La configuración cubre correctamente todo el rango."
            : "Corrige los rangos antes de guardar."}
        </span>
        <RqActionButton
          disabled={saving || !summary.coverage}
          onClick={() => void save()}
          tone="operation"
        >
          {saving ? "Guardando…" : "Guardar cambios"}
        </RqActionButton>
      </footer>
    </section>
  );
}
