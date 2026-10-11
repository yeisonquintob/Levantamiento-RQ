// AI_ANALYSIS_LOCAL_ONLY_V2_TEXT_HYGIENE_V1
//
// Funciones puras y deterministas que limpian defectos de presentación de la
// salida de un modelo local pequeño: cortes a mitad de palabra, caracteres de
// alfabetos ajenos, Markdown sin interpretar y rótulos de etiqueta pegados al
// contenido. Ninguna función inventa texto: solo recorta, elimina o separa
// lo que el modelo ya escribió.

import { requireDefined } from "../common/require-defined";

const CONNECTORS = [
  "de",
  "del",
  "la",
  "las",
  "el",
  "los",
  "un",
  "una",
  "unos",
  "unas",
  "y",
  "o",
  "u",
  "e",
  "en",
  "con",
  "para",
  "por",
  "a",
  "al",
  "que",
  "se",
  "su",
  "sus",
  "como",
  "sin",
  "sobre",
  "entre",
  "desde",
  "hasta",
];

const DANGLING_CONNECTOR = new RegExp(
  `(?:^|[\\s(])(?:${CONNECTORS.join("|")})\\s*$`,
  "u",
);

const INTRUSIVE_SCRIPTS =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;

const LABEL_PREFIX =
  /^\s*(?:INCLUIDO|INCLUYE|EXCLUIDO|FUERA DE ALCANCE|OBJETIVO|CORRESPONDENCIA AS-IS\/TO-BE|ESTADO ACTUAL(?:\s*\(AS-IS\))?|EVALUACI[OÓ]N|COMPONENTES?|ELEMENTOS\s+INVOLUCRADOS?|ESTADO\s+FUTURO|RESULTADO(?:\s+ESPERADO)?(?:\s*\(?TO-BE\)?)?)\s*:\s*/iu;

/**
 * Quita del final de una línea los conectores sueltos ("para la"), los
 * separadores huérfanos y un paréntesis abierto sin cierre. Solo elimina.
 */
export function trimDanglingTail(value: string): string {
  let current = value.trimEnd();
  for (let guard = 0; guard < 12; guard += 1) {
    const before = current;
    current = current.replace(/[\s,;|\-–—]+$/u, "");
    const openParen = current.lastIndexOf("(");
    if (openParen > current.lastIndexOf(")")) {
      current = current.slice(0, openParen).trimEnd();
    }
    if (DANGLING_CONNECTOR.test(current)) {
      current = current.replace(/\s*\S+$/u, "");
    }
    if (current === before) break;
  }
  return current.trimEnd();
}

/**
 * Recorta `text` a `maxCharacters` sin partir palabras: retrocede hasta el
 * último espacio y, si conserva al menos la mitad del texto, hasta el último
 * cierre de oración. Nunca devuelve más de `maxCharacters`.
 */
export function truncateAtBoundary(
  text: string,
  maxCharacters: number,
): string {
  const value = text.trim();
  if (maxCharacters <= 0) return "";
  if (value.length <= maxCharacters) return value;

  let cut = value.slice(0, maxCharacters);
  if (!/\s/u.test(value.charAt(maxCharacters))) {
    const lastWhitespace = cut.search(/\s\S*$/u);
    if (lastWhitespace > 0) cut = cut.slice(0, lastWhitespace);
  }
  const sentenceEnd = Math.max(
    cut.lastIndexOf("."),
    cut.lastIndexOf("!"),
    cut.lastIndexOf("?"),
    cut.lastIndexOf(";"),
  );
  if (sentenceEnd >= cut.length * 0.5) cut = cut.slice(0, sentenceEnd + 1);
  return trimDanglingTail(cut);
}

/** Elimina caracteres CJK/hangul intrusos en texto escrito en español. */
export function removeIntrusiveScripts(value: string): string {
  if (!INTRUSIVE_SCRIPTS.test(value)) return value;
  INTRUSIVE_SCRIPTS.lastIndex = 0;
  return value.replace(INTRUSIVE_SCRIPTS, "").replace(/[ \t]{2,}/gu, " ");
}

/** Quita negritas, subrayados, código en línea y encabezados de Markdown. */
export function stripInlineMarkdown(value: string): string {
  return value
    .replace(/\*\*([^*\n]+)\*\*/gu, "$1")
    .replace(/__([^_\n]+)__/gu, "$1")
    .replace(/`([^`\n]+)`/gu, "$1")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gmu, "")
    .replace(/\*\*/gu, "");
}

/**
 * Quita rótulos de clasificación ("INCLUIDO:", "Objetivo:", "Evaluación:")
 * pegados al inicio de un elemento. Si el elemento quedara vacío, lo conserva.
 */
export function stripLabelPrefix(value: string): string {
  let current = value;
  for (let guard = 0; guard < 4; guard += 1) {
    const next = current.replace(LABEL_PREFIX, "");
    if (next === current || !next.trim()) break;
    current = next;
  }
  return current.trim();
}

/**
 * Limpieza final del contenido de un punto generado por el modelo local:
 * caracteres ajenos, Markdown y cortes evidentes al final. Si el texto llena
 * el presupuesto y no termina en un cierre, se retrocede a la última palabra
 * completa; en cualquier caso se retiran conectores o paréntesis colgantes
 * de la última línea.
 */
export function sanitizeLocalOnlyV2GeneratedContent(
  content: string,
  maxCharacters: number,
): string {
  let value = stripInlineMarkdown(removeIntrusiveScripts(content)).trim();
  if (!value) return value;

  const lines = value.split("\n");
  let last = requireDefined(
    lines[lines.length - 1],
    "Invariante: split devuelve al menos una línea.",
  );
  const filledBudget = content.length >= maxCharacters - 2;
  if (filledBudget && !/[.!?;:)\]"”»]$/u.test(last.trim())) {
    last = last.replace(/\s*\S+$/u, "");
  }
  last = trimDanglingTail(last);
  lines[lines.length - 1] = last;
  value = lines.join("\n").trim();
  return value;
}
