"use client";

// SOURCES_GENERATION_PANEL_V1
//
// Cabecera de ejecución de Fuentes. Una sola fuente visual de verdad para el
// estado: el estado general se muestra una vez, seguido de la etapa, la
// explicación funcional y las acciones. Los detalles técnicos se ven en la
// pestaña correspondiente de la tarjeta lateral de consumo.
import type { ReactElement, ReactNode } from "react";
import { useId } from "react";

import { RqActionButton, RqStatusBadge } from "@levantamiento-rq/shared-ui";

import { ElapsedClock } from "./live-clock";

import type {
  GenerationOutcome,
  GenerationOutcomeAction,
} from "./sources-generation-summary";

const STATE_TONE = {
  ready: "neutral",
  queued: "process",
  active: "process",
  completed: "success",
  cancelled: "inactive",
  failed: "danger",
} as const;

const STATE_SYMBOL = {
  ready: "○",
  queued: "…",
  active: "◔",
  completed: "✓",
  cancelled: "–",
  failed: "✕",
} as const;

const ACTION_LABEL: Record<GenerationOutcomeAction, string> = {
  "review-result": "Revisar resultado",
  "retry-application": "Reintentar aplicación",
  "retry-checkpoint": "Reintentar desde checkpoint",
  "technical-details": "Ver detalles técnicos",
};

export interface SourcesGenerationPanelProps {
  readonly outcome: GenerationOutcome;
  /** Contexto previo a iniciar, por ejemplo «Estimación previa a la ejecución». */
  readonly subject?: string | null;
  /** Inicio de la ejecución en curso; el reloj lo actualiza un componente propio. */
  readonly elapsedSince?: string | null;
  readonly stageLabel?: string | null;
  readonly progress?: number | null;
  readonly pipeline?: ReactNode;
  readonly detail?: ReactNode;
  readonly draftProgress?: ReactNode;
  readonly consumption?: ReactNode;
  /** Metadatos compactos bajo la etiqueta de estado (duración, tokens). */
  readonly statusContent?: ReactNode;
  readonly reviewHref?: string | null;
  readonly busyAction?: GenerationOutcomeAction | null;
  readonly disabledActions?: readonly GenerationOutcomeAction[];
  readonly onAction?: (action: GenerationOutcomeAction) => void;
  readonly generationMode?: string | null;
}

export function SourcesGenerationPanel({
  busyAction = null,
  consumption,
  detail,
  disabledActions = [],
  draftProgress,
  elapsedSince,
  generationMode,
  onAction,
  outcome,
  pipeline,
  progress,
  reviewHref,
  stageLabel,
  statusContent,
  subject,
}: SourcesGenerationPanelProps): ReactElement {
  const titleId = useId();
  const visibleActions = outcome.actions.filter(
    (action) => action !== "technical-details",
  );

  function runAction(action: GenerationOutcomeAction): void {
    if (action === "technical-details") return;
    onAction?.(action);
  }

  function renderAction(action: GenerationOutcomeAction): ReactElement | null {
    if (action === "review-result") {
      return reviewHref ? (
        <a className="rq-gen__link" href={reviewHref} key={action}>
          {ACTION_LABEL[action]}
        </a>
      ) : null;
    }
    // «Detalles técnicos» no es un botón de acción: es una pestaña de la tarjeta lateral.
    if (action === "technical-details") return null;
    const busy = busyAction === action;
    return (
      <RqActionButton
        compact
        disabled={busy || disabledActions.includes(action)}
        key={action}
        onClick={() => runAction(action)}
        tone="secondary"
      >
        {busy ? "En curso…" : ACTION_LABEL[action]}
      </RqActionButton>
    );
  }

  return (
    <section
      aria-labelledby={titleId}
      className="rq-gen"
      data-rq-generation-mode={generationMode ?? undefined}
      data-rq-generation-status={outcome.state}
    >
      <div className="rq-gen__main">
        <header className="rq-gen__outcome" data-rq-state={outcome.state}>
          {subject || stageLabel ? (
            <p className="rq-gen__eyebrow">
              {subject ? <span>{subject}</span> : null}
              {stageLabel ? (
                <span>
                  {outcome.state === "failed" ? "Falló en" : "Etapa"}:{" "}
                  <strong>{stageLabel}</strong>
                </span>
              ) : null}
            </p>
          ) : null}

          <div
            aria-atomic="true"
            aria-live="polite"
            className="rq-gen__live"
            role="status"
          >
            <div className="rq-gen__headline">
              <h2 className="rq-gen__title" id={titleId}>
                {outcome.headline}
              </h2>

              {outcome.explanation || outcome.consequence ? (
                <p className="rq-gen__text">
                  {outcome.explanation ? (
                    <span className="rq-gen__explanation">
                      {outcome.explanation}
                    </span>
                  ) : null}{" "}
                  {outcome.consequence ? (
                    <strong className="rq-gen__consequence">
                      {outcome.consequence}
                    </strong>
                  ) : null}
                </p>
              ) : null}
            </div>
          </div>

          <span className="rq-gen__state">
            {elapsedSince && Number.isFinite(Date.parse(elapsedSince)) ? (
              <span className="rq-gen__elapsed">
                Tiempo transcurrido: <strong><ElapsedClock startedAt={elapsedSince} /></strong>
              </span>
            ) : null}
            <span className="rq-gen__state-stack">
              <RqStatusBadge tone={STATE_TONE[outcome.state]}>
                <span aria-hidden="true" className="rq-gen__state-icon">
                  {STATE_SYMBOL[outcome.state]}
                </span>
                {outcome.statusLabel}
              </RqStatusBadge>
              {statusContent ? (
                <span className="rq-gen__state-meta">{statusContent}</span>
              ) : null}
            </span>
          </span>

          {visibleActions.length > 0 ? (
            <div className="rq-gen__controls">
              <div className="rq-gen__actions">
                {visibleActions.map(renderAction)}
              </div>
            </div>
          ) : null}
        </header>

        {pipeline}

        {progress !== null && progress !== undefined ? (
          <div className="rq-gen__progress" data-rq-state={outcome.state}>
            <progress
              aria-label="Avance de la generación del documento con IA"
              max={100}
              value={progress}
            />
            <strong>{progress}%</strong>
          </div>
        ) : null}

        {detail}
        {draftProgress}
      </div>

      {consumption ? (
        <aside aria-label="Consumo de la ejecución" className="rq-gen__side">
          {consumption}
        </aside>
      ) : null}
    </section>
  );
}
