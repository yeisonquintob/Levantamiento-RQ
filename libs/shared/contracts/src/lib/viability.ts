export interface ViabilityCriterion {
  id: string;
  level: number;
  minimumPercentage: number;
  maximumPercentage: number;
  name: string;
  description: string;
  recommendation: string;
  viable: boolean;
  order: number;
  active: boolean;
}

export interface ViabilityConfiguration {
  criteria: ViabilityCriterion[];
  discrepancyThreshold: number;
}

export interface ViabilityEvaluation {
  percentage: number;
  criterionId: string;
  level: number;
  name: string;
  description: string;
  recommendation: string;
  viable: boolean;
}

export interface DiscussionAnswerEvidence {
  answer: string;
  definitionPercentage: number;
}

export interface DiscussionOriginViability {
  generated: number;
  usable: number;
  requiresReview: number;
  gaps: number;
  definitionPercentage: number;
  evaluation: ViabilityEvaluation;
}

export interface DiscussionViabilitySummary {
  manual: DiscussionOriginViability;
  local: DiscussionOriginViability;
  cloud: DiscussionOriginViability;
  consolidated: DiscussionOriginViability;
  discrepancyPoints: number;
  hasSignificantDiscrepancy: boolean;
}

export interface DiscussionViabilityInput {
  questionIds: readonly string[];
  manual: Readonly<Record<string, DiscussionAnswerEvidence | undefined>>;
  local: Readonly<Record<string, DiscussionAnswerEvidence | undefined>>;
  cloud: Readonly<Record<string, DiscussionAnswerEvidence | undefined>>;
  criteria: readonly ViabilityCriterion[];
  discrepancyThreshold: number;
}

function clampPercentage(value: number): number {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
}

function normalizedText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").trim().toLowerCase().replace(/\s+/gu, " ");
}

const INSUFFICIENT_PATTERNS = [
  /(?:informacion|evidencia) insuficiente/u,
  /no (?:hay|existe|se encuentra|se encontro) (?:informacion|evidencia)/u,
  /no (?:fue|es) posible determinar/u,
  /no se puede determinar/u,
  /sin (?:informacion|evidencia) suficiente/u,
  /pendiente por definir/u,
];

/** Clasificación local y determinística; no realiza llamadas a IA. */
export function isInsufficientDiscussionAnswer(value: unknown): boolean {
  if (typeof value !== "string") return true;
  const text = normalizedText(value);
  if (text.length < 20 || text.split(" ").length < 4) return true;
  return INSUFFICIENT_PATTERNS.some((pattern) => pattern.test(text));
}

export function validateViabilityCriteria(criteria: readonly ViabilityCriterion[]): string[] {
  const errors: string[] = [];
  const active = criteria.filter((item) => item.active).sort((a, b) => a.minimumPercentage - b.minimumPercentage);
  if (active.length === 0) return ["Debe existir al menos un criterio activo."];
  for (const item of active) {
    if (!Number.isInteger(item.minimumPercentage) || !Number.isInteger(item.maximumPercentage)) errors.push(`El rango de ${item.name} debe usar enteros.`);
    if (item.minimumPercentage < 0 || item.maximumPercentage > 100 || item.minimumPercentage > item.maximumPercentage) errors.push(`El rango de ${item.name} no es válido.`);
    if (!item.name.trim() || !item.description.trim() || !item.recommendation.trim()) errors.push(`El criterio de nivel ${item.level} tiene campos obligatorios vacíos.`);
  }
  if (active[0]?.minimumPercentage !== 0) errors.push("Los criterios activos deben comenzar en 0%.");
  if (active.at(-1)?.maximumPercentage !== 100) errors.push("Los criterios activos deben terminar en 100%.");
  for (let index = 1; index < active.length; index += 1) {
    if (active[index].minimumPercentage !== active[index - 1].maximumPercentage + 1) errors.push(`Existe un vacío o solapamiento entre ${active[index - 1].name} y ${active[index].name}.`);
  }
  return errors;
}

export function evaluateViability(percentage: number, criteria: readonly ViabilityCriterion[]): ViabilityEvaluation {
  const normalized = clampPercentage(percentage);
  const criterion = criteria.filter((item) => item.active).sort((a, b) => a.order - b.order).find((item) => normalized >= item.minimumPercentage && normalized <= item.maximumPercentage);
  if (!criterion) throw new Error(`No existe un criterio de viabilidad activo para ${normalized}%.`);
  return { percentage: normalized, criterionId: criterion.id, level: criterion.level, name: criterion.name, description: criterion.description, recommendation: criterion.recommendation, viable: criterion.viable };
}

function evaluateOrigin(questionIds: readonly string[], answers: Readonly<Record<string, DiscussionAnswerEvidence | undefined>>, criteria: readonly ViabilityCriterion[]): DiscussionOriginViability {
  const evidence = questionIds.map((id) => answers[id]).filter((item): item is DiscussionAnswerEvidence => Boolean(item));
  const generated = evidence.filter((item) => item.answer.trim().length > 0).length;
  const usableEvidence = evidence.filter((item) => !isInsufficientDiscussionAnswer(item.answer));
  const definitionPercentage = questionIds.length === 0 ? 0 : clampPercentage(usableEvidence.reduce((sum, item) => sum + clampPercentage(item.definitionPercentage), 0) / questionIds.length);
  return { generated, usable: usableEvidence.length, requiresReview: generated - usableEvidence.length, gaps: questionIds.length - usableEvidence.length, definitionPercentage, evaluation: evaluateViability(definitionPercentage, criteria) };
}

export function evaluateDiscussionViability(input: DiscussionViabilityInput): DiscussionViabilitySummary {
  const manual = evaluateOrigin(input.questionIds, input.manual, input.criteria);
  const local = evaluateOrigin(input.questionIds, input.local, input.criteria);
  const cloud = evaluateOrigin(input.questionIds, input.cloud, input.criteria);
  const consolidatedAnswers: Record<string, DiscussionAnswerEvidence> = {};
  for (const id of input.questionIds) {
    const candidates = [input.manual[id], input.local[id], input.cloud[id]].filter((item): item is DiscussionAnswerEvidence => item !== undefined && !isInsufficientDiscussionAnswer(item.answer));
    const best = candidates.sort((a, b) => b.definitionPercentage - a.definitionPercentage)[0];
    if (best) consolidatedAnswers[id] = best;
  }
  const consolidated = evaluateOrigin(input.questionIds, consolidatedAnswers, input.criteria);
  const available = [manual, local, cloud].filter((item) => item.generated > 0).map((item) => item.definitionPercentage);
  const discrepancyPoints = available.length < 2 ? 0 : Math.max(...available) - Math.min(...available);
  return { manual, local, cloud, consolidated, discrepancyPoints, hasSignificantDiscrepancy: discrepancyPoints >= clampPercentage(input.discrepancyThreshold) };
}
