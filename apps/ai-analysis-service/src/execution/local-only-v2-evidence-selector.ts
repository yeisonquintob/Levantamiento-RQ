// LOCAL_ONLY_V2_09_EVIDENCE_SELECTOR
//
// Selección determinística y genérica de evidencia por bloque.
//
// Principios:
// - no usa un mapa blockKey -> categorías;
// - no envía el índice completo a cada bloque;
// - combina intención del bloque (key/título/guidance) con categoría,
//   descripción y evidencia literal;
// - contradicciones, pendientes y advertencias viajan como guardas separadas;
// - conserva trazabilidad exacta;
// - no llama IA;
// - no construye todavía el micro-borrador.
//
// La selección lexical es deliberadamente simple y auditable. Paso 10 recibe
// únicamente este paquete compacto; Paso 15 verificará cobertura global.

import { createHash } from "node:crypto";

import {
  LOCAL_AI_CATEGORIES,
  type LocalAiCategory,
} from "../local-ai/local-ai-output";
import type {
  LocalOnlyV2KnowledgeIndex,
  LocalOnlyV2KnowledgeSegment,
} from "./local-only-v2-knowledge-index";
import type {
  LocalOnlyV2FindingOccurrence,
  LocalOnlyV2NormalizedFinding,
} from "./local-only-v2-normalizer";
import type { LocalOnlyV2DiagramArtifact } from "./local-only-v2-diagram-contract";
import type {
  LocalOnlyV2TemplateGenerationBlock,
  LocalOnlyV2TemplateGenerationPlan,
} from "./local-only-v2-template-planner";

export type { LocalOnlyV2DiagramArtifact };

export const LOCAL_ONLY_V2_EVIDENCE_SELECTION_SCHEMA_VERSION = "1.0.0" as const;

export const LOCAL_ONLY_V2_TRANSVERSAL_GUARD_CATEGORIES = [
  "contradictions",
  "pendingQuestions",
  "warnings",
] as const satisfies readonly LocalAiCategory[];

export interface LocalOnlyV2EvidenceSelectionPolicy {
  readonly maxRelevantFindingsPerBlock: number;
  readonly maxGuardFindingsPerBlock: number;
  readonly maxOccurrencesPerFinding: number;
  readonly minimumRelevantScore: number;
}

export const LOCAL_ONLY_V2_DEFAULT_EVIDENCE_SELECTION_POLICY: LocalOnlyV2EvidenceSelectionPolicy =
  Object.freeze({
    maxRelevantFindingsPerBlock: 24,
    maxGuardFindingsPerBlock: 9,
    maxOccurrencesPerFinding: 2,
    minimumRelevantScore: 1,
  });

export interface LocalOnlyV2EvidenceOccurrence {
  readonly sourceId: string;
  readonly sourceTitle: string;
  readonly sourcePosition: number;
  readonly segmentId: string;
  readonly segmentIndex: number;
  readonly evidenceText: string;
  readonly evidenceStartCharacter: number;
  readonly evidenceEndCharacter: number;
  readonly mandatoryQuestionnaireEvidence: boolean;
}

export interface LocalOnlyV2SelectedFinding {
  readonly canonicalId: string;
  readonly category: LocalAiCategory;
  readonly description: string;
  readonly selectionScore: number;
  readonly sourceIds: readonly string[];
  readonly segmentIds: readonly string[];
  readonly mandatoryQuestionnaireEvidence: boolean;
  readonly occurrenceCount: number;
  readonly occurrences: readonly LocalOnlyV2EvidenceOccurrence[];
}

export interface LocalOnlyV2BlockEvidenceMetrics {
  readonly relevantFindingCount: number;
  readonly guardFindingCount: number;
  readonly totalFindingCount: number;
  readonly questionnaireFindingCount: number;
  readonly sourceCount: number;
  readonly segmentCount: number;
  readonly evidenceCharacterCount: number;
  readonly estimatedEvidenceTokens: number;
}

export interface LocalOnlyV2BlockEvidencePacket {
  readonly pipelineId: "LOCAL_ONLY_V2";
  readonly schemaVersion: typeof LOCAL_ONLY_V2_EVIDENCE_SELECTION_SCHEMA_VERSION;
  readonly projectId: string;
  readonly knowledgeFingerprint: string;
  readonly templatePlanFingerprint: string;
  readonly blockId: string;
  readonly blockNumber: number;
  readonly blockTotal: number;
  readonly sectionKey: string;
  readonly title: string;
  readonly required: boolean;
  readonly guidance: string;
  readonly relevantFindings: readonly LocalOnlyV2SelectedFinding[];
  readonly guardFindings: readonly LocalOnlyV2SelectedFinding[];
  readonly selectedFindingIds: readonly string[];
  readonly sourceIds: readonly string[];
  readonly segmentIds: readonly string[];
  readonly metrics: LocalOnlyV2BlockEvidenceMetrics;
  readonly fingerprint: string;
  readonly diagramArtifact?: LocalOnlyV2DiagramArtifact;
}

export interface LocalOnlyV2EvidenceSelectionPlan {
  readonly pipelineId: "LOCAL_ONLY_V2";
  readonly schemaVersion: typeof LOCAL_ONLY_V2_EVIDENCE_SELECTION_SCHEMA_VERSION;
  readonly projectId: string;
  readonly knowledgeFingerprint: string;
  readonly templatePlanFingerprint: string;
  readonly policy: LocalOnlyV2EvidenceSelectionPolicy;
  readonly blocks: readonly LocalOnlyV2BlockEvidencePacket[];
}

const STOP_WORDS = new Set([
  "a",
  "al",
  "algo",
  "ante",
  "como",
  "con",
  "contra",
  "de",
  "del",
  "desde",
  "debe",
  "deben",
  "describir",
  "documentar",
  "el",
  "ella",
  "ellos",
  "en",
  "entre",
  "es",
  "esta",
  "este",
  "estos",
  "la",
  "las",
  "lo",
  "los",
  "para",
  "por",
  "que",
  "se",
  "segun",
  "ser",
  "sin",
  "sobre",
  "su",
  "sus",
  "sistema",
  "sistemas",
  "un",
  "una",
  "unas",
  "unos",
  "y",
  "the",
  "of",
  "to",
  "and",
  "or",
  "for",
  "with",
  "from",
]);

const CATEGORY_TERMS: Readonly<Record<LocalAiCategory, readonly string[]>> =
  Object.freeze({
    actors: [
      "actor",
      "actores",
      "usuario",
      "usuarios",
      "rol",
      "roles",
      "responsable",
      "responsables",
      "area",
      "equipo",
      "stakeholder",
    ],
    problems: [
      "problema",
      "problemas",
      "error",
      "errores",
      "falla",
      "fallas",
      "reproceso",
      "reprocesos",
      "dolor",
      "impacto",
      "incidente",
    ],
    needs: [
      "necesidad",
      "necesidades",
      "objetivo",
      "objetivos",
      "resultado",
      "mejora",
      "beneficio",
      "expectativa",
    ],
    facts: [
      "hecho",
      "hechos",
      "dato",
      "datos",
      "contexto",
      "antecedente",
      "antecedentes",
      "situacion",
      "informacion",
    ],
    currentProcesses: [
      "actual",
      "as",
      "is",
      "proceso",
      "procesos",
      "flujo",
      "manual",
      "hoy",
      "actividad",
      "actividades",
    ],
    expectedProcesses: [
      "futuro",
      "to",
      "be",
      "esperado",
      "propuesto",
      "proceso",
      "flujo",
      "automatizado",
      "automatizacion",
    ],
    functionalRequirements: [
      "requisito",
      "requisitos",
      "requerimiento",
      "requerimientos",
      "funcional",
      "funcionales",
      "funcionalidad",
      "funcionalidades",
      "sistema",
      "debera",
    ],
    nonFunctionalRequirements: [
      "no",
      "funcional",
      "rendimiento",
      "seguridad",
      "disponibilidad",
      "accesibilidad",
      "compatibilidad",
      "continuidad",
      "capacidad",
      "latencia",
    ],
    businessRules: [
      "regla",
      "reglas",
      "negocio",
      "validacion",
      "validaciones",
      "condicion",
      "condiciones",
      "politica",
      "restriccion",
    ],
    entities: [
      "entidad",
      "entidades",
      "campo",
      "campos",
      "dato",
      "datos",
      "registro",
      "registros",
      "modelo",
      "atributo",
    ],
    integrations: [
      "integracion",
      "integraciones",
      "interfaz",
      "interfaces",
      "api",
      "servicio",
      "sistema",
      "origen",
      "destino",
      "erp",
      "sap",
    ],
    risks: [
      "riesgo",
      "riesgos",
      "amenaza",
      "impacto",
      "mitigacion",
      "dependencia",
      "bloqueo",
      "contingencia",
    ],
    decisions: [
      "decision",
      "decisiones",
      "acuerdo",
      "acuerdos",
      "definido",
      "aprobacion",
      "aprobado",
      "eleccion",
    ],
    contradictions: [
      "contradiccion",
      "contradicciones",
      "conflicto",
      "conflictos",
      "inconsistencia",
      "discrepancia",
    ],
    pendingQuestions: [
      "pendiente",
      "pendientes",
      "pregunta",
      "preguntas",
      "definir",
      "confirmar",
      "aclarar",
      "faltante",
    ],
    warnings: [
      "advertencia",
      "advertencias",
      "alerta",
      "alertas",
      "precaucion",
      "cuidado",
      "observacion",
    ],
  });

const GUARD_CATEGORY_SET = new Set<LocalAiCategory>(
  LOCAL_ONLY_V2_TRANSVERSAL_GUARD_CATEGORIES,
);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeText(value: string): string {
  return value
    .replace(/([a-záéíóúñ0-9])([A-ZÁÉÍÓÚÑ])/gu, "$1 $2")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("es")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function tokens(value: string): readonly string[] {
  if (!value.trim()) return [];
  return [
    ...new Set(
      normalizeText(value)
        .split(" ")
        .filter((token) => token.length >= 2 && !STOP_WORDS.has(token)),
    ),
  ];
}

function tokenSet(value: string): ReadonlySet<string> {
  return new Set(tokens(value));
}

function intersectionCount(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): number {
  let count = 0;
  for (const token of left) {
    if (right.has(token)) count += 1;
  }
  return count;
}

function queryTerms(
  block: LocalOnlyV2TemplateGenerationBlock,
): ReadonlySet<string> {
  const semanticExpansions: Readonly<Record<string, string>> = {
    encabezado: "proyecto codigo titulo area responsable estado fecha",
    objetivo: "resultado mejora beneficio indicador linea base",
    objetivos: "resultado mejora beneficio indicador linea base",
    problema: "impacto demora error riesgo situacion actual",
    alcance: "incluye excluye entregable etapa restriccion dependencia",
    solucion: "proceso futuro automatizacion componente integracion",
    // AI_ANALYSIS_LOCAL_ONLY_V2_PROCESS_FLOW_DIAGRAM_QUERY_EXPANSION_V1
    //
    // El punto 6 necesita, a la vez, evidencia de actores/procesos/problemas
    // (AS-IS), procesos/reglas/requisitos futuros (TO-BE) y entidades del
    // modelo de datos (ER). Sin estos términos, un hallazgo de categoría
    // "entities" o "problems" puede puntuar 0 frente al bloque de
    // processFlow simplemente porque su descripción no repite literalmente
    // palabras como "flujo" o "diagrama".
    diagrama:
      "flujo proceso actual futuro actor decision estado integracion problema riesgo dolor regla entidad relacion atributo campo clave registro documento cardinalidad modelo datos requisito funcionalidad sistema",
    flujo:
      "proceso actual futuro actor decision estado integracion problema riesgo dolor regla entidad relacion atributo campo clave registro documento cardinalidad modelo datos requisito funcionalidad sistema",
    requerimientos:
      "requisito funcional funcionalidad historia usuario criterio aceptacion",
    esquema: "epic feature historia usuario tarea funcionalidad requerimiento",
    pruebas: "escenario caso error excepcion resultado esperado aceptacion",
    supuestos: "dependencia pendiente pregunta riesgo restriccion",
    aprobaciones: "rechazo cambio version responsable autorizacion",
    plantilla: "redaccion terminologia regla claridad",
    prototipo:
      "pantalla formulario consulta filtro busqueda carga adjunto interfaz visual diagrama",
    kpis: "indicador metrica reporte exportacion medicion linea base meta",
    plan: "sprint trabajo tarea entregable dependencia prueba riesgo cierre",
  };
  const base = [block.sectionKey, block.title, block.guidance]
    .filter(Boolean)
    .join(" ");
  const expanded = tokens(base)
    .map((token) => semanticExpansions[token] ?? "")
    .filter(Boolean)
    .join(" ");
  return tokenSet([base, expanded].filter(Boolean).join(" "));
}

function categoryTokenSet(category: LocalAiCategory): ReadonlySet<string> {
  return new Set(CATEGORY_TERMS[category].flatMap((term) => tokens(term)));
}

function findingScore(
  blockTerms: ReadonlySet<string>,
  finding: LocalOnlyV2NormalizedFinding,
): number {
  const categoryOverlap = intersectionCount(
    blockTerms,
    categoryTokenSet(finding.category),
  );
  const descriptionOverlap = intersectionCount(
    blockTerms,
    tokenSet(finding.description),
  );
  const evidenceOverlap = intersectionCount(
    blockTerms,
    tokenSet(
      finding.occurrences
        .map((occurrence) => occurrence.evidenceText)
        .join(" "),
    ),
  );

  const baseScore =
    categoryOverlap * 5 + descriptionOverlap * 4 + evidenceOverlap * 2;

  return baseScore > 0 && finding.mandatoryQuestionnaireEvidence
    ? baseScore + 1
    : baseScore;
}

function validatePolicy(
  policy: LocalOnlyV2EvidenceSelectionPolicy,
): LocalOnlyV2EvidenceSelectionPolicy {
  const integers: ReadonlyArray<
    readonly [keyof LocalOnlyV2EvidenceSelectionPolicy, number, number]
  > = [
    ["maxRelevantFindingsPerBlock", policy.maxRelevantFindingsPerBlock, 1],
    ["maxGuardFindingsPerBlock", policy.maxGuardFindingsPerBlock, 0],
    ["maxOccurrencesPerFinding", policy.maxOccurrencesPerFinding, 1],
    ["minimumRelevantScore", policy.minimumRelevantScore, 1],
  ];

  for (const [name, value, minimum] of integers) {
    if (!Number.isInteger(value) || value < minimum) {
      throw new Error(
        `LOCAL_ONLY_V2 recibió una política inválida en ${name}.`,
      );
    }
  }

  return Object.freeze({ ...policy });
}

function compareScored(
  left: Readonly<{ finding: LocalOnlyV2NormalizedFinding; score: number }>,
  right: Readonly<{ finding: LocalOnlyV2NormalizedFinding; score: number }>,
): number {
  return (
    right.score - left.score ||
    left.finding.sequence - right.finding.sequence ||
    left.finding.canonicalId.localeCompare(right.finding.canonicalId)
  );
}

function occurrenceRef(
  occurrence: LocalOnlyV2FindingOccurrence,
): LocalOnlyV2EvidenceOccurrence {
  return Object.freeze({
    sourceId: occurrence.sourceId,
    sourceTitle: occurrence.sourceTitle,
    sourcePosition: occurrence.sourcePosition,
    segmentId: occurrence.segmentId,
    segmentIndex: occurrence.segmentIndex,
    evidenceText: occurrence.evidenceText,
    evidenceStartCharacter: occurrence.evidenceStartCharacter,
    evidenceEndCharacter: occurrence.evidenceEndCharacter,
    mandatoryQuestionnaireEvidence: occurrence.mandatoryQuestionnaireEvidence,
  });
}

function selectedFinding(
  finding: LocalOnlyV2NormalizedFinding,
  score: number,
  maxOccurrences: number,
): LocalOnlyV2SelectedFinding {
  return Object.freeze({
    canonicalId: finding.canonicalId,
    category: finding.category,
    description: finding.description,
    selectionScore: score,
    sourceIds: finding.sourceIds,
    segmentIds: finding.segmentIds,
    mandatoryQuestionnaireEvidence: finding.mandatoryQuestionnaireEvidence,
    occurrenceCount: finding.occurrenceCount,
    occurrences: Object.freeze(
      finding.occurrences.slice(0, maxOccurrences).map(occurrenceRef),
    ),
  });
}

function uniqueInOrder(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)]);
}

function validateKnowledgePlanCompatibility(
  plan: LocalOnlyV2TemplateGenerationPlan,
  knowledge: LocalOnlyV2KnowledgeIndex,
): void {
  if (
    plan.pipelineId !== "LOCAL_ONLY_V2" ||
    knowledge.pipelineId !== "LOCAL_ONLY_V2"
  ) {
    throw new Error(
      "El selector de evidencia acepta únicamente artefactos LOCAL_ONLY_V2.",
    );
  }
  if (plan.knowledge.projectId !== knowledge.projectId) {
    throw new Error(
      "LOCAL_ONLY_V2 detectó projectId distinto entre plan e índice.",
    );
  }
  if (
    plan.knowledge.fingerprint !== knowledge.fingerprint ||
    plan.knowledge.canonicalFindingCount !==
      knowledge.metrics.canonicalFindingCount
  ) {
    throw new Error(
      "LOCAL_ONLY_V2 detectó que el plan de plantilla referencia otro índice de conocimiento.",
    );
  }

  const knownCategories = new Set<string>(LOCAL_AI_CATEGORIES);
  for (const finding of knowledge.findings) {
    if (!knownCategories.has(finding.category)) {
      throw new Error(
        `LOCAL_ONLY_V2 recibió una categoría desconocida: ${finding.category}.`,
      );
    }
  }
}

function validateSelectedTraceability(
  selected: readonly LocalOnlyV2SelectedFinding[],
  knowledge: LocalOnlyV2KnowledgeIndex,
): void {
  const sources = new Set(knowledge.sources.map((source) => source.sourceId));
  const segments = new Map<string, LocalOnlyV2KnowledgeSegment>(
    knowledge.segments.map((segment) => [segment.segmentId, segment]),
  );

  for (const finding of selected) {
    for (const sourceId of finding.sourceIds) {
      if (!sources.has(sourceId)) {
        throw new Error(
          `LOCAL_ONLY_V2 seleccionó sourceId desconocido: ${sourceId}.`,
        );
      }
    }
    for (const occurrence of finding.occurrences) {
      const segment = segments.get(occurrence.segmentId);
      if (!segment || segment.sourceId !== occurrence.sourceId) {
        throw new Error(
          `LOCAL_ONLY_V2 seleccionó una ocurrencia sin trazabilidad válida: ${occurrence.segmentId}.`,
        );
      }
      if (
        occurrence.evidenceStartCharacter < segment.startCharacter ||
        occurrence.evidenceEndCharacter > segment.endCharacter
      ) {
        throw new Error(
          `LOCAL_ONLY_V2 seleccionó evidencia fuera del segmento: ${occurrence.segmentId}.`,
        );
      }
    }
  }
}

type ScoredFinding = Readonly<{
  finding: LocalOnlyV2NormalizedFinding;
  score: number;
}>;

// AI_ANALYSIS_LOCAL_ONLY_V2_PROCESS_FLOW_RESERVED_COVERAGE_V1
//
// El corte plano por score (top-N) puede dejar que una sola familia de
// hallazgos con muchos términos coincidentes (por ejemplo "proceso"/"flujo")
// desplace por completo a otra familia igual de relevante pero con menos
// coincidencias léxicas (por ejemplo "entidad"/"campo"). Esto es
// específicamente un riesgo para processFlow, que necesita evidencia de
// actores, procesos Y entidades a la vez. El reparto por turnos (round
// robin) entre categorías garantiza que, si el cupo alcanza para al menos
// una vuelta completa, CADA categoría presente en los candidatos reciba
// cobertura, sin favorecer ninguna categoría por nombre ni por proyecto.
function roundRobinByCategory(
  scoredCandidates: readonly ScoredFinding[],
  cap: number,
): readonly ScoredFinding[] {
  const byCategory = new Map<LocalAiCategory, ScoredFinding[]>();
  for (const candidate of scoredCandidates) {
    const bucket = byCategory.get(candidate.finding.category) ?? [];
    bucket.push(candidate);
    byCategory.set(candidate.finding.category, bucket);
  }
  const categories = [...byCategory.keys()];
  const cursors = new Map<LocalAiCategory, number>(
    categories.map((category) => [category, 0]),
  );

  const result: ScoredFinding[] = [];
  let advanced = true;
  while (result.length < cap && advanced) {
    advanced = false;
    for (const category of categories) {
      if (result.length >= cap) break;
      const bucket = byCategory.get(category)!;
      const cursor = cursors.get(category)!;
      if (cursor >= bucket.length) continue;
      result.push(bucket[cursor]!);
      cursors.set(category, cursor + 1);
      advanced = true;
    }
  }
  return result;
}

function finishBlockPacket(
  block: LocalOnlyV2TemplateGenerationBlock,
  plan: LocalOnlyV2TemplateGenerationPlan,
  knowledge: LocalOnlyV2KnowledgeIndex,
  relevantCandidates: readonly ScoredFinding[],
  guardCandidates: readonly ScoredFinding[],
  policy: LocalOnlyV2EvidenceSelectionPolicy,
): LocalOnlyV2BlockEvidencePacket {
  const relevantFindings = Object.freeze(
    relevantCandidates.map(({ finding, score }) =>
      selectedFinding(finding, score, policy.maxOccurrencesPerFinding),
    ),
  );
  const guardFindings = Object.freeze(
    guardCandidates.map(({ finding, score }) =>
      selectedFinding(finding, score, policy.maxOccurrencesPerFinding),
    ),
  );

  const selected = [...relevantFindings, ...guardFindings];
  validateSelectedTraceability(selected, knowledge);

  const selectedFindingIds = uniqueInOrder(
    selected.map((finding) => finding.canonicalId),
  );
  const sourceIds = uniqueInOrder(
    selected.flatMap((finding) => finding.sourceIds),
  );
  const segmentIds = uniqueInOrder(
    selected.flatMap((finding) => finding.segmentIds),
  );
  const questionnaireFindingCount = selected.filter(
    (finding) => finding.mandatoryQuestionnaireEvidence,
  ).length;

  const evidenceCharacterCount = selected.reduce(
    (total, finding) =>
      total +
      finding.description.length +
      finding.occurrences.reduce(
        (subtotal, occurrence) => subtotal + occurrence.evidenceText.length,
        0,
      ),
    0,
  );

  const metrics = Object.freeze({
    relevantFindingCount: relevantFindings.length,
    guardFindingCount: guardFindings.length,
    totalFindingCount: selected.length,
    questionnaireFindingCount,
    sourceCount: sourceIds.length,
    segmentCount: segmentIds.length,
    evidenceCharacterCount,
    estimatedEvidenceTokens: Math.ceil(evidenceCharacterCount / 4),
  });

  const withoutFingerprint = {
    pipelineId: "LOCAL_ONLY_V2" as const,
    schemaVersion: LOCAL_ONLY_V2_EVIDENCE_SELECTION_SCHEMA_VERSION,
    projectId: knowledge.projectId,
    knowledgeFingerprint: knowledge.fingerprint,
    templatePlanFingerprint: plan.planFingerprint,
    blockId: block.blockId,
    blockNumber: block.blockNumber,
    blockTotal: block.blockTotal,
    sectionKey: block.sectionKey,
    title: block.title,
    required: block.required,
    guidance: block.guidance,
    relevantFindings,
    guardFindings,
    selectedFindingIds,
    sourceIds,
    segmentIds,
    metrics,
  };

  const fingerprint = sha256(
    JSON.stringify({
      knowledgeFingerprint: withoutFingerprint.knowledgeFingerprint,
      templatePlanFingerprint: withoutFingerprint.templatePlanFingerprint,
      blockId: withoutFingerprint.blockId,
      relevant: relevantFindings.map((finding) => [
        finding.canonicalId,
        finding.selectionScore,
      ]),
      guards: guardFindings.map((finding) => [
        finding.canonicalId,
        finding.selectionScore,
      ]),
      occurrenceIds: selected.flatMap((finding) =>
        finding.occurrences.map(
          (occurrence) =>
            `${occurrence.sourceId}:${occurrence.segmentId}:${occurrence.evidenceStartCharacter}:${occurrence.evidenceEndCharacter}`,
        ),
      ),
    }),
  );

  return Object.freeze({
    ...withoutFingerprint,
    fingerprint,
  });
}

function blockPacket(
  block: LocalOnlyV2TemplateGenerationBlock,
  plan: LocalOnlyV2TemplateGenerationPlan,
  knowledge: LocalOnlyV2KnowledgeIndex,
  policy: LocalOnlyV2EvidenceSelectionPolicy,
): LocalOnlyV2BlockEvidencePacket {
  const blockTerms = queryTerms(block);

  const relevantCandidates = knowledge.findings
    .filter((finding) => !GUARD_CATEGORY_SET.has(finding.category))
    .map((finding) => ({
      finding,
      score: findingScore(blockTerms, finding),
    }))
    .filter(({ score }) => score >= policy.minimumRelevantScore)
    .sort(compareScored)
    .slice(0, policy.maxRelevantFindingsPerBlock);

  const guardCandidates = knowledge.findings
    .filter((finding) => GUARD_CATEGORY_SET.has(finding.category))
    .map((finding) => ({
      finding,
      score: findingScore(blockTerms, finding),
    }))
    .sort(compareScored)
    .slice(0, policy.maxGuardFindingsPerBlock);

  return finishBlockPacket(
    block,
    plan,
    knowledge,
    relevantCandidates,
    guardCandidates,
    policy,
  );
}

// AI_ANALYSIS_LOCAL_ONLY_V2_PROCESS_FLOW_EVIDENCE_V1
//
// processFlow es el único bloque que necesita, a la vez, evidencia de
// actores/procesos (para AS-IS y TO-BE) Y evidencia de entidades/registros
// (para el modelo entidad-relación). El corte plano por score de
// `blockPacket` no lo garantiza: 24 hallazgos de "proceso" pueden desplazar
// por completo a los hallazgos de "entidad" antes de que el punto 6
// siquiera decida cómo repartirlos entre sus tres subunidades. Este cupo
// ampliado y el reparto por turnos (round robin) entre TODAS las
// categorías presentes en el índice —no solo processFlow— aseguran que
// ninguna familia con evidencia real quede en cero, sin exigir cantidades
// arbitrarias ni contenido específico de ningún proyecto.
const LOCAL_ONLY_V2_PROCESS_FLOW_MAX_RELEVANT_FINDINGS = 40;
const LOCAL_ONLY_V2_PROCESS_FLOW_RELEVANT_CATEGORIES: ReadonlySet<LocalAiCategory> =
  new Set([
    "actors",
    "currentProcesses",
    "problems",
    "facts",
    "decisions",
    "integrations",
    "risks",
    "expectedProcesses",
    "functionalRequirements",
    "businessRules",
    "needs",
    "entities",
  ]);

function processFlowBlockPacket(
  block: LocalOnlyV2TemplateGenerationBlock,
  plan: LocalOnlyV2TemplateGenerationPlan,
  knowledge: LocalOnlyV2KnowledgeIndex,
  policy: LocalOnlyV2EvidenceSelectionPolicy,
): LocalOnlyV2BlockEvidencePacket {
  const blockTerms = queryTerms(block);
  const cap = Math.max(
    policy.maxRelevantFindingsPerBlock,
    LOCAL_ONLY_V2_PROCESS_FLOW_MAX_RELEVANT_FINDINGS,
  );

  const scoredRelevant = knowledge.findings
    .filter(
      (finding) =>
        !GUARD_CATEGORY_SET.has(finding.category) &&
        LOCAL_ONLY_V2_PROCESS_FLOW_RELEVANT_CATEGORIES.has(finding.category),
    )
    .map((finding) => ({
      finding,
      score: findingScore(blockTerms, finding),
    }))
    .filter(({ score }) => score >= policy.minimumRelevantScore)
    .sort(compareScored);
  const relevantCandidates = roundRobinByCategory(scoredRelevant, cap);

  const guardCandidates = knowledge.findings
    .filter((finding) => GUARD_CATEGORY_SET.has(finding.category))
    .map((finding) => ({
      finding,
      score: findingScore(blockTerms, finding),
    }))
    .sort(compareScored)
    .slice(0, policy.maxGuardFindingsPerBlock);

  return finishBlockPacket(
    block,
    plan,
    knowledge,
    relevantCandidates,
    guardCandidates,
    policy,
  );
}

export function selectLocalOnlyV2EvidenceByBlock(
  plan: LocalOnlyV2TemplateGenerationPlan,
  knowledge: LocalOnlyV2KnowledgeIndex,
  requestedPolicy: LocalOnlyV2EvidenceSelectionPolicy = LOCAL_ONLY_V2_DEFAULT_EVIDENCE_SELECTION_POLICY,
): LocalOnlyV2EvidenceSelectionPlan {
  validateKnowledgePlanCompatibility(plan, knowledge);
  const policy = validatePolicy(requestedPolicy);

  const blocks = plan.blocks.map((block) =>
    block.sectionKey === "processFlow"
      ? processFlowBlockPacket(block, plan, knowledge, policy)
      : blockPacket(block, plan, knowledge, policy),
  );

  return Object.freeze({
    pipelineId: "LOCAL_ONLY_V2" as const,
    schemaVersion: LOCAL_ONLY_V2_EVIDENCE_SELECTION_SCHEMA_VERSION,
    projectId: knowledge.projectId,
    knowledgeFingerprint: knowledge.fingerprint,
    templatePlanFingerprint: plan.planFingerprint,
    policy,
    blocks: Object.freeze(blocks),
  });
}

// AI_ANALYSIS_LOCAL_ONLY_V2_PROCESS_FLOW_ARTIFACT_SPLIT_V1
//
// Divide la evidencia YA seleccionada y certificada de un paquete de
// processFlow (relevantFindings/guardFindings) en la vista especializada de
// un artefacto (AS-IS, TO-BE o modelo entidad-relación), sin volver a tocar
// el índice de conocimiento. No es una partición exhaustiva y disjunta
// (a diferencia de los lotes de Requerimientos): un mismo hallazgo puede
// sustentar más de un artefacto (por ejemplo, una regla de negocio puede
// alimentar TO-BE y el modelo entidad-relación a la vez), y eso es
// intencional. guardFindings se conserva igual para los tres artefactos
// porque son transversales (contradicciones, pendientes, advertencias).
const LOCAL_ONLY_V2_DIAGRAM_ARTIFACT_CATEGORIES: Readonly<
  Record<LocalOnlyV2DiagramArtifact, readonly LocalAiCategory[]>
> = Object.freeze({
  AS_IS: [
    "actors",
    "currentProcesses",
    "problems",
    "facts",
    "decisions",
    "integrations",
    "risks",
  ],
  TO_BE: [
    "actors",
    "expectedProcesses",
    "functionalRequirements",
    "businessRules",
    "decisions",
    "integrations",
    "needs",
  ],
  ENTITY_RELATIONSHIP: ["entities", "businessRules", "integrations", "facts"],
});

export function selectLocalOnlyV2DiagramArtifactEvidence(
  packet: LocalOnlyV2BlockEvidencePacket,
  artifact: LocalOnlyV2DiagramArtifact,
  maxRelevantFindings: number,
): LocalOnlyV2BlockEvidencePacket {
  const relevantCategories = new Set(
    LOCAL_ONLY_V2_DIAGRAM_ARTIFACT_CATEGORIES[artifact],
  );
  const relevantFindings = Object.freeze(
    packet.relevantFindings
      .filter((finding) => relevantCategories.has(finding.category))
      .slice(0, maxRelevantFindings),
  );
  const guardFindings = packet.guardFindings;

  const selected = [...relevantFindings, ...guardFindings];
  const selectedFindingIds = uniqueInOrder(
    selected.map((finding) => finding.canonicalId),
  );
  const sourceIds = uniqueInOrder(
    selected.flatMap((finding) => finding.sourceIds),
  );
  const segmentIds = uniqueInOrder(
    selected.flatMap((finding) => finding.segmentIds),
  );
  const questionnaireFindingCount = selected.filter(
    (finding) => finding.mandatoryQuestionnaireEvidence,
  ).length;
  const evidenceCharacterCount = selected.reduce(
    (total, finding) =>
      total +
      finding.description.length +
      finding.occurrences.reduce(
        (subtotal, occurrence) => subtotal + occurrence.evidenceText.length,
        0,
      ),
    0,
  );

  const withoutFingerprint = {
    ...packet,
    relevantFindings,
    guardFindings,
    selectedFindingIds,
    sourceIds,
    segmentIds,
    metrics: Object.freeze({
      relevantFindingCount: relevantFindings.length,
      guardFindingCount: guardFindings.length,
      totalFindingCount: selectedFindingIds.length,
      questionnaireFindingCount,
      sourceCount: sourceIds.length,
      segmentCount: segmentIds.length,
      evidenceCharacterCount,
      estimatedEvidenceTokens: Math.max(1, Math.ceil(evidenceCharacterCount / 4)),
    }),
    diagramArtifact: artifact,
  };

  return Object.freeze({
    ...withoutFingerprint,
    // AI_ANALYSIS_LOCAL_ONLY_V2_PROCESS_FLOW_ARTIFACT_FINGERPRINT_V1
    //
    // Deriva únicamente de identificadores estables (conocimiento, plan,
    // bloque) y de la evidencia YA FILTRADA para este artefacto — nunca del
    // fingerprint del paquete completo del bloque. Si se incluyera
    // `packet.fingerprint`, cualquier cambio en la evidencia de OTRO
    // artefacto (por ejemplo, una entidad nueva que solo afecta a ER)
    // invalidaría también el checkpoint de AS-IS/TO-BE aunque su propia
    // vista especializada de la evidencia no haya cambiado en nada.
    fingerprint: sha256(
      JSON.stringify({
        knowledgeFingerprint: packet.knowledgeFingerprint,
        templatePlanFingerprint: packet.templatePlanFingerprint,
        blockId: packet.blockId,
        artifact,
        relevant: relevantFindings.map((finding) => [
          finding.canonicalId,
          finding.selectionScore,
        ]),
        guards: guardFindings.map((finding) => [
          finding.canonicalId,
          finding.selectionScore,
        ]),
        selectedFindingIds,
        sourceIds,
        segmentIds,
      }),
    ),
  });
}
