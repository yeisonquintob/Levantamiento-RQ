/**
 * Ejecuta `task` sobre cada elemento con a lo sumo `limit` en paralelo y avisa de cada resultado
 * en cuanto llega. Evita lanzar decenas de solicitudes a la vez y permite pintar progresivamente.
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
  shouldStop: () => boolean = () => false,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length && !shouldStop()) {
      const item = items[next];
      next += 1;
      await task(item as T);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker),
  );
}
