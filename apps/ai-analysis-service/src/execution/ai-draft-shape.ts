// AI_ANALYSIS_DRAFT_SHAPE_DIAGNOSTIC_V1
//
// Resumen estructural de un borrador devuelto por la IA: solo versiones de
// esquema, estados y cantidades de elementos por ruta. Nunca incluye texto del
// documento ni de las fuentes, así que es seguro en trazas y registros.
const MAX_DEPTH = 5;
const MAX_ENTRIES = 80;

export function summarizeDraftShape(
  draft: unknown,
): Record<string, number | string> {
  const shape: Record<string, number | string> = {};
  const visit = (value: unknown, path: string, depth: number): void => {
    if (Object.keys(shape).length >= MAX_ENTRIES || depth > MAX_DEPTH) return;
    if (Array.isArray(value)) {
      shape[path] = value.length;
      // Se describe la forma del primer elemento: basta para ver su anidación.
      if (value.length > 0) visit(value[0], `${path}[]`, depth + 1);
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        const childPath = path ? `${path}.${key}` : key;
        if (
          typeof child === "string" &&
          (key === "schemaVersion" || key === "structureStatus")
        ) {
          shape[childPath] = child;
        } else {
          visit(child, childPath, depth + 1);
        }
      }
    }
  };
  visit(draft, "", 0);
  return shape;
}
