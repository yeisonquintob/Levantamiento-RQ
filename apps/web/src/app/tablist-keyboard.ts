/** Pestaña a la que lleva una tecla dentro de una lista de pestañas, o null si no aplica. */
export function nextTabIndex(
  key: string,
  current: number,
  enabled: readonly boolean[],
): number | null {
  const count = enabled.length;
  if (count === 0 || current < 0 || current >= count) return null;
  const step = (from: number, direction: 1 | -1): number | null => {
    for (let offset = 1; offset <= count; offset += 1) {
      const index = (((from + direction * offset) % count) + count) % count;
      if (enabled[index]) return index;
    }
    return null;
  };
  if (key === "ArrowRight" || key === "ArrowDown") return step(current, 1);
  if (key === "ArrowLeft" || key === "ArrowUp") return step(current, -1);
  if (key === "Home") return enabled.findIndex(Boolean) >= 0 ? enabled.findIndex(Boolean) : null;
  if (key === "End") {
    const last = enabled.lastIndexOf(true);
    return last >= 0 ? last : null;
  }
  return null;
}
