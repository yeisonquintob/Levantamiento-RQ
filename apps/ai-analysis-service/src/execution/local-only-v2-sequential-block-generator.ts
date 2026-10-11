import { createHash } from "node:crypto";
import type { AiDraftGenerationPurpose } from "@levantamiento-rq/shared-contracts";
import { LocalAiError, type OllamaClient } from "../local-ai/ollama.client";
import { batchLocalOnlyV2ProcessingPacket } from "./local-only-v2-array-batches";
import {
  LOCAL_ONLY_V2_DIAGRAM_ARTIFACTS,
  deterministicDiagramFlowFallback,
  deterministicEntityRelationshipFallback,
  hasNameableDiagramEntityEvidence,
  hasUsableDiagramEntityEvidence,
  hasUsableDiagramFlowEvidence,
  parseCanonicalDiagramFlow,
  parseCanonicalEntityRelationshipModel,
  validateCanonicalDiagramFlow,
  validateCanonicalEntityRelationshipModel,
  type LocalOnlyV2DiagramArtifact,
  type LocalOnlyV2DiagramFallbackFinding,
} from "./local-only-v2-diagram-contract";
import {
  selectLocalOnlyV2DiagramArtifactEvidence,
  type LocalOnlyV2BlockEvidencePacket,
} from "./local-only-v2-evidence-selector";
import {
  buildLocalOnlyV2BudgetedMicroDraftPlan,
  deriveLocalOnlyV2InferenceBudgetForOutputCap,
  type LocalOnlyV2InferenceBudget,
} from "./local-only-v2-inference-budget";
import { validateLocalOnlyV2MicroDraft } from "./local-only-v2-localized-repair";
import {
  LOCAL_ONLY_V2_MICRO_DRAFT_SCHEMA_VERSION,
  parseLocalOnlyV2MicroDraftModelOutput,
  type LocalOnlyV2MicroDraft,
} from "./local-only-v2-micro-draft";
import { localOnlyV2Diagnostic } from "./local-only-v2-diagnostics";
import {
  isPendingFieldValue,
  mentionedNavitransSystems,
} from "./local-only-v2-section-content";
import {
  sanitizeLocalOnlyV2GeneratedContent,
  truncateAtBoundary,
} from "./local-only-v2-text-hygiene";
import type { LocalOnlyV2SequentialBlockExecution } from "./local-only-v2-sequential-block-contract";
import { requireLocalOnlyV2ProcessingBlock } from "./local-only-v2-sequential-block-evidence";
import type { LocalOnlyV2TemplateGenerationPlan } from "./local-only-v2-template-planner";
import { localOnlyV2SectionDraftPolicy } from "./local-only-v2-section-draft-policy";

export function localOnlyV2Fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export const LOCAL_ONLY_V2_SEQUENTIAL_QUALITY_PROFILE =
  "cloud-parity-v1" as const;
export const LOCAL_ONLY_V2_SEQUENTIAL_MAX_CONTENT_CHARACTERS = 900;
export const LOCAL_ONLY_V2_SEQUENTIAL_MAX_OUTPUT_TOKENS = 320;
// AI_ANALYSIS_LOCAL_ONLY_V2_MILESTONES_BUDGET_V2
//
// Con el modelo real, cinco hallazgos producen unas 68 líneas y ~5.900
// caracteres válidos (HITO, HU, COMO, QUIERO, PARA, CONTEXTO, CA, CAMPO). El
// tope anterior de 4.500 caracteres descartaba esa salida completa y la
// sustituía por el respaldo de evidencia cruda. Ahora cada subunidad trae tres
// hallazgos y el tope deja margen sobre lo que el modelo realmente escribe.
export const LOCAL_ONLY_V2_MILESTONES_MAX_CONTENT_CHARACTERS = 7_000;
export const LOCAL_ONLY_V2_MILESTONES_MAX_OUTPUT_TOKENS = 3_000;
export const LOCAL_ONLY_V2_MILESTONES_MAX_FINDINGS_PER_BATCH = 3;
// AI_ANALYSIS_LOCAL_ONLY_V2_PROCESS_FLOW_DIAGRAM_BUDGET_V1
//
// El punto 6 se genera como tres subunidades independientes: AS-IS y TO-BE
// comparten el mismo presupuesto por artefacto (idéntico al que antes
// cubría el bloque entero de un solo intento); el modelo entidad-relación
// tiene su propio presupuesto más pequeño porque su contrato es más
// compacto por elemento. La suma de los tres cabe dentro del máximo del
// bloque ensamblado (ver `processFlow.maxCharacters` en
// local-only-v2-section-draft-policy.ts).
export const LOCAL_ONLY_V2_PROCESS_FLOW_MAX_CONTENT_CHARACTERS = 4_500;
export const LOCAL_ONLY_V2_PROCESS_FLOW_MAX_OUTPUT_TOKENS = 1_200;
export const LOCAL_ONLY_V2_PROCESS_FLOW_ER_MAX_CONTENT_CHARACTERS = 3_000;
export const LOCAL_ONLY_V2_PROCESS_FLOW_ER_MAX_OUTPUT_TOKENS = 900;
export const LOCAL_ONLY_V2_PROCESS_FLOW_DIAGRAM_REPAIR_MARKER =
  "LOCAL_ONLY_V2_PROCESS_FLOW_DIAGRAM_REPAIR_V2" as const;
export const LOCAL_ONLY_V2_PROCESS_FLOW_DIAGRAM_CONTRACT_VERSION =
  "LOCAL_ONLY_V2_PROCESS_FLOW_DIAGRAM_CONTRACT_V4" as const;
export const LOCAL_ONLY_V2_OBJECTIVES_MAX_CONTENT_CHARACTERS = 1_800;
export const LOCAL_ONLY_V2_OBJECTIVES_MAX_OUTPUT_TOKENS = 700;
export const LOCAL_ONLY_V2_PROBLEM_DESCRIPTION_MAX_CONTENT_CHARACTERS = 1_600;
export const LOCAL_ONLY_V2_PROBLEM_DESCRIPTION_MAX_OUTPUT_TOKENS = 600;
export const LOCAL_ONLY_V2_PROBLEM_DESCRIPTION_REPAIR_MARKER =
  "LOCAL_ONLY_V2_PROBLEM_DESCRIPTION_IMPACTS_REPAIR_V1" as const;
export const LOCAL_ONLY_V2_OBJECTIVES_QUANTITATIVE_REPAIR_MARKER =
  "LOCAL_ONLY_V2_OBJECTIVES_QUANTITATIVE_REPAIR_V1" as const;
export const LOCAL_ONLY_V2_PROCESS_FLOW_REPAIR_MARKER =
  "LOCAL_ONLY_V2_PROCESS_FLOW_STRUCTURED_REPAIR_V1" as const;
export const LOCAL_ONLY_V2_MILESTONES_REPAIR_MARKER =
  "LOCAL_ONLY_V2_MILESTONES_STRUCTURED_REPAIR_V1" as const;
export const LOCAL_ONLY_V2_REQUIREMENTS_HIERARCHY_MARKER =
  "LOCAL_ONLY_V2_REQUIREMENTS_HIERARCHY_V2" as const;
export const LOCAL_ONLY_V2_OBJECTIVES_QUALITATIVE_REPAIR_MARKER =
  "LOCAL_ONLY_V2_OBJECTIVES_QUALITATIVE_REPAIR_V1" as const;

function concreteQualitativeObjectiveCount(content: string): number {
  const normalized = content.replace(/\r\n?/gu, "\n");
  const heading =
    /(?:^|\n)\s*objetivos?\s+espec(?:í|i)ficos?\s+cualitativos?\s*:?\s*/iu;
  const headingMatch = heading.exec(normalized);
  if (!headingMatch) return 0;

  const start = headingMatch.index + headingMatch[0].length;
  const remainder = normalized.slice(start);
  const nextHeading =
    /\n\s*(?:objetivo\s+general|objetivos?\s+espec(?:í|i)ficos?\s+cuantitativos?)\s*:?/iu;
  const nextMatch = nextHeading.exec(remainder);
  const block = nextMatch ? remainder.slice(0, nextMatch.index) : remainder;

  const seen = new Set<string>();
  return block
    .split(/\n+|(?<=[.!?;])\s+(?=[A-ZÁÉÍÓÚÑ])/gu)
    .map((item) => item.replace(/^(?:[-*•]|\d+[.)])\s*/u, "").trim())
    .filter((item) => item.length >= 12)
    .filter((item) => !/\[PENDIENTE POR DEFINIR(?::[^\]]+)?\]/iu.test(item))
    .filter((item) => {
      const key = item
        .normalize("NFD")
        .replace(/\p{M}+/gu, "")
        .toLocaleLowerCase("es")
        .replace(/\s+/gu, " ")
        .trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).length;
}

function quantitativeObjectiveItems(content: string): string[] {
  const normalized = content.replace(/\r\n?/gu, "\n");
  const heading =
    /(?:^|\n)\s*objetivos?\s+espec(?:í|i)ficos?\s+cuantitativos?\s*:?\s*/iu;
  const headingMatch = heading.exec(normalized);
  if (!headingMatch) return [];

  const start = headingMatch.index + headingMatch[0].length;
  const remainder = normalized.slice(start);
  const nextHeading =
    /\n\s*(?:objetivo\s+general|objetivos?\s+espec(?:í|i)ficos?\s+cualitativos?)\s*:?/iu;
  const nextMatch = nextHeading.exec(remainder);
  const block = nextMatch ? remainder.slice(0, nextMatch.index) : remainder;

  const measurementSignal =
    /(?:\b\d+(?:[.,]\d+)?\b|%|porcentaje|cantidad|volumen|tiempo|plazo|frecuencia|tasa|meta|medici(?:ó|o)n|medir|indicador|l(?:í|i)nea\s+base|duraci(?:ó|o)n|n(?:ú|u)mero|total|promedio|proporci(?:ó|o)n|cobertura|cumplimiento|productividad|capacidad|rendimiento|mensual|semanal|diari|anual)/iu;
  const trailingConnector =
    /\b(?:a|al|con|de|del|el|en|la|las|los|o|para|por|seg(?:ú|u)n|sin|un|una|y)$/iu;
  const purePending = /^\[PENDIENTE POR DEFINIR(?::[^\]]+)?\][.!]?$/iu;

  const seen = new Set<string>();
  return block
    .split(/\n+|(?<=[.!?;])\s+(?=[A-ZÁÉÍÓÚÑ])/gu)
    .map((item) => item.replace(/^(?:[-*•]|\d+[.)])\s*/u, "").trim())
    .filter((item) => item.length >= 28)
    .filter((item) => !purePending.test(item))
    .filter((item) => {
      const withoutTerminalPunctuation = item.replace(/[.!?;:]+$/u, "").trim();
      return !trailingConnector.test(withoutTerminalPunctuation);
    })
    .filter((item) => measurementSignal.test(item))
    .filter((item) => {
      const key = item
        .normalize("NFD")
        .replace(/\p{M}+/gu, "")
        .toLocaleLowerCase("es")
        .replace(/\s+/gu, " ")
        .trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function concreteQuantitativeObjectiveCount(content: string): number {
  return quantitativeObjectiveItems(content).length;
}

function normalizedQuantitativeObjectiveBlock(content: string): string | null {
  const items = quantitativeObjectiveItems(content);
  if (items.length !== 3) return null;
  return [
    "Objetivos específicos cuantitativos:",
    ...items.map((item, index) => `${index + 1}. ${item}`),
  ].join("\n");
}

function replaceQuantitativeObjectiveBlock(
  content: string,
  quantitativeBlock: string,
): string {
  const normalized = content.replace(/\r\n?/gu, "\n").trim();
  const heading =
    /(?:^|\n)\s*objetivos?\s+espec(?:í|i)ficos?\s+cuantitativos?\s*:?/iu;
  const headingMatch = heading.exec(normalized);
  const prefix = headingMatch
    ? normalized.slice(0, headingMatch.index).trimEnd()
    : normalized;
  return `${prefix}\n${quantitativeBlock.trim()}`.trim();
}

function normalizeProblemContractLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toUpperCase()
    .replace(/\s+/gu, "_")
    .trim();
}

function problemCurrentStateFromContent(content: string): string | null {
  const normalized = content.replace(/\r\n?/gu, "\n").trim();
  const lines = normalized
    .split(/\n+/gu)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const parts = line.split(/\s*\|\s*/u);
    const label = normalizeProblemContractLabel(parts.shift() ?? "");
    if (label === "SITUACION_ACTUAL") {
      const value = parts.join(" | ").trim();
      if (value.length >= 20) return value;
    }
  }

  const heading = /(?:^|\n)\s*situaci(?:ó|o)n\s+actual\s*:\s*/iu;
  const headingMatch = heading.exec(normalized);
  if (headingMatch) {
    const remainder = normalized.slice(
      headingMatch.index + headingMatch[0].length,
    );
    const firstLine = (remainder.split(/\n+/u)[0] ?? "").trim();
    const value = firstLine
      .split(
        /\s+(?:los\s+)?impactos?\s+(?:operacionales?|operativos?)(?:\s+identificados?)?\s*:\s*/iu,
      )[0]
      ?.trim();
    if (value && value.length >= 20) return value;
  }

  const fallback = normalized
    .split(/\n+|(?<=[.!?;])\s+(?=[A-ZÁÉÍÓÚÑ])/gu)
    .map((item) => item.trim())
    .find(
      (item) =>
        item.length >= 20 &&
        /actual|actualmente|hoy|manual|depende|se realiza|se gestiona|carece|no existe/iu.test(
          item,
        ),
    );

  return fallback ?? null;
}

function problemImpactLinesFromContract(content: string): string[] {
  const seen = new Set<string>();
  return content
    .replace(/\r\n?/gu, "\n")
    .split(/\n+/gu)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const parts = line.split(/\s*\|\s*/u);
      const label = normalizeProblemContractLabel(parts.shift() ?? "");
      if (label !== "IMPACTO") return [];
      const value = parts.join(" | ").trim();
      return value ? [value] : [];
    })
    .filter((item) => {
      const key = item
        .normalize("NFD")
        .replace(/\p{M}+/gu, "")
        .toLocaleLowerCase("es")
        .replace(/\s+/gu, " ")
        .trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
}

function hasStructuredProblemDescriptionContract(content: string): boolean {
  const lines = content
    .replace(/\r\n?/gu, "\n")
    .split(/\n+/gu)
    .map((line) => line.trim())
    .filter(Boolean);

  let currentStateCount = 0;
  let impactCount = 0;

  for (const line of lines) {
    const parts = line.split(/\s*\|\s*/u);
    const label = normalizeProblemContractLabel(parts.shift() ?? "");
    const value = parts.join(" | ").trim();

    if (label === "SITUACION_ACTUAL") {
      if (value.length < 20) return false;
      currentStateCount += 1;
      continue;
    }

    if (label === "IMPACTO") {
      if (!value) return false;
      if (
        /^(?:[-*•]|\d{1,2}[.)])\s*/u.test(value) ||
        /\s+[1-5][.)]\s*$/u.test(value) ||
        /(?:los\s+)?impactos?\s+(?:operacionales?|operativos?)(?:\s+identificados?)?\s*:/iu.test(
          value,
        )
      ) {
        return false;
      }
      impactCount += 1;
      continue;
    }

    return false;
  }

  return currentStateCount === 1 && impactCount >= 1 && impactCount <= 5;
}

const LOCAL_ONLY_V2_MILESTONES_STRUCTURAL_LABELS = new Set([
  "HITO",
  "HU",
  "HISTORIA",
  "RNF",
]);

const LOCAL_ONLY_V2_MILESTONES_ATTRIBUTE_LABELS = new Set([
  "COMO",
  "QUIERO",
  "PARA",
  "CONTEXTO",
  "CA",
  "PREMISA",
  "SISTEMA",
  "CAMPO",
]);

// AI_ANALYSIS_LOCAL_ONLY_V2_MILESTONES_TOLERABLE_NOISE_V2
//
// Conjunto CERRADO y explícito de etiquetas que qwen3.5:9b produjo realmente
// (verificado contra Ollama real) al fragmentar, en líneas propias, columnas
// que el propio contrato ya declara como parte de una sola línea CA o RNF:
// "CA | código | dado | cuando | entonces" y
// "RNF | código | título | descripción | categoría | medida | objetivo |
// criterio verificable". No es una lista abierta ni una heurística de
// negocio: son literalmente los nombres de columna que el contrato ya usa.
// Tolerarlas NUNCA usa su contenido para completar ningún campo obligatorio;
// solo evita que UNA línea de ruido invalide una HU o un RNF que, por el
// resto de sus líneas correctamente etiquetadas, ya cumple el contrato.
const LOCAL_ONLY_V2_MILESTONES_TOLERABLE_NOISE_LABELS = new Set([
  "CUANDO",
  "TIPO",
  "CATEGORIA",
  "MEDIDA",
  "OBJETIVO",
  "CRITERIO VERIFICABLE",
]);

// Una variante malformada de una etiqueta ESTRUCTURAL (p. ej. "HITO:",
// "HU:", "HISTORIA:", "RNF:") no es ruido de un atributo secundario: es una
// reapertura o corrupción de la jerarquía funcional disfrazada de línea
// desconocida. Tolerarla permitiría ocultar un HITO/HU corrupto o repetido
// después de los RNF. Se detecta de forma genérica (sin listar variantes
// específicas): si al quedarnos solo con las letras de la etiqueta el
// resultado coincide exactamente con HITO/HU/HISTORIA/RNF, es una variante
// estructural malformada y debe fallar cerrado siempre, sin importar el
// contexto.
function isMalformedStructuralLabelVariant(label: string): boolean {
  const lettersOnly = label.replace(/[^A-Z]/gu, "");
  return (
    lettersOnly.length > 0 &&
    LOCAL_ONLY_V2_MILESTONES_STRUCTURAL_LABELS.has(lettersOnly)
  );
}

// Keep the same list-prefix interpretation as requirementsFromText. Only
// parsing is normalized: the original content and field values stay intact.
function milestonesContractLines(content: string): string[] {
  const lines = content
    .replace(/\r\n?/gu, "\n")
    .split(/\n+/gu)
    .map((line) => line.trim())
    .filter(Boolean);

  // qwen3.5 may wrap an otherwise exact HITO/HU contract in a Markdown
  // code fence, even when both the generation and repair prompts forbid
  // prose. The document assembler already ignores those wrapper lines. The
  // validator must interpret the same payload consistently; otherwise two
  // valid model attempts are rejected solely because of presentation.
  // Only one balanced outer fence is tolerated. Fences inside the contract,
  // unbalanced fences and any other narrative/unknown line still fail closed.
  const firstLine = lines[0] ?? "";
  const lastLine = lines.at(-1) ?? "";
  const openingFence = /^(`{3,}|~{3,})(?:[\p{L}\p{N}_+-]+)?$/u.exec(firstLine);
  const closingFence = /^(`{3,}|~{3,})$/u.exec(lastLine);
  const contractLines =
    openingFence &&
    closingFence &&
    openingFence[1]?.[0] === closingFence[1]?.[0] &&
    (openingFence[1]?.length ?? 0) <= (closingFence[1]?.length ?? 0)
      ? lines.slice(1, -1)
      : lines;

  return contractLines.map((line) =>
    line.replace(/^(?:[-*•]|\d+[.)])\s*/u, ""),
  );
}

function hasStructuredMilestonesContract(content: string): boolean {
  const lines = milestonesContractLines(content);

  if (lines.length === 0) return false;

  const normalizeLabel = (value: string) =>
    value
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toUpperCase()
      .trim();

  type StoryState = {
    como: boolean;
    quiero: boolean;
    para: boolean;
    contexto: boolean;
    acceptanceCriteria: number;
  };

  let milestoneCount = 0;
  let storyCount = 0;
  let milestoneHasStory = false;
  let story: StoryState | null = null;
  let nonFunctionalStarted = false;

  const storyIsComplete = () =>
    Boolean(
      story &&
      story.como &&
      story.quiero &&
      story.para &&
      story.contexto &&
      story.acceptanceCriteria > 0,
    );

  for (const line of lines) {
    const values = line.split(/\s*\|\s*/u).map((item) => item.trim());
    const label = normalizeLabel(values[0] ?? "");

    if (label === "HITO") {
      if (nonFunctionalStarted) return false;
      if (story && !storyIsComplete()) return false;
      if (milestoneCount > 0 && !milestoneHasStory) return false;
      if (!values[1] || !values[2] || !values[3]) return false;

      milestoneCount += 1;
      milestoneHasStory = false;
      story = null;
      continue;
    }

    if (label === "HU" || label === "HISTORIA") {
      if (nonFunctionalStarted || milestoneCount === 0) return false;
      if (story && !storyIsComplete()) return false;
      if (!values[1] || !values[2] || !values[3]) return false;

      storyCount += 1;
      milestoneHasStory = true;
      story = {
        como: false,
        quiero: false,
        para: false,
        contexto: false,
        acceptanceCriteria: 0,
      };
      continue;
    }

    if (label === "RNF") {
      if (story && !storyIsComplete()) return false;
      if (milestoneCount > 0 && !milestoneHasStory) return false;
      if (!values[1] || !values[2] || !values[3]) return false;

      story = null;
      nonFunctionalStarted = true;
      continue;
    }

    if (!LOCAL_ONLY_V2_MILESTONES_ATTRIBUTE_LABELS.has(label)) {
      // AI_ANALYSIS_LOCAL_ONLY_V2_MILESTONES_NOISE_TOLERANCE_V2
      //
      // Una variante malformada de HITO/HU/HISTORIA/RNF siempre falla
      // cerrado: no es ruido de atributo secundario, es jerarquía corrupta
      // disfrazada.
      if (isMalformedStructuralLabelVariant(label)) return false;

      // Solo el conjunto CERRADO y explícito de etiquetas realmente
      // observadas en la salida de Ollama (columnas de CA/RNF fragmentadas
      // en líneas propias) se descarta como ruido, y solo dentro de una HU
      // ya abierta o después de haber iniciado los RNF. Cualquier otra
      // etiqueta desconocida (narrativa arbitraria, comentarios, etc.) sigue
      // fallando cerrado: no hay descarte genérico de "cualquier etiqueta no
      // reconocida".
      if (
        (story || nonFunctionalStarted) &&
        LOCAL_ONLY_V2_MILESTONES_TOLERABLE_NOISE_LABELS.has(label)
      ) {
        continue;
      }
      return false;
    }

    if (!story || nonFunctionalStarted) return false;

    if (label === "COMO") {
      if (isPendingFieldValue(values.slice(1).join(" | ").trim())) return false;
      story.como = true;
      continue;
    }

    if (label === "QUIERO") {
      if (isPendingFieldValue(values.slice(1).join(" | ").trim())) return false;
      story.quiero = true;
      continue;
    }

    if (label === "PARA") {
      if (isPendingFieldValue(values.slice(1).join(" | ").trim())) return false;
      story.para = true;
      continue;
    }

    if (label === "CONTEXTO") {
      if (isPendingFieldValue(values.slice(1).join(" | ").trim())) return false;
      story.contexto = true;
      continue;
    }

    if (label === "CA") {
      // Un marcador "[PENDIENTE POR DEFINIR]" (o su variante con anotación)
      // en DADO/CUANDO/ENTONCES no es un criterio de aceptación realmente
      // definido. Pero una HU puede tener varios CA: uno ya válido y otro
      // todavía pendiente. Ese CA pendiente NO debe invalidar todo el
      // contrato ni disparar una reparación innecesaria de una HU que ya
      // cumple el mínimo (al menos un CA realmente definido); simplemente no
      // se cuenta. Solo si NINGÚN CA de la HU queda válido, la comprobación
      // final de `storyIsComplete()` la marcará incompleta.
      if (
        values[1] &&
        !isPendingFieldValue(values[2] ?? "") &&
        !isPendingFieldValue(values[3] ?? "") &&
        !isPendingFieldValue(values[4] ?? "")
      ) {
        story.acceptanceCriteria += 1;
      }
      continue;
    }

    if (label === "PREMISA" || label === "SISTEMA") {
      if (!values.slice(1).join(" | ").trim()) return false;
      continue;
    }

    if (label === "CAMPO") {
      if (!values[1]) return false;
      continue;
    }
  }

  if (story && !storyIsComplete()) return false;
  if (milestoneCount === 0 || storyCount === 0 || !milestoneHasStory) {
    return false;
  }

  return true;
}

// AI_ANALYSIS_LOCAL_ONLY_V2_MILESTONES_PENDING_CLASSIFICATION_V1
//
// hasStructuredMilestonesContract() es todo-o-nada: si UNA sola HU del texto
// queda incompleta (evidencia insuficiente para COMO/QUIERO/PARA/CONTEXTO/CA),
// retorna false para TODO el contenido. Eso es correcto para decidir si vale
// la pena reintentar una reparación, pero no debe usarse para decidir si se
// aborta el documento completo: el ensamblador (requirementsFromText, en
// local-only-v2-section-content.ts) ya clasifica cada HU individualmente como
// COMPLETE o PENDING_DOCUMENTATION sin inventar datos ni perder evidencia.
//
// Este clasificador solo distingue si el texto contiene ALGUNA estructura
// HITO/HU reconocible (aunque esté incompleta) de si es prosa/jerarquía
// realmente corrupta y no hay nada recuperable que ensamblar.
type LocalOnlyV2MilestonesContentClassification =
  | "COMPLETE"
  | "HAS_PENDING_NEEDS"
  | "UNPARSEABLE";

const LOCAL_ONLY_V2_MILESTONES_RECOGNIZED_LABELS = new Set([
  ...LOCAL_ONLY_V2_MILESTONES_STRUCTURAL_LABELS,
  ...LOCAL_ONLY_V2_MILESTONES_ATTRIBUTE_LABELS,
]);

// AI_ANALYSIS_LOCAL_ONLY_V2_MILESTONES_STRUCTURAL_CODE_V1
//
// Un código estructural (H-001, HU-F-001, HU-001, CA-001, CA-F-001,
// RNF-001, ...) identifica un elemento, pero repetirlo en un título,
// descripción o atributo no expresa ninguna necesidad funcional real. El
// modelo puede repetirlo accidentalmente en CUALQUIER columna (título,
// COMO, QUIERO, CA, ...), así que la detección no puede asumir una posición
// fija: se evalúa el valor en sí, dondequiera que aparezca.
const MILESTONES_STRUCTURAL_CODE_PATTERN =
  /^[A-Z]{1,6}(?:-[A-Z]{1,6}){0,2}-\d{1,6}$/u;

function isStructuralCodeValue(value: string): boolean {
  return MILESTONES_STRUCTURAL_CODE_PATTERN.test(value.trim());
}

function classifyMilestonesContent(
  content: string,
): LocalOnlyV2MilestonesContentClassification {
  if (hasStructuredMilestonesContract(content)) return "COMPLETE";

  const lines = milestonesContractLines(content);

  if (lines.length === 0) return "UNPARSEABLE";

  const normalizeLabel = (value: string) =>
    value
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toUpperCase()
      .trim();

  // La mera presencia de una etiqueta reconocida (HITO, HU, ...) no basta:
  // un HITO aislado, una HU sin ningún dato propio ni atributos, o etiquetas
  // sueltas sin ningún contenido funcional recuperable son basura
  // estructurada, no una necesidad pendiente. Solo cuando existe al menos
  // una HU/RNF con contenido funcional real (título, descripción o algún
  // atributo con valor realmente definido) permitimos HAS_PENDING_NEEDS.
  //
  // Debe evaluarse cada valor de forma individual, no la línea concatenada:
  // unir columnas vacías con " | " produce separadores no vacíos (p. ej.
  // values.slice(1).join(" | ") de ["", ""] es " | ", cuyo trim() sigue
  // siendo no vacío). Un valor "[PENDIENTE POR DEFINIR]" tampoco es
  // contenido funcional real aunque no esté vacío, y un código estructural
  // (repetido en cualquier columna, incluida su propia columna de código)
  // tampoco demuestra ninguna necesidad funcional.
  const hasDefinedFunctionalValue = (values: string[]) =>
    values
      .slice(1)
      .some(
        (value) => !isPendingFieldValue(value) && !isStructuralCodeValue(value),
      );

  let milestoneCount = 0;
  let openStory = false;
  let nonFunctionalStarted = false;
  let sawRecoverableUnit = false;

  for (const line of lines) {
    const values = line.split(/\s*\|\s*/u).map((item) => item.trim());
    const label = normalizeLabel(values[0] ?? "");
    if (!LOCAL_ONLY_V2_MILESTONES_RECOGNIZED_LABELS.has(label)) {
      // Ver AI_ANALYSIS_LOCAL_ONLY_V2_MILESTONES_NOISE_TOLERANCE_V2 en
      // hasStructuredMilestonesContract: una variante malformada de una
      // etiqueta ESTRUCTURAL siempre falla cerrado, y solo el conjunto
      // cerrado y explícito de ruido de atributos secundarios realmente
      // observado en Ollama se descarta dentro de una HU abierta o después
      // de haber iniciado los RNF. Cualquier otra etiqueta desconocida
      // (narrativa arbitraria, comentarios) sigue fallando cerrado.
      if (isMalformedStructuralLabelVariant(label)) return "UNPARSEABLE";
      if (
        (openStory || nonFunctionalStarted) &&
        LOCAL_ONLY_V2_MILESTONES_TOLERABLE_NOISE_LABELS.has(label)
      ) {
        continue;
      }
      return "UNPARSEABLE";
    }

    if (label === "HITO") {
      // Reabrir la jerarquía funcional después de iniciar los RNF indica una
      // salida con el orden del contrato realmente roto, no una necesidad
      // pendiente: eso sí debe fallar cerrado.
      if (nonFunctionalStarted) return "UNPARSEABLE";
      milestoneCount += 1;
      openStory = false;
      continue;
    }

    if (label === "HU" || label === "HISTORIA") {
      // Una HU huérfana, sin ningún Hito que la contenga, no es evidencia
      // pendiente: es una relación HITO/HU rota que no se puede ensamblar.
      if (nonFunctionalStarted || milestoneCount === 0) return "UNPARSEABLE";
      openStory = true;
      if (hasDefinedFunctionalValue(values)) sawRecoverableUnit = true;
      continue;
    }

    if (label === "RNF") {
      if (hasDefinedFunctionalValue(values)) sawRecoverableUnit = true;
      nonFunctionalStarted = true;
      openStory = false;
      continue;
    }

    // COMO, QUIERO, PARA, CONTEXTO, CA, PREMISA, SISTEMA y CAMPO solo tienen
    // sentido dentro de una HU abierta. Una etiqueta reconocida pero huérfana
    // (sin HU previa, o tras iniciar los RNF) es jerarquía corrupta, no un
    // campo pendiente por definir.
    if (!openStory || nonFunctionalStarted) return "UNPARSEABLE";

    if (hasDefinedFunctionalValue(values)) sawRecoverableUnit = true;
  }

  return sawRecoverableUnit ? "HAS_PENDING_NEEDS" : "UNPARSEABLE";
}

// AI_ANALYSIS_LOCAL_ONLY_V2_MILESTONES_REPAIR_LOSSLESS_V1
//
// Antes de sustituir la salida de una subunidad por su versión reparada,
// verificamos que la reparación no haya eliminado en silencio un Hito, una
// HU o un RNF que ya existía (completo o pendiente). No inventamos contenido
// para "recuperar" lo perdido: si la reparación omite algo que ya existía,
// simplemente rechazamos la sustitución y conservamos la salida anterior.
//
// La identidad usada importa:
// - HITO se identifica por título normalizado, porque el ensamblador
//   determinístico (requirementsFromText, en local-only-v2-section-content.ts)
//   agrupa y canonicaliza Hitos por título, no por el código que el modelo
//   asigna dentro de esta subunidad; dos Hitos con el mismo título ya son,
//   aguas abajo, el mismo elemento.
// - HU/RNF NO se deduplican aguas abajo: cada línea es una necesidad
//   independiente aunque comparta título con otra. Por eso su identidad
//   prioriza el código (values[1]), que el propio contrato de reparación
//   exige distinto dentro de la respuesta; solo si falta código se usa como
//   respaldo el contenido completo de la línea (no solo el título), para no
//   colapsar por colisión dos HU/RNF distintas que comparten título.
// Además se cuenta multiplicidad (Map, no Set): perder una de dos
// elementos que comparten exactamente la misma identidad también debe
// detectarse como pérdida.
function milestonesElementContentIdentity(values: string[]): string {
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toLocaleLowerCase("es")
      .replace(/\s+/gu, " ")
      .trim();

  const code = normalize(values[1] ?? "");
  if (code) return `CODE:${code}`;

  return `CONTENT:${normalize(values.slice(2).join(" | "))}`;
}

function milestonesStructuralElementCounts(
  content: string,
): Map<string, number> {
  const normalizeTitle = (value: string) =>
    value
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toLocaleLowerCase("es")
      .replace(/\s+/gu, " ")
      .trim();

  const lines = milestonesContractLines(content);

  const counts = new Map<string, number>();
  const addKey = (key: string) => {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };

  let currentMilestoneTitleKey = "";
  let currentHuIdentity = "";

  for (const line of lines) {
    const values = line.split(/\s*\|\s*/u).map((item) => item.trim());
    const label = (values[0] ?? "")
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toUpperCase()
      .trim();

    if (label === "HITO") {
      currentMilestoneTitleKey = normalizeTitle(values[2] ?? "");
      currentHuIdentity = "";
      if (currentMilestoneTitleKey) {
        addKey(`HITO:${currentMilestoneTitleKey}`);
      }
      continue;
    }

    if (label === "HU" || label === "HISTORIA") {
      currentHuIdentity = milestonesElementContentIdentity(values);
      addKey(`HU:${currentMilestoneTitleKey}:${currentHuIdentity}`);
      continue;
    }

    if (label === "RNF") {
      addKey(`RNF:${milestonesElementContentIdentity(values)}`);
      currentHuIdentity = "";
      continue;
    }

    // Un CA perdido o sustituido (mismo u otro código) es tan grave como
    // perder la HU que lo contiene: sin esta clave, la ausencia total de un
    // CA no la detectaba ningún chequeo (repairPreservesDefinedFields solo
    // protege campos de elementos que SOBREVIVIERON; delegaba la detección
    // de ausencia total a este conteo, que hasta ahora no incluía CA).
    if (label === "CA") {
      addKey(
        `CA:${currentMilestoneTitleKey}:${currentHuIdentity}:${milestonesElementContentIdentity(values)}`,
      );
      continue;
    }
  }

  return counts;
}

// AI_ANALYSIS_LOCAL_ONLY_V2_MILESTONES_REPAIR_SEMANTIC_LOSSLESS_V1
//
// Conservar el código de un HITO/HU/RNF no basta: una reparación podría
// mantener el mismo código y, aun así, sustituir en silencio un valor ya
// definido (título, descripción, COMO/QUIERO/PARA/CONTEXTO, o el DADO/CUANDO/
// ENTONCES de un CA) por otro contenido distinto, o degradarlo a
// "[PENDIENTE POR DEFINIR]". Este recorrido construye, por elemento, los
// campos que YA estaban definidos en la salida anterior para poder exigir
// que la reparación los conserve exactamente. Un campo que antes estaba
// pendiente sí puede completarse libremente: solo protegemos lo que ya
// existía. No inventamos ninguna equivalencia semántica: la comparación es
// textual y exacta (tras normalizar espacios).
type MilestonesElementFields = Record<string, string>;

interface MilestonesElementRecord {
  identity: string;
  fields: MilestonesElementFields;
}

function normalizeMilestonesFieldValue(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function milestonesElementRecords(content: string): MilestonesElementRecord[] {
  const normalizeTitle = (value: string) =>
    value
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toLocaleLowerCase("es")
      .replace(/\s+/gu, " ")
      .trim();

  const lines = milestonesContractLines(content);

  const records: MilestonesElementRecord[] = [];
  let currentMilestoneTitleKey = "";
  let currentHuIdentity = "";
  let currentHuRecord: MilestonesElementRecord | null = null;

  for (const line of lines) {
    const values = line.split(/\s*\|\s*/u).map((item) => item.trim());
    const label = (values[0] ?? "")
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toUpperCase()
      .trim();

    if (label === "HITO") {
      currentMilestoneTitleKey = normalizeTitle(values[2] ?? "");
      currentHuIdentity = "";
      currentHuRecord = null;
      if (currentMilestoneTitleKey) {
        records.push({
          identity: `HITO:${currentMilestoneTitleKey}`,
          fields: { title: values[2] ?? "", description: values[3] ?? "" },
        });
      }
      continue;
    }

    if (label === "HU" || label === "HISTORIA") {
      currentHuIdentity = milestonesElementContentIdentity(values);
      currentHuRecord = {
        identity: `HU:${currentMilestoneTitleKey}:${currentHuIdentity}`,
        fields: { title: values[2] ?? "", description: values[3] ?? "" },
      };
      records.push(currentHuRecord);
      continue;
    }

    if (label === "RNF") {
      records.push({
        identity: `RNF:${milestonesElementContentIdentity(values)}`,
        fields: {
          title: values[2] ?? "",
          description: values[3] ?? "",
          category: values[4] ?? "",
          measure: values[5] ?? "",
          target: values[6] ?? "",
          criterion: values[7] ?? "",
        },
      });
      currentHuIdentity = "";
      currentHuRecord = null;
      continue;
    }

    if (!currentHuRecord) continue;

    if (label === "COMO") {
      currentHuRecord.fields.como = values.slice(1).join(" | ");
      continue;
    }

    if (label === "QUIERO") {
      currentHuRecord.fields.quiero = values.slice(1).join(" | ");
      continue;
    }

    if (label === "PARA") {
      currentHuRecord.fields.para = values.slice(1).join(" | ");
      continue;
    }

    if (label === "CONTEXTO") {
      currentHuRecord.fields.contexto = values.slice(1).join(" | ");
      continue;
    }

    if (label === "CA") {
      records.push({
        identity: `CA:${currentMilestoneTitleKey}:${currentHuIdentity}:${milestonesElementContentIdentity(values)}`,
        fields: {
          dado: values[2] ?? "",
          cuando: values[3] ?? "",
          entonces: values[4] ?? "",
        },
      });
      continue;
    }
  }

  return records;
}

function repairPreservesDefinedFields(
  previousContent: string,
  repairedContent: string,
): boolean {
  const previousRecords = milestonesElementRecords(previousContent);
  if (previousRecords.length === 0) return true;

  const repairedByIdentity = new Map<string, MilestonesElementFields[]>();
  for (const record of milestonesElementRecords(repairedContent)) {
    const bucket = repairedByIdentity.get(record.identity) ?? [];
    bucket.push(record.fields);
    repairedByIdentity.set(record.identity, bucket);
  }

  // Múltiples elementos previos pueden compartir la misma identidad (misma
  // clave, distinta instancia): cada candidato reparado con esa identidad
  // solo puede "cubrir" a uno de ellos.
  const consumedCount = new Map<string, number>();

  for (const previous of previousRecords) {
    const bucket = repairedByIdentity.get(previous.identity) ?? [];
    const alreadyConsumed = consumedCount.get(previous.identity) ?? 0;
    const candidate = bucket[alreadyConsumed];
    // La ausencia total del elemento ya la detecta
    // repairPreservesExistingMilestonesElements (conteo por identidad); aquí
    // solo protegemos campos de elementos que sí sobrevivieron.
    if (!candidate) continue;
    consumedCount.set(previous.identity, alreadyConsumed + 1);

    for (const [fieldName, previousValue] of Object.entries(previous.fields)) {
      if (isPendingFieldValue(previousValue)) continue;
      const repairedValue = candidate[fieldName] ?? "";
      if (
        normalizeMilestonesFieldValue(repairedValue) !==
        normalizeMilestonesFieldValue(previousValue)
      ) {
        return false;
      }
    }
  }

  return true;
}

function repairPreservesExistingMilestonesElements(
  previousContent: string,
  repairedContent: string,
): boolean {
  const previousCounts = milestonesStructuralElementCounts(previousContent);
  if (previousCounts.size === 0) return true;

  const repairedCounts = milestonesStructuralElementCounts(repairedContent);
  for (const [key, count] of previousCounts) {
    if ((repairedCounts.get(key) ?? 0) < count) return false;
  }

  return repairPreservesDefinedFields(previousContent, repairedContent);
}

function hasStructuredProcessFlowContract(content: string): boolean {
  const lines = content
    .replace(/\r\n?/gu, "\n")
    .split(/\n+/gu)
    .map((line) => line.trim())
    .filter(Boolean);

  const normalizedHeading = (value: string) =>
    value
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toUpperCase()
      .replace(/\s+/gu, " ")
      .replace(/:$/u, "")
      .trim();

  const headingIndex = (heading: string) =>
    lines.findIndex(
      (line) => normalizedHeading(line) === normalizedHeading(heading),
    );

  const requiredHeadings = [
    "FLUJO AS-IS",
    "PROBLEMAS IDENTIFICADOS",
    "FLUJO TO-BE",
    "MEJORAS DEL PROCESO",
    "RESULTADOS ESPERADOS",
    "ENTIDADES",
    "RELACIONES",
  ];

  const positions = requiredHeadings.map(headingIndex);
  if (positions.some((position) => position < 0)) return false;
  if (
    !positions.every(
      (position, index) => index === 0 || position > positions[index - 1]!,
    )
  ) {
    return false;
  }

  const flowLine =
    /^[^|\n]{2,}\s*\|\s*(?:INICIO|PROCESO|DECISI(?:Ó|O)N|SISTEMA|FIN)\s*\|\s*.+$/iu;

  const asIsLines = lines.slice(positions[0]! + 1, positions[1]!);
  const toBeLines = lines.slice(positions[2]! + 1, positions[3]!);

  return (
    asIsLines.some((line) => flowLine.test(line)) &&
    toBeLines.some((line) => flowLine.test(line))
  );
}

function diagramArtifactMaxContentCharacters(
  artifact: LocalOnlyV2DiagramArtifact,
): number {
  return artifact === "ENTITY_RELATIONSHIP"
    ? LOCAL_ONLY_V2_PROCESS_FLOW_ER_MAX_CONTENT_CHARACTERS
    : LOCAL_ONLY_V2_PROCESS_FLOW_MAX_CONTENT_CHARACTERS;
}

function diagramArtifactMaxOutputTokens(
  artifact: LocalOnlyV2DiagramArtifact,
): number {
  return artifact === "ENTITY_RELATIONSHIP"
    ? LOCAL_ONLY_V2_PROCESS_FLOW_ER_MAX_OUTPUT_TOKENS
    : LOCAL_ONLY_V2_PROCESS_FLOW_MAX_OUTPUT_TOKENS;
}

// AI_ANALYSIS_LOCAL_ONLY_V2_SECTION_UNIT_LIMITS_V1
//
// Esquema, Pruebas, Plan de trabajo, Alcance, Solución propuesta, Prototipo y
// Plantilla aplicada compartían el tope genérico de 900 caracteres y 320
// tokens por subunidad, muy por debajo de lo que exige su contrato de líneas
// (y de su propia política de sección). Un tope insuficiente corta la salida
// y activa el respaldo determinista. Cada valor sigue acotado por la política
// de la sección y por el máximo evaluado para el modelo. Ningún tope de
// tokens puede ser menor que 256: el cliente de Ollama rechaza la llamada.
const LOCAL_ONLY_V2_SECTION_UNIT_LIMITS: Readonly<
  Record<string, { readonly characters: number; readonly tokens: number }>
> = {
  scope: { characters: 1_200, tokens: 450 },
  solutionProposal: { characters: 1_200, tokens: 450 },
  visualFormat: { characters: 900, tokens: 350 },
  writingRules: { characters: 600, tokens: 256 },
  backlogStructure: { characters: 5_000, tokens: 2_000 },
  tests: { characters: 3_600, tokens: 1_400 },
  scrumPlan: { characters: 6_000, tokens: 3_000 },
};

function sequentialContentLimit(
  sectionKey: string,
  policyMaxCharacters: number,
  diagramArtifact?: LocalOnlyV2DiagramArtifact,
): number {
  if (sectionKey === "processFlow" && diagramArtifact) {
    return Math.min(
      diagramArtifactMaxContentCharacters(diagramArtifact),
      policyMaxCharacters,
    );
  }
  if (sectionKey === "processFlow") {
    return Math.min(
      LOCAL_ONLY_V2_PROCESS_FLOW_MAX_CONTENT_CHARACTERS,
      policyMaxCharacters,
    );
  }
  if (sectionKey === "objectives") {
    return Math.min(
      LOCAL_ONLY_V2_OBJECTIVES_MAX_CONTENT_CHARACTERS,
      policyMaxCharacters,
    );
  }
  if (sectionKey === "problemDescription") {
    return Math.min(
      LOCAL_ONLY_V2_PROBLEM_DESCRIPTION_MAX_CONTENT_CHARACTERS,
      policyMaxCharacters,
    );
  }
  const sectionLimit = LOCAL_ONLY_V2_SECTION_UNIT_LIMITS[sectionKey];
  if (sectionLimit) {
    return Math.min(sectionLimit.characters, policyMaxCharacters);
  }
  return sectionKey === "milestones"
    ? Math.min(
        LOCAL_ONLY_V2_MILESTONES_MAX_CONTENT_CHARACTERS,
        policyMaxCharacters,
      )
    : Math.min(
        LOCAL_ONLY_V2_SEQUENTIAL_MAX_CONTENT_CHARACTERS,
        policyMaxCharacters,
      );
}

// El cliente de Ollama rechaza cualquier tope de salida menor que 256 tokens o
// no entero; este piso evita que un ajuste futuro aborte la generación.
const LOCAL_ONLY_V2_MIN_OUTPUT_TOKENS = 256;

function sequentialOutputTokenLimit(
  sectionKey: string,
  assessedMaxOutputTokens: number,
  diagramArtifact?: LocalOnlyV2DiagramArtifact,
): number {
  return Math.max(
    LOCAL_ONLY_V2_MIN_OUTPUT_TOKENS,
    Math.floor(
      unboundedSequentialOutputTokenLimit(
        sectionKey,
        assessedMaxOutputTokens,
        diagramArtifact,
      ),
    ),
  );
}

function unboundedSequentialOutputTokenLimit(
  sectionKey: string,
  assessedMaxOutputTokens: number,
  diagramArtifact?: LocalOnlyV2DiagramArtifact,
): number {
  if (sectionKey === "processFlow" && diagramArtifact) {
    return Math.min(
      assessedMaxOutputTokens,
      diagramArtifactMaxOutputTokens(diagramArtifact),
    );
  }
  const sectionLimit = LOCAL_ONLY_V2_SECTION_UNIT_LIMITS[sectionKey];
  if (sectionLimit) {
    return Math.min(assessedMaxOutputTokens, sectionLimit.tokens);
  }
  return Math.min(
    assessedMaxOutputTokens,
    sectionKey === "processFlow"
      ? LOCAL_ONLY_V2_PROCESS_FLOW_MAX_OUTPUT_TOKENS
      : sectionKey === "objectives"
        ? LOCAL_ONLY_V2_OBJECTIVES_MAX_OUTPUT_TOKENS
        : sectionKey === "problemDescription"
          ? LOCAL_ONLY_V2_PROBLEM_DESCRIPTION_MAX_OUTPUT_TOKENS
          : sectionKey === "milestones"
            ? LOCAL_ONLY_V2_MILESTONES_MAX_OUTPUT_TOKENS
            : LOCAL_ONLY_V2_SEQUENTIAL_MAX_OUTPUT_TOKENS,
  );
}

export interface LocalOnlyV2ProcessingUnitsHumanContext {
  readonly instruction?: string | null;
  readonly purpose?: AiDraftGenerationPurpose;
  // Códigos reales de puntos anteriores (ver local-only-v2-prior-codes.ts).
  readonly priorCodes?: string;
}

// AI_ANALYSIS_LOCAL_ONLY_V2_HUMAN_INSTRUCTION_V1
// La instrucción humana se incorpora aquí, dentro del `aiPrompt.templateInstruction`
// que arma `compactPlan`. Al quedar dentro de `part.task` (usado por
// `unitFingerprint` más abajo), un cambio de instrucción invalida
// automáticamente los checkpoints de subunidad ya persistidos: no hace falta
// un campo de fingerprint aparte.
function localOnlyV2TemplateInstructionWithHumanContext(
  block: LocalOnlyV2TemplateGenerationPlan["blocks"][number],
  humanContext?: LocalOnlyV2ProcessingUnitsHumanContext,
): string {
  const instruction = humanContext?.instruction?.trim();
  const purposeContext =
    humanContext?.purpose === "AI_VERSION"
      ? "Esta ejecución regenera una versión existente del documento (AI_VERSION). Si la solicitud de cambio del usuario afecta esta sección, esa solicitud tiene prioridad."
      : null;
  return [
    block.guidance,
    purposeContext,
    humanContext?.priorCodes ?? null,
    instruction
      ? `SOLICITUD DE CAMBIO CONFIABLE DEL USUARIO (aplica únicamente si corresponde a esta sección): ${instruction}`
      : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
}

// AI_ANALYSIS_LOCAL_ONLY_V2_PROCESS_FLOW_SUBUNIT_PLAN_V1
//
// processFlow no pasa por el loteo genérico (`batchLocalOnlyV2ProcessingPacket`):
// ese loteo exige una partición EXHAUSTIVA y DISJUNTA de los hallazgos (cada
// hallazgo cubierto exactamente una vez entre todos los lotes), lo cual es
// correcto para una colección como Requerimientos pero incorrecto aquí,
// porque un mismo hallazgo (por ejemplo una regla de negocio) puede
// sustentar legítimamente más de un artefacto (TO-BE y el modelo
// entidad-relación a la vez). En su lugar, cada artefacto obtiene su propia
// VISTA especializada de `packet.relevantFindings` (ver
// selectLocalOnlyV2DiagramArtifactEvidence en local-only-v2-evidence-selector.ts)
// y luego reutiliza exactamente el mismo mecanismo de presupuesto por
// inferencia (`buildLocalOnlyV2BudgetedMicroDraftPlan`) que cualquier otra
// sección para decidir si esa vista cabe en una sola llamada o necesita
// dividirse en más partes. El orden de artefactos (AS-IS, TO-BE,
// entidad-relación) es fijo y determina el orden final de ensamblaje.
function planLocalOnlyV2ProcessFlowDiagramParts(
  compactPlan: LocalOnlyV2TemplateGenerationPlan,
  packet: LocalOnlyV2BlockEvidencePacket,
  budget: LocalOnlyV2InferenceBudget,
) {
  return LOCAL_ONLY_V2_DIAGRAM_ARTIFACTS.flatMap((artifact) => {
    const artifactPacket = selectLocalOnlyV2DiagramArtifactEvidence(
      packet,
      artifact,
      // La segmentación por presupuesto que sigue puede dividir esta vista
      // en varias subunidades. Recortar aquí perdería IDs seleccionados y
      // haría fallar correctamente la consolidación de trazabilidad.
      packet.relevantFindings.length,
    );
    const effectiveBudget = deriveLocalOnlyV2InferenceBudgetForOutputCap(
      budget,
      diagramArtifactMaxOutputTokens(artifact),
    );
    return buildLocalOnlyV2BudgetedMicroDraftPlan(
      compactPlan,
      artifactPacket,
      effectiveBudget,
    ).parts;
  });
}

export function planLocalOnlyV2ProcessingUnits(
  execution: LocalOnlyV2SequentialBlockExecution,
  plan: LocalOnlyV2TemplateGenerationPlan,
  packet: LocalOnlyV2BlockEvidencePacket,
  budget: LocalOnlyV2InferenceBudget,
  humanContext?: LocalOnlyV2ProcessingUnitsHumanContext,
) {
  const block = requireLocalOnlyV2ProcessingBlock(execution, plan);
  // Only the active point and instructions relevant to a point enter the prompt.
  const compactPlan = {
    ...plan,
    blocks: [block],
    aiPrompt: {
      ...plan.aiPrompt,
      systemInstruction:
        "Redacta una única sección documental basada en evidencia verificable.",
      purpose: `Redactar ${block.title}.`,
      templateInstruction: localOnlyV2TemplateInstructionWithHumanContext(
        block,
        humanContext,
      ),
    },
  };

  let parts: ReturnType<typeof buildLocalOnlyV2BudgetedMicroDraftPlan>["parts"];
  if (block.sectionKey === "processFlow") {
    parts = planLocalOnlyV2ProcessFlowDiagramParts(compactPlan, packet, budget);
  } else {
    const sectionLimit = LOCAL_ONLY_V2_SECTION_UNIT_LIMITS[block.sectionKey];
    const effectiveBudget =
      block.sectionKey === "milestones"
        ? deriveLocalOnlyV2InferenceBudgetForOutputCap(
            budget,
            LOCAL_ONLY_V2_MILESTONES_MAX_OUTPUT_TOKENS,
          )
        : sectionLimit
          ? // El tope de salida de la sección debe reflejarse también en el
            // presupuesto de la subunidad; de lo contrario queda en 1.200.
            deriveLocalOnlyV2InferenceBudgetForOutputCap(
              budget,
              sectionLimit.tokens,
            )
          : budget;
    const batches = batchLocalOnlyV2ProcessingPacket(
      block,
      packet,
      block.sectionKey === "milestones"
        ? {
            maxRelevantFindingsPerBatch:
              LOCAL_ONLY_V2_MILESTONES_MAX_FINDINGS_PER_BATCH,
            maxEstimatedRelevantTokensPerBatch: 1_200,
          }
        : block.sectionKey === "objectives" ||
            block.sectionKey === "problemDescription"
          ? {
              maxRelevantFindingsPerBatch: Math.max(
                6,
                packet.relevantFindings.length,
              ),
              maxEstimatedRelevantTokensPerBatch: 3_200,
            }
          : undefined,
    );
    parts = batches.batches.flatMap((batch) => {
      // Las guardas son transversales. Enviarlas en todos los lotes hacía que
      // advertencias y pendientes aparecieran repetidos en la sección final.
      const guardFindings =
        batch.batchNumber === 1 ? batch.guardFindings : Object.freeze([]);
      const selectedFindings = [...batch.relevantFindings, ...guardFindings];
      const batchPacket: LocalOnlyV2BlockEvidencePacket = {
        ...packet,
        relevantFindings: batch.relevantFindings,
        guardFindings,
        selectedFindingIds: [
          ...new Set(selectedFindings.map((finding) => finding.canonicalId)),
        ],
        sourceIds: [
          ...new Set(
            selectedFindings.flatMap((finding) => finding.sourceIds),
          ),
        ],
        segmentIds: [
          ...new Set(
            selectedFindings.flatMap((finding) => finding.segmentIds),
          ),
        ],
        metrics: {
          ...packet.metrics,
          relevantFindingCount: batch.relevantFindings.length,
          guardFindingCount: guardFindings.length,
          totalFindingCount: selectedFindings.length,
          questionnaireFindingCount: selectedFindings.filter(
            (finding) => finding.mandatoryQuestionnaireEvidence,
          ).length,
          sourceCount: new Set(
            selectedFindings.flatMap((finding) => finding.sourceIds),
          ).size,
          segmentCount: new Set(
            selectedFindings.flatMap((finding) => finding.segmentIds),
          ).size,
          estimatedEvidenceTokens: batch.estimatedRelevantTokens,
        },
        fingerprint: localOnlyV2Fingerprint([
          packet.fingerprint,
          batch.fingerprint,
        ]),
      };
      return buildLocalOnlyV2BudgetedMicroDraftPlan(
        compactPlan,
        batchPacket,
        effectiveBudget,
      ).parts;
    });
  }

  return parts.map((part, index) => ({
    ...part,
    unitNumber: index + 1,
    unitTotal: parts.length,
    unitFingerprint: localOnlyV2Fingerprint({
      packet: part.packet.fingerprint,
      task: part.task,
      limits: part.assessment.runtimeLimits,
      qualityProfile: LOCAL_ONLY_V2_SEQUENTIAL_QUALITY_PROFILE,
      diagramContract:
        block.sectionKey === "processFlow"
          ? LOCAL_ONLY_V2_PROCESS_FLOW_DIAGRAM_CONTRACT_VERSION
          : undefined,
      model: "qwen3.5:9b",
      think: false,
    }),
  }));
}
// AI_ANALYSIS_LOCAL_ONLY_V2_DETERMINISTIC_EVIDENCE_LINES_V1
//
// Dos secciones dependen de evidencia que el modelo pequeño suele omitir:
// la sección 10 (preguntas, aspectos por revisar y contradicciones ya
// detectados como hallazgos de resguardo) y Alcance (sistemas mencionados en
// las fuentes). Se agregan como líneas literales dentro del mismo presupuesto
// del punto; nunca se inventa texto ni se crea una contradicción nueva.
const LOCAL_ONLY_V2_GUARD_LINE_LABELS: ReadonlyArray<
  readonly [string, string]
> = [
  ["contradictions", "Contradicciones por resolver"],
  ["pendingQuestions", "Preguntas pendientes"],
  ["warnings", "Aspectos por revisar"],
];

// AI_ANALYSIS_LOCAL_ONLY_V2_KPI_TARGET_EVIDENCE_V1
//
// Una meta de KPI solo se conserva si cada cifra que contiene aparece
// literalmente en la evidencia del punto; de lo contrario queda pendiente.
function normalizeKpiTargets(
  content: string,
  unit: LocalOnlyV2ProcessingUnit,
): string {
  const evidence = [
    ...unit.packet.relevantFindings,
    ...unit.packet.guardFindings,
  ]
    .flatMap((finding) => [
      finding.description,
      ...finding.occurrences.map((occurrence) => occurrence.evidenceText),
    ])
    .join("\n")
    .replace(/,/gu, ".");
  const figures = (value: string) =>
    value.replace(/,/gu, ".").match(/\d+(?:\.\d+)?/gu) ?? [];
  return content
    .split("\n")
    .map((line) => {
      const parts = line.split(/\s*\|\s*/u);
      if (parts[0]?.trim().toUpperCase() !== "KPI" || parts.length < 5) {
        return line;
      }
      const target = parts.slice(4).join(" | ").trim();
      const unsupported = figures(target).some(
        (figure) => !evidence.includes(figure),
      );
      if (!unsupported) return line;
      return [...parts.slice(0, 4), "[PENDIENTE POR DEFINIR]"].join(" | ");
    })
    .join("\n");
}

function enrichLocalOnlyV2SectionContent(
  sectionKey: string,
  content: string,
  unit: LocalOnlyV2ProcessingUnit,
  maxCharacters: number,
): string {
  if (sectionKey === "assumptionsDependenciesPending") {
    const guardBudget = Math.floor(maxCharacters * 0.55);
    const lines: string[] = [];
    let used = 0;
    for (const [category, label] of LOCAL_ONLY_V2_GUARD_LINE_LABELS) {
      const findings = unit.packet.guardFindings
        .filter((finding) => finding.category === category)
        .slice(0, 2);
      for (const finding of findings) {
        const description = truncateAtBoundary(
          finding.description.trim().replace(/\s+/gu, " "),
          110,
        );
        if (description.length < 8) continue;
        if (content.includes(description.slice(0, 40))) continue;
        const line = `${label}: ${description}`;
        if (used + line.length + 1 > guardBudget) continue;
        lines.push(line);
        used += line.length + 1;
      }
    }
    if (lines.length === 0) return content;
    const modelPart = truncateAtBoundary(
      content,
      Math.max(0, maxCharacters - used),
    );
    return [modelPart, ...lines].filter(Boolean).join("\n");
  }
  if (sectionKey === "automationInstruction") {
    return normalizeKpiTargets(content, unit);
  }
  if (sectionKey === "scope") {
    const evidenceText = [
      ...unit.packet.relevantFindings,
      ...unit.packet.guardFindings,
    ]
      .flatMap((finding) => [
        finding.description,
        ...finding.occurrences.map((occurrence) => occurrence.evidenceText),
      ])
      .join("\n");
    const known = new Set(mentionedNavitransSystems(content));
    const systems = mentionedNavitransSystems(evidenceText).filter(
      (name) => !known.has(name),
    );
    if (systems.length === 0) return content;
    const all = [...known, ...systems];
    let line = `Sistemas involucrados: ${all.join("; ")}.`;
    while (
      line.length + content.length + 1 > maxCharacters &&
      all.length > known.size
    ) {
      all.pop();
      line = `Sistemas involucrados: ${all.join("; ")}.`;
    }
    if (all.length === known.size) return content;
    if (line.length + content.length + 1 > maxCharacters) return content;
    return `${content}\n${line}`;
  }
  return content;
}

export type LocalOnlyV2ProcessingUnit = ReturnType<
  typeof planLocalOnlyV2ProcessingUnits
>[number];

function deterministicTruncatedMicroDraftContent(
  unit: LocalOnlyV2ProcessingUnit,
  maxCharacters: number,
): string {
  const entries = [
    ...unit.packet.relevantFindings.map((finding) => ({
      prefix: "- ",
      value: finding.description.trim(),
    })),
    ...unit.packet.guardFindings.map((finding) => ({
      prefix: "- Aspecto por revisar: ",
      value: finding.description.trim(),
    })),
  ].filter(
    (entry, index, values) =>
      entry.value &&
      values.findIndex(
        (candidate) =>
          candidate.prefix === entry.prefix && candidate.value === entry.value,
      ) === index,
  );

  if (entries.length === 0) return "[PENDIENTE POR DEFINIR]";

  const separatorsLength = Math.max(0, entries.length - 1);
  const prefixesLength = entries.reduce(
    (total, entry) => total + entry.prefix.length,
    0,
  );
  const perEntry = Math.max(
    24,
    Math.floor(
      (maxCharacters - separatorsLength - prefixesLength) / entries.length,
    ),
  );
  // Se recorta cada entrada en el último límite de palabra o frase; nunca a
  // mitad de palabra. Si aun así el total excede el presupuesto se descartan
  // las entradas finales completas en lugar de partir la última.
  const rendered = entries
    .map((entry) => `${entry.prefix}${truncateAtBoundary(entry.value, perEntry)}`)
    .filter((line) => line.trim().length > 2);
  const kept: string[] = [];
  let used = 0;
  for (const line of rendered) {
    const next = used + line.length + (kept.length > 0 ? 1 : 0);
    if (next > maxCharacters) break;
    kept.push(line);
    used = next;
  }
  const content = kept.join("\n");
  return content || "[PENDIENTE POR DEFINIR]";
}

// AI_ANALYSIS_LOCAL_ONLY_V2_MILESTONES_PENDING_FALLBACK_V1
//
// Único fallback determinista para una subunidad de Requerimientos
// (milestones). Se reutiliza para todos los casos en los que la salida de
// Ollama no puede conservarse como jerarquía HITO/HU reconocible:
// truncamiento (OLLAMA_OUTPUT_TRUNCATED), contenido JSON válido pero
// sobredimensionado, contenido que sigue UNPARSEABLE tras la reparación
// localizada existente, una reparación truncada/sobredimensionada/inválida,
// o una excepción no cancelatoria durante esa reparación. En todos los
// casos se reutiliza esta misma función: no se realiza ninguna llamada
// adicional al modelo ni ningún reintento.
//
// El fallback preserva la evidencia (unit.packet.relevantFindings) dentro de
// una jerarquía sintácticamente reconocible: un único HITO técnico
// pendiente y exactamente una HU pendiente por cada hallazgo relevante de
// la subunidad. COMO, QUIERO, PARA y CONTEXTO quedan explícitamente
// [PENDIENTE POR DEFINIR]; no se fabrica ningún CA ni ningún dato de
// dominio (actor, sistema, regla, cifra o comportamiento). La descripción
// funcional de cada HU conserva literalmente la descripción del hallazgo
// (recortada solo si el presupuesto de caracteres de la subunidad lo
// exige), lo que basta para que classifyMilestonesContent la reconozca
// como HAS_PENDING_NEEDS en lugar de UNPARSEABLE.
//
// Los códigos de HITO/HU incorporan el número de subunidad
// (unit.unitNumber, único dentro de un mismo bloque) para que dos
// subunidades distintas del mismo documento nunca produzcan el mismo
// código técnico, aunque aguas abajo requirementsFromText (en
// local-only-v2-section-content.ts) vuelva a numerar cada elemento de forma
// secuencial y global sobre el documento ensamblado.
const LOCAL_ONLY_V2_MILESTONES_FALLBACK_MIN_DESCRIPTION_CHARACTERS = 24;

function localOnlyV2MilestonesFallbackMilestoneCode(
  unit: LocalOnlyV2ProcessingUnit,
): string {
  return `H-PEND-${String(unit.unitNumber).padStart(3, "0")}`;
}

function localOnlyV2MilestonesFallbackStoryCode(
  unit: LocalOnlyV2ProcessingUnit,
  index: number,
): string {
  return `HU-PEND-${String(unit.unitNumber).padStart(3, "0")}-${String(
    index + 1,
  ).padStart(2, "0")}`;
}

// AI_ANALYSIS_LOCAL_ONLY_V2_MILESTONES_FALLBACK_QUALITY_V1
//
// El fallback solo convierte en HU los hallazgos que describen una capacidad
// o necesidad funcional. Actores, pasos del proceso actual, problemas, hechos,
// entidades y riesgos NO son historias de usuario: su evidencia sigue
// registrada en el paquete (selectedFindingIds) y alimenta las demás
// secciones, pero no se presenta como si fuera un requisito.
const LOCAL_ONLY_V2_MILESTONES_FALLBACK_CATEGORIES: ReadonlySet<string> =
  new Set([
    "functionalRequirements",
    "needs",
    "expectedProcesses",
    "businessRules",
    "integrations",
    "decisions",
  ]);
const LOCAL_ONLY_V2_MILESTONES_FALLBACK_MIN_FINDING_CHARACTERS = 20;
const LOCAL_ONLY_V2_MILESTONES_FALLBACK_GROUP_TITLE =
  "Necesidades funcionales identificadas";
const LOCAL_ONLY_V2_MILESTONES_FALLBACK_GROUP_DESCRIPTION =
  "Necesidades funcionales identificadas en la evidencia del levantamiento que requieren especificación detallada.";
const LOCAL_ONLY_V2_MILESTONES_FALLBACK_STORY_TITLE =
  "Necesidad funcional pendiente de especificación";

// AI_ANALYSIS_LOCAL_ONLY_V2_MILESTONES_PUBLISHABLE_TITLES_V1
//
// La jerarquía HITO/HU válida no garantiza que los títulos sean publicables:
// un modelo local puede filtrar rótulos del cuestionario ("Escenarios a
// probar", "Rol que ..."), dejar títulos vacíos/pendientes, repetir el rótulo
// genérico "Requerimientos por agrupar" o duplicar títulos. Estos defectos se
// detectan de forma determinista y sin llamar a ningún proveedor.
function normalizeMilestoneTitleForComparison(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .replace(/[\s?¿:.;,!¡]+$/u, "")
    .replace(/^[\s?¿:.;,!¡]+/u, "")
    .trim();
}

function isUnpublishableMilestoneGroupTitle(title: string): boolean {
  if (isPendingFieldValue(title)) return true;
  const normalized = normalizeMilestoneTitleForComparison(title);
  if (normalized.length === 0) return true;
  if (/^pendiente por definir\b/u.test(normalized)) return true;
  return normalized === "requerimientos por agrupar";
}

function isUnpublishableMilestoneTitle(title: string): boolean {
  if (isUnpublishableMilestoneGroupTitle(title)) return true;
  const normalized = normalizeMilestoneTitleForComparison(title);
  if (/^(escenarios a probar|resultado observable)\b/u.test(normalized)) {
    return true;
  }
  if (/^(rol|roles|notificaciones|pantallas|informacion)\b/u.test(normalized)) {
    if (/[?:]\s*$/u.test(title.trim())) return true;
    if (
      /^(rol|roles|notificaciones|pantallas|informacion)(?: (?:que|a|necesari\w*|requerid\w*|involucrad\w*|principales))?$/u.test(
        normalized,
      ) ||
      /^(rol|roles|notificaciones|pantallas|informacion) (?:que|a) /u.test(
        normalized,
      )
    ) {
      return true;
    }
  }
  return false;
}

function milestonesContentHasUnpublishableTitles(content: string): boolean {
  for (const line of milestonesContractLines(content)) {
    const values = line.split(/\s*\|\s*/u).map((item) => item.trim());
    const label = (values[0] ?? "")
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toUpperCase()
      .trim();
    if (label !== "HITO" && label !== "HU") continue;
    const title = values[2] ?? "";
    const unpublishable =
      label === "HITO"
        ? isUnpublishableMilestoneGroupTitle(title)
        : isUnpublishableMilestoneTitle(title);
    if (unpublishable) return true;
  }
  return false;
}

function milestonesFallbackFindings(unit: LocalOnlyV2ProcessingUnit) {
  return unit.packet.relevantFindings.filter(
    (finding) =>
      LOCAL_ONLY_V2_MILESTONES_FALLBACK_CATEGORIES.has(finding.category) &&
      finding.description.trim().length >=
        LOCAL_ONLY_V2_MILESTONES_FALLBACK_MIN_FINDING_CHARACTERS,
  );
}

function milestonesFallbackTitle(description: string): string {
  const firstClause = description.trim().split(/(?<=[.:;])\s+/u)[0] ?? "";
  const title = truncateAtBoundary(
    firstClause.replace(/\s*\|\s*/gu, " / "),
    90,
  ).replace(/[.:;]+$/u, "");
  return title.length >= 8 && !isUnpublishableMilestoneTitle(title)
    ? title
    : LOCAL_ONLY_V2_MILESTONES_FALLBACK_STORY_TITLE;
}

// Garantiza títulos de HU únicos dentro de la subunidad sin inventar
// contenido: el sufijo numérico solo desambigua repeticiones exactas.
function uniqueMilestonesFallbackTitles(titles: readonly string[]): string[] {
  const used = new Set<string>();
  return titles.map((title) => {
    let candidate = title;
    let counter = 2;
    while (used.has(normalizeMilestoneTitleForComparison(candidate))) {
      candidate = `${title} (${counter})`;
      counter += 1;
    }
    used.add(normalizeMilestoneTitleForComparison(candidate));
    return candidate;
  });
}

function localOnlyV2MilestonesFallbackStoryLines(
  code: string,
  title: string,
  description: string,
): string[] {
  return [
    `HU | ${code} | ${title} | ${description}`,
    "COMO | [PENDIENTE POR DEFINIR]",
    "QUIERO | [PENDIENTE POR DEFINIR]",
    "PARA | [PENDIENTE POR DEFINIR]",
    "CONTEXTO | [PENDIENTE POR DEFINIR]",
  ];
}

// AI_ANALYSIS_LOCAL_ONLY_V2_MILESTONES_FALLBACK_ATOMIC_BUDGET_V1
//
// Construir el contenido y luego recortarlo con
// `lines.join("\n").slice(0, maxCharacters)` puede cortar una línea a la
// mitad y corromper el contrato (por ejemplo, dejar
// "CONTEXTO | [PENDIENTE POR DEF" sin cerrar el corchete). En su lugar,
// calculamos primero el espacio fijo que ya requieren el HITO y todas las
// líneas fijas de cada HU (HU/COMO/QUIERO/PARA/CONTEXTO, sin su
// descripción), y distribuimos el espacio restante entre las
// descripciones. Ninguna línea se genera más larga que su presupuesto, así
// que el contenido final nunca excede maxCharacters y ninguna línea queda
// truncada a mitad de camino. No se elimina ningún relevantFinding para
// ajustar el tamaño: si el presupuesto no alcanza ni para el mínimo
// legible por descripción, se falla con un error explícito de invariante
// de configuración en lugar de perder evidencia en silencio.
function deterministicPendingMilestonesFallbackContent(
  unit: LocalOnlyV2ProcessingUnit,
  maxCharacters: number,
): string {
  const findings = milestonesFallbackFindings(unit);
  if (findings.length === 0) return "[PENDIENTE POR DEFINIR]";

  const milestoneLine = `HITO | ${localOnlyV2MilestonesFallbackMilestoneCode(
    unit,
  )} | ${LOCAL_ONLY_V2_MILESTONES_FALLBACK_GROUP_TITLE} | ${LOCAL_ONLY_V2_MILESTONES_FALLBACK_GROUP_DESCRIPTION}`;

  const storyCodes = findings.map((_, index) =>
    localOnlyV2MilestonesFallbackStoryCode(unit, index),
  );
  const titles = uniqueMilestonesFallbackTitles(
    findings.map((finding) => milestonesFallbackTitle(finding.description)),
  );
  const fixedStoryOverhead = storyCodes.reduce(
    (total, code, index) =>
      total +
      localOnlyV2MilestonesFallbackStoryLines(code, titles[index]!, "").reduce(
        (subtotal, line) => subtotal + line.length + 1,
        0,
      ),
    0,
  );
  const fixedTotal = milestoneLine.length + 1 + fixedStoryOverhead;

  const available = maxCharacters - fixedTotal;
  const minimumRequired =
    findings.length *
    LOCAL_ONLY_V2_MILESTONES_FALLBACK_MIN_DESCRIPTION_CHARACTERS;
  if (available < minimumRequired) {
    throw new Error(
      "LOCAL_ONLY_V2_MILESTONES_FALLBACK_CONFIG_INVARIANT: el presupuesto de caracteres configurado para Requerimientos no alcanza para representar de forma legible todas las HU pendientes de esta subunidad.",
    );
  }

  const perFindingBase = Math.floor(available / findings.length);
  const remainder = available - perFindingBase * findings.length;
  const budgets = findings.map((_, index) =>
    index < remainder ? perFindingBase + 1 : perFindingBase,
  );

  const lines = [
    milestoneLine,
    ...findings.flatMap((findingItem, index) =>
      localOnlyV2MilestonesFallbackStoryLines(
        storyCodes[index]!,
        titles[index]!,
        truncateAtBoundary(
          findingItem.description.trim().replace(/\s*\|\s*/gu, " / "),
          budgets[index]!,
        ) || "[PENDIENTE POR DEFINIR]",
      ),
    ),
  ];

  return lines.join("\n");
}

// AI_ANALYSIS_LOCAL_ONLY_V2_PROCESS_FLOW_DIAGRAM_FALLBACK_V1
//
// Fallback determinista exclusivo de una subunidad de diagrama (AS-IS,
// TO-BE o modelo entidad-relación). Igual que el de Requerimientos, los
// códigos incorporan unit.unitNumber para que dos subunidades del mismo
// bloque nunca produzcan el mismo identificador técnico.
function localOnlyV2DiagramCodePrefix(unit: LocalOnlyV2ProcessingUnit): string {
  return `U${String(unit.unitNumber).padStart(3, "0")}`;
}

function deterministicDiagramArtifactFallbackContent(
  unit: LocalOnlyV2ProcessingUnit,
  maxCharacters: number,
): string {
  const artifact = unit.packet.diagramArtifact;
  const findings = unit.packet.relevantFindings.map((finding) => ({
    canonicalId: finding.canonicalId,
    category: finding.category,
    description: finding.description,
  }));
  const prefix = localOnlyV2DiagramCodePrefix(unit);

  if (artifact === "ENTITY_RELATIONSHIP") {
    return deterministicEntityRelationshipFallback(
      findings,
      `ER-${prefix}`,
      maxCharacters,
    );
  }
  if (artifact === "TO_BE") {
    return deterministicDiagramFlowFallback(
      findings,
      "FLUJO TO-BE",
      `TOBE-${prefix}`,
      maxCharacters,
    );
  }
  return deterministicDiagramFlowFallback(
    findings,
    "FLUJO AS-IS",
    `ASIS-${prefix}`,
    maxCharacters,
  );
}

// AI_ANALYSIS_LOCAL_ONLY_V2_PROCESS_FLOW_DIAGRAM_CLASSIFICATION_V1
//
// Clasifica la salida de una subunidad de diagrama contra el contrato
// canónico. Para AS-IS/TO-BE, "sin ninguna línea canónica" (heading-only o
// ausente) es VALID_EMPTY exclusivamente cuando esta subunidad no recibió
// evidencia utilizable (actor sustentado + paso sustentado): el modelo
// correctamente no inventó un carril ni un nodo que la evidencia no
// respalda. Si SÍ había evidencia utilizable y la salida sigue sin ninguna
// línea canónica, sigue siendo INVALID (dispara reparación y, si falla, el
// fallback determinista, que si produce el mismo heading vacío ya no
// vuelve a fallar el chequeo porque también pasa por esta clasificación).
// Para el modelo entidad-relación, una salida sin ninguna línea ENTIDAD es
// VALID_EMPTY cuando la subunidad no recibió evidencia de entidades (el
// modelo correctamente no inventó nada) y solo es INVALID cuando SÍ había
// evidencia y el modelo la ignoró.
type LocalOnlyV2DiagramFlowClassification =
  | { readonly status: "VALID" }
  | { readonly status: "VALID_EMPTY" }
  | { readonly status: "INVALID"; readonly issues: readonly string[] };

function classifyDiagramFlowOutput(
  content: string,
  distinctActorEvidenceHints: readonly string[],
  findings: readonly LocalOnlyV2DiagramFallbackFinding[],
  heading: "FLUJO AS-IS" | "FLUJO TO-BE",
): LocalOnlyV2DiagramFlowClassification {
  const parsed = parseCanonicalDiagramFlow(content);
  if (!parsed) {
    return hasUsableDiagramFlowEvidence(findings, heading)
      ? { status: "INVALID", issues: ["NOT_CANONICAL"] }
      : { status: "VALID_EMPTY" };
  }
  const validation = validateCanonicalDiagramFlow(parsed, {
    distinctActorEvidenceHints,
  });
  return validation.valid
    ? { status: "VALID" }
    : { status: "INVALID", issues: validation.issues };
}

type LocalOnlyV2DiagramErClassification =
  | { readonly status: "VALID" }
  | { readonly status: "VALID_EMPTY" }
  | { readonly status: "INVALID"; readonly issues: readonly string[] };

function classifyDiagramErOutput(
  content: string,
  hasArtifactEvidence: boolean,
): LocalOnlyV2DiagramErClassification {
  const parsed = parseCanonicalEntityRelationshipModel(content);
  if (!parsed || parsed.entities.length === 0) {
    return hasArtifactEvidence
      ? { status: "INVALID", issues: ["EMPTY_DESPITE_EVIDENCE"] }
      : { status: "VALID_EMPTY" };
  }
  const validation = validateCanonicalEntityRelationshipModel(parsed);
  return validation.valid
    ? { status: "VALID" }
    : { status: "INVALID", issues: validation.issues };
}

// AI_ANALYSIS_LOCAL_ONLY_V2_FALLBACK_DISPATCH_V1
//
// Único punto de entrada para el fallback determinista de una subunidad,
// sea cual sea la razón (truncamiento, JSON sobredimensionado, o
// UNPARSEABLE persistente tras la reparación). Cada sección conserva su
// propio fallback especializado; el resto sigue usando el fallback
// genérico de viñetas.
function deterministicFallbackContentForUnit(
  unit: LocalOnlyV2ProcessingUnit,
  maxCharacters: number,
): string {
  if (unit.packet.sectionKey === "milestones") {
    return deterministicPendingMilestonesFallbackContent(unit, maxCharacters);
  }
  if (
    unit.packet.sectionKey === "processFlow" &&
    unit.packet.diagramArtifact
  ) {
    return deterministicDiagramArtifactFallbackContent(unit, maxCharacters);
  }
  return deterministicTruncatedMicroDraftContent(unit, maxCharacters);
}

// AI_ANALYSIS_LOCAL_ONLY_V2_MILESTONES_OVERSIZED_RAW_GUARD_V1
//
// parseLocalOnlyV2MicroDraftModelOutput enforces its own global ceiling
// (LOCAL_ONLY_V2_MICRO_DRAFT_MAX_CONTENT_CHARACTERS, 4_800) and throws a
// generic Error the moment content exceeds it — before the section-specific
// `maxContentCharacters` check below ever runs. When qwen3.5 returns a
// syntactically valid { content } payload whose content is larger than both
// ceilings (observed: 8_873 characters), that generic Error propagates
// unrewritten and aborts the whole document. This guard replays only the
// same safe checks the strict parser performs (valid JSON, object, exactly
// one "content" string key, tolerating one balanced outer Markdown fence
// around the whole payload) so an oversized-but-otherwise-valid milestones
// response can be detected and redirected to the deterministic HITO/HU
// fallback without ever relaxing or duplicating the strict parser's rules.
function stripOuterMarkdownFenceForRawModelOutput(raw: string): string {
  const lines = raw.replace(/\r\n?/gu, "\n").split("\n");
  let start = 0;
  let end = lines.length - 1;
  while (start <= end && lines[start]?.trim() === "") start++;
  while (end >= start && lines[end]?.trim() === "") end--;
  if (start >= end) return raw;

  const firstLine = lines[start]?.trim() ?? "";
  const lastLine = lines[end]?.trim() ?? "";
  const openingFence = /^(`{3,}|~{3,})(?:[\p{L}\p{N}_+-]+)?$/u.exec(firstLine);
  const closingFence = /^(`{3,}|~{3,})$/u.exec(lastLine);
  if (
    openingFence &&
    closingFence &&
    openingFence[1]?.[0] === closingFence[1]?.[0] &&
    (openingFence[1]?.length ?? 0) <= (closingFence[1]?.length ?? 0)
  ) {
    return lines.slice(start + 1, end).join("\n");
  }
  return raw;
}

function oversizedRawMicroDraftContent(
  raw: string,
  maxContentCharacters: number,
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripOuterMarkdownFenceForRawModelOutput(raw));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const keys = Object.keys(parsed as Record<string, unknown>);
  if (keys.length !== 1 || keys[0] !== "content") return null;
  const content = (parsed as Record<string, unknown>).content;
  if (typeof content !== "string") return null;
  const trimmed = content.trim();
  return trimmed.length > maxContentCharacters ? trimmed : null;
}

export async function generateLocalOnlyV2ProcessingBlock(
  client: Pick<OllamaClient, "generate">,
  execution: LocalOnlyV2SequentialBlockExecution,
  plan: LocalOnlyV2TemplateGenerationPlan,
  unit: LocalOnlyV2ProcessingUnit,
  signal?: AbortSignal,
): Promise<LocalOnlyV2MicroDraft> {
  const block = requireLocalOnlyV2ProcessingBlock(execution, plan);
  const sectionPolicy = localOnlyV2SectionDraftPolicy(block.sectionKey);
  const diagramArtifact =
    block.sectionKey === "processFlow" ? unit.packet.diagramArtifact : undefined;
  const maxContentCharacters = sequentialContentLimit(
    block.sectionKey,
    sectionPolicy.maxCharacters,
    diagramArtifact,
  );
  if (block.blockId !== unit.packet.blockId)
    throw new Error("Unidad ajena al punto PROCESSING.");
  signal?.throwIfAborted();
  const compactSchema = {
    ...unit.task.schema,
    properties: {
      content: {
        type: "string",
        minLength: 1,
        maxLength: maxContentCharacters,
      },
    },
  };
  const generationDirective =
    diagramArtifact === "AS_IS"
      ? [
          "NO resumas el Flujo AS-IS en una secuencia genérica ni en un párrafo.",
          "Representa ÚNICAMENTE el proceso ACTUAL sustentado en la evidencia de esta subunidad; no incluyas mejoras, automatizaciones propuestas ni resultados futuros.",
          "Devuelve exclusivamente este contrato y empieza con la línea 'FLUJO AS-IS':",
          "CARRIL | id | nombre del actor, rol, área o sistema | ACTOR o SYSTEM",
          "NODO | id | idDeCarril | START, PROCESS, DECISION o END | acción concreta",
          "ARISTA | idNodoOrigen | idNodoDestino | etiqueta",
          "PROBLEMA | consecuencia negativa concreta y sustentada (máximo cinco líneas)",
          "Crea un carril por cada actor, rol, área, sistema o plataforma realmente identificado en la evidencia; nunca uses un único carril genérico como 'Proceso actual' si la evidencia identifica más de un responsable.",
          "Conserva el orden temporal real desde el inicio hasta el fin y no omitas pasos intermedios sustentados.",
          "Cuando exista una decisión real de negocio, usa DECISION y crea una ARISTA por cada alternativa sustentada, cada una con su propia etiqueta distinta (por ejemplo Sí/No, Aprobado/Rechazado, Válido/Inválido, Éxito/Error); la etiqueta de ARISTA nunca puede quedar vacía cuando el nodo de origen es una decisión con más de una salida.",
          "No conviertas una pregunta del levantamiento en una decisión del flujo; nunca escribas 'Pregunta:' ni 'Respuesta:' dentro de un NODO.",
          "No inventes actores, sistemas, pasos, decisiones ni problemas que la evidencia no sustente.",
        ].join(" ")
      : diagramArtifact === "TO_BE"
        ? [
            "NO resumas el Flujo TO-BE en una secuencia genérica ni en un párrafo, y no lo copies del AS-IS.",
            "Representa ÚNICAMENTE el proceso FUTURO esperado sustentado en la evidencia de esta subunidad.",
            "Devuelve exclusivamente este contrato y empieza con la línea 'FLUJO TO-BE':",
            "CARRIL | id | nombre del actor, rol, área o sistema | ACTOR o SYSTEM",
            "NODO | id | idDeCarril | START, PROCESS, DECISION, SYSTEM o END | acción concreta",
            "ARISTA | idNodoOrigen | idNodoDestino | etiqueta",
            "MEJORA | mejora concreta y sustentada (máximo cinco líneas)",
            "RESULTADO | beneficio o resultado explícito de la evidencia (máximo ocho líneas)",
            "Conserva actores, sistemas, automatizaciones e integraciones realmente sustentadas; nunca uses un único carril genérico como 'Solución propuesta' si la evidencia identifica más de un responsable.",
            "Cuando exista una decisión real de negocio, usa DECISION y crea una ARISTA por cada alternativa sustentada, cada una con su propia etiqueta distinta; la etiqueta de ARISTA nunca puede quedar vacía cuando el nodo de origen es una decisión con más de una salida.",
            "No inventes porcentajes, ahorros, tiempos ni métricas; no conviertas una pregunta del levantamiento en una decisión del flujo; nunca escribas 'Pregunta:' ni 'Respuesta:' dentro de un NODO.",
            "No inventes actores, sistemas, pasos, decisiones, mejoras ni resultados que la evidencia no sustente.",
          ].join(" ")
        : diagramArtifact === "ENTITY_RELATIONSHIP"
          ? [
              "NO resumas el modelo entidad-relación en prosa ni en viñetas.",
              "Devuelve exclusivamente este contrato:",
              "ENTIDAD | id | nombre | descripción",
              "ATRIBUTO | entidadId | nombre | tipo de dato | PK, FK o NONE | SI o NO (obligatoriedad)",
              "RELACION | entidadOrigenId | entidadDestinoId | 1:1, 1:N, N:1 o N:M | descripción",
              "Incluye únicamente entidades, atributos y relaciones sustentados literalmente por la evidencia de esta subunidad.",
              "Si la evidencia de esta subunidad no sustenta ninguna entidad, no escribas ninguna línea ENTIDAD; no inventes entidades para llenar la sección.",
              "Marca PK únicamente cuando la evidencia identifique inequívocamente un identificador de la entidad; no la inventes por conveniencia.",
              "No inventes atributos, tipos de dato, cardinalidades ni relaciones que la evidencia no sustente.",
            ].join(" ")
          : block.sectionKey === "processFlow"
            ? [
                "NO resumas el Diagrama de flujo en una secuencia genérica.",
                "Reconstruye únicamente el proceso sustentado en la evidencia de esta subunidad.",
                "Conserva actores, roles, áreas, sistemas y plataformas como carriles separados cuando estén identificados.",
                "Conserva el orden de los pasos, decisiones, integraciones y alternativas sustentadas.",
                "Usa obligatoriamente los siete bloques FLUJO AS-IS, PROBLEMAS IDENTIFICADOS, FLUJO TO-BE, MEJORAS DEL PROCESO, RESULTADOS ESPERADOS, ENTIDADES y RELACIONES.",
                "Dentro de cada flujo usa solo líneas 'Actor o sistema | TIPO | acción', donde TIPO es INICIO, PROCESO, DECISIÓN, SISTEMA o FIN.",
                "No reemplaces actores conocidos por 'Proceso actual' o 'Solución propuesta'.",
                "No inventes carriles, decisiones, entidades, atributos, relaciones ni resultados.",
              ].join(" ")
            : block.sectionKey === "objectives"
        ? [
            "NO resumas Objetivos en una lista incompleta ni cortes frases.",
            "Entrega exactamente un objetivo general, cuatro objetivos específicos cualitativos y tres objetivos específicos cuantitativos.",
            "Los tres cuantitativos deben conservar una dimensión medible sustentada.",
            "Si falta una cifra, meta o línea base, conserva el objetivo completo y deja pendiente únicamente ese dato.",
            "Nunca uses [PENDIENTE POR DEFINIR: objetivo cuantitativo N] como sustituto de un objetivo.",
            "No inventes cifras, porcentajes, tiempos, metas ni líneas base.",
          ].join(" ")
        : block.sectionKey === "problemDescription"
          ? [
              "NO redactes Impactos operacionales como una lista narrativa numerada.",
              "Usa exclusivamente una línea SITUACION_ACTUAL | ... y entre una y cinco líneas IMPACTO | ...",
              "Cada IMPACTO debe ser una consecuencia negativa concreta, completa, distinta y sustentada del AS-IS.",
              "No escribas encabezados de impactos, numeración, viñetas ni números sueltos al final.",
              "No mezcles objetivos, beneficios, mejoras, recomendaciones, solución propuesta ni TO-BE.",
              "Si no existe impacto sustentado, usa IMPACTO | [PENDIENTE POR DEFINIR].",
              "No inventes impactos.",
            ].join(" ")
          : block.sectionKey === "milestones"
            ? [
                LOCAL_ONLY_V2_REQUIREMENTS_HIERARCHY_MARKER,
                "NO resumas ni redactes Requerimientos como prosa o lista libre.",
                "Transforma únicamente la evidencia de esta subunidad al contrato estructurado solicitado.",
                "Empieza directamente con HITO | y usa una línea por elemento.",
                "Nunca generes un HITO sin al menos una HU debajo.",
                "Si una agrupación no tiene una capacidad funcional sustentada, omite ese HITO en lugar de dejarlo vacío.",
                "Cada HU debe quedar dentro de un Hito y contener exactamente COMO, QUIERO, PARA, CONTEXTO y al menos un CA.",
                "PREMISA, SISTEMA y CAMPO son opcionales y solo se incluyen cuando la evidencia los sustenta.",
                "RNF es opcional y solo se incluye cuando exista evidencia no funcional.",
                "No escribas encabezados narrativos como REQUERIMIENTOS FUNCIONALES ni textos del tipo Hito:.",
                "No inventes información ausente; usa [PENDIENTE POR DEFINIR] únicamente en el campo puntual que falte.",
              ].join(" ")
            : `Resume solo los hallazgos necesarios para ${block.title}, una sola vez y sin introducción ni conclusión.`;
  let output;
  try {
    const raw = await client.generate(
      unit.task.prompt +
        `\nSubunidad ${unit.unitNumber}/${unit.unitTotal}. ` +
        `Perfil ${LOCAL_ONLY_V2_SEQUENTIAL_QUALITY_PROFILE}. ` +
        `${generationDirective} ` +
        `${sectionPolicy.instruction} ` +
        `Usa como máximo ${maxContentCharacters} caracteres.`,
      compactSchema,
      undefined,
      {
        sourceId: block.blockId,
        sourceTitle: block.title,
        sourceClassification: "LOCAL_ONLY_V2_SEQUENTIAL",
      },
      signal,
      // No profile: LOCAL_DOCUMENT overrides structuredThinking with LOW.
      {
        structuredTransport: "CHAT",
        structuredThinking: "DISABLED",
        runtimeLimits: {
          ...unit.assessment.runtimeLimits,
          maxOutputTokens: sequentialOutputTokenLimit(
            block.sectionKey,
            unit.assessment.effectiveOutputTokens,
            diagramArtifact,
          ),
        },
      },
    );
    const oversizedRawContent =
      block.sectionKey === "milestones" || diagramArtifact
        ? oversizedRawMicroDraftContent(raw, maxContentCharacters)
        : null;
    if (oversizedRawContent !== null) {
      // The strict parser's own global ceiling would throw before the
      // section-specific check below runs; route directly to the
      // deterministic fallback while the raw payload is still known-valid.
      localOnlyV2Diagnostic("fallback", {
        reason: "RAW_OVERSIZED",
        section: block.sectionKey,
        unit: unit.unitNumber,
        unitTotal: unit.unitTotal,
        maxContentCharacters,
      });
      output = parseLocalOnlyV2MicroDraftModelOutput({
        content: deterministicFallbackContentForUnit(unit, maxContentCharacters),
      });
    } else {
      output = parseLocalOnlyV2MicroDraftModelOutput(raw);
      if (output.content.length > maxContentCharacters) {
        localOnlyV2Diagnostic("fallback", {
          reason: "CONTENT_OVER_MAX",
          section: block.sectionKey,
          unit: unit.unitNumber,
          unitTotal: unit.unitTotal,
          contentCharacters: output.content.length,
          maxContentCharacters,
        });
        output = parseLocalOnlyV2MicroDraftModelOutput({
          content: deterministicFallbackContentForUnit(
            unit,
            maxContentCharacters,
          ),
        });
      }
    }
  } catch (error) {
    if (
      !(error instanceof LocalAiError) ||
      error.code !== "OLLAMA_OUTPUT_TRUNCATED"
    ) {
      throw error;
    }
    localOnlyV2Diagnostic("fallback", {
      reason: "OLLAMA_OUTPUT_TRUNCATED",
      section: block.sectionKey,
      unit: unit.unitNumber,
      unitTotal: unit.unitTotal,
      maxContentCharacters,
    });
    // La evidencia y la trazabilidad ya fueron validadas antes de esta unidad.
    // Si Ollama consume su salida antes de cerrar el JSON, conservamos esa
    // evidencia literalmente para que una sola subunidad no invalide todo el
    // documento ni obligue a regenerar los checkpoints anteriores.
    output = parseLocalOnlyV2MicroDraftModelOutput({
      content: deterministicFallbackContentForUnit(unit, maxContentCharacters),
    });
  }

  if (
    block.sectionKey === "problemDescription" &&
    !hasStructuredProblemDescriptionContract(output.content)
  ) {
    signal?.throwIfAborted();
    try {
      const preservedCurrentState = problemCurrentStateFromContent(
        output.content,
      );
      const repairInstructions = preservedCurrentState
        ? [
            "CORRIGE ÚNICAMENTE LOS IMPACTOS OPERACIONALES.",
            "La Situación actual ya es válida y NO debes volver a redactarla.",
            "Devuelve SOLO entre una y cinco líneas con este formato exacto: IMPACTO | consecuencia completa.",
            "No uses encabezado, numeración, viñetas ni prefijos diferentes de IMPACTO |.",
            "No escribas frases como 'Los impactos operacionales identificados son'.",
            "No dejes números sueltos al final de las frases.",
            "Cada impacto debe ser distinto y estar sustentado por la misma evidencia.",
            "No incluyas solución, objetivo, beneficio, mejora ni TO-BE.",
            "Si no existe ningún impacto sustentado, devuelve exactamente IMPACTO | [PENDIENTE POR DEFINIR].",
            "No inventes impactos.",
          ]
        : [
            "REPARA ÚNICAMENTE LA DESCRIPCIÓN DEL PROBLEMA.",
            "Devuelve una línea SITUACION_ACTUAL | descripción completa y sustentada.",
            "Después devuelve entre una y cinco líneas IMPACTO | consecuencia operacional completa y sustentada.",
            "No uses encabezados adicionales, numeración, viñetas ni números sueltos.",
            "No incluyas solución, objetivo, beneficio, mejora ni TO-BE.",
            "No inventes información.",
          ];

      const repairedRaw = await client.generate(
        [
          unit.task.prompt,
          "",
          LOCAL_ONLY_V2_PROBLEM_DESCRIPTION_REPAIR_MARKER,
          ...repairInstructions,
          "",
          "SALIDA_ANTERIOR_NO_CONFORME",
          output.content,
        ].join("\n"),
        compactSchema,
        undefined,
        {
          sourceId: block.blockId,
          sourceTitle: block.title,
          sourceClassification: "LOCAL_ONLY_V2_SEQUENTIAL",
        },
        signal,
        {
          structuredTransport: "CHAT",
          structuredThinking: "DISABLED",
          runtimeLimits: {
            ...unit.assessment.runtimeLimits,
            maxOutputTokens: sequentialOutputTokenLimit(
              block.sectionKey,
              unit.assessment.effectiveOutputTokens,
              diagramArtifact,
            ),
          },
        },
      );

      const repairedOutput = parseLocalOnlyV2MicroDraftModelOutput(repairedRaw);

      if (preservedCurrentState) {
        const repairedImpacts = problemImpactLinesFromContract(
          repairedOutput.content,
        );
        if (repairedImpacts.length >= 1 && repairedImpacts.length <= 5) {
          const mergedContent = [
            `SITUACION_ACTUAL | ${preservedCurrentState}`,
            ...repairedImpacts.map((impact) => `IMPACTO | ${impact}`),
          ].join("\n");

          if (
            mergedContent.length <= maxContentCharacters &&
            hasStructuredProblemDescriptionContract(mergedContent)
          ) {
            output = parseLocalOnlyV2MicroDraftModelOutput({
              content: mergedContent,
            });
          }
        }
      } else if (
        repairedOutput.content.length <= maxContentCharacters &&
        hasStructuredProblemDescriptionContract(repairedOutput.content)
      ) {
        output = repairedOutput;
      }
    } catch {
      // Reparación localizada solo para problemDescription.
      signal?.throwIfAborted();
    }
  }

  if (
    block.sectionKey === "processFlow" &&
    !diagramArtifact &&
    !hasStructuredProcessFlowContract(output.content)
  ) {
    // Red de seguridad heredada: solo alcanzable si, por alguna razón, una
    // subunidad de processFlow llegara sin diagramArtifact (nunca ocurre en
    // la generación nueva; planLocalOnlyV2ProcessingUnits siempre lo marca).
    // Se conserva únicamente por compatibilidad de lectura, nunca la usa la
    // generación vigente.
    signal?.throwIfAborted();
    try {
      const repairedRaw = await client.generate(
        [
          unit.task.prompt,
          "",
          LOCAL_ONLY_V2_PROCESS_FLOW_REPAIR_MARKER,
          "REPARA ÚNICAMENTE EL PUNTO 6 / DIAGRAMA DE FLUJO DE ESTA SUBUNIDAD.",
          "La salida anterior no cumple el contrato estructurado requerido.",
          "No resumas, no expliques y no uses una lista narrativa genérica.",
          "Devuelve exactamente estos encabezados y en este orden:",
          "FLUJO AS-IS",
          "PROBLEMAS IDENTIFICADOS",
          "FLUJO TO-BE",
          "MEJORAS DEL PROCESO",
          "RESULTADOS ESPERADOS",
          "ENTIDADES",
          "RELACIONES",
          "En FLUJO AS-IS y FLUJO TO-BE usa únicamente líneas:",
          "Actor o sistema | INICIO/PROCESO/DECISIÓN/SISTEMA/FIN | acción concreta",
          "Conserva cada actor o sistema identificado como carril independiente.",
          "Conserva decisiones y alternativas únicamente cuando la evidencia las sustente.",
          "Para ENTIDADES usa: Entidad | atributo:tipo:PK/FK/obligatorio, ...",
          "Para RELACIONES usa: Entidad 1:1/1:N/N:1/N:M Entidad | descripción",
          "Si no hay evidencia suficiente para entidades o relaciones, deja esos bloques vacíos.",
          "No inventes pasos, actores, sistemas, datos, relaciones ni resultados.",
          `Usa como máximo ${maxContentCharacters} caracteres.`,
          "",
          "SALIDA_ANTERIOR_NO_CONFORME",
          output.content,
        ].join("\n"),
        compactSchema,
        undefined,
        {
          sourceId: block.blockId,
          sourceTitle: block.title,
          sourceClassification: "LOCAL_ONLY_V2_SEQUENTIAL",
        },
        signal,
        {
          structuredTransport: "CHAT",
          structuredThinking: "DISABLED",
          runtimeLimits: {
            ...unit.assessment.runtimeLimits,
            maxOutputTokens: sequentialOutputTokenLimit(
              block.sectionKey,
              unit.assessment.effectiveOutputTokens,
              diagramArtifact,
            ),
          },
        },
      );

      const repairedOutput = parseLocalOnlyV2MicroDraftModelOutput(repairedRaw);
      if (
        repairedOutput.content.length <= maxContentCharacters &&
        hasStructuredProcessFlowContract(repairedOutput.content)
      ) {
        output = repairedOutput;
      }
    } catch {
      // Reparación localizada exclusiva de processFlow. Si falla,
      // conserva la salida previa y no afecta otra sección.
      signal?.throwIfAborted();
    }
  }

  // AI_ANALYSIS_LOCAL_ONLY_V2_PROCESS_FLOW_DIAGRAM_VALIDATION_V1
  //
  // Ruta vigente para las tres subunidades de diagramas. Como máximo UNA
  // reparación localizada por artefacto, recibiendo la evidencia original de
  // esta subunidad (ya en unit.task.prompt), la salida anterior no conforme
  // y una lista breve de errores detectados; nunca el documento completo ni
  // otras secciones. Si la reparación no produce una salida válida, no se
  // acepta ni se conserva la salida corrupta: se sustituye por el fallback
  // determinista exclusivo de diagramas (sin otra llamada al modelo). El
  // fallo de un artefacto nunca destruye los otros dos (cada uno vive en su
  // propia subunidad con su propio checkpoint).
  if (block.sectionKey === "processFlow" && diagramArtifact) {
    const isEntityRelationship = diagramArtifact === "ENTITY_RELATIONSHIP";
    const flowHeading: "FLUJO AS-IS" | "FLUJO TO-BE" =
      diagramArtifact === "TO_BE" ? "FLUJO TO-BE" : "FLUJO AS-IS";
    const actorEvidenceHints = isEntityRelationship
      ? []
      : unit.packet.relevantFindings
          .filter((finding) => finding.category === "actors")
          .map((finding) => finding.description);
    const hasArtifactEvidence = hasUsableDiagramEntityEvidence(
      unit.packet.relevantFindings,
    );

    const classify = (content: string) =>
      isEntityRelationship
        ? classifyDiagramErOutput(content, hasArtifactEvidence)
        : classifyDiagramFlowOutput(
            content,
            actorEvidenceHints,
            unit.packet.relevantFindings,
            flowHeading,
          );

    let classification = classify(output.content);

    if (classification.status === "INVALID") {
      signal?.throwIfAborted();
      try {
        const artifactLabel =
          diagramArtifact === "AS_IS"
            ? "FLUJO AS-IS"
            : diagramArtifact === "TO_BE"
              ? "FLUJO TO-BE"
              : "el modelo entidad-relación";
        const contractLines = isEntityRelationship
          ? [
              "ENTIDAD | id | nombre | descripción",
              "ATRIBUTO | entidadId | nombre | tipo de dato | PK/FK/NONE | SI/NO",
              "RELACION | entidadOrigenId | entidadDestinoId | 1:1/1:N/N:1/N:M | descripción",
            ]
          : [
              diagramArtifact === "AS_IS" ? "FLUJO AS-IS" : "FLUJO TO-BE",
              "CARRIL | id | nombre | ACTOR/SYSTEM",
              "NODO | id | idDeCarril | START/PROCESS/DECISION/SYSTEM/END | acción concreta",
              "ARISTA | idOrigen | idDestino | etiqueta",
              diagramArtifact === "AS_IS" ? "PROBLEMA | texto" : "MEJORA | texto",
              ...(diagramArtifact === "TO_BE" ? ["RESULTADO | texto"] : []),
            ];

        const repairedRaw = await client.generate(
          [
            unit.task.prompt,
            "",
            LOCAL_ONLY_V2_PROCESS_FLOW_DIAGRAM_REPAIR_MARKER,
            `REPARA ÚNICAMENTE ${artifactLabel} DE ESTA SUBUNIDAD.`,
            "La salida anterior no cumple el contrato canónico exigido.",
            `Errores detectados: ${classification.issues.join(", ")}.`,
            "Devuelve exclusivamente líneas de este contrato, sin narrativa ni encabezados adicionales:",
            ...contractLines,
            "IDs únicos, sin referencias rotas, sin 'Pregunta:' ni 'Respuesta:'.",
            isEntityRelationship
              ? "No inventes entidades, atributos ni relaciones que la evidencia no sustente."
              : "Cada decisión con más de una salida debe traer una ARISTA por alternativa con etiqueta distinta y no vacía.",
            `Usa como máximo ${maxContentCharacters} caracteres.`,
            "",
            "SALIDA_ANTERIOR_NO_CONFORME",
            output.content,
          ].join("\n"),
          compactSchema,
          undefined,
          {
            sourceId: block.blockId,
            sourceTitle: block.title,
            sourceClassification: "LOCAL_ONLY_V2_SEQUENTIAL",
          },
          signal,
          {
            structuredTransport: "CHAT",
            structuredThinking: "DISABLED",
            runtimeLimits: {
              ...unit.assessment.runtimeLimits,
              maxOutputTokens: sequentialOutputTokenLimit(
                block.sectionKey,
                unit.assessment.effectiveOutputTokens,
                diagramArtifact,
              ),
            },
          },
        );

        const repairedOutput =
          parseLocalOnlyV2MicroDraftModelOutput(repairedRaw);
        if (repairedOutput.content.length <= maxContentCharacters) {
          const repairedClassification = classify(repairedOutput.content);
          if (repairedClassification.status !== "INVALID") {
            output = repairedOutput;
            classification = repairedClassification;
          }
        }
      } catch {
        // Reparación localizada exclusiva de esta subunidad de diagrama. Si
        // falla, conserva la salida previa; el chequeo final decide si
        // necesita el fallback determinista.
        signal?.throwIfAborted();
      }
    }

    if (classification.status === "INVALID") {
      // Una salida corrupta del modelo no se acepta ni se conserva, pero
      // tampoco aborta el documento: se sustituye por el fallback
      // determinista de diagramas construido exclusivamente desde la
      // evidencia ya certificada de esta subunidad. Sin otra llamada al
      // modelo ni otro reintento.
      signal?.throwIfAborted();
      const fallbackContent = deterministicDiagramArtifactFallbackContent(
        unit,
        maxContentCharacters,
      );
      const fallbackOutput = parseLocalOnlyV2MicroDraftModelOutput({
        content: fallbackContent,
      });
      // El respaldo entidad-relación solo puede publicar entidades con un
      // nombre honesto: si ninguna evidencia puede nombrarse, un modelo vacío
      // es el resultado válido (no una violación del invariante).
      const fallbackClassification = isEntityRelationship
        ? classifyDiagramErOutput(
            fallbackOutput.content,
            hasNameableDiagramEntityEvidence(unit.packet.relevantFindings),
          )
        : classify(fallbackOutput.content);
      if (fallbackClassification.status === "INVALID") {
        throw new Error(
          [
            "LOCAL_ONLY_V2_PROCESS_FLOW_DIAGRAM_FALLBACK_INVARIANT_VIOLATION: el fallback determinista del diagrama no produjo una estructura canónica válida para esta subunidad.",
            `artifact=${diagramArtifact}`,
            `unitNumber=${unit.unitNumber}`,
            `findingCount=${unit.packet.relevantFindings.length}`,
            `categories=${[...new Set(unit.packet.relevantFindings.map((finding) => finding.category))].sort().join(",")}`,
            `contentCharacters=${fallbackOutput.content.length}`,
            `maxCharacters=${maxContentCharacters}`,
            `issues=${fallbackClassification.issues.join(",")}`,
          ].join(" "),
        );
      }
      output = fallbackOutput;
    }
  }

  if (
    block.sectionKey === "milestones" &&
    !hasStructuredMilestonesContract(output.content)
  ) {
    signal?.throwIfAborted();
    try {
      const repairedRaw = await client.generate(
        [
          unit.task.prompt,
          "",
          LOCAL_ONLY_V2_MILESTONES_REPAIR_MARKER,
          "REPARA ÚNICAMENTE LA SALIDA DE REQUERIMIENTOS DE ESTA SUBUNIDAD.",
          "La salida anterior no cumple el contrato estructurado requerido.",
          "No resumas, no expliques y no uses viñetas.",
          "Devuelve solo líneas parseables en este orden lógico:",
          "HITO | H-001 | nombre | descripción",
          "HU | HU-F-001 | título breve | descripción funcional",
          "COMO | rol",
          "QUIERO | capacidad",
          "PARA | beneficio",
          "CONTEXTO | situación sustentada",
          "PREMISA | texto  (solo si está sustentada)",
          "SISTEMA | nombre literal  (solo si está sustentado)",
          "CAMPO | nombre | tipo | SI/NO | validación  (solo si está sustentado)",
          "CA | CA-F-001 | dado | cuando | entonces",
          "RNF | RNF-001 | título | descripción | categoría | medida | objetivo | criterio verificable  (solo si está sustentado)",
          LOCAL_ONLY_V2_REQUIREMENTS_HIERARCHY_MARKER,
          "No devuelvas ningún HITO vacío.",
          "Cada HITO que aparezca debe contener al menos una HU antes del siguiente HITO o RNF.",
          "Cada HU debe incluir exactamente COMO, QUIERO, PARA, CONTEXTO y al menos un CA.",
          "Si la evidencia de esta subunidad no sustenta una HU para una agrupación, omite esa agrupación en lugar de inventar la historia.",
          "Los códigos deben ser distintos dentro de esta respuesta; TypeScript hará la canonicalización global al ensamblar.",
          "No inventes datos. Si falta un dato puntual, usa [PENDIENTE POR DEFINIR] solo en ese campo.",
          `Usa como máximo ${maxContentCharacters} caracteres.`,
          "",
          "SALIDA_ANTERIOR_NO_CONFORME",
          output.content,
        ].join("\n"),
        compactSchema,
        undefined,
        {
          sourceId: block.blockId,
          sourceTitle: block.title,
          sourceClassification: "LOCAL_ONLY_V2_SEQUENTIAL",
        },
        signal,
        {
          structuredTransport: "CHAT",
          structuredThinking: "DISABLED",
          runtimeLimits: {
            ...unit.assessment.runtimeLimits,
            maxOutputTokens: sequentialOutputTokenLimit(
              block.sectionKey,
              unit.assessment.effectiveOutputTokens,
              diagramArtifact,
            ),
          },
        },
      );
      const repairedOutput = parseLocalOnlyV2MicroDraftModelOutput(repairedRaw);
      // Una reparación que produce HAS_PENDING_NEEDS es una salida
      // recuperable válida (conserva jerarquía HITO/HU correcta, aunque
      // algunas HU sigan incompletas) y debe reemplazar la salida previa en
      // lugar de descartarse; solo UNPARSEABLE debe rechazarse. Además, la
      // sustitución nunca debe eliminar en silencio un Hito, HU o RNF que ya
      // existía en la salida previa.
      if (
        repairedOutput.content.length <= maxContentCharacters &&
        classifyMilestonesContent(repairedOutput.content) !== "UNPARSEABLE" &&
        repairPreservesExistingMilestonesElements(
          output.content,
          repairedOutput.content,
        )
      ) {
        output = repairedOutput;
      }
    } catch {
      signal?.throwIfAborted();
    }
  }

  if (
    block.sectionKey === "milestones" &&
    unit.packet.relevantFindings.length > 0 &&
    (classifyMilestonesContent(output.content) === "UNPARSEABLE" ||
      milestonesContentHasUnpublishableTitles(output.content))
  ) {
    // Una HU incompleta no es corrupción: el ensamblador la conserva como
    // PENDING_DOCUMENTATION sin inventar datos. Solo llegamos aquí cuando no
    // hay ninguna estructura HITO/HU reconocible, o cuando la jerarquía del
    // contrato está realmente rota (RNF seguido de más HITO/HU), incluso
    // después de la reparación localizada anterior. Una respuesta corrupta
    // del modelo no se acepta ni se conserva: en lugar de abortar todo el
    // documento, se sustituye por el fallback determinista construido
    // exclusivamente desde la evidencia ya certificada de esta subunidad. No
    // se realiza ninguna llamada adicional al modelo ni ningún reintento.
    localOnlyV2Diagnostic("fallback", {
      reason:
        classifyMilestonesContent(output.content) === "UNPARSEABLE"
          ? "MILESTONES_UNPARSEABLE"
          : "MILESTONES_UNPUBLISHABLE_TITLES",
      section: block.sectionKey,
      unit: unit.unitNumber,
      unitTotal: unit.unitTotal,
      contentCharacters: output.content.length,
    });
    signal?.throwIfAborted();
    const fallbackContent = deterministicPendingMilestonesFallbackContent(
      unit,
      maxContentCharacters,
    );
    const fallbackOutput = parseLocalOnlyV2MicroDraftModelOutput({
      content: fallbackContent,
    });
    const fallbackClassification = classifyMilestonesContent(
      fallbackOutput.content,
    );
    // Sin hallazgos funcionales en esta subunidad no se fabrica una HU: el
    // punto queda pendiente y su evidencia se conserva en el paquete.
    const withoutFunctionalEvidence =
      milestonesFallbackFindings(unit).length === 0;
    if (
      !withoutFunctionalEvidence &&
      fallbackClassification !== "HAS_PENDING_NEEDS" &&
      fallbackClassification !== "COMPLETE"
    ) {
      // El propio fallback no cumplió el invariante que garantiza: esto
      // solo puede deberse a un error interno de construcción del fallback,
      // nunca a una salida corrupta del modelo, así que se reporta con un
      // mensaje distinto del rechazo genérico atribuido al modelo.
      throw new Error(
        "LOCAL_ONLY_V2_MILESTONES_FALLBACK_INVARIANT_VIOLATION: el fallback determinista de Requerimientos no produjo una estructura HITO/HU reconocible para esta subunidad.",
      );
    }
    output = fallbackOutput;
  }

  if (
    block.sectionKey === "objectives" &&
    unit.unitNumber === 1 &&
    concreteQualitativeObjectiveCount(output.content) < 4
  ) {
    signal?.throwIfAborted();
    try {
      const repairedRaw = await client.generate(
        [
          unit.task.prompt,
          "",
          LOCAL_ONLY_V2_OBJECTIVES_QUALITATIVE_REPAIR_MARKER,
          "Corrige únicamente la sección Objetivos del proyecto.",
          "La salida anterior no contiene cuatro objetivos específicos cualitativos concretos.",
          "Devuelve nuevamente la sección completa con exactamente tres bloques: Objetivo general, Objetivos específicos cualitativos y Objetivos específicos cuantitativos.",
          "Debes redactar exactamente cuatro objetivos específicos cualitativos distintos y sustentados únicamente en la evidencia del mismo bloque.",
          "Un objetivo cualitativo expresa una mejora o resultado no numérico respaldado; no lo conviertas en cuantitativo solo por usar verbos como reducir, mejorar, aumentar o disminuir.",
          "No uses [PENDIENTE POR DEFINIR] en un objetivo cualitativo si la evidencia permite redactarlo sin inventar.",
          "Conserva el objetivo general y los cuantitativos válidos cuando sigan respaldados.",
          "No inventes cifras, funciones, actores, sistemas ni resultados.",
          "Si realmente no existe evidencia suficiente para cuatro cualitativos, conserva pendiente únicamente el faltante.",
          `Usa como máximo ${maxContentCharacters} caracteres.`,
          "",
          "SALIDA_ANTERIOR",
          output.content,
        ].join("\n"),
        compactSchema,
        undefined,
        {
          sourceId: block.blockId,
          sourceTitle: block.title,
          sourceClassification: "LOCAL_ONLY_V2_SEQUENTIAL",
        },
        signal,
        {
          structuredTransport: "CHAT",
          structuredThinking: "DISABLED",
          runtimeLimits: {
            ...unit.assessment.runtimeLimits,
            maxOutputTokens: sequentialOutputTokenLimit(
              block.sectionKey,
              unit.assessment.effectiveOutputTokens,
              diagramArtifact,
            ),
          },
        },
      );
      const repairedOutput = parseLocalOnlyV2MicroDraftModelOutput(repairedRaw);
      if (
        repairedOutput.content.length <= maxContentCharacters &&
        concreteQualitativeObjectiveCount(repairedOutput.content) >= 4
      ) {
        output = repairedOutput;
      }
    } catch {
      // Reparación localizada de calidad: si falla, conserva la salida válida
      // anterior y no modifica ninguna otra sección.
      signal?.throwIfAborted();
    }
  }

  if (
    block.sectionKey === "objectives" &&
    unit.unitNumber === 1 &&
    concreteQualitativeObjectiveCount(output.content) >= 4 &&
    concreteQuantitativeObjectiveCount(output.content) !== 3
  ) {
    signal?.throwIfAborted();
    try {
      const repairedRaw = await client.generate(
        [
          unit.task.prompt,
          "",
          LOCAL_ONLY_V2_OBJECTIVES_QUANTITATIVE_REPAIR_MARKER,
          "CORRIGE ÚNICAMENTE LOS OBJETIVOS ESPECÍFICOS CUANTITATIVOS.",
          "La salida anterior no contiene exactamente tres objetivos cuantitativos completos y medibles.",
          "No vuelvas a redactar el Objetivo general ni los Objetivos específicos cualitativos.",
          "Devuelve SOLO el bloque 'Objetivos específicos cuantitativos:' seguido de exactamente tres objetivos numerados.",
          "Cada objetivo debe expresar una dimensión medible sustentada por la evidencia del mismo bloque.",
          "Un verbo como reducir, aumentar, incrementar, optimizar o disminuir no convierte por sí solo un objetivo en cuantitativo: debe quedar claro qué se mide.",
          "Si la evidencia identifica qué medir pero no proporciona cifra, meta o línea base, conserva el objetivo completo y agrega en la misma línea '; meta: [PENDIENTE POR DEFINIR]' o '; línea base: [PENDIENTE POR DEFINIR]'.",
          "Nunca devuelvas '[PENDIENTE POR DEFINIR: objetivo cuantitativo N]' como objetivo completo.",
          "No inventes cifras, porcentajes, tiempos, metas, líneas base, actores, sistemas ni resultados.",
          "No dejes frases cortadas o terminadas en conectores como 'por', 'para', 'con', 'de' o 'y'.",
          "",
          "SALIDA_ANTERIOR_DE_OBJETIVOS",
          output.content,
        ].join("\n"),
        compactSchema,
        undefined,
        {
          sourceId: block.blockId,
          sourceTitle: block.title,
          sourceClassification: "LOCAL_ONLY_V2_SEQUENTIAL",
        },
        signal,
        {
          structuredTransport: "CHAT",
          structuredThinking: "DISABLED",
          runtimeLimits: {
            ...unit.assessment.runtimeLimits,
            maxOutputTokens: sequentialOutputTokenLimit(
              block.sectionKey,
              unit.assessment.effectiveOutputTokens,
              diagramArtifact,
            ),
          },
        },
      );

      const repairedOutput = parseLocalOnlyV2MicroDraftModelOutput(repairedRaw);
      const repairedQuantitativeBlock = normalizedQuantitativeObjectiveBlock(
        repairedOutput.content,
      );

      if (repairedQuantitativeBlock) {
        const mergedContent = replaceQuantitativeObjectiveBlock(
          output.content,
          repairedQuantitativeBlock,
        );

        if (
          mergedContent.length <= maxContentCharacters &&
          concreteQualitativeObjectiveCount(mergedContent) >= 4 &&
          concreteQuantitativeObjectiveCount(mergedContent) === 3
        ) {
          output = parseLocalOnlyV2MicroDraftModelOutput({
            content: mergedContent,
          });
        }
      }
    } catch {
      signal?.throwIfAborted();
    }
  }

  // AI_ANALYSIS_LOCAL_ONLY_V2_TEXT_HYGIENE_V1: caracteres ajenos, Markdown y
  // cortes evidentes se corrigen antes de persistir el punto.
  const finalContent = enrichLocalOnlyV2SectionContent(
    block.sectionKey,
    sanitizeLocalOnlyV2GeneratedContent(output.content, maxContentCharacters) ||
      "[PENDIENTE POR DEFINIR]",
    unit,
    maxContentCharacters,
  );
  localOnlyV2Diagnostic("unit", {
    section: block.sectionKey,
    unit: unit.unitNumber,
    unitTotal: unit.unitTotal,
    rawCharacters: output.content.length,
    finalCharacters: finalContent.length,
    maxContentCharacters,
    filledBudget: output.content.length >= maxContentCharacters - 2,
    sanitizedAway: output.content.length - finalContent.length,
  });
  const value = {
    pipelineId: "LOCAL_ONLY_V2" as const,
    schemaVersion: LOCAL_ONLY_V2_MICRO_DRAFT_SCHEMA_VERSION,
    taskId: unit.task.taskId,
    blockId: block.blockId,
    sectionKey: block.sectionKey,
    blockNumber: block.blockNumber,
    blockTotal: block.blockTotal,
    required: block.required,
    content: finalContent,
    contentCharacters: finalContent.length,
    estimatedContentTokens: Math.max(1, Math.ceil(finalContent.length / 4)),
    evidenceFingerprint: unit.packet.fingerprint,
    templatePlanFingerprint: plan.planFingerprint,
    selectedFindingIds: unit.packet.selectedFindingIds,
    sourceIds: unit.packet.sourceIds,
    segmentIds: unit.packet.segmentIds,
    questionnaireFindingCount: unit.packet.metrics.questionnaireFindingCount,
  };
  const draft = { ...value, fingerprint: localOnlyV2Fingerprint(value) };
  const validation = validateLocalOnlyV2MicroDraft(draft, plan, unit.packet);
  if (!validation.valid)
    throw new Error(
      `Punto inválido: ${validation.issues.map((issue) => issue.code).join(", ")}`,
    );
  return draft;
}
