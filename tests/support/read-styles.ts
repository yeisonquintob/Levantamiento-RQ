import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/**
 * Hoja de estilos de la librería de UI. `styles.css` es un índice de
 * `@import` hacia `styles/*.css`; estos helpers devuelven su contenido ya
 * concatenado, en el orden de la cascada, para que los tests de estilos
 * sigan buscando reglas y texto como si fuera un solo archivo.
 */
export const UI_STYLES_ENTRY = "libs/shared/ui/src/styles.css";

const IMPORT_LINE =
  /^@import\s+(?:url\()?["']([^"']+)["']\)?\s*;[ \t]*\r?\n?/gmu;

function inlineImportsSync(path: string, ancestors: readonly string[]): string {
  if (ancestors.includes(path)) {
    throw new Error(`Ciclo de @import en ${path}`);
  }
  return readFileSync(path, "utf8").replace(
    IMPORT_LINE,
    (_line, target: string) =>
      inlineImportsSync(resolve(dirname(path), target), [...ancestors, path]),
  );
}

async function inlineImports(
  path: string,
  ancestors: readonly string[],
): Promise<string> {
  if (ancestors.includes(path)) {
    throw new Error(`Ciclo de @import en ${path}`);
  }
  const source = await readFile(path, "utf8");
  const targets = [...source.matchAll(IMPORT_LINE)].map((match) =>
    resolve(dirname(path), match[1] ?? ""),
  );
  const inlined = await Promise.all(
    targets.map((target) => inlineImports(target, [...ancestors, path])),
  );
  let index = 0;
  return source.replace(IMPORT_LINE, () => inlined[index++] ?? "");
}

export function readStylesSync(entry: string = UI_STYLES_ENTRY): string {
  return inlineImportsSync(resolve(entry), []);
}

export function readStyles(entry: string = UI_STYLES_ENTRY): Promise<string> {
  return inlineImports(resolve(entry), []);
}
