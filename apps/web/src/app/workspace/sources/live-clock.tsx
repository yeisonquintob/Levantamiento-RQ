"use client";

import React, { useEffect, useState } from "react";

/**
 * Relojes de la pantalla de Fuentes. Cada uno lleva su propio temporizador: así solo se vuelve a
 * renderizar el texto que cambia y no el componente completo de Fuentes (miles de líneas).
 */
export function useNow(active: boolean, intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(interval);
  }, [active, intervalMs]);
  return now;
}

/** mm:ss (o h:mm:ss) para el tiempo que tarda cada punto del borrador. */
export function formatBlockDuration(milliseconds: number): string {
  const total = Math.floor(milliseconds / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

/** Tiempo de un punto: en curso se actualiza cada segundo; terminado es fijo. */
export function BlockDuration({
  endStamp,
  live,
  previousStamp,
}: {
  /** Fin del punto (ignorado mientras está en curso, que usa la hora actual). */
  endStamp: number;
  live: boolean;
  previousStamp: number;
}) {
  const now = useNow(live);
  const elapsed = (live ? now : endStamp) - previousStamp;
  if (!Number.isFinite(elapsed) || elapsed < 0) return null;
  return (
    <time
      className="rq-local-draft-block-progress__item-time"
      title="Tiempo de este punto"
    >
      {formatBlockDuration(elapsed)}
    </time>
  );
}

/** Aviso cuando un punto lleva más de dos minutos sin un nuevo punto de control. */
export function StallNotice({
  active,
  updatedAt,
}: {
  active: boolean;
  updatedAt: string;
}) {
  const now = useNow(active, 5_000);
  if (!active || now - Date.parse(updatedAt) <= 120_000) return null;
  return (
    <span className="rq-local-draft-block-progress__stall-notice">
      La inferencia continúa activa, pero no se ha recibido un nuevo punto de
      control.
    </span>
  );
}

export function formatGenerationElapsed(
  startedAt: string | null | undefined,
  now = Date.now(),
): string {
  const started = startedAt ? Date.parse(startedAt) : Number.NaN;
  if (!Number.isFinite(started)) return "—";
  const totalSeconds = Math.max(0, Math.floor((now - started) / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .filter((_, index) => hours > 0 || index > 0)
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

/** Tiempo transcurrido desde `startedAt`, actualizado cada segundo por su propio temporizador. */
export function ElapsedClock({ startedAt }: { startedAt: string }) {
  const now = useNow(true);
  return <>{formatGenerationElapsed(startedAt, now)}</>;
}
