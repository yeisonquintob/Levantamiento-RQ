// AI_ANALYSIS_VISUAL_FORMAT_SANITIZE_V1
//
// La guía de la sección "Prototipo" habla de campos internos del contrato
// (solutionProposal.content.prototypeMarkdown). El modelo a veces los repite en
// el texto visible ("...prototypeMarkdown permanece en null."). Esta función
// elimina, sin inventar nada, las frases que mencionan nombres internos y, si
// no queda contenido, devuelve un texto neutro.
import type { DocumentJsonValue } from "@levantamiento-rq/shared-contracts";

export const VISUAL_FORMAT_NOT_APPLICABLE =
  "No aplica prototipo visual en esta etapa.";

const INTERNAL_NAMES =
  /\b(?:prototypeMarkdown|structuredAnalysis|solutionProposal\.content|sections\.\w+|schemaVersion)\b/iu;

export function sanitizeVisualFormatContent(
  content: DocumentJsonValue,
): DocumentJsonValue {
  if (typeof content !== "string") return content;
  if (!INTERNAL_NAMES.test(content)) return content;
  const kept = content
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && !INTERNAL_NAMES.test(sentence));
  return kept.length > 0 ? kept.join(" ") : VISUAL_FORMAT_NOT_APPLICABLE;
}
