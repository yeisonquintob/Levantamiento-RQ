import { requireDefined } from "../common/require-defined";

export function normalizedTextReference(value: string): string {
  return value.trim().replaceAll(/\s+/gu, " ").toLocaleLowerCase("es");
}

export function normalizedObjectiveReference(value: string): string {
  return normalizedTextReference(value)
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/gu, "")
    .replaceAll(/[^a-z0-9]+/gu, " ")
    .trim();
}

const OBJECTIVE_REFERENCE_STOP_WORDS = new Set([
  "como",
  "con",
  "del",
  "desde",
  "el",
  "en",
  "la",
  "las",
  "los",
  "para",
  "por",
  "que",
  "una",
  "uno",
]);

/*
 * KPI_SAFE_CANONICALIZATION_V7_4_3
 *
 * `relatedObjective` debe terminar apuntando al texto canónico de uno de los
 * objetivos específicos generados. Structured Outputs no puede expresar un
 * enum dinámico basado en otro campo de la misma respuesta, por lo que el
 * proveedor puede devolver una paráfrasis mínima.
 *
 * Esta reconciliación es deliberadamente conservadora:
 * - exacto / normalizado: se acepta;
 * - variaciones morfológicas simples y expansión textual: solo si existe UN
 *   candidato claramente superior;
 * - cero candidatos o empate/ambigüedad: fail-closed.
 *
 * No se usan sinónimos, embeddings ni inferencia semántica para evitar que el
 * backend invente relaciones entre KPI y objetivos.
 */
function objectiveReferenceTokenKey(token: string): string {
  if (token.length < 4) return token;

  if (token.endsWith("ciones") && token.length > 7) {
    return `${token.slice(0, -6)}cion`;
  }
  if (token.endsWith("siones") && token.length > 7) {
    return `${token.slice(0, -6)}sion`;
  }
  if (token.endsWith("udes") && token.length > 5) {
    return `${token.slice(0, -4)}ud`;
  }
  if (token.endsWith("ades") && token.length > 5) {
    return `${token.slice(0, -4)}ad`;
  }
  if (token.endsWith("ores") && token.length > 5) {
    return `${token.slice(0, -4)}or`;
  }
  if (token.endsWith("ales") && token.length > 5) {
    return `${token.slice(0, -4)}al`;
  }
  if (token.endsWith("es") && token.length > 5) {
    const beforeEnding = token.at(-3) ?? "";
    if (!/[aeiou]/u.test(beforeEnding)) {
      return token.slice(0, -2);
    }
  }
  if (token.endsWith("s") && token.length > 4) {
    return token.slice(0, -1);
  }
  return token;
}

function objectiveReferenceTokens(value: string): Set<string> {
  return new Set(
    normalizedObjectiveReference(value)
      .split(" ")
      .filter(
        (token) =>
          token.length >= 3 && !OBJECTIVE_REFERENCE_STOP_WORDS.has(token),
      )
      .map(objectiveReferenceTokenKey)
      .filter((token) => token.length >= 3),
  );
}

/*
 * AI_KPI_OBJECTIVE_THREE_WAY_CLASSIFICATION_V1
 *
 * Distingue tres resultados que antes se mezclaban en una lista vacía:
 * - NONE: ningún objetivo comparte lo suficiente (se puede pedir un reintento
 *   localizado porque no hay una elección que el modelo vaya a "desempatar").
 * - SINGLE: exactamente una coincidencia segura (se canonicaliza sin llamar al
 *   proveedor).
 * - AMBIGUOUS: dos o más objetivos igualmente plausibles (falla cerrado y NO se
 *   reintenta: cualquier valor que el modelo escogiera sería arbitrario).
 */
type ObjectiveReferenceMatch =
  | { readonly status: "NONE" }
  | { readonly status: "AMBIGUOUS" }
  | { readonly status: "SINGLE"; readonly objective: string };

export function classifyFuzzyObjectiveReference(
  value: string,
  objectives: readonly string[],
): ObjectiveReferenceMatch {
  const referenceTokens = objectiveReferenceTokens(value);
  if (referenceTokens.size < 2) return { status: "NONE" };

  const ranked = objectives
    .map((objective) => {
      const objectiveTokens = objectiveReferenceTokens(objective);
      const commonTokens = [...referenceTokens].filter((token) =>
        objectiveTokens.has(token),
      ).length;
      const smallerSetSize = Math.min(
        referenceTokens.size,
        objectiveTokens.size,
      );
      const unionSize = new Set([...referenceTokens, ...objectiveTokens]).size;
      const coverage = smallerSetSize === 0 ? 0 : commonTokens / smallerSetSize;
      const jaccard = unionSize === 0 ? 0 : commonTokens / unionSize;
      const score = coverage * 0.65 + jaccard * 0.35;

      return {
        objective,
        commonTokens,
        coverage,
        jaccard,
        score,
      };
    })
    .filter(
      (candidate) =>
        candidate.commonTokens >= 2 &&
        candidate.coverage >= 0.75 &&
        (candidate.jaccard >= 0.35 || candidate.coverage === 1),
    )
    .sort((left, right) => right.score - left.score);

  if (ranked.length === 0) return { status: "NONE" };

  const best = requireDefined(
    ranked[0],
    "Invariante: existe al menos un candidato clasificado.",
  );
  const second = ranked[1];

  /*
   * Un candidato debe ser inequívoco. Si hay otro objetivo casi igual de
   * plausible, no se adivina: el parser conserva el comportamiento fail-closed.
   */
  if (second && best.score - second.score < 0.18) {
    return { status: "AMBIGUOUS" };
  }

  return { status: "SINGLE", objective: best.objective };
}

export type KpiObjectiveFailureReason = "NO_MATCH" | "AMBIGUOUS";

export interface KpiObjectiveFailure {
  readonly kpiIndex: number;
  readonly reason: KpiObjectiveFailureReason;
}

/**
 * Error tipado del parser: un KPI no referencia de forma inequívoca un objetivo
 * específico. `failures` conserva, KPI por KPI, si no hubo coincidencia segura
 * o si hubo varias plausibles, para que el proveedor decida SIN depender del
 * texto del mensaje. El mensaje conserva el formato histórico.
 */
export class KpiObjectiveReferenceError extends Error {
  constructor(readonly failures: readonly KpiObjectiveFailure[]) {
    const first = failures[0];
    super(
      `scope.kpis[${first?.kpiIndex ?? 0}].relatedObjective no referencia de forma inequívoca un objetivo específico cualitativo o cuantitativo generado.`,
    );
    this.name = "KpiObjectiveReferenceError";
  }

  /** Solo es reparable si NINGÚN KPI es ambiguo. */
  get repairable(): boolean {
    return (
      this.failures.length > 0 &&
      this.failures.every((failure) => failure.reason === "NO_MATCH")
    );
  }

  get noMatchIndexes(): number[] {
    return this.failures
      .filter((failure) => failure.reason === "NO_MATCH")
      .map((failure) => failure.kpiIndex);
  }
}
