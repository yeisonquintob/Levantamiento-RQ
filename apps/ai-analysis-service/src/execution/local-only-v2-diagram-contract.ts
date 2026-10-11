// LOCAL_ONLY_V2_PROCESS_FLOW_DIAGRAM_CONTRACT
//
// Contrato canónico, exclusivo del punto 6 (processFlow / Diagrama de
// flujo) de LOCAL_ONLY_V2: AS-IS, TO-BE y modelo entidad-relación. No se usa
// desde CLOUD_ONLY, desde el modo híbrido ni desde ai-prompt-builder.ts.
//
// Responsabilidades de este módulo:
// - definir el contrato de líneas parseables por identificador estable
//   (CARRIL/NODO/ARISTA/PROBLEMA/MEJORA/RESULTADO para AS-IS/TO-BE;
//   ENTIDAD/ATRIBUTO/RELACION para el modelo entidad-relación);
// - parsear esas líneas de forma determinista, sin inventar nada;
// - validar la estructura resultante (IDs únicos, referencias válidas,
//   ramas de decisión etiquetadas, ausencia de "Pregunta:"/"Respuesta:");
// - construir el fallback determinista exclusivo de diagramas cuando la
//   generación y su única reparación localizada no producen una salida
//   aceptable.
//
// Este módulo NO decide qué evidencia se envía al modelo ni cómo se llama a
// Ollama: solo entiende el contrato de texto y las estructuras que produce.

import { requireDefined } from "../common/require-defined";
import { truncateAtBoundary } from "./local-only-v2-text-hygiene";

export type LocalOnlyV2DiagramArtifact =
  | "AS_IS"
  | "TO_BE"
  | "ENTITY_RELATIONSHIP";

export const LOCAL_ONLY_V2_DIAGRAM_ARTIFACTS: readonly LocalOnlyV2DiagramArtifact[] =
  ["AS_IS", "TO_BE", "ENTITY_RELATIONSHIP"];

export type LocalOnlyV2DiagramLaneKind = "ACTOR" | "SYSTEM";
export type LocalOnlyV2DiagramNodeKind =
  | "START"
  | "PROCESS"
  | "DECISION"
  | "SYSTEM"
  | "END";

export interface LocalOnlyV2DiagramLane {
  readonly id: string;
  readonly name: string;
  readonly kind: LocalOnlyV2DiagramLaneKind;
}

export interface LocalOnlyV2DiagramNode {
  readonly id: string;
  readonly laneId: string;
  readonly kind: LocalOnlyV2DiagramNodeKind;
  readonly label: string;
}

export interface LocalOnlyV2DiagramEdge {
  readonly from: string;
  readonly to: string;
  readonly label: string;
}

export interface LocalOnlyV2ParsedDiagramFlow {
  readonly lanes: readonly LocalOnlyV2DiagramLane[];
  readonly nodes: readonly LocalOnlyV2DiagramNode[];
  readonly edges: readonly LocalOnlyV2DiagramEdge[];
  readonly problems: readonly string[];
  readonly improvements: readonly string[];
  readonly results: readonly string[];
  readonly unrecognizedLines: readonly string[];
}

export interface LocalOnlyV2DiagramAttribute {
  readonly name: string;
  readonly dataType: string;
  readonly keyRole: "PK" | "FK" | "NONE";
  readonly required: boolean;
}

export interface LocalOnlyV2DiagramEntity {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly attributes: readonly LocalOnlyV2DiagramAttribute[];
}

export type LocalOnlyV2DiagramCardinality = "1:1" | "1:N" | "N:1" | "N:M";

export interface LocalOnlyV2DiagramRelation {
  readonly fromEntityId: string;
  readonly toEntityId: string;
  readonly cardinality: LocalOnlyV2DiagramCardinality;
  readonly description: string;
}

export interface LocalOnlyV2ParsedDiagramEntityModel {
  readonly entities: readonly LocalOnlyV2DiagramEntity[];
  readonly relations: readonly LocalOnlyV2DiagramRelation[];
  readonly unrecognizedLines: readonly string[];
}

export interface LocalOnlyV2DiagramValidation {
  readonly valid: boolean;
  readonly issues: readonly string[];
}

export interface LocalOnlyV2DiagramFallbackFinding {
  readonly canonicalId: string;
  readonly category: string;
  readonly description: string;
}

const CARDINALITIES: ReadonlySet<string> = new Set(["1:1", "1:N", "N:1", "N:M"]);

const GENERIC_LANE_NAMES: ReadonlySet<string> = new Set([
  "proceso actual",
  "solucion propuesta",
]);

// AI_ANALYSIS_LOCAL_ONLY_V2_DIAGRAM_PENDING_PLACEHOLDER_V1
//
// Marca el literal fabricado que el fallback anterior usaba para carriles,
// nodos y entidades sin evidencia real. Ya no se produce desde este módulo,
// pero la validación lo sigue rechazando explícitamente por si el modelo
// (no el fallback) lo reproduce: un placeholder "pendiente" nunca es
// sustancia derivada de evidencia, aunque estructuralmente sea parseable.
const PENDING_PLACEHOLDER = /^\[PENDIENTE POR DEFINIR\b/iu;

function normalizeLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toUpperCase()
    .trim();
}

function normalizeCompare(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("es")
    .replace(/\s+/gu, " ")
    .trim();
}

function stripListPrefix(line: string): string {
  return line.replace(/^(?:[-*•]|\d+[.)])\s*/u, "");
}

function contentLines(content: string): string[] {
  return content
    .replace(/\r\n?/gu, "\n")
    .split(/\n+/gu)
    .map((line) => stripListPrefix(line.trim()))
    .filter(Boolean);
}

function isSectionHeadingLine(line: string): boolean {
  return /^(?:FLUJO\s+(?:AS-IS|TO-BE)|PROBLEMAS?\s+IDENTIFICADOS?|MEJORAS?\s+DEL\s+PROCESO|RESULTADOS?\s+ESPERADOS?|ENTIDADES|RELACIONES)\s*:?$/iu.test(
    line,
  );
}

function normalizeLaneKind(value: string): LocalOnlyV2DiagramLaneKind {
  return /SYSTEM|SISTEMA/iu.test(value) ? "SYSTEM" : "ACTOR";
}

function normalizeNodeKind(value: string): LocalOnlyV2DiagramNodeKind | null {
  const label = normalizeLabel(value);
  if (label === "START" || label === "INICIO") return "START";
  if (label === "PROCESS" || label === "PROCESO") return "PROCESS";
  if (label === "DECISION" || label === "DECISIÓN" || label === "DECISION")
    return "DECISION";
  if (label === "SYSTEM" || label === "SISTEMA") return "SYSTEM";
  if (label === "END" || label === "FIN") return "END";
  return null;
}

// AI_ANALYSIS_LOCAL_ONLY_V2_DIAGRAM_CANONICAL_FLOW_PARSER_V1
//
// Devuelve null únicamente cuando no hay NINGUNA señal canónica (ni CARRIL
// ni NODO): en ese caso el llamador debe intentar el parseo heredado
// (Actor | TIPO | acción). Si hay al menos una señal canónica, siempre se
// devuelve una estructura, aunque contenga `unrecognizedLines`: distinguir
// "no es canónico" de "es canónico pero inválido" permite que la
// validación exija reparación en lugar de mezclar contratos.
export function parseCanonicalDiagramFlow(
  content: string,
): LocalOnlyV2ParsedDiagramFlow | null {
  const lines = contentLines(content);

  const lanes: LocalOnlyV2DiagramLane[] = [];
  const nodes: LocalOnlyV2DiagramNode[] = [];
  const edges: LocalOnlyV2DiagramEdge[] = [];
  const problems: string[] = [];
  const improvements: string[] = [];
  const results: string[] = [];
  const unrecognizedLines: string[] = [];

  for (const line of lines) {
    if (isSectionHeadingLine(line)) continue;

    const values = line.split(/\s*\|\s*/u).map((item) => item.trim());
    const label = normalizeLabel(values[0] ?? "");

    if (label === "CARRIL") {
      const [, id, name, kind] = values;
      if (id && name) {
        lanes.push({ id, name, kind: normalizeLaneKind(kind ?? "") });
        continue;
      }
    } else if (label === "NODO") {
      const [, id, laneId, kindToken, ...rest] = values;
      const kind = kindToken ? normalizeNodeKind(kindToken) : null;
      if (id && laneId && kind) {
        nodes.push({ id, laneId, kind, label: rest.join(" | ").trim() });
        continue;
      }
    } else if (label === "ARISTA") {
      const [, from, to, ...rest] = values;
      if (from && to) {
        edges.push({ from, to, label: rest.join(" | ").trim() });
        continue;
      }
    } else if (label === "PROBLEMA") {
      const value = values.slice(1).join(" | ").trim();
      if (value) {
        problems.push(value);
        continue;
      }
    } else if (label === "MEJORA") {
      const value = values.slice(1).join(" | ").trim();
      if (value) {
        improvements.push(value);
        continue;
      }
    } else if (label === "RESULTADO") {
      const value = values.slice(1).join(" | ").trim();
      if (value) {
        results.push(value);
        continue;
      }
    }

    unrecognizedLines.push(line);
  }

  if (lanes.length === 0 && nodes.length === 0) return null;

  return {
    lanes,
    nodes,
    edges,
    problems,
    improvements,
    results,
    unrecognizedLines,
  };
}

// AI_ANALYSIS_LOCAL_ONLY_V2_DIAGRAM_FLOW_VALIDATION_V1
//
// Validación fuerte y relativa a la evidencia: no basta con que el
// contenido sea parseable, tiene que representar realmente el proceso
// sustentado. `distinctActorEvidenceHints` son literales de hallazgos de
// actores/sistemas seleccionados para esta subunidad: si la evidencia
// sustenta más de un responsable y el diagrama sigue usando un único
// carril con un nombre genérico ("Proceso actual"/"Solución propuesta"),
// la validación falla y dispara la reparación en lugar de aceptar un
// diagrama de un solo carril inventado por conveniencia.
export function validateCanonicalDiagramFlow(
  flow: LocalOnlyV2ParsedDiagramFlow,
  options: {
    readonly distinctActorEvidenceHints?: readonly string[];
  } = {},
): LocalOnlyV2DiagramValidation {
  const issues: string[] = [];

  if (flow.unrecognizedLines.length > 0) {
    issues.push("UNRECOGNIZED_LINES");
  }
  if (flow.lanes.length === 0) {
    issues.push("NO_LANES");
  }
  if (flow.nodes.length === 0) {
    issues.push("NO_NODES");
  } else {
    // AI_ANALYSIS_LOCAL_ONLY_V2_DIAGRAM_SUBSTANTIVE_NODE_V1
    //
    // Un flujo compuesto únicamente por START y END (sin ningún PROCESS,
    // DECISION o SYSTEM real entre medio) es exactamente el patrón
    // reportado: actor-only o facts-only produciendo un START->END vacío
    // de contenido. Exigir al menos un nodo sustantivo cierra esa brecha
    // sin importar si las etiquetas son o no placeholders.
    const substantiveNodes = flow.nodes.filter(
      (node) => node.kind !== "START" && node.kind !== "END",
    );
    if (substantiveNodes.length === 0) {
      issues.push("NO_SUBSTANTIVE_NODES");
    }
  }
  if (flow.nodes.length > 1 && flow.edges.length === 0) {
    issues.push("NO_EDGES");
  }

  const laneIds = new Set(flow.lanes.map((lane) => lane.id));
  if (laneIds.size !== flow.lanes.length) issues.push("DUPLICATE_LANE_IDS");

  for (const lane of flow.lanes) {
    if (PENDING_PLACEHOLDER.test(lane.name.trim())) {
      issues.push(`PENDING_LANE_NAME:${lane.id}`);
    }
  }

  const nodeIds = new Set(flow.nodes.map((node) => node.id));
  if (nodeIds.size !== flow.nodes.length) issues.push("DUPLICATE_NODE_IDS");

  for (const node of flow.nodes) {
    if (!laneIds.has(node.laneId)) {
      issues.push(`NODE_REFERENCES_UNKNOWN_LANE:${node.id}`);
    }
    if (!node.label.trim()) {
      issues.push(`EMPTY_NODE_LABEL:${node.id}`);
    }
    if (/^(?:pregunta|respuesta)\s*:/iu.test(node.label.trim())) {
      issues.push(`QUESTIONNAIRE_LEAKAGE:${node.id}`);
    }
    if (PENDING_PLACEHOLDER.test(node.label.trim())) {
      issues.push(`PENDING_NODE_LABEL:${node.id}`);
    }
  }

  for (const edge of flow.edges) {
    if (!nodeIds.has(edge.from)) {
      issues.push(`EDGE_UNKNOWN_FROM:${edge.from}->${edge.to}`);
    }
    if (!nodeIds.has(edge.to)) {
      issues.push(`EDGE_UNKNOWN_TO:${edge.from}->${edge.to}`);
    }
  }

  const outgoingByNode = new Map<string, LocalOnlyV2DiagramEdge[]>();
  for (const edge of flow.edges) {
    const bucket = outgoingByNode.get(edge.from) ?? [];
    bucket.push(edge);
    outgoingByNode.set(edge.from, bucket);
  }
  for (const node of flow.nodes) {
    if (node.kind !== "DECISION") continue;
    const outgoing = outgoingByNode.get(node.id) ?? [];
    if (outgoing.length < 2) continue;
    const labels = outgoing.map((edge) => normalizeCompare(edge.label));
    if (labels.some((label) => !label)) {
      issues.push(`DECISION_BRANCH_WITHOUT_LABEL:${node.id}`);
    }
    if (new Set(labels).size !== labels.length) {
      issues.push(`DECISION_BRANCH_DUPLICATE_LABEL:${node.id}`);
    }
  }

  const distinctActorHintCount = new Set(
    (options.distinctActorEvidenceHints ?? []).map(normalizeCompare),
  ).size;
  if (
    flow.lanes.length === 1 &&
    distinctActorHintCount >= 2 &&
    GENERIC_LANE_NAMES.has(normalizeCompare(
        requireDefined(flow.lanes[0], "Invariante: el flujo tiene un carril.").name,
      ))
  ) {
    issues.push("GENERIC_LANE_WITH_MULTIPLE_ACTORS_IN_EVIDENCE");
  }

  return { valid: issues.length === 0, issues };
}

// AI_ANALYSIS_LOCAL_ONLY_V2_DIAGRAM_CANONICAL_ER_PARSER_V1
export function parseCanonicalEntityRelationshipModel(
  content: string,
): LocalOnlyV2ParsedDiagramEntityModel | null {
  const lines = contentLines(content);

  const entities: LocalOnlyV2DiagramEntity[] = [];
  const attributesByEntity = new Map<string, LocalOnlyV2DiagramAttribute[]>();
  const relations: LocalOnlyV2DiagramRelation[] = [];
  const unrecognizedLines: string[] = [];
  let sawCanonicalSignal = false;

  for (const line of lines) {
    if (isSectionHeadingLine(line)) continue;

    const values = line.split(/\s*\|\s*/u).map((item) => item.trim());
    const label = normalizeLabel(values[0] ?? "");

    if (label === "ENTIDAD") {
      sawCanonicalSignal = true;
      const [, id, name, ...rest] = values;
      if (id && name) {
        entities.push({
          id,
          name,
          description: rest.join(" | ").trim(),
          attributes: [],
        });
        continue;
      }
    } else if (label === "ATRIBUTO") {
      sawCanonicalSignal = true;
      const [, entityId, name, dataType, keyRoleToken, requiredToken] =
        values;
      if (entityId && name) {
        const keyRole: LocalOnlyV2DiagramAttribute["keyRole"] =
          keyRoleToken?.toUpperCase() === "PK"
            ? "PK"
            : keyRoleToken?.toUpperCase() === "FK"
              ? "FK"
              : "NONE";
        const bucket = attributesByEntity.get(entityId) ?? [];
        bucket.push({
          name,
          dataType: dataType || "Texto",
          keyRole,
          required:
            /^(?:SI|SÍ|TRUE)$/iu.test(requiredToken ?? "") || keyRole === "PK",
        });
        attributesByEntity.set(entityId, bucket);
        continue;
      }
    } else if (label === "RELACION" || label === "RELACIÓN") {
      sawCanonicalSignal = true;
      const [, fromEntityId, toEntityId, cardinalityToken, ...rest] = values;
      const cardinality = cardinalityToken?.toUpperCase();
      if (
        fromEntityId &&
        toEntityId &&
        cardinality &&
        CARDINALITIES.has(cardinality)
      ) {
        relations.push({
          fromEntityId,
          toEntityId,
          cardinality: cardinality as LocalOnlyV2DiagramCardinality,
          description: rest.join(" | ").trim(),
        });
        continue;
      }
    }

    unrecognizedLines.push(line);
  }

  if (!sawCanonicalSignal) return null;

  const entitiesWithAttributes = entities.map((entity) => ({
    ...entity,
    attributes: attributesByEntity.get(entity.id) ?? [],
  }));

  return {
    entities: entitiesWithAttributes,
    relations,
    unrecognizedLines,
  };
}

export function validateCanonicalEntityRelationshipModel(
  model: LocalOnlyV2ParsedDiagramEntityModel,
): LocalOnlyV2DiagramValidation {
  const issues: string[] = [];

  if (model.unrecognizedLines.length > 0) issues.push("UNRECOGNIZED_LINES");

  const entityIds = new Set(model.entities.map((entity) => entity.id));
  if (entityIds.size !== model.entities.length) {
    issues.push("DUPLICATE_ENTITY_IDS");
  }
  for (const entity of model.entities) {
    if (!entity.name.trim()) issues.push(`EMPTY_ENTITY_NAME:${entity.id}`);
    if (PENDING_PLACEHOLDER.test(entity.name.trim())) {
      issues.push(`PENDING_ENTITY_NAME:${entity.id}`);
    }
  }
  for (const relation of model.relations) {
    if (!entityIds.has(relation.fromEntityId)) {
      issues.push(`RELATION_UNKNOWN_FROM:${relation.fromEntityId}`);
    }
    if (!entityIds.has(relation.toEntityId)) {
      issues.push(`RELATION_UNKNOWN_TO:${relation.toEntityId}`);
    }
    if (!CARDINALITIES.has(relation.cardinality)) {
      issues.push(`INVALID_CARDINALITY:${relation.cardinality}`);
    }
  }

  return { valid: issues.length === 0, issues };
}

// AI_ANALYSIS_LOCAL_ONLY_V2_DIAGRAM_DETERMINISTIC_FALLBACK_V2
//
// Fallback determinista exclusivo de diagramas: nunca produce un carril
// genérico "Proceso actual"/"Solución propuesta" inventado ni una viñeta de
// prosa. Conserva únicamente pasos/entidades que se derivan literalmente de
// las descripciones de los hallazgos ya seleccionados para esta subunidad;
// nunca fabrica actores, sistemas, decisiones, atributos ni relaciones. El
// presupuesto se aplica de forma atómica: cada línea entra completa o se
// omite. De ese modo una subunidad con muchos hallazgos nunca rompe IDs,
// delimitadores ni referencias para intentar representarlos todos.

function usableFallbackDescription(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /^pregunta\s*:/iu.test(trimmed)) return null;
  const withoutAnswerPrefix = trimmed.replace(/^respuesta\s*:\s*/iu, "").trim();
  return withoutAnswerPrefix || null;
}

// AI_ANALYSIS_LOCAL_ONLY_V2_DIAGRAM_ENTITY_NAMEABLE_EVIDENCE_V1
//
// El respaldo solo publica entidades cuyo nombre es un sustantivo corto. Si
// todos los hallazgos de entidades son frases (p. ej. una pregunta del
// cuestionario), el respaldo correcto es un modelo vacío honesto; exigirle
// entidades abortaría todo el documento por una evidencia que no puede
// nombrarse de forma honesta.
export function hasNameableDiagramEntityEvidence(
  findings: readonly LocalOnlyV2DiagramFallbackFinding[],
): boolean {
  return findings.some(
    (finding) =>
      finding.category === "entities" &&
      fallbackEntityName(finding.description, "") !== null,
  );
}

export function hasUsableDiagramEntityEvidence(
  findings: readonly LocalOnlyV2DiagramFallbackFinding[],
): boolean {
  return findings.some(
    (finding) =>
      finding.category === "entities" &&
      usableFallbackDescription(finding.description) !== null,
  );
}

// AI_ANALYSIS_LOCAL_ONLY_V2_DIAGRAM_LANE_NAME_QUALITY_V1
//
// Un carril es un actor, rol, área o sistema: un nombre corto y completo. Se
// rechazan las frases largas, los nombres con paréntesis sin cerrar, los
// truncados ("…") y los que terminan en un conector.
const LANE_NAME_TRAILING_CONNECTOR =
  /\s(?:de|del|la|las|el|los|un|una|y|o|en|con|para|por|a|al|que)$/iu;

function isUsableLaneCandidate(candidate: string): boolean {
  const opening = (candidate.match(/\(/gu) ?? []).length;
  const closing = (candidate.match(/\)/gu) ?? []).length;
  return (
    candidate.length >= 2 &&
    candidate.length <= 60 &&
    candidate.split(/\s+/u).length <= 7 &&
    opening === closing &&
    !/[.!?…]/u.test(candidate) &&
    !LANE_NAME_TRAILING_CONNECTOR.test(candidate)
  );
}

// Etiqueta corta de un nodo: sin el prefijo "Paso NN:", solo la primera
// cláusula y siempre como prefijo literal de la respuesta (nunca se reescribe).
function shortStepLabel(description: string): string {
  const withoutOrdinal = description
    .trim()
    .replace(/^paso\s*\d+\s*[:.\-–]\s*/iu, "");
  const firstClause =
    withoutOrdinal.split(/(?<=[.;])\s+/u)[0] ?? withoutOrdinal;
  const label = truncateAtBoundary(
    firstClause.replace(/\s*\|\s*/gu, " / "),
    100,
  )
    .replace(/[.;:]+$/u, "")
    .trim();
  return label || withoutOrdinal.replace(/\s*\|\s*/gu, " / ");
}

// Suplemento (PROBLEMA/MEJORA): primera oración, sin duplicados y sin
// descripciones que pertenecen a otro propósito.
function shortSupplementText(description: string): string | null {
  if (/^\s*(?:escenarios?\s+a\s+probar|pregunta)\s*:/iu.test(description)) {
    return null;
  }
  const firstSentence =
    description.trim().split(/(?<=[.!?])\s+/u)[0] ?? description.trim();
  const text = truncateAtBoundary(
    firstSentence.replace(/\s*\|\s*/gu, " / "),
    160,
  );
  return text.length >= 8 ? text : null;
}

const LANE_STOP_WORDS = new Set([
  "para",
  "como",
  "desde",
  "hasta",
  "sobre",
  "entre",
  "grupo",
  "area",
  "areas",
  "sistema",
  "proceso",
]);

function laneTokens(name: string): string[] {
  return normalizeCompare(name)
    .split(/[^\p{L}\d]+/u)
    .filter((token) => token.length >= 4 && !LANE_STOP_WORDS.has(token));
}

// AI_ANALYSIS_LOCAL_ONLY_V2_DIAGRAM_LANE_NAME_SENTENCE_SUBJECT_V1
//
// Extrae el sujeto (artículo + sustantivo) que antecede a un verbo de
// responsabilidad/participación, siempre como subcadena literal de la
// respuesta; nunca se inventa ni se completa el nombre. Cubre respuestas de
// cuestionario en forma de oración completa (p.ej. "El área de cartera
// aprueba las solicitudes.") que no siguen el formato "Nombre: descripción"
// que sí produce el modelo.
const LANE_SUBJECT_PATTERN =
  /^(?:el|la|los|las|un|una)\s+([\p{L}\d][\p{L}\d ._-]{1,60}?)\s+(?:es|son|participa|participan|gestiona|gestionan|valida|validan|aprueba|aprueban|registra|registran|revisa|revisan|autoriza|autorizan|realiza|realizan|coordina|coordinan|responde|responden|solicita|solicitan|envia|envian|envía|envían|extrae|extraen|centraliza|centralizan)\b/iu;

function fallbackLaneName(value: string): string | null {
  const usable = usableFallbackDescription(value);
  if (!usable) return null;

  const beforeColon = (usable.split(":", 1)[0] ?? "").trim();
  if (beforeColon.length > 0 && beforeColon.length < usable.length) {
    if (isUsableLaneCandidate(beforeColon)) return beforeColon;
  }

  const subjectMatch = usable.match(LANE_SUBJECT_PATTERN);
  const subject = subjectMatch?.[1]?.trim();
  if (subject && isUsableLaneCandidate(subject)) return subject;

  return isUsableLaneCandidate(usable) ? usable : null;
}

// AI_ANALYSIS_LOCAL_ONLY_V2_DIAGRAM_ENTITY_NAME_QUALITY_V1
//
// Una entidad se nombra con un sustantivo corto. Una frase de la pregunta
// ("Se utilizan los siguientes sistemas, herramientas...") o un rótulo que
// introduce una lista ("Información a ingresar") no es una entidad: se
// omite en lugar de publicarla como si lo fuera.
const ENTITY_LABEL_NOT_ENTITY =
  /^(?:informaci[oó]n|datos|campos|sistemas|herramientas|documentos)\s+(?:a|que|por|para|de|del)\b/iu;

function isUsableEntityName(name: string): boolean {
  const opening = (name.match(/\(/gu) ?? []).length;
  const closing = (name.match(/\)/gu) ?? []).length;
  return (
    name.length >= 2 &&
    name.length <= 50 &&
    name.split(/\s+/u).length <= 5 &&
    opening === closing &&
    !/[,.!?…]/u.test(name) &&
    !/^(?:se|es|son|para|que|los|las)\b/iu.test(name) &&
    !LANE_NAME_TRAILING_CONNECTOR.test(name) &&
    !ENTITY_LABEL_NOT_ENTITY.test(name)
  );
}

function fallbackEntityName(value: string, id: string): string | null {
  void id;
  const usable = usableFallbackDescription(value);
  if (!usable) return null;
  const match = usable.match(
    /^(?:la|el|un|una)\s+([\p{L}\d][\p{L}\d _-]{0,60}?)\s+(?:es|representa|registra|contiene|queda|tiene)\b/iu,
  );
  if (match?.[1]) {
    const name = match[1].trim();
    return isUsableEntityName(name) ? name : null;
  }
  const beforeColon = (usable.split(":", 1)[0] ?? "").trim();
  const candidate =
    beforeColon.length > 0 && beforeColon.length < usable.length
      ? beforeColon
      : usable;
  return isUsableEntityName(candidate) ? candidate : null;
}

// Atributos literales: solo cuando la respuesta tiene la forma
// "Entidad: campo, campo, campo" y el nombre de la entidad es ese mismo
// encabezado. Cada elemento se copia tal cual; nunca se completa.
function literalEntityAttributes(description: string, name: string): string[] {
  const separator = description.indexOf(":");
  if (separator < 0) return [];
  if (description.slice(0, separator).trim() !== name) return [];
  const items = description
    .slice(separator + 1)
    .split(/\s*[,;]\s*/u)
    .map((item) => item.replace(/[.\s]+$/u, "").trim())
    .filter(
      (item) =>
        item.length >= 2 &&
        item.length <= 40 &&
        item.split(/\s+/u).length <= 5 &&
        !/[|:]/u.test(item),
    );
  return items
    .filter(
      (item, index) =>
        items.findIndex(
          (other) => normalizeCompare(other) === normalizeCompare(item),
        ) === index,
    )
    .slice(0, 8);
}

const AS_IS_STEP_CATEGORIES = new Set([
  "currentProcesses",
  "decisions",
  "integrations",
]);
const TO_BE_STEP_CATEGORIES = new Set([
  "expectedProcesses",
  "functionalRequirements",
  "businessRules",
  "decisions",
  "integrations",
]);

// AI_ANALYSIS_LOCAL_ONLY_V2_DIAGRAM_FLOW_EVIDENCE_SUFFICIENCY_V1
//
// Un flujo AS-IS/TO-BE solo es "utilizable" cuando la evidencia sustenta a
// la vez un responsable (carril real) y al menos un paso concreto. Actor
// sin pasos ("actor-only") o pasos sin ningún actor sustentado no alcanzan
// para un flujo honesto: nunca se fabrica el responsable o el paso que
// falta, así que el resultado correcto es un modelo vacío explícito.
export function hasUsableDiagramFlowEvidence(
  findings: readonly LocalOnlyV2DiagramFallbackFinding[],
  heading: "FLUJO AS-IS" | "FLUJO TO-BE",
): boolean {
  const stepCategories =
    heading === "FLUJO AS-IS" ? AS_IS_STEP_CATEGORIES : TO_BE_STEP_CATEGORIES;
  const hasActor = findings.some(
    (finding) =>
      finding.category === "actors" &&
      fallbackLaneName(finding.description) !== null,
  );
  const hasStep = findings.some(
    (finding) =>
      stepCategories.has(finding.category) &&
      usableFallbackDescription(finding.description) !== null,
  );
  return hasActor && hasStep;
}

export function deterministicDiagramFlowFallback(
  findings: readonly LocalOnlyV2DiagramFallbackFinding[],
  heading: "FLUJO AS-IS" | "FLUJO TO-BE",
  codePrefix: string,
  maxCharacters: number,
): string {
  if (heading.length > maxCharacters) {
    throw new Error(
      "LOCAL_ONLY_V2_DIAGRAM_FALLBACK_CONFIG_INVARIANT: el presupuesto no permite representar la estructura canónica mínima.",
    );
  }

  // AI_ANALYSIS_LOCAL_ONLY_V2_DIAGRAM_FLOW_HONEST_EMPTY_V1
  //
  // Sin evidencia de flujo utilizable (actor + paso), el fallback ya no
  // fabrica un carril "[PENDIENTE POR DEFINIR]" con START/END pendientes:
  // devuelve exclusivamente el encabezado, una representación vacía
  // explícita y reconocible que el normalizador convierte en un modelo con
  // lanes/nodes/edges vacíos (la UI ya sabe mostrar su mensaje de "no hay
  // información" ante eso). No inventar aquí es lo que evita el diagrama
  // ficticio reportado.
  if (!hasUsableDiagramFlowEvidence(findings, heading)) {
    return heading;
  }

  const stepCategories =
    heading === "FLUJO AS-IS" ? AS_IS_STEP_CATEGORIES : TO_BE_STEP_CATEGORIES;

  const actorNames = findings
    .filter((finding) => finding.category === "actors")
    .map((finding) => fallbackLaneName(finding.description))
    .filter((value): value is string => Boolean(value))
    .filter(
      (value, index, values) =>
        values.findIndex(
          (candidate) => normalizeCompare(candidate) === normalizeCompare(value),
        ) === index,
    );

  const selectedActorNames: string[] = [];
  const selectedSteps: Array<{
    readonly description: string;
    readonly category: string;
  }> = [];
  const selectedSupplements: string[] = [];

  const render = (): string => {
    if (selectedActorNames.length === 0) return heading;
    const actorLanes = selectedActorNames.map((name, index) => ({
      id: `${codePrefix}-L${String(index + 1).padStart(2, "0")}`,
      name,
      kind: /(?:sistema|plataforma|erp|d365|correo)/iu.test(name)
        ? ("SYSTEM" as const)
        : ("ACTOR" as const),
    }));
    const laneLines = actorLanes.map(
      (lane) => `CARRIL | ${lane.id} | ${lane.name} | ${lane.kind}`,
    );
    const stepIds = selectedSteps.map(
      (_, index) => `${codePrefix}-N${String(index + 1).padStart(2, "0")}`,
    );
    const nodeLines = selectedSteps.map((step, index) => {
      const stepText = normalizeCompare(step.description);
      const exactLane = actorLanes.find((lane) =>
        stepText.includes(normalizeCompare(lane.name)),
      );
      // Sin coincidencia exacta se elige el carril que comparte más palabras
      // significativas con el paso; solo si ninguno comparte se usa el primero.
      const stepTokens = new Set(stepText.split(/[^\p{L}\d]+/u));
      const overlapLane = actorLanes
        .map((lane) => ({
          lane,
          overlap: laneTokens(lane.name).filter((token) =>
            stepTokens.has(token),
          ).length,
        }))
        .filter((candidate) => candidate.overlap > 0)
        .sort((first, second) => second.overlap - first.overlap)[0]?.lane;
      const matchingLane = exactLane ?? overlapLane;
      const baseKind =
        step.category === "decisions"
          ? "DECISION"
          : step.category === "integrations"
            ? "SYSTEM"
            : "PROCESS";
      // El primer y el último paso comunes marcan el inicio y el fin, pero solo
      // con tres pasos o más: el contrato exige al menos un paso sustantivo
      // (PROCESS, DECISION o SYSTEM) entre ellos.
      const kind =
        baseKind === "PROCESS" && selectedSteps.length >= 3
          ? index === 0
            ? "START"
            : index === selectedSteps.length - 1
              ? "END"
              : "PROCESS"
          : baseKind;
      return `NODO | ${stepIds[index]} | ${matchingLane?.id ?? requireDefined(actorLanes[0], "Invariante: existe al menos un carril de actor.").id} | ${kind} | ${shortStepLabel(step.description)}`;
    });
    const edgeLines = stepIds
      .slice(1)
      .map((id, index) => `ARISTA | ${stepIds[index]} | ${id} | `.trimEnd());
    return [
      heading,
      ...laneLines,
      ...nodeLines,
      ...edgeLines,
      ...selectedSupplements,
    ].join("\n");
  };

  for (const name of actorNames) {
    selectedActorNames.push(name);
    if (render().length > maxCharacters) selectedActorNames.pop();
  }
  if (selectedActorNames.length === 0) return heading;

  for (const finding of findings) {
    if (!stepCategories.has(finding.category)) continue;
    const description = usableFallbackDescription(finding.description);
    if (!description) continue;
    selectedSteps.push({ description, category: finding.category });
    if (render().length > maxCharacters) selectedSteps.pop();
  }
  if (selectedSteps.length === 0) return heading;

  const supplementCategory = heading === "FLUJO AS-IS" ? "problems" : "needs";
  const supplementLabel = heading === "FLUJO AS-IS" ? "PROBLEMA" : "MEJORA";
  for (const finding of findings) {
    if (finding.category !== supplementCategory) continue;
    const usable = usableFallbackDescription(finding.description);
    const description = usable ? shortSupplementText(usable) : null;
    if (!description) continue;
    const line = `${supplementLabel} | ${description}`;
    if (selectedSupplements.includes(line)) continue;
    selectedSupplements.push(line);
    if (render().length > maxCharacters) selectedSupplements.pop();
  }

  return render();
}

export function deterministicEntityRelationshipFallback(
  findings: readonly LocalOnlyV2DiagramFallbackFinding[],
  codePrefix: string,
  maxCharacters: number,
): string {
  const entityFindings = findings.flatMap((finding) => {
    if (finding.category !== "entities") return [];
    const description = usableFallbackDescription(finding.description);
    return description ? [{ description }] : [];
  });
  if (entityFindings.length === 0) {
    return ["ENTIDADES", "", "RELACIONES"].join("\n");
  }
  const entityLines: string[] = [];
  const render = () => ["ENTIDADES", ...entityLines, "", "RELACIONES"].join("\n");

  for (const finding of entityFindings) {
    const id = `${codePrefix}-E${String(entityLines.length + 1).padStart(2, "0")}`;
    const name = fallbackEntityName(finding.description, id);
    // AI_ANALYSIS_LOCAL_ONLY_V2_DIAGRAM_ENTITY_NO_PLACEHOLDER_V1
    //
    // Si no se puede derivar un nombre honesto de la descripción, se omite
    // la entidad en vez de fabricar "[PENDIENTE POR DEFINIR id]": ese
    // literal ya no es contenido válido para la validación del contrato.
    if (!name) continue;
    const entityLine = `ENTIDAD | ${id} | ${name} | ${finding.description.replace(/\s*\|\s*/gu, " / ")}`;
    entityLines.push(entityLine);
    if (render().length > maxCharacters) {
      entityLines.pop();
      continue;
    }
    for (const attribute of literalEntityAttributes(
      finding.description,
      name,
    )) {
      entityLines.push(`ATRIBUTO | ${id} | ${attribute} | Texto | NONE | NO`);
      if (render().length > maxCharacters) entityLines.pop();
    }
  }

  return render();
}
