// Utilidades tipadas para sustituir aserciones no nulas (`x!`) por guardias
// explícitas sin cambiar el comportamiento en los casos válidos.

/** Devuelve `value` si no es null/undefined; si lo es, lanza un error con `message`. */
export function requireDefined<T>(
  value: T | null | undefined,
  message: string,
): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

/** Copia superficial de `value` sin la propiedad `key`, conservando el orden de las demás. */
export function omitKey<T extends object, K extends keyof T>(
  value: T,
  key: K,
): Omit<T, K> {
  return Object.fromEntries(
    Object.entries(value).filter(([entryKey]) => entryKey !== key),
  ) as Omit<T, K>;
}
