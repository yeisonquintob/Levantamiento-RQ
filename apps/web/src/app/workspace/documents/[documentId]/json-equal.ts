import type { DocumentJsonValue } from "@levantamiento-rq/shared-contracts";

/**
 * Igualdad profunda de contenido de sección. Si ambos lados son la misma referencia responde al
 * instante, que es el caso habitual sin cambios; al teclear, se detiene en la primera diferencia
 * en lugar de serializar todo el documento dos veces por pulsación.
 */
export function jsonEqual(
  left: DocumentJsonValue | undefined,
  right: DocumentJsonValue | undefined,
): boolean {
  if (left === right) return true;
  if (
    left === null ||
    right === null ||
    left === undefined ||
    right === undefined ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  const leftIsArray = Array.isArray(left);
  if (leftIsArray !== Array.isArray(right)) return false;
  if (leftIsArray) {
    const a = left as DocumentJsonValue[];
    const b = right as DocumentJsonValue[];
    return a.length === b.length && a.every((item, index) => jsonEqual(item, b[index]));
  }
  const a = left as Record<string, DocumentJsonValue>;
  const b = right as Record<string, DocumentJsonValue>;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && jsonEqual(a[key], b[key]))
  );
}
