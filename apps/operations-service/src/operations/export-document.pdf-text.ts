import { type PDFFont } from "pdf-lib";

// Caracteres fuera de Latin-1 que la codificación WinAnsi de las fuentes
// estándar (Helvetica) sí representa: € ‚ ƒ „ † ‡ ˆ ‰ Š ‹ Œ Ž ™ š › œ ž Ÿ.
const PDF_WINANSI_EXTRAS = new Set(
  Array.from(
    "\u20AC\u201A\u0192\u201E\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2122\u0161\u203A\u0153\u017E\u0178\u02DC",
  ),
);

// Sustituciones explícitas y legibles para símbolos que la fuente estándar no
// puede dibujar. Nunca se descarta un carácter visible sin dejar equivalente.
const PDF_SYMBOL_SUBSTITUTIONS: Readonly<Record<string, string>> = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201C": '"',
  "\u201D": '"',
  "\u2013": "-",
  "\u2014": "-",
  "\u2212": "-",
  "\u2026": "...",
  "\u2022": "-",
  "\u25CF": "-",
  "\u25AA": "-",
  "\u2192": "->",
  "\u2190": "<-",
  "\u2194": "<->",
  "\u21D2": "=>",
  "\u2264": "<=",
  "\u2265": ">=",
  "\u2260": "!=",
  "\u2248": "~=",
  "\u221E": "inf.",
  "\u2211": "suma",
  "\u2713": "OK",
  "\u2714": "OK",
  "\u2717": "X",
  "\u2718": "X",
  "\u2044": "/",
  "\u03BC": "\u00B5",
  "\u2126": "ohm",
  "\u03A9": "ohm",
  "\u2103": "\u00B0C",
  "\u2109": "\u00B0F",
  "\u00AD": "",
  "\t": " ",
};

function pdfSafeCharacter(character: string): string {
  if (
    character === "\n" ||
    (character >= "\u0020" && character <= "\u007E") ||
    (character >= "\u00A0" &&
      character <= "\u00FF" &&
      character !== "\u00AD") ||
    PDF_WINANSI_EXTRAS.has(character)
  ) {
    return character;
  }
  const substitution = PDF_SYMBOL_SUBSTITUTIONS[character];
  if (substitution !== undefined) return substitution;
  // Espacios y controles invisibles (ancho cero, marcas de dirección, BOM).
  if (/^[\p{Cc}\p{Cf}\p{Zs}\p{Zl}\p{Zp}\p{Mn}]$/u.test(character)) {
    return /^[\p{Zs}\p{Zl}\p{Zp}]$/u.test(character) ? " " : "";
  }
  // Equivalente de compatibilidad (①→1, ﬁ→fi, ² →2, ｆ→f) solo si es
  // íntegramente representable.
  const compatible = character.normalize("NFKC");
  if (compatible !== character) {
    const mapped = Array.from(compatible).map(pdfSafeCharacter).join("");
    if (mapped && !mapped.includes("?")) return mapped;
  }
  // Sin equivalente: marcador visible, nunca se pierde en silencio.
  return "?";
}

// Convierte cualquier texto a caracteres que la fuente estándar (WinAnsi) puede
// codificar sin lanzar error. Conserva ½ µ € × ± ° · y demás Latin-1/WinAnsi; no
// aplica NFKC global (convertía ½ en "12" y µs en "s").
export function pdfSafe(text: string): string {
  return Array.from(text.normalize("NFC").replace(/\r\n?/gu, "\n"))
    .map(pdfSafeCharacter)
    .join("");
}

export function wrap(
  text: string,
  font: PDFFont,
  size: number,
  width: number,
): string[] {
  const paragraphs = pdfSafe(text).split(/\r?\n/);
  const result: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph
      .split(/\s+/)
      .filter(Boolean)
      .flatMap((word) => {
        if (font.widthOfTextAtSize(word, size) <= width) return [word];
        const segments: string[] = [];
        let segment = "";
        for (const character of word) {
          const candidate = `${segment}${character}`;
          if (font.widthOfTextAtSize(candidate, size) <= width || !segment) {
            segment = candidate;
          } else {
            segments.push(segment);
            segment = character;
          }
        }
        if (segment) segments.push(segment);
        return segments;
      });
    if (words.length === 0) {
      result.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width || !line) {
        line = candidate;
      } else {
        result.push(line);
        line = word;
      }
    }
    if (line) result.push(line);
  }
  return result;
}
