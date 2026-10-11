import type {
  DocumentJsonValue,
} from "@levantamiento-rq/shared-contracts";
import {
  parseCanonicalDiagramFlow,
  parseCanonicalEntityRelationshipModel,
  validateCanonicalDiagramFlow,
  validateCanonicalEntityRelationshipModel,
} from "./local-only-v2-diagram-contract";

import { stripLabelPrefix, truncateAtBoundary } from "./local-only-v2-text-hygiene";

const PENDING = "[PENDIENTE POR DEFINIR]";

// AI_ANALYSIS_LOCAL_ONLY_V2_MILESTONES_PENDING_FIELD_V1
//
// El generador puede anotar un pendiente puntual como
// "[PENDIENTE POR DEFINIR: rol]" (con una nota entre paréntesis), no solo el
// literal exacto "[PENDIENTE POR DEFINIR]". Una comparación estricta
// (=== PENDING) deja pasar esas variantes como si fueran información real y
// puede clasificar una HU incompleta como COMPLETE.
export function isPendingFieldValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return /^\[PENDIENTE POR DEFINIR(?::[^\]]*)?\]$/iu.test(trimmed);
}

function canonicalExecutionKpis(): Array<{
  name: string;
  relatedObjective: string;
  measurement: string;
  target: string;
}> {
  return [
    {
      name: "Avance general del proyecto",
      relatedObjective: "Completar la ejecución planificada del proyecto",
      measurement: "(Tareas completadas / Total de tareas planificadas) × 100",
      target: "100%",
    },
    {
      name: "Cumplimiento de objetivos",
      relatedObjective:
        "Cumplir los objetivos cualitativos y cuantitativos mediante sus historias y tareas vinculadas",
      measurement:
        "(Historias y tareas vinculadas completadas / Total de historias y tareas vinculadas) × 100",
      target: "100%",
    },
    {
      name: "Cumplimiento de entregables",
      relatedObjective: "Finalizar los hitos y entregables comprometidos",
      measurement:
        "(Entregables o hitos finalizados / Total de entregables o hitos planificados) × 100",
      target: "100%",
    },
  ];
}

// AI_ANALYSIS_LOCAL_ONLY_V2_KPI_DERIVATION_V1
//
// Los KPI se derivan de la evidencia cuando el modelo los escribe con el
// contrato 'KPI | nombre | objetivo relacionado | fórmula | meta'. Los KPI
// estándar de ejecución solo completan hasta tres indicadores. La meta sin
// respaldo queda como [PENDIENTE POR DEFINIR] (ver el generador).
function kpisFromText(text: string): Array<{
  name: string;
  relatedObjective: string;
  measurement: string;
  target: string;
}> {
  const derived: Array<{
    name: string;
    relatedObjective: string;
    measurement: string;
    target: string;
  }> = [];
  for (const line of text.split(/\n+/gu)) {
    const values = line
      .trim()
      .replace(/^(?:[-*•]|\d+[.)])\s*/u, "")
      .split(/\s*\|\s*/u)
      .map((item) => item.trim());
    if (values[0]?.toUpperCase() !== "KPI") continue;
    const [, name, relatedObjective, measurement, target] = values;
    if (!name || name.length < 6 || isPendingFieldValue(name)) continue;
    if (!measurement || isPendingFieldValue(measurement)) continue;
    if (derived.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
      continue;
    }
    derived.push({
      name,
      relatedObjective:
        relatedObjective && !isPendingFieldValue(relatedObjective)
          ? relatedObjective
          : PENDING,
      measurement,
      target: target && target.trim() ? target : PENDING,
    });
    if (derived.length === 3) break;
  }
  const canonical = canonicalExecutionKpis();
  const names = new Set(derived.map((item) => item.name.toLowerCase()));
  const completion = canonical.filter(
    (item) => !names.has(item.name.toLowerCase()),
  );
  return [...derived, ...completion].slice(0, 3);
}

function clean(value: string): string {
  return value
    .replace(/\r\n/gu, "\n")
    .replace(/[ \t]+/gu, " ")
    .trim();
}

function sentences(value: string): string[] {
  return clean(value)
    .split(/(?<=[.!?;])\s+(?=[A-ZÁÉÍÓÚÑ])/gu)
    .map((item) => item.trim())
    .filter((item) => item.length >= 12);
}

function joinComplete(
  values: readonly string[],
  maxCharacters: number,
): string {
  const selected: string[] = [];
  let length = 0;
  for (const value of values) {
    const separator = selected.length > 0 ? 1 : 0;
    if (length + separator + value.length > maxCharacters) continue;
    selected.push(value);
    length += separator + value.length;
  }
  return selected.join(" ");
}

function objectiveCandidates(value: string): string[] {
  const seen = new Set<string>();
  return clean(value)
    .split(/\n+|(?<=[.!?;])\s+(?=[A-ZÁÉÍÓÚÑ])/gu)
    .map((item) => item.replace(/^(?:[-*•]|\d+[.)])\s*/u, "").trim())
    .map((item) =>
      item
        .replace(
          /^(?:objetivo\s+general|objetivos?\s+espec(?:í|i)ficos?(?:\s+(?:cualitativos|cuantitativos))?)\s*:?[\s-]*/iu,
          "",
        )
        .trim(),
    )
    .filter((item) => item.length >= 12)
    .filter((item) => {
      const key = item
        .normalize("NFD")
        .replace(/\p{M}+/gu, "")
        .toLocaleLowerCase("es")
        .replace(/\s+/gu, " ");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function objectiveBlock(
  value: string,
  heading: "general" | "qualitative" | "quantitative",
): string | null {
  const headings = {
    general: "objetivo\\s+general",
    qualitative: "objetivos?\\s+espec(?:í|i)ficos?\\s+cualitativos?",
    quantitative: "objetivos?\\s+espec(?:í|i)ficos?\\s+cuantitativos?",
  } as const;
  const current = headings[heading];
  const followingCandidates: string[] = Object.values(headings).filter(
    (candidate) => candidate !== current,
  );
  if (heading === "general") {
    followingCandidates.push("objetivos?\\s+espec(?:í|i)ficos?");
  }
  const following = [...new Set(followingCandidates)].join("|");
  const match = clean(value).match(
    new RegExp(
      `(?:^|\\n)\\s*${current}\\s*:?\\s*([\\s\\S]*?)(?=\\n\\s*(?:${following})\\s*:?|$)`,
      "iu",
    ),
  );
  return match?.[1]?.trim() || null;
}

function classifiedObjectiveCandidates(
  value: string,
  heading: "qualitative" | "quantitative",
): string[] {
  const block = objectiveBlock(value, heading);
  return block ? objectiveCandidates(block) : [];
}

function fillObjectives(
  values: readonly string[],
  count: number,
): string[] {
  const selected = values.slice(0, count);
  return Array.from({ length: count }, (_, index) =>
    selected[index] ? selected[index] : PENDING,
  );
}

function uniqueValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((item) => {
    const key = item
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toLocaleLowerCase("es")
      .replace(/\s+/gu, " ");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const NAVITRANS_SYSTEMS: readonly {
  readonly name: string;
  readonly pattern: RegExp;
}[] = [
  {
    name: "Microsoft Dynamics 365 (D365)",
    pattern: /\b(?:D365|Dynamics\s+365)\b/iu,
  },
  { name: "Cero Papel", pattern: /\bCero\s+Papel\b/iu },
  { name: "Microsoft Teams", pattern: /\b(?:Microsoft\s+)?Teams\b/iu },
  { name: "Microsoft Outlook", pattern: /\b(?:Microsoft\s+)?Outlook\b/iu },
  {
    name: "Microsoft SharePoint",
    pattern: /\b(?:Microsoft\s+)?SharePoint\b/iu,
  },
  { name: "Microsoft Power BI", pattern: /\b(?:Microsoft\s+)?Power\s*BI\b/iu },
  { name: "Microsoft Excel", pattern: /\b(?:Microsoft\s+)?Excel\b/iu },
  { name: "Azure DevOps", pattern: /\bAzure\s+DevOps\b/iu },
  { name: "SAP", pattern: /\bSAP\b/u },
  { name: "Jira", pattern: /\bJira\b/iu },
  {
    name: "Plataforma Lockton",
    pattern: /\b(?:plataforma(?:\s+del\s+proveedor)?\s+)?Lockton\b/iu,
  },
];

export function mentionedNavitransSystems(value: string): string[] {
  return NAVITRANS_SYSTEMS.filter(({ pattern }) => pattern.test(value)).map(
    ({ name }) => name,
  );
}

function diagramItem(value: string): string {
  return value
    .replace(/^(?:[-*•]|\d+[.)])\s*/u, "")
    .replace(
      /^(?:el\s+)?diagrama\s+de\s+flujo\s+(?:AS-IS(?:\s+y\s+TO-BE)?|TO-BE)\s*:?\s*/iu,
      "",
    )
    .replace(
      /^(?:flujo|proceso)\s+(?:AS-IS|TO-BE|actual|propuesto|futuro)\s*:?\s*/iu,
      "",
    )
    .trim();
}

function diagramItems(value: string): string[] {
  return uniqueValues(
    clean(value)
      .split(/\n+|(?<=[.!?;])\s+(?=[A-ZÁÉÍÓÚÑ])/gu)
      .map(diagramItem)
      .filter((item) => item.length >= 12)
      .filter(
        (item) =>
          !/^(?:AS-IS|TO-BE|flujo\s+AS-IS|flujo\s+TO-BE)\s*:?$/iu.test(item),
      ),
  );
}

// AI_ANALYSIS_LOCAL_ONLY_V2_PROCESS_FLOW_HONEST_EMPTY_MODEL_V1
//
// Un flujo (AS-IS o TO-BE) sin evidencia suficiente para representar al
// menos un paso ya no fabrica un carril genérico con un único nodo
// "[PENDIENTE POR DEFINIR]": eso es exactamente el contenido ficticio que el
// contrato canónico rechaza en la validación fuerte. Sin evidencia, el
// resultado correcto es un modelo vacío honesto (arrays vacíos), no una
// aproximación con placeholders.
function emptyFlowModel(title: string, future: boolean) {
  return {
    title,
    objective: future
      ? "Representar el proceso futuro descrito en la evidencia local."
      : "Representar el proceso actual descrito en la evidencia local.",
    lanes: [],
    nodes: [],
    edges: [],
    problems: [],
    improvements: [],
    expectedResults: [],
    sourceIds: [],
  };
}

function flowModel(
  title: string,
  values: readonly string[],
  future: boolean,
  insights: {
    readonly problems?: readonly string[];
    readonly improvements?: readonly string[];
    readonly expectedResults?: readonly string[];
  } = {},
) {
  if (values.length === 0) return emptyFlowModel(title, future);
  const steps = values;
  const laneId = future ? "to-be-system" : "as-is-actor";
  const nodes = steps.map((label, index) => ({
    id: `${future ? "to-be" : "as-is"}-${index + 1}`,
    laneId,
    kind:
      index === 0
        ? "START"
        : index === steps.length - 1
          ? "END"
          : label.includes("?")
            ? "DECISION"
            : "PROCESS",
    label,
  }));
  return {
    title,
    objective: future
      ? "Representar el proceso futuro descrito en la evidencia local."
      : "Representar el proceso actual descrito en la evidencia local.",
    lanes: [
      {
        id: laneId,
        name: future ? "Solución propuesta" : "Proceso actual",
        kind: future ? "SYSTEM" : "ACTOR",
      },
    ],
    nodes,
    edges: nodes.slice(1).map((node, index) => ({
      from: nodes[index]?.id ?? node.id,
      to: node.id,
      label: "",
    })),
    problems: [...(insights.problems ?? [])],
    improvements: [...(insights.improvements ?? [])],
    expectedResults: [...(insights.expectedResults ?? [])],
    sourceIds: [],
  };
}

type LocalFlowLaneKind = "ACTOR" | "SYSTEM";
type LocalFlowNodeKind = "START" | "END" | "PROCESS" | "DECISION";

function slug(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toLocaleLowerCase("es")
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-|-$/gu, "") || "item"
  );
}

// AI_ANALYSIS_LOCAL_ONLY_V2_PROCESS_FLOW_CANONICAL_SECTION_BOUNDARY_V1
//
// Extrae las líneas de un artefacto canónico (AS-IS o TO-BE) desde su
// encabezado hasta el límite del siguiente artefacto. A diferencia de
// flowBlockLines (heredado, pensado para el formato narrativo anterior),
// también se detiene ante cualquier línea ENTIDAD/ATRIBUTO/RELACION: el
// modelo entidad-relación no lleva encabezado "ENTIDADES"/"RELACIONES"
// propio en el contrato canónico nuevo, así que sin este límite adicional
// la extracción de TO-BE se comería por completo las líneas del modelo
// entidad-relación cuando las tres subunidades se concatenan.
function canonicalFlowSectionLines(value: string, heading: RegExp): string[] {
  const lines = value
    .replace(/\r\n?/gu, "\n")
    .split(/\n+/gu)
    .map((line) => line.trim())
    .filter(Boolean);
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return [];
  const stop =
    /^(?:FLUJO\s+(?:AS-IS|TO-BE)|ENTIDAD|ATRIBUTO|RELACI[OÓ]N|ENTIDADES|RELACIONES)\b/iu;
  const end = lines.findIndex((line, index) => index > start && stop.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

// AI_ANALYSIS_LOCAL_ONLY_V2_PROCESS_FLOW_CANONICAL_HEADING_PRESENCE_V1
//
// canonicalFlowSectionLines() devuelve [] tanto cuando el encabezado
// AS-IS/TO-BE no existe como cuando existe pero no trae líneas debajo. Ese
// empate hace que parseCanonicalDiagramFlow("") -> null sea indistinguible
// de "el artefacto no tiene señal canónica propia", y el llamador terminaba
// cayendo al parseo heredado (que fabrica un carril/nodo genérico) para un
// encabezado que en realidad ya existe, solo que vacío. Esta función aísla
// la detección de presencia del encabezado para que un encabezado presente
// con parseo null se resuelva como modelo vacío honesto, nunca heredado.
function canonicalFlowHeadingPresent(value: string, heading: RegExp): boolean {
  return value
    .replace(/\r\n?/gu, "\n")
    .split(/\n+/gu)
    .map((line) => line.trim())
    .some((line) => heading.test(line));
}

// AI_ANALYSIS_LOCAL_ONLY_V2_PROCESS_FLOW_CANONICAL_BLOCK_SIGNAL_V1
//
// Determina si el bloque completo (AS-IS + TO-BE + ER concatenados) trae
// alguna línea estructural canónica propia (CARRIL/NODO/ARISTA para
// AS-IS/TO-BE, ENTIDAD/ATRIBUTO/RELACION para el modelo entidad-relación).
// Un encabezado ambiguo como una línea suelta "TO-BE" (sin ninguna de estas
// líneas debajo) no es, por sí solo, evidencia de que el documento use el
// contrato canónico: también es el pivote que usa el parseo heredado
// (legacyProcessFlowModels) para documentos narrativos previos a ese
// contrato. Sin esta distinción, un documento enteramente heredado con esa
// única línea "TO-BE" quedaba clasificado como artefacto canónico vacío y
// perdía sus nodos TO-BE heredados.
function hasCanonicalStructuralSignal(value: string): boolean {
  const lines = value
    .replace(/\r\n?/gu, "\n")
    .split(/\n+/gu)
    .map((line) => line.trim())
    .filter(Boolean);
  const label = (line: string) =>
    (line.split(/\s*\|\s*/u)[0] ?? "")
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toUpperCase()
      .trim();
  const canonicalLabels = new Set([
    "CARRIL",
    "NODO",
    "ARISTA",
    "ENTIDAD",
    "ATRIBUTO",
    "RELACION",
  ]);
  return lines.some((line) => canonicalLabels.has(label(line)));
}

// AI_ANALYSIS_LOCAL_ONLY_V2_PROCESS_FLOW_CANONICAL_ER_SECTION_V1
//
// Aísla, de cualquier texto (incluido el ensamblado de las tres subunidades
// de processFlow concatenadas), únicamente las líneas que ya declaran una
// etiqueta ENTIDAD/ATRIBUTO/RELACION propia. No depende de encabezados
// "ENTIDADES"/"RELACIONES": el contrato canónico nuevo no los exige.
function canonicalEntityRelationshipSectionLines(value: string): string[] {
  const lines = value
    .replace(/\r\n?/gu, "\n")
    .split(/\n+/gu)
    .map((line) => line.trim())
    .filter(Boolean);
  const label = (line: string) =>
    (line.split(/\s*\|\s*/u)[0] ?? "")
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toUpperCase()
      .trim();
  return lines.filter((line) =>
    ["ENTIDAD", "ATRIBUTO", "RELACION", "RELACIÓN"].includes(label(line)),
  );
}

function flowBlockLines(value: string, heading: RegExp): string[] {
  const lines = value
    .split(/\n+/gu)
    .map((line) => line.trim())
    .filter(Boolean);
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return [];
  const end = lines.findIndex(
    (line, index) =>
      index > start &&
      /^(?:flujo\s+AS-IS|flujo\s+TO-BE|problemas?\s+identificados?|mejoras?\s+del\s+proceso|resultados?\s+esperados?|modelo\s+entidad[- ]relaci[oó]n|entidades|relaciones)\s*:?$/iu.test(
        line,
      ),
  );
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .map((line) => line.replace(/^(?:[-*•]|\d+[.)])\s*/u, "").trim())
    .filter(Boolean);
}

function structuredFlowModel(
  title: string,
  lines: readonly string[],
  future: boolean,
  insights: {
    readonly problems?: readonly string[];
    readonly improvements?: readonly string[];
    readonly expectedResults?: readonly string[];
  },
) {
  const parsed = lines.map((line) => {
    const parts = line.split(/\s*\|\s*/u).filter(Boolean);
    const actor =
      parts.length >= 2
        ? parts[0]!
        : future
          ? "Solución propuesta"
          : "Proceso actual";
    const kindToken = parts.length >= 3 ? parts[1]! : "PROCESO";
    const label =
      parts.length >= 3
        ? parts.slice(2).join(" | ")
        : (parts.at(-1) ?? PENDING);
    const laneKind: LocalFlowLaneKind =
      /sistema|aplicaci[oó]n|plataforma/iu.test(kindToken) ? "SYSTEM" : "ACTOR";
    const nodeKind: LocalFlowNodeKind = /inicio/iu.test(kindToken)
      ? "START"
      : /fin/iu.test(kindToken)
        ? "END"
        : /decisi[oó]n/iu.test(kindToken) || label.includes("?")
          ? "DECISION"
          : "PROCESS";
    return { actor, laneKind, nodeKind, label: diagramItem(label) };
  });
  const usable = parsed.filter((item) => item.label.length >= 3);
  if (usable.length === 0) return flowModel(title, [], future, insights);
  const lanes = uniqueValues(usable.map((item) => item.actor)).map((name) => ({
    id: `${future ? "to-be" : "as-is"}-lane-${slug(name)}`,
    name,
    kind: usable.find((item) => item.actor === name)?.laneKind ?? "ACTOR",
  }));
  const nodes = usable.map((item, index) => ({
    id: `${future ? "to-be" : "as-is"}-${index + 1}`,
    laneId: lanes.find((lane) => lane.name === item.actor)?.id ?? lanes[0]!.id,
    kind: item.nodeKind,
    label: item.label,
  }));
  return {
    title,
    objective: future
      ? "Representar el proceso futuro descrito en la evidencia local."
      : "Representar el proceso actual descrito en la evidencia local.",
    lanes,
    nodes,
    edges: nodes.slice(1).map((node, index) => ({
      from: nodes[index]!.id,
      to: node.id,
      label: "",
    })),
    problems: [...(insights.problems ?? [])],
    improvements: [...(insights.improvements ?? [])],
    expectedResults: [...(insights.expectedResults ?? [])],
    sourceIds: [],
  };
}

function entityRelationshipFromText(value: string) {
  const entityLines = flowBlockLines(value, /^entidades\s*:?$/iu);
  const relationshipLines = flowBlockLines(value, /^relaciones\s*:?$/iu);
  const entities = entityLines.flatMap((line) => {
    const match = line.match(/^([^|:]+)\s*\|\s*(.+)$/u);
    if (!match) return [];
    const name = match[1]!.trim();
    const id = slug(name);
    const attributes = match[2]!.split(/\s*,\s*/u).flatMap((attribute) => {
      const parts = attribute.split(/\s*:\s*/u).filter(Boolean);
      if (!parts[0]) return [];
      const flags = parts.slice(2).join(":");
      return [
        {
          name: parts[0],
          dataType: parts[1] || "Texto",
          primaryKey: /\bPK\b/iu.test(flags),
          foreignKey: /\bFK\b/iu.test(flags),
          required:
            /obligatorio|required/iu.test(flags) || /\bPK\b/iu.test(flags),
        },
      ];
    });
    return [
      {
        id,
        name,
        description: `Entidad ${name} sustentada en la evidencia local.`,
        attributes,
      },
    ];
  });
  // AI_ANALYSIS_LOCAL_ONLY_V2_PROCESS_FLOW_ER_NAME_MATCH_NORMALIZATION_V1
  //
  // Normaliza tildes y espacios además de mayúsculas: una relación no debe
  // perderse silenciosamente solo porque el nombre de la entidad se
  // escribió con una tilde distinta o un espacio extra entre las dos
  // líneas del contrato heredado.
  const normalizeEntityName = (value: string): string =>
    value
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toLocaleLowerCase("es")
      .replace(/\s+/gu, " ")
      .trim();
  const entityIds = new Map(
    entities.map((entity) => [normalizeEntityName(entity.name), entity.id]),
  );
  const relationships = relationshipLines.flatMap((line) => {
    const match = line.match(
      /^([^|]+?)\s+(1:1|1:N|N:1|N:M)\s+([^|]+?)(?:\s*\|\s*(.+))?$/iu,
    );
    if (!match) return [];
    const from = entityIds.get(normalizeEntityName(match[1]!));
    const to = entityIds.get(normalizeEntityName(match[3]!));
    if (!from || !to) return [];
    return [
      {
        from,
        to,
        cardinality: match[2]!.toUpperCase(),
        label: match[4]?.trim() || "relaciona",
      },
    ];
  });
  return entities.length > 0
    ? {
        title: "Modelo entidad-relación",
        entities,
        relationships,
        sourceIds: [],
      }
    : null;
}

// AI_ANALYSIS_LOCAL_ONLY_V2_PROCESS_FLOW_CANONICAL_TO_MODEL_V1
//
// Convierte la estructura ya parseada y validada del contrato canónico al
// mismo shape que el frontend ya consume (lanes/nodes/edges con IDs
// explícitos y aristas con from/to/label reales, en vez de la cadena lineal
// con label vacío que producía el parseo heredado).
function canonicalFlowToStructuredModel(
  title: string,
  flow: {
    readonly lanes: readonly { id: string; name: string; kind: string }[];
    readonly nodes: readonly {
      id: string;
      laneId: string;
      kind: string;
      label: string;
    }[];
    readonly edges: readonly { from: string; to: string; label: string }[];
  },
  future: boolean,
  insights: {
    readonly problems?: readonly string[];
    readonly improvements?: readonly string[];
    readonly expectedResults?: readonly string[];
  },
) {
  return {
    title,
    objective: future
      ? "Representar el proceso futuro descrito en la evidencia local."
      : "Representar el proceso actual descrito en la evidencia local.",
    lanes: flow.lanes.map((lane) => ({
      id: lane.id,
      name: lane.name,
      kind: lane.kind,
    })),
    nodes: flow.nodes.map((node) => ({
      id: node.id,
      laneId: node.laneId,
      kind: node.kind,
      label: node.label,
    })),
    edges: flow.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      label: edge.label,
    })),
    problems: [...(insights.problems ?? [])],
    improvements: [...(insights.improvements ?? [])],
    expectedResults: [...(insights.expectedResults ?? [])],
    sourceIds: [],
  };
}

function canonicalEntityRelationshipToModel(model: {
  readonly entities: readonly {
    id: string;
    name: string;
    description: string;
    attributes: readonly {
      name: string;
      dataType: string;
      keyRole: "PK" | "FK" | "NONE";
      required: boolean;
    }[];
  }[];
  readonly relations: readonly {
    fromEntityId: string;
    toEntityId: string;
    cardinality: string;
    description: string;
  }[];
}) {
  return {
    title: "Modelo entidad-relación",
    entities: model.entities.map((entity) => ({
      id: entity.id,
      name: entity.name,
      description:
        entity.description ||
        `Entidad ${entity.name} sustentada en la evidencia local.`,
      attributes: entity.attributes.map((attribute) => ({
        name: attribute.name,
        dataType: attribute.dataType,
        primaryKey: attribute.keyRole === "PK",
        foreignKey: attribute.keyRole === "FK",
        required: attribute.required,
      })),
    })),
    relationships: model.relations.map((relation) => ({
      from: relation.fromEntityId,
      to: relation.toEntityId,
      cardinality: relation.cardinality,
      label: relation.description || "relaciona",
    })),
    sourceIds: [],
  };
}

type LocalFunctionalStory = {
  code: string;
  title: string;
  description: string;
  assignmentStatus: "ASSIGNED" | "PENDING_ASSIGNMENT";
  documentationStatus: "COMPLETE" | "PENDING_DOCUMENTATION";
  documentationObservation: string | null;
  milestone: string | null;
  functionality: string | null;
  milestoneDescription: string | null;
  assignmentObservation: string | null;
  role: string;
  want: string;
  benefit: string;
  context: string;
  premises: string[];
  impactedSystems: string[];
  fields: Array<{
    name: string;
    dataType: string;
    required: boolean;
    validation: string;
    sourceIds: string[];
  }>;
  acceptanceCriteria: Array<{
    code: string;
    given: string;
    when: string;
    then: string;
    sourceIds: string[];
  }>;
  functionalNeedCodes: string[];
  sourceIds: string[];
};

// AI_ANALYSIS_LOCAL_ONLY_V2_TEXT_SECTIONS_V1
//
// Alcance, Solución propuesta y la sección 10 llegan como texto libre. Estos
// ayudantes separan el texto por rótulos escritos en cualquier posición y por
// viñetas o saltos de línea, sin reutilizar una misma oración en dos lugares.
function splitTextItems(value: string): string[] {
  return value
    .split(/\n+|(?<=[.!?;])\s+(?=[A-ZÁÉÍÓÚÑ¿¡])/gu)
    .map((item) => item.replace(/^\s*(?:[-*•]|\d+[.)])\s*/u, "").trim())
    .filter((item) => item.length >= 6);
}

const PENDING_SECTION_LABELS: ReadonlyArray<{
  readonly key:
    | "assumptions"
    | "dependencies"
    | "pendingItems"
    | "pendingQuestions"
    | "warnings"
    | "contradictions";
  readonly pattern: RegExp;
  readonly prefix?: string;
}> = [
  { key: "assumptions", pattern: /^supuestos?$/iu },
  { key: "dependencies", pattern: /^dependencias?$/iu },
  {
    key: "dependencies",
    pattern: /^restricciones?$/iu,
    prefix: "Restricción: ",
  },
  {
    key: "pendingItems",
    pattern: /^pendientes?(?:\s+(?:funcionales?|abiertos?|documentales?))?$/iu,
  },
  { key: "pendingQuestions", pattern: /^preguntas?\s+pendientes?$/iu },
  {
    key: "warnings",
    pattern: /^(?:aspectos?\s+por\s+(?:revisar|mejorar)|puntos?\s+por\s+mejorar|advertencias?|riesgos?)$/iu,
  },
  { key: "contradictions", pattern: /^contradicci[oó]n(?:es)?(?:\s+por\s+resolver)?$/iu },
];

const PENDING_SECTION_LABEL_SCAN =
  /(?<![\p{L}\p{N}])(supuestos?|dependencias?|restricciones?|pendientes?(?:\s+(?:funcionales?|abiertos?|documentales?))?|preguntas?\s+pendientes?|aspectos?\s+por\s+(?:revisar|mejorar)|puntos?\s+por\s+mejorar|advertencias?|riesgos?|contradicci[oó]n(?:es)?(?:\s+por\s+resolver)?)\s*:\s*/giu;

function pendingSectionFromText(text: string): DocumentJsonValue {
  const matches = [...text.matchAll(PENDING_SECTION_LABEL_SCAN)];
  const lists: Record<string, string[]> = {
    assumptions: [],
    dependencies: [],
    pendingItems: [],
    pendingQuestions: [],
    warnings: [],
    contradictions: [],
  };
  const narrative = text.slice(0, matches[0]?.index ?? text.length).trim();
  matches.forEach((match, index) => {
    const label = PENDING_SECTION_LABELS.find((candidate) =>
      candidate.pattern.test((match[1] ?? "").trim()),
    );
    if (!label) return;
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? text.length;
    for (const item of splitTextItems(text.slice(start, end))) {
      lists[label.key]!.push(`${label.prefix ?? ""}${item}`);
    }
  });
  const unique = (values: string[]) =>
    values.filter((item, position) => values.indexOf(item) === position);
  return {
    narrative: matches.length === 0 ? text : narrative,
    assumptions: unique(lists.assumptions!),
    dependencies: unique(lists.dependencies!),
    pendingItems: unique(lists.pendingItems!),
    pendingQuestions: unique(lists.pendingQuestions!),
    warnings: unique(lists.warnings!),
    // Solo se registra como contradicción lo que el texto rotula como tal; no
    // se crea ninguna contradicción artificial.
    contradictions: unique(lists.contradictions!).map((statement) => ({
      statementA: statement,
      statementB: PENDING,
      decision: PENDING,
    })),
  };
}

const SCOPE_EXCLUSION =
  /fuera de alcance|exclu|no incluye|segunda etapa|posterior|mejoras?\s+futuras?|m[aá]s\s+all[aá]\s+de|fase\s*[2-9]|etapa\s*[2-9]|segunda\s+fase|optimizaci[oó]n\s+avanzada/iu;

function scopeFromText(text: string): DocumentJsonValue {
  const included: string[] = [];
  const excluded: string[] = [];
  // La línea "Sistemas involucrados: ..." alimenta involvedSystems, no el alcance.
  const body = text.replace(/^[ \t]*sistemas\s+involucrados\s*:.*$/gimu, "");
  for (const item of splitTextItems(body)) {
    if (/KPI|l[ií]nea base|riesgo identificado|para medir|sistemas involucrados/iu.test(item)) {
      continue;
    }
    // Un rótulo explícito decide; sin rótulo se usa la detección por palabras.
    const explicit = /^\s*(incluido|incluye|excluido|fuera de alcance)\s*:/iu.exec(
      item,
    );
    const isExcluded = explicit
      ? /^(?:excluido|fuera de alcance)$/iu.test(explicit[1]!)
      : SCOPE_EXCLUSION.test(item);
    (isExcluded ? excluded : included).push(stripLabelPrefix(item));
  }
  const unique = (values: string[]) =>
    values.filter((item, index) => item && values.indexOf(item) === index);
  const includedItems = unique(included).slice(0, 10);
  const excludedItems = unique(excluded).slice(0, 5);
  const systems = mentionedNavitransSystems(text);
  return {
    included: includedItems.length > 0 ? includedItems : [body.trim() || text],
    excluded: excludedItems.length > 0 ? excludedItems : [PENDING],
    involvedSystems: systems.length > 0 ? systems : [PENDING],
    kpis: canonicalExecutionKpis(),
  };
}

const SOLUTION_LABEL_BREAK =
  /\s+(?=(?:Objetivo|Correspondencia\s+AS-IS\/TO-BE|Estado\s+actual(?:\s*\(AS-IS\))?|Evaluaci[oó]n|Resultado(?:\s+esperado)?(?:\s*\(?TO-BE\)?)?|Estado\s+futuro|Componentes?|Elementos?\s+involucrados?)\s*:)/giu;

function solutionProposalFromText(text: string): DocumentJsonValue {
  // Un rótulo suelto ("Correspondencia AS-IS/TO-BE:") no es contenido.
  const segments = splitTextItems(
    text.replace(SOLUTION_LABEL_BREAK, "\n"),
  ).filter((item) => !/^[^:]{1,60}:\s*$/u.test(item));
  const used = new Set<string>();
  const pick = (labelPattern: RegExp, wordPattern: RegExp): string => {
    const found =
      segments.find(
        (item) => !used.has(item) && labelPattern.test(item.slice(0, 60)),
      ) ?? segments.find((item) => !used.has(item) && wordPattern.test(item));
    if (!found) return PENDING;
    used.add(found);
    return stripLabelPrefix(found);
  };
  const objective = (() => {
    const found =
      segments.find((item) => /^\s*objetivo\s*:/iu.test(item)) ??
      segments.find((item) =>
        /objetivo|automatiz|digitaliz|centraliz|implementar/iu.test(item),
      ) ??
      segments[0] ??
      text;
    used.add(found);
    return stripLabelPrefix(found);
  })();
  const currentState = pick(
    /^\s*(?:correspondencia\s+AS-IS\/TO-BE\s*:\s*)?estado\s+actual/iu,
    /actual|AS-IS|hoy|manual/iu,
  );
  const evaluation = pick(
    /^\s*evaluaci[oó]n\s*:/iu,
    /evaluaci|necesidad|brecha|hallazgo|problema/iu,
  );
  const expectedResult = pick(
    /^\s*(?:resultado|estado\s+futuro|TO-BE)/iu,
    /resultado|TO-BE|futuro|permitir[aá]|lograr[aá]/iu,
  );
  const involved = segments
    .filter(
      (item) =>
        !used.has(item) &&
        /componente|integra|sistema|plataforma|ERP|D365|API|formulario|motor|panel/iu.test(
          item,
        ),
    )
    .slice(0, 4);
  involved.forEach((item) => used.add(item));
  const involvedElements = involved
    .map((item) => stripLabelPrefix(item))
    .map((item) =>
      item.length <= 220 ? item : `${truncateAtBoundary(item, 217)}…`,
    );
  // La descripción solo agrega lo que aún no aparece en las demás tarjetas.
  const remaining = segments
    .filter((item) => !used.has(item))
    .map((item) => stripLabelPrefix(item));
  return {
    objective,
    description: joinComplete(remaining, 700) || PENDING,
    involvedElements:
      involvedElements.length > 0 ? involvedElements : [PENDING],
    flowAlignment: { currentState, evaluation, expectedResult },
    prototypeMarkdown: null,
  };
}

// AI_ANALYSIS_LOCAL_ONLY_V2_UNIQUE_CODES_V1
//
// El modelo local reinicia la numeración (FE-001, HU-P-001, T-001, TS-001,
// SP-001) en cada subunidad y el ensamblado concatena los bloques. Estos
// ayudantes conservan el código original la primera vez que aparece y solo
// asignan uno nuevo, libre y consecutivo, a las repeticiones.
function uniqueCode(
  requested: string | undefined,
  prefix: string,
  used: Set<string>,
): string {
  const code = (requested ?? "").trim();
  if (code && !used.has(code.toUpperCase())) {
    used.add(code.toUpperCase());
    return code;
  }
  for (let number = 1; ; number += 1) {
    const candidate = `${prefix}-${String(number).padStart(3, "0")}`;
    if (!used.has(candidate.toUpperCase())) {
      used.add(candidate.toUpperCase());
      return candidate;
    }
  }
}

// Un código de proyecto o de elemento (RQ-2026-000309, FE-001) no describe
// nada: como descripción equivale a no tener descripción.
function isCodeOnlyText(value: string | undefined): boolean {
  return /^[A-Z]{1,6}(?:-[A-Z0-9]{1,12})+$/u.test((value ?? "").trim());
}

function describedOrPending(
  description: string | undefined,
  title: string | undefined,
): string {
  if (description && !isCodeOnlyText(description)) return description;
  if (title && !isCodeOnlyText(title)) return title;
  return PENDING;
}

function requirementsFromText(value: string): DocumentJsonValue {
  const lines = value
    .split(/\n+/gu)
    .map((line) => line.trim())
    .filter(Boolean);
  const stories: LocalFunctionalStory[] = [];
  const nonFunctionalRequirements: Array<Record<string, DocumentJsonValue>> =
    [];
  let milestone: { code: string; title: string; description: string } | null =
    null;
  let story: LocalFunctionalStory | null = null;
  const milestoneByTitle = new Map<
    string,
    { code: string; title: string; description: string }
  >();
  let milestoneSequence = 0;
  let storySequence = 0;
  let acceptanceCriterionSequence = 0;
  let nonFunctionalSequence = 0;

  const structuralTitleKey = (value: string) =>
    value
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toLocaleLowerCase("es")
      .replace(/\s+/gu, " ")
      .trim();

  const parts = (line: string) =>
    line.split(/\s*\|\s*/u).map((item) => item.trim());
  for (const line of lines) {
    const values = parts(line.replace(/^(?:[-*•]|\d+[.)])\s*/u, ""));
    const label = (values[0] ?? "")
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toUpperCase();
    if (label === "HITO") {
      const title = values[2] || PENDING;
      const description = values[3] || PENDING;
      const titleKey = structuralTitleKey(title);
      const existingMilestone = milestoneByTitle.get(titleKey);

      if (existingMilestone) {
        milestone = existingMilestone;
      } else {
        milestoneSequence += 1;
        milestone = {
          code: `H-${String(milestoneSequence).padStart(3, "0")}`,
          title,
          description,
        };
        milestoneByTitle.set(titleKey, milestone);
      }

      story = null;
      continue;
    }
    if (label === "HU" || label === "HISTORIA") {
      const assigned = Boolean(milestone);
      story = {
        code: `HU-F-${String(++storySequence).padStart(3, "0")}`,
        title: values[2] || PENDING,
        description: values[3] || values[2] || PENDING,
        assignmentStatus: assigned ? "ASSIGNED" : "PENDING_ASSIGNMENT",
        documentationStatus: "PENDING_DOCUMENTATION",
        documentationObservation: null,
        milestone: milestone?.code ?? null,
        functionality: milestone?.title ?? null,
        milestoneDescription: milestone?.description ?? null,
        assignmentObservation: assigned
          ? null
          : "No existe evidencia suficiente para asignar esta historia a un hito.",
        role: PENDING,
        want: PENDING,
        benefit: PENDING,
        context: PENDING,
        premises: [],
        impactedSystems: [],
        fields: [],
        acceptanceCriteria: [],
        functionalNeedCodes: [],
        sourceIds: [],
      };
      stories.push(story);
      continue;
    }
    if (label === "RNF") {
      nonFunctionalRequirements.push({
        code: `RNF-${String(++nonFunctionalSequence).padStart(3, "0")}`,
        title: values[2] || PENDING,
        description: values[3] || values[2] || PENDING,
        requirementType: "NON_FUNCTIONAL",
        category: values[4] || PENDING,
        measure: values[5] || PENDING,
        target: values[6] || PENDING,
        acceptanceCriteria: values[7] ? [values[7]] : [],
        sourceIds: [],
      });
      story = null;
      continue;
    }
    if (!story) continue;
    if (label === "COMO") story.role = values.slice(1).join(" | ") || PENDING;
    else if (label === "QUIERO")
      story.want = values.slice(1).join(" | ") || PENDING;
    else if (label === "PARA")
      story.benefit = values.slice(1).join(" | ") || PENDING;
    else if (label === "CONTEXTO")
      story.context = values.slice(1).join(" | ") || PENDING;
    else if (label === "PREMISA" && values[1])
      story.premises.push(values.slice(1).join(" | "));
    else if (label === "SISTEMA" && values[1])
      story.impactedSystems.push(values.slice(1).join(" | "));
    else if (label === "CAMPO" && values[1]) {
      story.fields.push({
        name: values[1],
        dataType: values[2] || "Texto",
        required: /^(?:SI|SÍ|TRUE|OBLIGATORIO)$/iu.test(values[3] || ""),
        validation: values[4] || PENDING,
        sourceIds: [],
      });
    } else if (label === "CA") {
      story.acceptanceCriteria.push({
        code: `CA-F-${String(++acceptanceCriterionSequence).padStart(3, "0")}`,
        given: values[2] || PENDING,
        when: values[3] || PENDING,
        then: values[4] || PENDING,
        sourceIds: [],
      });
    }
  }

  for (const item of stories) {
    const hasDefinedCoreFields = [
      item.role,
      item.want,
      item.benefit,
      item.context,
    ].every((field) => !isPendingFieldValue(field));
    const hasValidAcceptanceCriterion = item.acceptanceCriteria.some(
      (criterion) =>
        !isPendingFieldValue(criterion.given) &&
        !isPendingFieldValue(criterion.when) &&
        !isPendingFieldValue(criterion.then),
    );
    const complete = hasDefinedCoreFields && hasValidAcceptanceCriterion;
    item.documentationStatus = complete ? "COMPLETE" : "PENDING_DOCUMENTATION";
    item.documentationObservation = complete
      ? null
      : "Falta evidencia para completar uno o más elementos obligatorios de la historia de usuario.";
  }

  return {
    functionalRequirements: stories,
    nonFunctionalRequirements,
    pendingFunctionalNeeds: [],
  };
}

function backlogFromText(value: string): DocumentJsonValue {
  type Task = Record<string, DocumentJsonValue>;
  type PlanningStory = Record<string, DocumentJsonValue> & { tasks: Task[] };
  type Feature = Record<string, DocumentJsonValue> & {
    userStories: PlanningStory[];
  };
  type Epic = Record<string, DocumentJsonValue> & { features: Feature[] };

  const epics: Epic[] = [];
  let epic: Epic | null = null;
  let feature: Feature | null = null;
  let story: PlanningStory | null = null;
  const usedFeatureCodes = new Set<string>();
  const usedStoryCodes = new Set<string>();
  const usedTaskCodes = new Set<string>();
  // Código original → código vigente (las dependencias apuntan a tareas ya
  // definidas de la misma subunidad, por lo que se resuelven hacia atrás).
  const taskCodeByOriginal = new Map<string, string>();
  const split = (line: string) =>
    line.split(/\s*\|\s*/u).map((item) => item.trim());

  for (const rawLine of value
    .split(/\n+/gu)
    .map((line) => line.trim())
    .filter(Boolean)) {
    const values = split(rawLine.replace(/^(?:[-*•]|\d+[.)])\s*/u, ""));
    const label = (values[0] ?? "")
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toUpperCase();
    if (label === "EPICA" || label === "EPIC") {
      epic = {
        // LOCAL_ONLY_V2: cada raíz visible necesita una key canónica única.
        // El modelo puede reiniciar EP-001 en cada microbloque.
        code: `EP-${String(epics.length + 1).padStart(3, "0")}`,
        title: values[2] || PENDING,
        description: describedOrPending(values[3], values[2]),
        sourceNumber: values[4] || null,
        sourceIds: [],
        features: [],
      };
      epics.push(epic);
      feature = null;
      story = null;
      continue;
    }
    if ((label === "FEATURE" || label === "CARACTERISTICA") && epic) {
      feature = {
        code: uniqueCode(values[1], "FE", usedFeatureCodes),
        title: values[2] || PENDING,
        description: describedOrPending(values[3], values[2]),
        sourceNumber: values[4] || null,
        sourceIds: [],
        userStories: [],
      };
      epic.features.push(feature);
      story = null;
      continue;
    }
    if ((label === "HU-P" || label === "HISTORIA") && feature) {
      story = {
        code: uniqueCode(values[1], "HU-P", usedStoryCodes),
        title: values[2] || PENDING,
        description: describedOrPending(values[3], values[2]),
        sourceNumber: values[4] || null,
        functionalRequirementCodes: (values[5] || "")
          .split(/\s*,\s*/u)
          .filter(Boolean),
        sourceIds: [],
        tasks: [],
      };
      feature.userStories.push(story);
      continue;
    }
    if ((label === "TAREA" || label === "TASK") && story) {
      const requestedType = (values[5] || "ANALYSIS").toUpperCase();
      const allowedTypes = new Set([
        "ANALYSIS",
        "DESIGN",
        "DEVELOPMENT",
        "CONFIGURATION",
        "INTEGRATION",
        "DATA",
        "TESTING",
        "UAT",
        "DOCUMENTATION",
        "DEPLOYMENT",
      ]);
      const taskCode = uniqueCode(values[1], "T", usedTaskCodes);
      const dependencyCodes = (values[7] || "")
        .split(/\s*,\s*/u)
        .filter(Boolean)
        .map((code) => taskCodeByOriginal.get(code.toUpperCase()) ?? code);
      if (values[1]) taskCodeByOriginal.set(values[1].toUpperCase(), taskCode);
      story.tasks.push({
        code: taskCode,
        title: values[2] || PENDING,
        description: describedOrPending(values[3], values[2]),
        sourceNumber: values[4] || null,
        type: allowedTypes.has(requestedType) ? requestedType : "ANALYSIS",
        origin: /IMPLEMENTATION_PROPOSAL/iu.test(values[6] || "")
          ? "IMPLEMENTATION_PROPOSAL"
          : "EVIDENCE",
        dependencyCodes,
        sourceIds: [],
      });
    }
  }

  return {
    structureStatus: "AI_SUGGESTED",
    epics,
    pendingAssignments: { features: [], userStories: [], tasks: [] },
  };
}

function testsFromText(value: string): DocumentJsonValue {
  const usedScenarioCodes = new Set<string>();
  const scenarios = value
    .split(/\n+/gu)
    .map((line) => line.trim().replace(/^(?:[-*•]|\d+[.)])\s*/u, ""))
    .filter(Boolean)
    .flatMap((line) => {
      const values = line.split(/\s*\|\s*/u).map((item) => item.trim());
      const label = (values[0] ?? "")
        .normalize("NFD")
        .replace(/\p{M}+/gu, "")
        .toUpperCase();
      if (label !== "PRUEBA" && label !== "TEST") return [];
      const codes = (position: number) =>
        (values[position] || "").split(/\s*,\s*/u).filter(Boolean);
      return [
        {
          code: uniqueCode(values[1], "TS", usedScenarioCodes),
          title: values[2] || PENDING,
          userStoryCodes: codes(3),
          acceptanceCriterionCodes: codes(4),
          taskCodes: codes(5),
          precondition: values[6] || PENDING,
          action: values[7] || PENDING,
          expectedResult: values[8] || PENDING,
          sourceIds: [],
        },
      ];
    });
  return { scenarios };
}

function scrumPlanFromText(value: string): DocumentJsonValue {
  type ScrumTask = Record<string, DocumentJsonValue>;
  type ScrumSprint = Record<string, DocumentJsonValue> & { tasks: ScrumTask[] };
  const sprints: ScrumSprint[] = [];
  const sprintByCode = new Map<string, ScrumSprint>();
  const usedSprintCodes = new Set<string>();
  const usedSprintNumbers = new Set<number>();
  const usedScrumTaskCodes = new Set<string>();
  const scrumTaskCodeByOriginal = new Map<string, string>();
  const list = (field = "") =>
    field
      .split(/\s*,\s*/u)
      .map((item) => item.trim())
      .filter(Boolean);
  const allowedTypes = new Set([
    "ANALYSIS",
    "DESIGN",
    "DEVELOPMENT",
    "CONFIGURATION",
    "INTEGRATION",
    "DATA",
    "TESTING",
    "UAT",
    "DOCUMENTATION",
    "DEPLOYMENT",
  ]);

  for (const rawLine of value
    .split(/\n+/gu)
    .map((line) => line.trim())
    .filter(Boolean)) {
    const values = rawLine
      .replace(/^(?:[-*•]|\d+[.)])\s*/u, "")
      .split(/\s*\|\s*/u)
      .map((item) => item.trim());
    const label = (values[0] ?? "")
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toUpperCase();

    if (label === "SPRINT") {
      // El modelo repite "SP-001 / 1" en cada subunidad: un número o código
      // ya usado recibe el siguiente libre para que los Sprints se escalonen.
      let number = Math.max(
        1,
        Number.parseInt(values[2] || "", 10) || sprints.length + 1,
      );
      while (usedSprintNumbers.has(number)) number += 1;
      usedSprintNumbers.add(number);
      const code = uniqueCode(
        values[1] || `SP-${String(number).padStart(3, "0")}`,
        "SP",
        usedSprintCodes,
      );
      const sprint: ScrumSprint = {
        code,
        number,
        objective: values[3] || PENDING,
        featureCodes: list(values[4]),
        userStoryCodes: list(values[5]),
        tasks: [],
        dependencies: list(values[6]),
        testCodes: list(values[7]),
        deliverables: list(values[8]),
        closingCriterion: values[9] || PENDING,
        risks: list(values[10]),
      };
      sprints.push(sprint);
      // Las tareas se enlazan por el código que escribió el modelo (el último
      // Sprint declarado con ese código), no por el código ya renumerado.
      sprintByCode.set((values[1] || code).toUpperCase(), sprint);
      continue;
    }

    if (label !== "TAREA" && label !== "TASK") continue;
    // Una tarea cuyo Sprint no fue declarado se asigna al último Sprint
    // declarado en lugar de perderse; sin ningún Sprint no hay dónde ubicarla.
    const sprint =
      sprintByCode.get((values[1] || "").toUpperCase()) ??
      sprints[sprints.length - 1];
    if (!sprint) continue;
    const sprintNumber = Number(sprint.number);
    const sprintStart = (sprintNumber - 1) * 15 + 1;
    const sprintEnd = sprintNumber * 15;
    const requestedStart = Number.parseInt(values[10] || "", 10);
    const startDay = Math.min(
      sprintEnd,
      Math.max(
        sprintStart,
        Number.isFinite(requestedStart) ? requestedStart : sprintStart,
      ),
    );
    const requestedEnd = Number.parseInt(values[11] || "", 10);
    const requestedDuration = Number.parseInt(values[9] || "", 10);
    const inferredEnd = startDay + Math.max(1, requestedDuration || 1) - 1;
    const endDay = Math.min(
      sprintEnd,
      Math.max(
        startDay,
        Number.isFinite(requestedEnd) ? requestedEnd : inferredEnd,
      ),
    );
    const scrumTaskCode = uniqueCode(values[2], "T", usedScrumTaskCodes);
    const scrumDependencyCodes = list(values[7]).map(
      (code) => scrumTaskCodeByOriginal.get(code.toUpperCase()) ?? code,
    );
    if (values[2]) {
      scrumTaskCodeByOriginal.set(values[2].toUpperCase(), scrumTaskCode);
    }
    sprint.tasks.push({
      code: scrumTaskCode,
      type: allowedTypes.has((values[3] || "").toUpperCase())
        ? (values[3] || "").toUpperCase()
        : "ANALYSIS",
      description: values[4] || PENDING,
      userStoryCode: values[5] || PENDING,
      suggestedRole: values[6] || PENDING,
      dependencyCodes: scrumDependencyCodes,
      expectedResult: values[8] || PENDING,
      estimatedDurationDays: endDay - startDay + 1,
      startDay,
      endDay,
    });
  }

  const scheduled = new Map<string, { endDay: number }>();
  for (const sprint of sprints) {
    const sprintNumber = Number(sprint.number);
    const sprintStart = (sprintNumber - 1) * 15 + 1;
    const sprintEnd = sprintNumber * 15;
    for (const task of sprint.tasks) {
      const validDependencies = list(String(task.dependencyCodes ?? "")).filter(
        (code) => scheduled.has(code.toUpperCase()),
      );
      const dependencyEnd = validDependencies.reduce(
        (maximum, code) =>
          Math.max(maximum, scheduled.get(code.toUpperCase())?.endDay ?? 0),
        0,
      );
      const duration = Math.max(1, Number(task.estimatedDurationDays) || 1);
      const requestedStart = Math.max(
        sprintStart,
        Number(task.startDay) || sprintStart,
      );
      const startDay = Math.max(
        requestedStart,
        dependencyEnd + (dependencyEnd > 0 ? 1 : 0),
      );
      if (startDay > sprintEnd) {
        task.dependencyCodes = [];
        task.startDay = requestedStart;
        task.endDay = Math.min(sprintEnd, requestedStart + duration - 1);
      } else {
        task.dependencyCodes = validDependencies;
        task.startDay = startDay;
        task.endDay = Math.min(sprintEnd, startDay + duration - 1);
      }
      task.estimatedDurationDays =
        Number(task.endDay) - Number(task.startDay) + 1;
      scheduled.set(String(task.code).toUpperCase(), {
        endDay: Number(task.endDay),
      });
    }
  }

  return {
    cadenceDays: 15,
    scheduleBasis: "RELATIVE_DAY",
    confirmedStartDate: null,
    sourceIds: [],
    sprints,
  };
}

function structuredProblemDescriptionFromText(
  value: string,
): { currentState: string; operationalImpact: string[] } | null {
  const lines = clean(value)
    .split(/\n+/gu)
    .map((line) => line.trim())
    .filter(Boolean);

  let currentState = "";
  let currentStateCount = 0;
  const impacts: string[] = [];
  let recognized = 0;

  for (const line of lines) {
    const parts = line.split(/\s*\|\s*/u);
    const rawLabel = parts.shift()?.trim() ?? "";
    const label = rawLabel
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toUpperCase()
      .replace(/\s+/gu, "_")
      .trim();
    const valueText = parts.join(" | ").trim();

    if (label === "SITUACION_ACTUAL") {
      currentStateCount += 1;
      recognized += 1;
      if (valueText) currentState = valueText;
      continue;
    }

    if (label === "IMPACTO") {
      recognized += 1;
      if (valueText) impacts.push(valueText);
    }
  }

  if (
    recognized !== lines.length ||
    currentStateCount !== 1 ||
    !currentState ||
    impacts.length < 1 ||
    impacts.length > 5
  ) {
    return null;
  }

  return {
    currentState,
    operationalImpact: uniqueValues(impacts).slice(0, 5),
  };
}

// AI_ANALYSIS_LOCAL_ONLY_V2_PROCESS_FLOW_LEGACY_COMPATIBILITY_V1
//
// Parseo heredado (formato narrativo previo al contrato canónico
// CARRIL/NODO/ARISTA). Solo se invoca, por artefacto, cuando ese artefacto
// (AS-IS o TO-BE) no trae ninguna señal canónica propia. No fabrica un
// resultado con placeholder cuando no hay evidencia: structuredFlowModel /
// flowModel devuelven un modelo vacío honesto en ese caso.
function legacyProcessFlowModels(text: string): {
  readonly asIs: ReturnType<typeof structuredFlowModel>;
  readonly toBe: ReturnType<typeof structuredFlowModel>;
} {
  const rawLines = clean(text)
    .split(/\n+/gu)
    .map((line) => line.replace(/^(?:[-*•]|\d+[.)])\s*/u, "").trim())
    .filter(Boolean);
  const pivot = rawLines.findIndex((line) =>
    /^(?:flujo\s+)?TO-BE\s*:?$|^proceso\s+(?:propuesto|futuro)\s*:?$/iu.test(
      line,
    ),
  );
  const all = diagramItems(text);
  const asIsBlock = flowBlockLines(text, /^(?:flujo\s+)?AS-IS\s*:?$/iu);
  const toBeBlock = flowBlockLines(text, /^(?:flujo\s+)?TO-BE\s*:?$/iu);
  const explicitAsIs =
    asIsBlock.length > 0
      ? diagramItems(asIsBlock.join("\n"))
      : pivot > 0
        ? diagramItems(rawLines.slice(0, pivot).join("\n"))
        : [];
  const explicitToBe =
    toBeBlock.length > 0
      ? diagramItems(toBeBlock.join("\n"))
      : pivot >= 0
        ? diagramItems(rawLines.slice(pivot + 1).join("\n"))
        : [];
  const explicitProblems = flowBlockLines(
    text,
    /^problemas?\s+identificados?\s*:?$/iu,
  );
  const explicitImprovements = flowBlockLines(
    text,
    /^mejoras?\s+del\s+proceso\s*:?$/iu,
  );
  const explicitResults = flowBlockLines(
    text,
    /^resultados?\s+esperados?\s*:?$/iu,
  );
  const problems = all.filter(
    (item) =>
      /problema|error|demora|retras|riesgo|reproceso|dificultad|p[eé]rdida|sobrecarga|manual|dependencia|rechazo|ineficien|omisi|carece|no existe/iu.test(
        item,
      ) &&
      !/TO-BE|futuro|propuest|soluci[oó]n|mejora|resultado esperado/iu.test(
        item,
      ),
  );
  const improvements = all.filter(
    (item) =>
      /automatiz|digitaliz|integr|centraliz|estandariz|optim|mejor|formulario|notificaci[oó]n autom|validaci[oó]n autom|trazabilidad|TO-BE|futuro|propuest/iu.test(
        item,
      ) &&
      !/problema identificado|situaci[oó]n actual|proceso actual/iu.test(
        item,
      ),
  );
  const expectedResults = all
    .filter((item) =>
      /resultado|permitir|garantiz|reduc|elimin|agiliz|asegur|beneficio|lograr|disminu|increment/iu.test(
        item,
      ),
    )
    .slice(0, 8);
  const inferredAsIs = all.filter(
    (item) =>
      /AS-IS|actual|actualmente|manual|correo|se registra|se realiza|se valida|se env[ií]a|se recibe/iu.test(
        item,
      ) && !/TO-BE|futuro|propuest|automatiz|digitaliz/iu.test(item),
  );
  const inferredToBe = all.filter((item) =>
    /TO-BE|futuro|propuest|automatiz|digitaliz|integr|formulario|notificaci[oó]n autom|validaci[oó]n autom/iu.test(
      item,
    ),
  );
  const asIsSteps = uniqueValues(
    explicitAsIs.length > 0 ? explicitAsIs : inferredAsIs,
  );
  const toBeSteps = uniqueValues(
    explicitToBe.length > 0
      ? explicitToBe
      : inferredToBe.length > 0
        ? inferredToBe
        : improvements,
  );
  const supportedProblems =
    explicitProblems.length > 0 ? explicitProblems : problems;
  const supportedImprovements =
    explicitImprovements.length > 0 ? explicitImprovements : improvements;
  const supportedResults =
    explicitResults.length > 0 ? explicitResults : expectedResults;
  return {
    asIs: structuredFlowModel(
      "Flujo AS-IS",
      asIsBlock.length > 0 ? asIsBlock : asIsSteps,
      false,
      {
        problems: uniqueValues(supportedProblems).slice(0, 5),
      },
    ),
    toBe: structuredFlowModel(
      "Flujo TO-BE",
      toBeBlock.length > 0 ? toBeBlock : toBeSteps,
      true,
      {
        improvements: uniqueValues(supportedImprovements).slice(0, 5),
        expectedResults: uniqueValues(supportedResults).slice(0, 8),
      },
    ),
  };
}

export function normalizeLocalOnlyV2SectionContent(
  key: string,
  proposed: DocumentJsonValue,
  current: DocumentJsonValue,
): DocumentJsonValue {
  if (typeof proposed !== "string") return proposed;
  const text = clean(proposed);
  if (!text) return current;

  switch (key) {
    case "header":
      // Código, versión, fecha, área y estado pertenecen al documento real.
      return current;
    case "objectives": {
      const general =
        objectiveBlock(text, "general") ?? objectiveCandidates(text)[0] ?? text;
      const candidates = objectiveCandidates(text).filter(
        (item) => item !== general,
      );
      const explicitQualitative = classifiedObjectiveCandidates(
        text,
        "qualitative",
      );
      const explicitQuantitative = classifiedObjectiveCandidates(
        text,
        "quantitative",
      );
      const quantitative =
        explicitQuantitative.length > 0
          ? explicitQuantitative
          : candidates.filter((item) =>
              /(?:\b\d+(?:[.,]\d+)?\b|%|porcentaje|cantidad|volumen|tiempo|plazo|frecuencia|tasa|meta|medir|indicador|línea\s+base)/iu.test(
                item,
              ),
            );
      const quantitativeSet = new Set(quantitative);
      const qualitative =
        explicitQualitative.length > 0
          ? explicitQualitative
          : candidates.filter((item) => !quantitativeSet.has(item));
      return {
        general,
        qualitative: fillObjectives(qualitative, 4),
        quantitative: fillObjectives(quantitative, 3),
      };
    }
    case "problemDescription": {
      const structured = structuredProblemDescriptionFromText(text);
      if (structured) return structured;

      const all = uniqueValues(sentences(text));
      const impacts = all
        .map((item) =>
          item
            .replace(
              /^(?:los\s+)?impactos?\s+(?:operacionales?|operativos?)(?:\s+identificados?)?\s*:\s*(?:\d{1,2}[.)]?\s*)?/iu,
              "",
            )
            .replace(/\s+[1-5][.)]\s*$/u, "")
            .trim(),
        )
        .filter((item) => item.length >= 12)
        .filter(
          (item) =>
            !/^situaci[oó]n\s+actual\s*:/iu.test(item) &&
            /impact|problema|error|demora|retras|riesgo|reproceso|dificultad|p[eé]rdida|sobrecarga|ineficien|omisi|rechazo|dependencia|trazabil|duplic|inconsisten|espera|costo|incumpl/iu.test(
              item,
            ) &&
            !/se busca|se propone|soluci[oó]n|TO-BE|l[ií]nea base|para medir|resultado esperado/iu.test(
              item,
            ),
        )
        .slice(0, 5);
      const currentStateCandidates = all.filter(
        (item) =>
          /actual|actualmente|hoy|manual|depende|se realiza|se gestiona|carece|no existe/iu.test(
            item,
          ) &&
          !/se busca|se propone|soluci[oó]n|TO-BE|futuro|requiere implementar/iu.test(
            item,
          ),
      );
      const currentState =
        joinComplete(
          (currentStateCandidates.length > 0
            ? currentStateCandidates
            : all
          ).slice(0, 4),
          700,
        ) || PENDING;
      return {
        currentState,
        operationalImpact:
          impacts.length > 0 ? uniqueValues(impacts) : [PENDING],
      };
    }
    case "scope":
      return scopeFromText(text);
    case "solutionProposal":
      return solutionProposalFromText(text);
    case "assumptionsDependenciesPending":
      return pendingSectionFromText(text);
    case "processFlow": {
      // AI_ANALYSIS_LOCAL_ONLY_V2_PROCESS_FLOW_CANONICAL_NORMALIZATION_V2
      //
      // Punto 6: AS-IS, TO-BE y el modelo entidad-relación se normalizan de
      // forma independiente. Cada artefacto intenta primero el contrato
      // canónico por identificador estable (CARRIL/NODO/ARISTA/PROBLEMA/
      // MEJORA/RESULTADO para AS-IS/TO-BE; ENTIDAD/ATRIBUTO/RELACION para el
      // modelo ER). Un artefacto que ya trae señal canónica propia (aunque
      // sea inválida) nunca cae al parseo heredado: eso fabricaría contenido
      // a partir de líneas que el propio artefacto ya reconoció y rechazó.
      // El parseo heredado solo aplica como compatibilidad cuando el
      // artefacto no presenta ninguna señal canónica (documentos previos a
      // esta corrección).
      const canonicalAsIsLines = canonicalFlowSectionLines(
        text,
        /^(?:flujo\s+)?AS-IS\s*:?$/iu,
      );
      const canonicalToBeLines = canonicalFlowSectionLines(
        text,
        /^(?:flujo\s+)?TO-BE\s*:?$/iu,
      );
      const canonicalAsIsFlow = parseCanonicalDiagramFlow(
        canonicalAsIsLines.join("\n"),
      );
      const canonicalToBeFlow = parseCanonicalDiagramFlow(
        canonicalToBeLines.join("\n"),
      );
      // AI_ANALYSIS_LOCAL_ONLY_V2_PROCESS_FLOW_CANONICAL_HEADING_PRESENCE_USE_V1
      //
      // Un encabezado "FLUJO AS-IS"/"FLUJO TO-BE" presente pero sin líneas
      // debajo produce canonicalXxxFlow === null igual que un encabezado
      // ausente. Se distingue explícitamente para no fabricar contenido con
      // el parseo heredado cuando el artefacto ya declaró su encabezado
      // canónico propio (aunque esté vacío).
      const asIsHeadingPresent = canonicalFlowHeadingPresent(
        text,
        /^(?:flujo\s+)?AS-IS\s*:?$/iu,
      );
      const toBeHeadingPresent = canonicalFlowHeadingPresent(
        text,
        /^(?:flujo\s+)?TO-BE\s*:?$/iu,
      );
      const canonicalAsIsValid =
        canonicalAsIsFlow !== null &&
        validateCanonicalDiagramFlow(canonicalAsIsFlow).valid;
      const canonicalToBeValid =
        canonicalToBeFlow !== null &&
        validateCanonicalDiagramFlow(canonicalToBeFlow).valid;
      // El texto ensamblado concatena las tres subunidades (AS-IS, TO-BE,
      // ER) del mismo bloque visible; parsear el modelo entidad-relación
      // sobre el texto COMPLETO haría que cada línea CARRIL/NODO/ARISTA de
      // AS-IS/TO-BE apareciera como "unrecognizedLines" para el parser de
      // ER e invalidara un modelo por lo demás correcto. Se aísla primero
      // solo lo que ya trae una etiqueta ENTIDAD/ATRIBUTO/RELACION.
      const canonicalEntityModel = parseCanonicalEntityRelationshipModel(
        canonicalEntityRelationshipSectionLines(text).join("\n"),
      );
      const canonicalEntityModelValid =
        canonicalEntityModel !== null &&
        canonicalEntityModel.entities.length > 0 &&
        validateCanonicalEntityRelationshipModel(canonicalEntityModel).valid;

      // Un encabezado AS-IS/TO-BE ambiguo solo cuenta como artefacto
      // canónico (heading-only) cuando el bloque completo trae alguna señal
      // estructural canónica propia; si no trae ninguna, el documento es
      // enteramente heredado y ambos lados deben usar el parseo heredado
      // aunque el pivote narrativo "TO-BE" coincida con ese encabezado.
      const hasCanonicalArtifactSignal = hasCanonicalStructuralSignal(text);

      // AI_ANALYSIS_LOCAL_ONLY_V2_PROCESS_FLOW_INDEPENDENT_ER_V1
      //
      // El modelo ER se decide únicamente por su propia señal canónica: si
      // ya trae ENTIDAD/ATRIBUTO/RELACION pero no es válido (por ejemplo,
      // cero entidades reconocidas), el resultado es null en vez de
      // reinterpretar el texto completo con el parser heredado.
      const entityRelationship = canonicalEntityModel
        ? canonicalEntityModelValid
          ? canonicalEntityRelationshipToModel(canonicalEntityModel)
          : null
        : entityRelationshipFromText(text);

      // Solo se calcula el parseo heredado cuando al menos un lado (AS-IS o
      // TO-BE) no presenta ni encabezado ni señal canónica propia; es una
      // única pasada sobre el texto completo que produce ambos lados, y cada
      // lado se usa solo si su propio artefacto no tiene encabezado canónico
      // (compatibilidad con documentos previos a este contrato).
      const legacy =
        !hasCanonicalArtifactSignal || !asIsHeadingPresent || !toBeHeadingPresent
          ? legacyProcessFlowModels(text)
          : null;

      const asIs = canonicalAsIsFlow
        ? canonicalAsIsValid
          ? canonicalFlowToStructuredModel(
              "Flujo AS-IS",
              canonicalAsIsFlow,
              false,
              { problems: canonicalAsIsFlow.problems.slice(0, 5) },
            )
          : emptyFlowModel("Flujo AS-IS", false)
        : asIsHeadingPresent && hasCanonicalArtifactSignal
          ? emptyFlowModel("Flujo AS-IS", false)
          : legacy!.asIs;

      const toBe = canonicalToBeFlow
        ? canonicalToBeValid
          ? canonicalFlowToStructuredModel(
              "Flujo TO-BE",
              canonicalToBeFlow,
              true,
              {
                improvements: canonicalToBeFlow.improvements.slice(0, 5),
                expectedResults: canonicalToBeFlow.results.slice(0, 8),
              },
            )
          : emptyFlowModel("Flujo TO-BE", true)
        : toBeHeadingPresent && hasCanonicalArtifactSignal
          ? emptyFlowModel("Flujo TO-BE", true)
          : legacy!.toBe;

      return {
        processFlows: { asIs, toBe },
        entityRelationship,
      };
    }
    case "milestones":
      return requirementsFromText(text);
    case "backlogStructure":
      return backlogFromText(text);
    case "tests":
      return testsFromText(text);
    case "scrumPlan": {
      const plan = scrumPlanFromText(text);
      const planRecord = plan as Record<string, DocumentJsonValue>;
      return Array.isArray(planRecord.sprints) && planRecord.sprints.length > 0
        ? plan
        : current;
    }
    case "automationInstruction":
      return {
        kpis: kpisFromText(text),
        dataSource: "AZURE_DEVOPS_EXECUTION",
        currentValues: [0, 0, 0],
      };
    default:
      return proposed;
  }
}
