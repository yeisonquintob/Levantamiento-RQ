import { useEffect, useRef, useState } from "react";

/** Tiempo que un aviso permanece visible antes de cerrarse solo. */
export const NOTIFICATION_AUTO_DISMISS_MS = 5_000;

/**
 * Limpia un aviso (`clear`) 5 segundos después de que aparece. Cada aviso
 * nuevo —aunque tenga el mismo texto— reinicia el conteo porque el valor es un
 * estado nuevo. Un valor vacío no programa nada.
 */
export function useAutoDismiss(
  value: unknown,
  clear: () => void,
  delayMs: number = NOTIFICATION_AUTO_DISMISS_MS,
): void {
  const clearRef = useRef(clear);
  clearRef.current = clear;

  useEffect(() => {
    if (!value) return;
    const timeout = window.setTimeout(() => clearRef.current(), delayMs);
    return () => window.clearTimeout(timeout);
  }, [value, delayMs]);
}

/**
 * Para avisos que llegan como propiedad (por ejemplo `initialError` de la
 * página): devuelve el valor solo durante 5 segundos.
 */
export function useAutoDismissedProp<T extends string>(
  value: T | null | undefined,
): T | null {
  const [dismissed, setDismissed] = useState<T | null>(null);
  useAutoDismiss(value, () => setDismissed(value ?? null));
  return value && value !== dismissed ? value : null;
}
