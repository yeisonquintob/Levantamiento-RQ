// LOCAL_ONLY_V2_PROCESS_FLOW_DIAGRAM_CONTRACT
//
// Pruebas unitarias directas del contrato canónico de diagramas (parseo,
// validación fuerte y fallback determinista), independientes de la
// generación con Ollama. Complementan las pruebas de extremo a extremo en
// local-only-v2-inference-budget.test.ts y local-only-v2-process-flow-diagram.test.ts.
import assert from "node:assert/strict";
import test from "node:test";

import {
  deterministicDiagramFlowFallback,
  deterministicEntityRelationshipFallback,
  parseCanonicalDiagramFlow,
  parseCanonicalEntityRelationshipModel,
  validateCanonicalDiagramFlow,
  validateCanonicalEntityRelationshipModel,
} from "../../apps/ai-analysis-service/src/execution/local-only-v2-diagram-contract.js";
import { normalizeLocalOnlyV2SectionContent } from "../../apps/ai-analysis-service/src/execution/local-only-v2-section-content.js";

const VALID_AS_IS = [
  "FLUJO AS-IS",
  "CARRIL | ASIS-L01 | Solicitante | ACTOR",
  "CARRIL | ASIS-L02 | Sistema origen | SYSTEM",
  "NODO | ASIS-N01 | ASIS-L01 | START | Inicia la solicitud",
  "NODO | ASIS-N02 | ASIS-L02 | SYSTEM | Consulta la información",
  "NODO | ASIS-N03 | ASIS-L01 | DECISION | ¿La información está completa?",
  "NODO | ASIS-N04 | ASIS-L01 | PROCESS | Corrige la información",
  "NODO | ASIS-N05 | ASIS-L01 | END | Finaliza el proceso",
  "ARISTA | ASIS-N01 | ASIS-N02 | ",
  "ARISTA | ASIS-N02 | ASIS-N03 | ",
  "ARISTA | ASIS-N03 | ASIS-N04 | No",
  "ARISTA | ASIS-N03 | ASIS-N05 | Sí",
  "PROBLEMA | La validación manual genera reprocesos.",
].join("\n");

test("parseCanonicalDiagramFlow reconoce el contrato canónico y devuelve null ante el formato heredado", () => {
  const parsed = parseCanonicalDiagramFlow(VALID_AS_IS);
  assert.ok(parsed);
  assert.equal(parsed!.lanes.length, 2);
  assert.equal(parsed!.nodes.length, 5);
  assert.equal(parsed!.edges.length, 4);
  assert.deepEqual(parsed!.problems, [
    "La validación manual genera reprocesos.",
  ]);
  assert.equal(parsed!.unrecognizedLines.length, 0);

  const legacy = [
    "Solicitante | INICIO | Inicia la necesidad del trámite",
    "Solicitante | PROCESO | Registra la información inicial",
  ].join("\n");
  assert.equal(parseCanonicalDiagramFlow(legacy), null);
});

test("validateCanonicalDiagramFlow acepta un flujo bien formado con ramas de decisión etiquetadas y distintas", () => {
  const parsed = parseCanonicalDiagramFlow(VALID_AS_IS)!;
  const validation = validateCanonicalDiagramFlow(parsed);
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.issues, []);
});

test("validateCanonicalDiagramFlow rechaza IDs duplicados, referencias rotas y aristas sin etiqueta en una decisión con ramas", () => {
  const duplicateNodeIds = parseCanonicalDiagramFlow(
    [
      "FLUJO AS-IS",
      "CARRIL | L01 | Solicitante | ACTOR",
      "NODO | N01 | L01 | START | Inicia",
      "NODO | N01 | L01 | END | Finaliza",
      "ARISTA | N01 | N01 | ",
    ].join("\n"),
  )!;
  assert.ok(
    validateCanonicalDiagramFlow(duplicateNodeIds).issues.includes(
      "DUPLICATE_NODE_IDS",
    ),
  );

  const brokenEdge = parseCanonicalDiagramFlow(
    [
      "FLUJO AS-IS",
      "CARRIL | L01 | Solicitante | ACTOR",
      "NODO | N01 | L01 | START | Inicia",
      "NODO | N02 | L01 | END | Finaliza",
      "ARISTA | N01 | N99 | ",
    ].join("\n"),
  )!;
  assert.ok(
    validateCanonicalDiagramFlow(brokenEdge).issues.some((issue) =>
      issue.startsWith("EDGE_UNKNOWN_TO"),
    ),
  );

  const unlabeledBranch = parseCanonicalDiagramFlow(
    [
      "FLUJO AS-IS",
      "CARRIL | L01 | Solicitante | ACTOR",
      "NODO | N01 | L01 | START | Inicia",
      "NODO | N02 | L01 | DECISION | ¿Cumple?",
      "NODO | N03 | L01 | END | Aprobado",
      "NODO | N04 | L01 | END | Rechazado",
      "ARISTA | N01 | N02 | ",
      "ARISTA | N02 | N03 | Sí",
      "ARISTA | N02 | N04 | ",
    ].join("\n"),
  )!;
  assert.ok(
    validateCanonicalDiagramFlow(unlabeledBranch).issues.some((issue) =>
      issue.startsWith("DECISION_BRANCH_WITHOUT_LABEL"),
    ),
  );

  const duplicateLabels = parseCanonicalDiagramFlow(
    [
      "FLUJO AS-IS",
      "CARRIL | L01 | Solicitante | ACTOR",
      "NODO | N01 | L01 | START | Inicia",
      "NODO | N02 | L01 | DECISION | ¿Cumple?",
      "NODO | N03 | L01 | END | Aprobado",
      "NODO | N04 | L01 | END | Rechazado",
      "ARISTA | N01 | N02 | ",
      "ARISTA | N02 | N03 | Sí",
      "ARISTA | N02 | N04 | Sí",
    ].join("\n"),
  )!;
  assert.ok(
    validateCanonicalDiagramFlow(duplicateLabels).issues.some((issue) =>
      issue.startsWith("DECISION_BRANCH_DUPLICATE_LABEL"),
    ),
  );
});

test("validateCanonicalDiagramFlow rechaza nodos con 'Pregunta:'/'Respuesta:' y un único carril genérico cuando hay más de un actor sustentado", () => {
  const questionnaireLeak = parseCanonicalDiagramFlow(
    [
      "FLUJO AS-IS",
      "CARRIL | L01 | Solicitante | ACTOR",
      "NODO | N01 | L01 | START | Pregunta: ¿cuál es el proceso actual?",
      "NODO | N02 | L01 | END | Respuesta: se hace manualmente",
      "ARISTA | N01 | N02 | ",
    ].join("\n"),
  )!;
  assert.ok(
    validateCanonicalDiagramFlow(questionnaireLeak).issues.some((issue) =>
      issue.startsWith("QUESTIONNAIRE_LEAKAGE"),
    ),
  );

  const genericLane = parseCanonicalDiagramFlow(
    [
      "FLUJO AS-IS",
      "CARRIL | L01 | Proceso actual | ACTOR",
      "NODO | N01 | L01 | START | Inicia",
      "NODO | N02 | L01 | END | Finaliza",
      "ARISTA | N01 | N02 | ",
    ].join("\n"),
  )!;
  const withMultipleActors = validateCanonicalDiagramFlow(genericLane, {
    distinctActorEvidenceHints: ["Solicitante", "Responsable de validación"],
  });
  assert.ok(
    withMultipleActors.issues.includes(
      "GENERIC_LANE_WITH_MULTIPLE_ACTORS_IN_EVIDENCE",
    ),
  );

  // Un solo actor legítimo (evidencia no sustenta un segundo responsable):
  // el mismo carril genérico no debe rechazarse por esta razón.
  const withSingleActor = validateCanonicalDiagramFlow(genericLane, {
    distinctActorEvidenceHints: ["Solicitante"],
  });
  assert.ok(
    !withSingleActor.issues.includes(
      "GENERIC_LANE_WITH_MULTIPLE_ACTORS_IN_EVIDENCE",
    ),
  );
});

test("parseCanonicalEntityRelationshipModel reconoce entidades, atributos y relaciones canónicas", () => {
  const content = [
    "ENTIDAD | E01 | Solicitud | Solicitud gestionada en el proceso",
    "ATRIBUTO | E01 | solicitud_id | Texto | PK | SI",
    "ATRIBUTO | E01 | estado | Texto | NONE | SI",
    "ENTIDAD | E02 | Usuario | Usuario participante",
    "ATRIBUTO | E02 | usuario_id | Texto | PK | SI",
    "RELACION | E02 | E01 | 1:N | registra",
  ].join("\n");
  const parsed = parseCanonicalEntityRelationshipModel(content)!;
  assert.equal(parsed.entities.length, 2);
  assert.equal(parsed.entities[0]!.attributes.length, 2);
  assert.equal(parsed.entities[0]!.attributes[0]!.keyRole, "PK");
  assert.equal(parsed.relations.length, 1);
  assert.equal(parsed.relations[0]!.cardinality, "1:N");
  const validation = validateCanonicalEntityRelationshipModel(parsed);
  assert.equal(validation.valid, true);
});

test("validateCanonicalEntityRelationshipModel rechaza IDs duplicados, extremos inexistentes y cardinalidades inválidas", () => {
  const duplicateEntities = parseCanonicalEntityRelationshipModel(
    [
      "ENTIDAD | E01 | Solicitud | descripción",
      "ENTIDAD | E01 | Otra | descripción",
    ].join("\n"),
  )!;
  assert.ok(
    validateCanonicalEntityRelationshipModel(duplicateEntities).issues.includes(
      "DUPLICATE_ENTITY_IDS",
    ),
  );

  const brokenRelation = parseCanonicalEntityRelationshipModel(
    [
      "ENTIDAD | E01 | Solicitud | descripción",
      "RELACION | E01 | E99 | 1:N | registra",
    ].join("\n"),
  )!;
  assert.ok(
    validateCanonicalEntityRelationshipModel(brokenRelation).issues.some(
      (issue) => issue.startsWith("RELATION_UNKNOWN_TO"),
    ),
  );
});

test("una entidad sin relaciones sustentadas se conserva con relations: []", () => {
  const parsed = parseCanonicalEntityRelationshipModel(
    "ENTIDAD | E01 | Solicitud | Solicitud gestionada en el proceso",
  )!;
  assert.equal(parsed.entities.length, 1);
  assert.equal(parsed.relations.length, 0);
  assert.equal(validateCanonicalEntityRelationshipModel(parsed).valid, true);
});

test("deterministicDiagramFlowFallback con actor y paso sustentados produce un carril y un nodo reales, nunca inventados", () => {
  const content = deterministicDiagramFlowFallback(
    [
      {
        canonicalId: "actor-1",
        category: "actors",
        description: "Solicitante: persona que registra la solicitud",
      },
      {
        canonicalId: "process-1",
        category: "currentProcesses",
        description: "El solicitante registra la información en un formulario físico",
      },
      {
        canonicalId: "problem-1",
        category: "problems",
        description: "La validación manual genera reprocesos frecuentes",
      },
    ],
    "FLUJO AS-IS",
    "ASIS-U001",
    900,
  );
  assert.ok(content.length <= 900);
  const parsed = parseCanonicalDiagramFlow(content)!;
  assert.ok(parsed);
  assert.equal(validateCanonicalDiagramFlow(parsed).valid, true);
  assert.equal(parsed.lanes[0]!.name, "Solicitante");
  assert.ok(
    parsed.nodes.some((node) =>
      node.label.includes("El solicitante registra"),
    ),
  );
});

test("deterministicDiagramFlowFallback sin hallazgos produce el encabezado sin estructura (modelo vacío honesto, sin inicio/fin pendientes)", () => {
  const content = deterministicDiagramFlowFallback([], "FLUJO TO-BE", "TOBE-U002", 900);
  assert.equal(content, "FLUJO TO-BE");
  assert.equal(parseCanonicalDiagramFlow(content), null);
});

test("deterministicEntityRelationshipFallback nunca fabrica relaciones y conserva la descripción literal", () => {
  const content = deterministicEntityRelationshipFallback(
    [
      {
        canonicalId: "entity-1",
        category: "entities",
        description: "La Solicitud es la entidad principal del proceso",
      },
      {
        canonicalId: "entity-2",
        category: "entities",
        description: "El Usuario registra una o varias Solicitudes",
      },
    ],
    "ER-U003",
    900,
  );
  const parsed = parseCanonicalEntityRelationshipModel(content)!;
  assert.equal(parsed.entities.length, 2);
  assert.equal(parsed.relations.length, 0);
  assert.equal(parsed.entities[0]!.name, "Solicitud");
  assert.ok(
    parsed.entities[0]!.description.includes("La Solicitud es la entidad"),
  );
});

test("el fallback de flujo no fabrica un actor a partir de pasos sin ningún hallazgo de categoría 'actors'", () => {
  // Pregunta/respuesta sin actor categorizado: aunque la descripción de
  // "Respuesta" mencione un responsable, sin un hallazgo de categoría
  // "actors" no hay carril que representar, así que el resultado correcto
  // es el encabezado sin estructura, no un carril inventado.
  const content = deterministicDiagramFlowFallback(
    [
      {
        canonicalId: "question-1",
        category: "currentProcesses",
        description: "Pregunta: ¿Cómo se registra actualmente la solicitud?",
      },
      {
        canonicalId: "answer-1",
        category: "currentProcesses",
        description: "Respuesta: El solicitante registra la solicitud manualmente.",
      },
    ],
    "FLUJO AS-IS",
    "ASIS-U004",
    900,
  );
  assert.equal(content, "FLUJO AS-IS");
  assert.equal(parseCanonicalDiagramFlow(content), null);
});

test("el fallback ER ignora evidencia que no pertenece a la categoría entities", () => {
  const content = deterministicEntityRelationshipFallback(
    [
      {
        canonicalId: "rule-1",
        category: "businessRules",
        description: "La solicitud debe ser aprobada antes del envío.",
      },
      {
        canonicalId: "integration-1",
        category: "integrations",
        description: "El sistema consulta D365.",
      },
    ],
    "ER-U005",
    900,
  );
  assert.equal(parseCanonicalEntityRelationshipModel(content), null);
  assert.equal(content, "ENTIDADES\n\nRELACIONES");
});

test("el fallback ER no convierte una pregunta categorizada como entidad en una entidad ficticia", () => {
  const content = deterministicEntityRelationshipFallback(
    [
      {
        canonicalId: "entity-question-1",
        category: "entities",
        description: "Pregunta: ¿Cuáles son las entidades principales?",
      },
    ],
    "ER-U006",
    900,
  );
  assert.equal(content, "ENTIDADES\n\nRELACIONES");
});

test("los pasos largos sin ningún hallazgo de categoría 'actors' no fabrican un carril y respetan el presupuesto", () => {
  const findings = Array.from({ length: 30 }, (_, index) => ({
    canonicalId: `process-${index}`,
    category: "currentProcesses",
    description: `Paso ${index + 1}: ${"descripción extensa ".repeat(30)}`,
  }));
  const content = deterministicDiagramFlowFallback(
    findings,
    "FLUJO AS-IS",
    "ASIS-U007",
    900,
  );
  assert.ok(content.length <= 900);
  assert.equal(content, "FLUJO AS-IS");
  assert.equal(parseCanonicalDiagramFlow(content), null);
});

test("normalizeLocalOnlyV2SectionContent(processFlow) usa el contrato canónico y produce edges/labels reales", () => {
  const toBeContent = [
    "FLUJO TO-BE",
    "CARRIL | TOBE-L01 | Solicitante | ACTOR",
    "CARRIL | TOBE-L02 | Sistema de gestión | SYSTEM",
    "NODO | TOBE-N01 | TOBE-L01 | START | Inicia el trámite digital",
    "NODO | TOBE-N02 | TOBE-L02 | SYSTEM | Captura y valida la información",
    "NODO | TOBE-N03 | TOBE-L02 | DECISION | ¿La información cumple las validaciones?",
    "NODO | TOBE-N04 | TOBE-L01 | PROCESS | Continúa con la aprobación",
    "NODO | TOBE-N05 | TOBE-L01 | END | Recibe la solicitud para corrección",
    "ARISTA | TOBE-N01 | TOBE-N02 | ",
    "ARISTA | TOBE-N02 | TOBE-N03 | ",
    "ARISTA | TOBE-N03 | TOBE-N04 | Sí",
    "ARISTA | TOBE-N03 | TOBE-N05 | No",
    "MEJORA | Estandarización del registro y la validación.",
    "RESULTADO | Mayor trazabilidad del trámite.",
  ].join("\n");
  const asIsContent = [
    "FLUJO AS-IS",
    "CARRIL | ASIS-L01 | Solicitante | ACTOR",
    "NODO | ASIS-N01 | ASIS-L01 | START | Inicia",
    "NODO | ASIS-N02 | ASIS-L01 | END | Finaliza",
    "ARISTA | ASIS-N01 | ASIS-N02 | ",
  ].join("\n");
  const assembled = [asIsContent, toBeContent].join("\n");

  const normalized = normalizeLocalOnlyV2SectionContent(
    "processFlow",
    assembled,
    {},
  ) as Record<string, unknown>;
  const processFlows = normalized.processFlows as Record<
    string,
    Record<string, unknown>
  >;
  const toBe = processFlows.toBe;
  const edges = toBe.edges as Array<Record<string, unknown>>;
  assert.ok(edges.some((edge) => edge.label === "Sí"));
  assert.ok(edges.some((edge) => edge.label === "No"));
  assert.equal(normalized.entityRelationship, null);
});

// AI_ANALYSIS_LOCAL_ONLY_V2_PROCESS_FLOW_ARTIFACT_INDEPENDENCE_REGRESSION_V1
//
// AS-IS, TO-BE y el modelo entidad-relación se normalizan de forma
// independiente: uno vacío o inválido no puede arrastrar a los otros al
// parseo heredado ni fabricar contenido ficticio.
test("normalizeLocalOnlyV2SectionContent(processFlow) conserva un AS-IS canónico válido aunque TO-BE no traiga estructura", () => {
  const asIsContent = [
    "FLUJO AS-IS",
    "CARRIL | ASIS-L01 | Solicitante | ACTOR",
    "NODO | ASIS-N01 | ASIS-L01 | START | Inicia la solicitud",
    "NODO | ASIS-N02 | ASIS-L01 | PROCESS | Registra la información en el formulario",
    "NODO | ASIS-N03 | ASIS-L01 | END | Finaliza el registro",
    "ARISTA | ASIS-N01 | ASIS-N02 | ",
    "ARISTA | ASIS-N02 | ASIS-N03 | ",
  ].join("\n");
  const toBeContent = "FLUJO TO-BE";
  const assembled = [asIsContent, toBeContent].join("\n");

  const normalized = normalizeLocalOnlyV2SectionContent(
    "processFlow",
    assembled,
    {},
  ) as Record<string, unknown>;
  const processFlows = normalized.processFlows as Record<
    string,
    Record<string, unknown>
  >;
  const asIs = processFlows.asIs;
  const toBe = processFlows.toBe;

  assert.equal((asIs.nodes as unknown[]).length, 3);
  assert.ok(
    (asIs.nodes as Array<{ label: string }>).some(
      (node) => node.label === "Registra la información en el formulario",
    ),
  );
  assert.deepEqual(toBe.lanes, []);
  assert.deepEqual(toBe.nodes, []);
  assert.deepEqual(toBe.edges, []);
});

test("normalizeLocalOnlyV2SectionContent(processFlow) conserva un TO-BE canónico válido con etiquetas Sí/No aunque AS-IS sea inválido", () => {
  const asIsContent = [
    "FLUJO AS-IS",
    "CARRIL | ASIS-L01 | Solicitante | ACTOR",
    "NODO | ASIS-N01 | ASIS-L01 | START | Inicia",
    "NODO | ASIS-N02 | ASIS-L01 | END | Finaliza",
    "ARISTA | ASIS-N01 | ASIS-N02 | ",
  ].join("\n");
  const toBeContent = [
    "FLUJO TO-BE",
    "CARRIL | TOBE-L01 | Solicitante | ACTOR",
    "NODO | TOBE-N01 | TOBE-L01 | START | Inicia el trámite digital",
    "NODO | TOBE-N02 | TOBE-L01 | DECISION | ¿La información cumple las validaciones?",
    "NODO | TOBE-N03 | TOBE-L01 | PROCESS | Continúa con la aprobación",
    "NODO | TOBE-N04 | TOBE-L01 | END | Recibe la solicitud para corrección",
    "ARISTA | TOBE-N01 | TOBE-N02 | ",
    "ARISTA | TOBE-N02 | TOBE-N03 | Sí",
    "ARISTA | TOBE-N02 | TOBE-N04 | No",
  ].join("\n");
  const assembled = [asIsContent, toBeContent].join("\n");

  const normalized = normalizeLocalOnlyV2SectionContent(
    "processFlow",
    assembled,
    {},
  ) as Record<string, unknown>;
  const processFlows = normalized.processFlows as Record<
    string,
    Record<string, unknown>
  >;
  const asIs = processFlows.asIs;
  const toBe = processFlows.toBe;

  // AS-IS solo tiene START/END (sin nodo sustantivo): la validación fuerte lo
  // rechaza y el resultado es un modelo vacío, nunca el parseo heredado.
  assert.deepEqual(asIs.lanes, []);
  assert.deepEqual(asIs.nodes, []);
  assert.deepEqual(asIs.edges, []);

  const edges = toBe.edges as Array<Record<string, unknown>>;
  assert.ok(edges.some((edge) => edge.label === "Sí"));
  assert.ok(edges.some((edge) => edge.label === "No"));
});

test("normalizeLocalOnlyV2SectionContent(processFlow) nunca fabrica el placeholder pendiente cuando no hay evidencia de flujo", () => {
  const assembled = ["FLUJO AS-IS", "FLUJO TO-BE"].join("\n");

  const normalized = normalizeLocalOnlyV2SectionContent(
    "processFlow",
    assembled,
    {},
  ) as Record<string, unknown>;
  const serialized = JSON.stringify(normalized);
  assert.ok(!serialized.includes("PENDIENTE POR DEFINIR"));

  const processFlows = normalized.processFlows as Record<
    string,
    Record<string, unknown>
  >;
  assert.deepEqual(processFlows.asIs.lanes, []);
  assert.deepEqual(processFlows.asIs.nodes, []);
  assert.deepEqual(processFlows.toBe.lanes, []);
  assert.deepEqual(processFlows.toBe.nodes, []);
});

test("normalizeLocalOnlyV2SectionContent(processFlow) deja el modelo entidad-relación en null cuando está vacío, sin afectar AS-IS/TO-BE", () => {
  const content = [
    "FLUJO AS-IS",
    "CARRIL | ASIS-L01 | Solicitante | ACTOR",
    "NODO | ASIS-N01 | ASIS-L01 | START | Inicia",
    "NODO | ASIS-N02 | ASIS-L01 | PROCESS | Registra la solicitud",
    "NODO | ASIS-N03 | ASIS-L01 | END | Finaliza",
    "ARISTA | ASIS-N01 | ASIS-N02 | ",
    "ARISTA | ASIS-N02 | ASIS-N03 | ",
    "ENTIDADES",
    "RELACIONES",
  ].join("\n");

  const normalized = normalizeLocalOnlyV2SectionContent(
    "processFlow",
    content,
    {},
  ) as Record<string, unknown>;
  assert.equal(normalized.entityRelationship, null);

  const processFlows = normalized.processFlows as Record<
    string,
    Record<string, unknown>
  >;
  assert.equal((processFlows.asIs.nodes as unknown[]).length, 3);
});

// AI_ANALYSIS_LOCAL_ONLY_V2_PROCESS_FLOW_REGRESSION_V1
//
// Caso de regresión reportado: AS-IS con un único carril "Proceso actual",
// TO-BE con un único carril "Solución propuesta", nodos con preguntas y
// respuestas crudas del cuestionario, decisiones visuales sin ramas reales,
// y modelo entidad-relación ausente. El contrato anterior (siete
// encabezados, una sola línea por flujo) lo aceptaba como "exitoso"; con el
// contrato canónico y la validación fuerte, este contenido ni siquiera se
// reconoce como canónico (no trae CARRIL/NODO), así que nunca puede
// aprobarse como AS-IS/TO-BE válidos.
test("el caso de regresión reportado (carriles genéricos, preguntas crudas, ER ausente) ya no aprueba la validación", () => {
  const regressionContent = [
    "FLUJO AS-IS",
    "PROBLEMAS IDENTIFICADOS",
    "FLUJO TO-BE",
    "MEJORAS DEL PROCESO",
    "RESULTADOS ESPERADOS",
    "ENTIDADES",
    "RELACIONES",
  ].join("\n");
  assert.equal(parseCanonicalDiagramFlow(regressionContent), null);

  const legacyStyleWithGenericLanes = [
    "Proceso actual | INICIO | Pregunta: ¿cómo se hace hoy?",
    "Proceso actual | FIN | Respuesta: se hace manualmente",
  ].join("\n");
  assert.equal(parseCanonicalDiagramFlow(legacyStyleWithGenericLanes), null);

  const canonicalButGenericAndLeaky = [
    "FLUJO AS-IS",
    "CARRIL | L01 | Proceso actual | ACTOR",
    "NODO | N01 | L01 | START | Pregunta: ¿cómo se hace hoy?",
    "NODO | N02 | L01 | END | Respuesta: se hace manualmente",
    "ARISTA | N01 | N02 | ",
  ].join("\n");
  const parsed = parseCanonicalDiagramFlow(canonicalButGenericAndLeaky)!;
  const validation = validateCanonicalDiagramFlow(parsed, {
    distinctActorEvidenceHints: ["Solicitante", "Responsable de validación"],
  });
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.includes("GENERIC_LANE_WITH_MULTIPLE_ACTORS_IN_EVIDENCE"));
  assert.ok(validation.issues.some((issue) => issue.startsWith("QUESTIONNAIRE_LEAKAGE")));
});
