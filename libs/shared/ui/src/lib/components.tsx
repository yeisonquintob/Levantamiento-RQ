import type { ButtonHTMLAttributes, ReactElement, ReactNode } from "react";

export type RqActionTone =
  "affirmative" | "operation" | "warning" | "danger" | "consult" | "secondary";

export interface RqActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  tone?: RqActionTone;
  compact?: boolean;
}

export function RqActionButton({
  children,
  className = "",
  compact = false,
  tone = "secondary",
  type = "button",
  ...props
}: RqActionButtonProps): ReactElement {
  const classes = ["rq-action", compact ? "rq-action--compact" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={classes} data-rq-tone={tone} type={type} {...props}>
      {children}
    </button>
  );
}

export interface RqKpiCardProps {
  title: string;
  description: string;
  value: string;
  icon?: ReactNode;
}

export function RqKpiCard({
  title,
  description,
  value,
  icon,
}: RqKpiCardProps): ReactElement {
  return (
    <article className="rq-kpi">
      <span aria-hidden="true" className="rq-kpi__icon">
        {icon ?? "•"}
      </span>
      <span className="rq-kpi__copy">
        <strong className="rq-kpi__title">{title}</strong>
        <span className="rq-kpi__description">{description}</span>
      </span>
      <strong className="rq-kpi__value">{value}</strong>
    </article>
  );
}

export interface RqKpiGridProps {
  children: ReactNode;
  label?: string;
}

export function RqKpiGrid({
  children,
  label = "Indicadores",
}: RqKpiGridProps): ReactElement {
  return (
    <section aria-label={label} className="rq-kpi-grid">
      {children}
    </section>
  );
}

export interface RqPageHeroProps {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}

export function RqPageHero({
  eyebrow,
  title,
  description,
  actions,
}: RqPageHeroProps): ReactElement {
  return (
    <header className="rq-page-hero">
      <div className="rq-page-hero__copy">
        {eyebrow ? (
          <span className="rq-page-hero__eyebrow">{eyebrow}</span>
        ) : null}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="rq-page-hero__actions">{actions}</div> : null}
    </header>
  );
}

export type RqStatusTone =
  "success" | "process" | "pending" | "danger" | "inactive" | "neutral";

export interface RqStatusBadgeProps {
  children: ReactNode;
  tone?: RqStatusTone;
}

export function RqStatusBadge({
  children,
  tone = "neutral",
}: RqStatusBadgeProps): ReactElement {
  return (
    <span className="rq-status" data-rq-status={tone}>
      {children}
    </span>
  );
}

export interface RqTableShellProps {
  title: string;
  description?: string;
  count?: number;
  children: ReactNode;
}

export function RqTableShell({
  title,
  description,
  count,
  children,
}: RqTableShellProps): ReactElement {
  return (
    <section className="rq-table-shell">
      <header className="rq-table-shell__header">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {typeof count === "number" ? (
          <span className="rq-table-shell__count">
            {count} {count === 1 ? "registro" : "registros"}
          </span>
        ) : null}
      </header>
      <div
        aria-label={title}
        className="rq-table-shell__scroll"
        role="region"
        tabIndex={0}
      >
        {children}
      </div>
    </section>
  );
}

export interface RqEmptyStateProps {
  title: string;
  description: string;
}

export function RqEmptyState({
  title,
  description,
}: RqEmptyStateProps): ReactElement {
  return (
    <div className="rq-empty-state">
      <span aria-hidden="true" className="rq-empty-state__icon">
        ○
      </span>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}
