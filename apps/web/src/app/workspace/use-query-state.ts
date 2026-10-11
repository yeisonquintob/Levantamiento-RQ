"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Valores de filtro razonables: sin saltos de línea ni textos enormes. */
function isAcceptable(value: string): boolean {
  return value.length <= 200 && !/[\r\n]/u.test(value);
}

/** Lee un parámetro de una búsqueda (`?a=b`) si existe y es aceptable. */
export function readQueryParam(search: string, key: string): string | null {
  const value = new URLSearchParams(search).get(key);
  return value !== null && isAcceptable(value) ? value : null;
}

/** Devuelve la búsqueda con `key` actualizado (o quitado si vuelve a su valor por defecto). */
export function withQueryParam(
  search: string,
  key: string,
  value: string,
  initial: string,
): string {
  const params = new URLSearchParams(search);
  if (value === initial) params.delete(key);
  else params.set(key, value);
  const next = params.toString();
  return next ? `?${next}` : "";
}

/**
 * Estado de un filtro reflejado en la URL (`?q=…&estado=…`): se puede compartir, recargar o abrir
 * de nuevo con el mismo filtro. Arranca con `initial` (igual en servidor y cliente, sin diferencias
 * de hidratación) y, al montar, toma el valor de la URL si lo hay. Escribe con `replaceState`: no
 * añade entradas al historial ni recarga la página, y conserva el resto de parámetros.
 */
export function useQueryState<T extends string>(
  key: string,
  initial: T,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(initial);
  const initialRef = useRef(initial);
  initialRef.current = initial;

  useEffect(() => {
    const fromUrl = readQueryParam(window.location.search, key);
    if (fromUrl !== null) setValue(fromUrl as T);
    // Solo al montar: después manda el estado y la URL lo sigue.
  }, []);

  const update = useCallback(
    (next: T) => {
      setValue(next);
      const url = new URL(window.location.href);
      url.search = withQueryParam(
        url.search,
        key,
        next,
        initialRef.current,
      );
      window.history.replaceState(window.history.state, "", url);
    },
    [key],
  );

  return [value, update];
}
