/**
 * Caché del avance de cada proyecto en `sessionStorage`. Inicio la usa para mostrar al instante el
 * último avance conocido mientras el cálculo real (varias peticiones por proyecto) se actualiza en
 * segundo plano. Nunca sustituye al cálculo: solo adelanta lo que se ve.
 */

const KEY_PREFIX = "rq-home-progress-v1:";
/** Pasado este tiempo el avance guardado ya no se muestra. */
export const PROGRESS_CACHE_TTL_MS = 5 * 60_000;

export interface ProgressCacheStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface CachedEntry<T> {
  savedAt: number;
  /** Estado del proyecto al guardar: si cambia, el avance guardado ya no vale. */
  status: string;
  progress: T;
}

export function readCachedProgress<T>(
  storage: ProgressCacheStorage | null,
  project: { id: string; status: string },
  now: number = Date.now(),
): T | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(KEY_PREFIX + project.id);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Partial<CachedEntry<T>>;
    if (
      typeof entry.savedAt !== "number" ||
      entry.status !== project.status ||
      entry.progress === undefined ||
      now - entry.savedAt > PROGRESS_CACHE_TTL_MS ||
      now < entry.savedAt
    ) {
      storage.removeItem(KEY_PREFIX + project.id);
      return null;
    }
    return entry.progress;
  } catch {
    return null;
  }
}

export function writeCachedProgress<T>(
  storage: ProgressCacheStorage | null,
  project: { id: string; status: string },
  progress: T,
  now: number = Date.now(),
): void {
  if (!storage) return;
  try {
    const entry: CachedEntry<T> = { savedAt: now, status: project.status, progress };
    storage.setItem(KEY_PREFIX + project.id, JSON.stringify(entry));
  } catch {
    // Almacenamiento lleno o bloqueado: el avance se calcula igual, solo sin adelantarlo.
  }
}

/** Descarta el avance guardado de un proyecto (por ejemplo, tras marcar tareas en Ejecución). */
export function clearCachedProgress(
  storage: ProgressCacheStorage | null,
  projectId: string,
): void {
  try {
    storage?.removeItem(KEY_PREFIX + projectId);
  } catch {
    // Sin acceso al almacenamiento no hay nada que descartar.
  }
}

/** `sessionStorage` si está disponible (puede lanzar en navegación privada o con datos bloqueados). */
export function browserProgressStorage(): ProgressCacheStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
