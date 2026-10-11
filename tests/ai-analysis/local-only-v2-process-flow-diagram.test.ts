// LOCAL_ONLY_V2_PROCESS_FLOW_DIAGRAM
//
// Punto 6 (processFlow) rediseñado como tres subunidades independientes
// (AS-IS, TO-BE, modelo entidad-relación). Estas pruebas cubren, con la
// ruta real (planLocalOnlyV2ProcessingUnits + generateLocalOnlyV2ProcessingBlock
// + normalizeLocalOnlyV2SectionContent), lo que las pruebas ya existentes en
// local-only-v2-inference-budget.test.ts y local-only-v2-section-content.test.ts
// no ejercitan directamente:
//
// 1. Independencia real frente al punto 5 (solutionProposal): dos
//    ejecuciones secuenciales completas del mismo plan de dos bloques, con
//    contenido de solutionProposal completamente distinto en cada una,
//    demuestran que el paquete de evidencia, la unidad y el borrador del
//    punto 6 no cambian, y que el prompt del punto 6 nunca contiene el
//    contenido del punto 5.
// 2. Cobertura reservada por familia en la selección de evidencia de
//    processFlow (no permite que hallazgos de proceso desplacen a los de
//    entidades) y la especialización por artefacto
//    (selectLocalOnlyV2DiagramArtifactEvidence).
// 3. Sensibilidad de fingerprint: el checkpoint de cada artefacto cambia
//    cuando cambia SU propia evidencia especializada, sin afectar a los
//    otros dos artefactos.
import assert from "node:assert/strict";
import test from "node:test";

import type { LocalAiCategory } from "../../apps/ai-analysis-service/src/local-ai/local-ai-output.js";
import { LOCAL_AI_CATEGORIES } from "../../apps/ai-analysis-service/src/local-ai/local-ai-output.js";
import type { OllamaClient } from "../../apps/ai-analysis-service/src/local-ai/ollama.client.js";
import type { LocalOnlyV2NormalizedFinding } from "../../apps/ai-analysis-service/src/execution/local-only-v2-normalizer.js";
import type { LocalOnlyV2KnowledgeIndex } from "../../apps/ai-analysis-service/src/execution/local-only-v2-knowledge-index.js";
import {
  LOCAL_ONLY_V2_DEFAULT_EVIDENCE_SELECTION_POLICY,
  selectLocalOnlyV2DiagramArtifactEvidence,
  selectLocalOnlyV2EvidenceByBlock,
} from "../../apps/ai-analysis-service/src/execution/local-only-v2-evidence-selector.js";
import { resolveLocalOnlyV2InferenceBudget } from "../../apps/ai-analysis-service/src/execution/local-only-v2-inference-budget.js";
import {
  generateLocalOnlyV2ProcessingBlock,
  planLocalOnlyV2ProcessingUnits,
} from "../../apps/ai-analysis-service/src/execution/local-only-v2-sequential-block-generator.js";
import {
  parseCanonicalDiagramFlow,
  validateCanonicalDiagramFlow,
} from "../../apps/ai-analysis-service/src/execution/local-only-v2-diagram-contract.js";
import {
  beginLocalOnlyV2Block,
  completeLocalOnlyV2Block,
  createLocalOnlyV2SequentialBlockExecution,
} from "../../apps/ai-analysis-service/src/execution/local-only-v2-sequential-block-contract.js";
import { prepareLocalOnlyV2EvidenceForProcessingBlock } from "../../apps/ai-analysis-service/src/execution/local-only-v2-sequential-block-evidence.js";
import type { LocalOnlyV2TemplateGenerationPlan } from "../../apps/ai-analysis-service/src/execution/local-only-v2-template-planner.js";

const SOURCE_ID = "source-a";

function normalizedFinding(
  canonicalId: string,
  sequence: number,
  category: LocalAiCategory,
  description: string,
): LocalOnlyV2NormalizedFinding {
  const segmentId = `${SOURCE_ID}#${String(sequence).padStart(4, "0")}`;
  const evidenceText = `${description} (evidencia literal ${sequence}).`;
  return {
    canonicalId,
    sequence,
    categorySequence: sequence,
    category,
    description,
    normalizedDescription: description.toLocaleLowerCase("es"),
    sourceIds: [SOURCE_ID],
    segmentIds: [segmentId],
    occurrenceCount: 1,
    mandatoryQuestionnaireEvidence: false,
    occurrences: [
      {
        sourceId: SOURCE_ID,
        sourceTitle: "Fuente principal",
        sourcePosition: 1,
        segmentId,
        segmentIndex: sequence,
        evidenceText,
        evidenceStartCharacter: 0,
        evidenceEndCharacter: evidenceText.length,
        mandatoryQuestionnaireEvidence: false,
      },
    ],
  };
}

// Ocho hallazgos: dos actores y un proceso actual/problema para AS-IS, un
// proceso esperado y un requisito funcional para TO-BE, y dos entidades
// para el modelo entidad-relación. Deliberadamente pocos hallazgos de
// "proceso" para que el reparto por turnos no sea necesario para pasar la
// prueba de cobertura reservada (ver más abajo un caso con MUCHOS más
// hallazgos de proceso que de entidades).
function baseFindings(): LocalOnlyV2NormalizedFinding[] {
  return [
    normalizedFinding(
      "v2f-actor-01",
      1,
      "actors",
      "Solicitante: persona que radica la solicitud de trámite.",
    ),
    normalizedFinding(
      "v2f-actor-02",
      2,
      "actors",
      "Responsable de validación: revisa la información recibida.",
    ),
    normalizedFinding(
      "v2f-proc-01",
      3,
      "currentProcesses",
      "El solicitante registra la información en un formulario físico.",
    ),
    normalizedFinding(
      "v2f-prob-01",
      4,
      "problems",
      "La validación manual genera reprocesos frecuentes.",
    ),
    normalizedFinding(
      "v2f-exp-01",
      5,
      "expectedProcesses",
      "El sistema de gestión captura y valida la información automáticamente.",
    ),
    normalizedFinding(
      "v2f-req-01",
      6,
      "functionalRequirements",
      "El sistema debe permitir aprobar o rechazar la solicitud digital.",
    ),
    normalizedFinding(
      "v2f-ent-01",
      7,
      "entities",
      "La Solicitud es la entidad principal del proceso, con un identificador único.",
    ),
    normalizedFinding(
      "v2f-ent-02",
      8,
      "entities",
      "El Usuario registra una o varias Solicitudes.",
    ),
  ];
}

function buildKnowledgeIndex(
  findings: readonly LocalOnlyV2NormalizedFinding[],
): LocalOnlyV2KnowledgeIndex {
  const segments = findings.map((finding) => {
    const occurrence = finding.occurrences[0]!;
    return {
      segmentId: occurrence.segmentId,
      sourceId: occurrence.sourceId,
      sourceTitle: occurrence.sourceTitle,
      sourcePosition: occurrence.sourcePosition,
      segmentIndex: occurrence.segmentIndex,
      startCharacter: occurrence.evidenceStartCharacter,
      endCharacter: occurrence.evidenceEndCharacter,
      estimatedTokens: Math.max(
        1,
        Math.ceil(occurrence.evidenceText.length / 4),
      ),
      mandatoryQuestionnaireEvidence: false,
      findingIds: [finding.canonicalId],
    };
  });

  const findingIdsByCategory = Object.fromEntries(
    LOCAL_AI_CATEGORIES.map((category) => [
      category,
      findings
        .filter((finding) => finding.category === category)
        .map((finding) => finding.canonicalId),
    ]),
  ) as Record<LocalAiCategory, readonly string[]>;

  return {
    pipelineId: "LOCAL_ONLY_V2",
    schemaVersion: "1.0.0",
    projectId: "project-flow-independence",
    questionnaireSourceId: SOURCE_ID,
    fingerprint: "k".repeat(64),
    sources: [
      {
        sourceId: SOURCE_ID,
        sourceTitle: "Fuente principal",
        sourcePosition: 1,
        mandatoryQuestionnaireEvidence: false,
        segmentIds: segments.map((segment) => segment.segmentId),
        findingIds: findings.map((finding) => finding.canonicalId),
      },
    ],
    segments,
    findings,
    findingIdsByCategory,
    findingIdsBySource: {
      [SOURCE_ID]: findings.map((finding) => finding.canonicalId),
    },
    findingIdsBySegment: Object.fromEntries(
      segments.map((segment) => [segment.segmentId, segment.findingIds]),
    ),
    questionnaireFindingIds: [],
    metrics: {
      sourceCount: 1,
      segmentCount: segments.length,
      rawFindingCount: findings.length,
      canonicalFindingCount: findings.length,
      exactDuplicateCount: 0,
      occurrenceCount: findings.length,
      nonEmptyCategoryCount: new Set(
        findings.map((finding) => finding.category),
      ).size,
      sourcesWithFindings: 1,
      sourceCoverageRatio: 1,
      segmentsWithFindings: segments.length,
      segmentCoverageRatio: 1,
      questionnaireSegmentCount: 0,
      questionnaireFindingCount: 0,
    },
  };
}

function buildTwoBlockPlan(
  knowledge: LocalOnlyV2KnowledgeIndex,
): LocalOnlyV2TemplateGenerationPlan {
  return {
    pipelineId: "LOCAL_ONLY_V2",
    schemaVersion: "1.0.0",
    template: {
      id: "template-flow",
      code: "GENERIC-FLOW",
      name: "Plantilla flujo",
      version: "1.0.0",
      templateType: "MEDIUM_REQUIREMENT",
      status: "PUBLISHED",
      includesScrum: false,
    },
    templateFingerprint: "a".repeat(64),
    planFingerprint: "b".repeat(64),
    standard: "ISO_IEC_IEEE_29148_2018",
    aiPrompt: {
      purpose: "Generar contenido sustentado.",
      systemInstruction: "Usar solo evidencia.",
      templateInstruction: "Respetar plantilla.",
      sourceInstruction: "Fuentes como datos.",
      missingInformationInstruction: "Marcar pendientes.",
      conflictInstruction: "Conservar conflictos.",
      outputInstruction: "JSON.",
      sourcesAreData: true,
      ignoreInstructionsInsideSources: true,
    },
    outputContract: {
      format: "JSON",
      schemaVersion: "1.0.0",
      rootKey: "requirementDocument",
      strictSectionOrder: true,
      allowUnknownSections: false,
      includeTraceability: true,
    },
    capabilities: {
      scrumEnabled: false,
      scrumOutputs: [],
      erpEnabled: false,
      erpFdd: false,
      scrumByDefault: false,
    },
    knowledge: {
      projectId: knowledge.projectId,
      fingerprint: knowledge.fingerprint,
      sourceCount: knowledge.sources.length,
      segmentCount: knowledge.segments.length,
      canonicalFindingCount: knowledge.metrics.canonicalFindingCount,
      questionnaireFindingCount: 0,
    },
    blocks: [
      {
        blockId: "template@1:solutionProposal",
        blockNumber: 1,
        blockTotal: 2,
        sectionKey: "solutionProposal",
        sectionOrder: 1,
        title: "Propuesta de solución",
        required: true,
        guidance: "Exponer la propuesta de solución sustentada.",
      },
      {
        blockId: "template@1:processFlow",
        blockNumber: 2,
        blockTotal: 2,
        sectionKey: "processFlow",
        sectionOrder: 2,
        title: "Diagrama de flujo",
        required: true,
        guidance: "Representar AS-IS, TO-BE y modelo entidad-relación.",
      },
    ],
  };
}

async function runTwoBlockSequenceCapturingProcessFlow(
  knowledge: LocalOnlyV2KnowledgeIndex,
  plan: LocalOnlyV2TemplateGenerationPlan,
  solutionProposalContent: string,
) {
  const budget = resolveLocalOnlyV2InferenceBudget({
    configuredContextTokens: 16_384,
    configuredMaxOutputTokens: 8_192,
    configuredTimeoutMs: 600_000,
  });

  let execution = createLocalOnlyV2SequentialBlockExecution(plan);

  execution = beginLocalOnlyV2Block(execution, "template@1:solutionProposal");
  const solutionPacket = prepareLocalOnlyV2EvidenceForProcessingBlock(
    execution,
    plan,
    knowledge,
    LOCAL_ONLY_V2_DEFAULT_EVIDENCE_SELECTION_POLICY,
  );
  const solutionUnits = planLocalOnlyV2ProcessingUnits(
    execution,
    plan,
    solutionPacket,
    budget,
  );
  const solutionClient: Pick<OllamaClient, "generate"> = {
    generate: async () => JSON.stringify({ content: solutionProposalContent }),
  };
  await generateLocalOnlyV2ProcessingBlock(
    solutionClient,
    execution,
    plan,
    solutionUnits[0]!,
  );
  execution = completeLocalOnlyV2Block(
    execution,
    "template@1:solutionProposal",
  );

  execution = beginLocalOnlyV2Block(execution, "template@1:processFlow");
  const processFlowPacket = prepareLocalOnlyV2EvidenceForProcessingBlock(
    execution,
    plan,
    knowledge,
    LOCAL_ONLY_V2_DEFAULT_EVIDENCE_SELECTION_POLICY,
  );
  const processFlowUnits = planLocalOnlyV2ProcessingUnits(
    execution,
    plan,
    processFlowPacket,
    budget,
  );
  const asIsUnit = processFlowUnits.find(
    (unit) => unit.packet.diagramArtifact === "AS_IS",
  )!;
  const prompts: string[] = [];
  const asIsClient: Pick<OllamaClient, "generate"> = {
    generate: async (prompt) => {
      prompts.push(prompt);
      return JSON.stringify({
        content: [
          "FLUJO AS-IS",
          "CARRIL | ASIS-L01 | Solicitante | ACTOR",
          "NODO | ASIS-N00 | ASIS-L01 | START | Inicia la solicitud",
          "NODO | ASIS-N01 | ASIS-L01 | PROCESS | Registra la información en el formulario",
          "NODO | ASIS-N02 | ASIS-L01 | END | Finaliza el registro",
          "ARISTA | ASIS-N00 | ASIS-N01 | ",
          "ARISTA | ASIS-N01 | ASIS-N02 | ",
        ].join("\n"),
      });
    },
  };
  const asIsDraft = await generateLocalOnlyV2ProcessingBlock(
    asIsClient,
    execution,
    plan,
    asIsUnit,
  );

  return { processFlowPacket, asIsUnit, asIsDraft, prompts };
}

test("la ruta real usa un fallback válido cuando generación y reparación filtran contenido de cuestionario", async () => {
  const knowledge = buildKnowledgeIndex([
    normalizedFinding(
      "actor-questionnaire",
      1,
      "actors",
      "Solicitante: persona responsable del registro.",
    ),
    normalizedFinding(
      "process-question",
      2,
      "currentProcesses",
      "Pregunta: ¿Cómo registra actualmente la solicitud?",
    ),
    normalizedFinding(
      "process-answer",
      3,
      "currentProcesses",
      "Respuesta: El solicitante registra la solicitud manualmente.",
    ),
  ]);
  const plan = buildTwoBlockPlan(knowledge);
  const budget = resolveLocalOnlyV2InferenceBudget({
    configuredContextTokens: 16_384,
    configuredMaxOutputTokens: 8_192,
    configuredTimeoutMs: 600_000,
  });
  const solutionStarted = beginLocalOnlyV2Block(
    createLocalOnlyV2SequentialBlockExecution(plan),
    "template@1:solutionProposal",
  );
  const processStarted = beginLocalOnlyV2Block(
    completeLocalOnlyV2Block(solutionStarted, "template@1:solutionProposal"),
    "template@1:processFlow",
  );
  const packet = prepareLocalOnlyV2EvidenceForProcessingBlock(
    processStarted,
    plan,
    knowledge,
    LOCAL_ONLY_V2_DEFAULT_EVIDENCE_SELECTION_POLICY,
  );
  const unit = planLocalOnlyV2ProcessingUnits(
    processStarted,
    plan,
    packet,
    budget,
  ).find((candidate) => candidate.packet.diagramArtifact === "AS_IS")!;
  let callCount = 0;
  const invalidClient: Pick<OllamaClient, "generate"> = {
    generate: async () => {
      callCount += 1;
      return JSON.stringify({
        content: "Pregunta: ¿Cómo se realiza el proceso actual?",
      });
    },
  };

  const draft = await generateLocalOnlyV2ProcessingBlock(
    invalidClient,
    processStarted,
    plan,
    unit,
  );

  assert.equal(callCount, 2);
  const parsed = parseCanonicalDiagramFlow(draft.content)!;
  assert.ok(parsed);
  assert.equal(validateCanonicalDiagramFlow(parsed).valid, true);
  assert.equal(
    parsed.nodes.some((node) =>
      /^(?:pregunta|respuesta)\s*:/iu.test(node.label),
    ),
    false,
  );
});

test("el punto 6 no depende del contenido generado para el punto 5", async () => {
  const knowledge = buildKnowledgeIndex(baseFindings());
  const plan = buildTwoBlockPlan(knowledge);

  const runA = await runTwoBlockSequenceCapturingProcessFlow(
    knowledge,
    plan,
    "La propuesta de solución automatiza el trámite mediante un portal web integrado con el ERP corporativo.",
  );
  const runB = await runTwoBlockSequenceCapturingProcessFlow(
    knowledge,
    plan,
    "Otra redacción completamente distinta: se sugiere subcontratar el proceso a un proveedor externo especializado en logística.",
  );

  assert.equal(
    runA.processFlowPacket.fingerprint,
    runB.processFlowPacket.fingerprint,
  );
  assert.equal(runA.asIsUnit.unitFingerprint, runB.asIsUnit.unitFingerprint);
  assert.equal(runA.asIsDraft.fingerprint, runB.asIsDraft.fingerprint);
  assert.equal(runA.asIsDraft.content, runB.asIsDraft.content);
  assert.equal(runA.prompts.length, 1);
  assert.equal(runB.prompts.length, 1);
  assert.equal(runA.prompts[0], runB.prompts[0]);

  for (const run of [runA, runB]) {
    assert.doesNotMatch(run.prompts[0]!, /portal web integrado con el ERP/u);
    assert.doesNotMatch(run.prompts[0]!, /subcontratar el proceso/u);
  }
});

test("la selección de evidencia de processFlow reserva cobertura para entidades aunque haya muchos más hallazgos de proceso", async () => {
  const manyProcessFindings = Array.from({ length: 30 }, (_, index) =>
    normalizedFinding(
      `v2f-proc-many-${String(index + 1).padStart(2, "0")}`,
      100 + index,
      "currentProcesses",
      `Paso del proceso actual número ${index + 1} descrito en la evidencia.`,
    ),
  );
  const entityFindings = [
    normalizedFinding(
      "v2f-ent-many-01",
      500,
      "entities",
      "La Solicitud es la entidad principal del proceso.",
    ),
    normalizedFinding(
      "v2f-ent-many-02",
      501,
      "entities",
      "El Usuario radica una o varias Solicitudes.",
    ),
  ];
  const knowledge = buildKnowledgeIndex([
    ...manyProcessFindings,
    ...entityFindings,
  ]);
  const plan: LocalOnlyV2TemplateGenerationPlan = {
    ...buildTwoBlockPlan(knowledge),
    blocks: [
      {
        blockId: "template@1:processFlow",
        blockNumber: 1,
        blockTotal: 1,
        sectionKey: "processFlow",
        sectionOrder: 1,
        title: "Diagrama de flujo",
        required: true,
        guidance: "Representar AS-IS, TO-BE y modelo entidad-relación.",
      },
    ],
  };

  const selection = selectLocalOnlyV2EvidenceByBlock(plan, knowledge);
  const packet = selection.blocks[0]!;
  const selectedCategories = new Set(
    packet.relevantFindings.map((finding) => finding.category),
  );
  assert.ok(
    selectedCategories.has("entities"),
    "la evidencia de entidades no debería quedar completamente desplazada por 30 hallazgos de proceso",
  );
  const selectedEntityIds = new Set(
    packet.relevantFindings
      .filter((finding) => finding.category === "entities")
      .map((finding) => finding.canonicalId),
  );
  assert.ok(selectedEntityIds.has("v2f-ent-many-01"));
  assert.ok(selectedEntityIds.has("v2f-ent-many-02"));

  const erEvidence = selectLocalOnlyV2DiagramArtifactEvidence(
    packet,
    "ENTITY_RELATIONSHIP",
    12,
  );
  assert.equal(erEvidence.relevantFindings.length, 2);
  assert.deepEqual(
    erEvidence.relevantFindings.map((finding) => finding.canonicalId).sort(),
    ["v2f-ent-many-01", "v2f-ent-many-02"],
  );

  const budget = resolveLocalOnlyV2InferenceBudget({
    configuredContextTokens: 16_384,
    configuredMaxOutputTokens: 8_192,
    configuredTimeoutMs: 600_000,
  });
  const execution = beginLocalOnlyV2Block(
    createLocalOnlyV2SequentialBlockExecution(plan),
    "template@1:processFlow",
  );
  const units = planLocalOnlyV2ProcessingUnits(execution, plan, packet, budget);
  const plannedFindingIds = new Set(
    units.flatMap((unit) => unit.packet.selectedFindingIds),
  );
  assert.deepEqual(
    [...plannedFindingIds].sort(),
    [...packet.selectedFindingIds].sort(),
    "ningún hallazgo seleccionado por processFlow puede perderse al especializar los tres artefactos",
  );
});

test("selectLocalOnlyV2DiagramArtifactEvidence filtra por familia sin perder trazabilidad", () => {
  const knowledge = buildKnowledgeIndex(baseFindings());
  const plan: LocalOnlyV2TemplateGenerationPlan = {
    ...buildTwoBlockPlan(knowledge),
    blocks: [
      {
        blockId: "template@1:processFlow",
        blockNumber: 1,
        blockTotal: 1,
        sectionKey: "processFlow",
        sectionOrder: 1,
        title: "Diagrama de flujo",
        required: true,
        guidance: "Representar AS-IS, TO-BE y modelo entidad-relación.",
      },
    ],
  };
  const packet = selectLocalOnlyV2EvidenceByBlock(plan, knowledge).blocks[0]!;

  const asIsEvidence = selectLocalOnlyV2DiagramArtifactEvidence(
    packet,
    "AS_IS",
    16,
  );
  const toBeEvidence = selectLocalOnlyV2DiagramArtifactEvidence(
    packet,
    "TO_BE",
    16,
  );
  const erEvidence = selectLocalOnlyV2DiagramArtifactEvidence(
    packet,
    "ENTITY_RELATIONSHIP",
    12,
  );

  assert.equal(asIsEvidence.diagramArtifact, "AS_IS");
  assert.equal(toBeEvidence.diagramArtifact, "TO_BE");
  assert.equal(erEvidence.diagramArtifact, "ENTITY_RELATIONSHIP");

  assert.ok(
    asIsEvidence.relevantFindings.some(
      (finding) => finding.canonicalId === "v2f-prob-01",
    ),
  );
  assert.ok(
    !erEvidence.relevantFindings.some(
      (finding) => finding.canonicalId === "v2f-prob-01",
    ),
  );
  assert.ok(
    erEvidence.relevantFindings.every(
      (finding) => finding.category === "entities",
    ),
  );

  for (const evidence of [asIsEvidence, toBeEvidence, erEvidence]) {
    assert.deepEqual(
      [...new Set(evidence.selectedFindingIds)],
      evidence.selectedFindingIds,
    );
    assert.ok(
      evidence.relevantFindings.every((finding) =>
        evidence.selectedFindingIds.includes(finding.canonicalId),
      ),
    );
  }
});

test("el fingerprint de una subunidad de diagrama cambia solo cuando cambia su propia evidencia especializada", () => {
  const knowledge = buildKnowledgeIndex(baseFindings());
  const knowledgeWithExtraEntity = buildKnowledgeIndex([
    ...baseFindings(),
    normalizedFinding(
      "v2f-ent-03",
      9,
      "entities",
      "El Pago queda asociado a la Solicitud una vez aprobada.",
    ),
  ]);
  const plan = buildTwoBlockPlan(knowledge);
  const planWithExtraEntity: LocalOnlyV2TemplateGenerationPlan = {
    ...plan,
    knowledge: {
      ...plan.knowledge,
      fingerprint: knowledgeWithExtraEntity.fingerprint,
      canonicalFindingCount:
        knowledgeWithExtraEntity.metrics.canonicalFindingCount,
    },
  };
  const budget = resolveLocalOnlyV2InferenceBudget({
    configuredContextTokens: 16_384,
    configuredMaxOutputTokens: 8_192,
    configuredTimeoutMs: 600_000,
  });

  const execution1 = beginLocalOnlyV2Block(
    createLocalOnlyV2SequentialBlockExecution(plan),
    "template@1:solutionProposal",
  );
  const execution1CompletedSolution = completeLocalOnlyV2Block(
    execution1,
    "template@1:solutionProposal",
  );
  const execution1ProcessFlow = beginLocalOnlyV2Block(
    execution1CompletedSolution,
    "template@1:processFlow",
  );
  const packet1 = prepareLocalOnlyV2EvidenceForProcessingBlock(
    execution1ProcessFlow,
    plan,
    knowledge,
    LOCAL_ONLY_V2_DEFAULT_EVIDENCE_SELECTION_POLICY,
  );
  const units1 = planLocalOnlyV2ProcessingUnits(
    execution1ProcessFlow,
    plan,
    packet1,
    budget,
  );

  const execution2 = beginLocalOnlyV2Block(
    createLocalOnlyV2SequentialBlockExecution(planWithExtraEntity),
    "template@1:solutionProposal",
  );
  const execution2CompletedSolution = completeLocalOnlyV2Block(
    execution2,
    "template@1:solutionProposal",
  );
  const execution2ProcessFlow = beginLocalOnlyV2Block(
    execution2CompletedSolution,
    "template@1:processFlow",
  );
  const packet2 = prepareLocalOnlyV2EvidenceForProcessingBlock(
    execution2ProcessFlow,
    planWithExtraEntity,
    knowledgeWithExtraEntity,
    LOCAL_ONLY_V2_DEFAULT_EVIDENCE_SELECTION_POLICY,
  );
  const units2 = planLocalOnlyV2ProcessingUnits(
    execution2ProcessFlow,
    planWithExtraEntity,
    packet2,
    budget,
  );

  const asIs1 = units1.find((unit) => unit.packet.diagramArtifact === "AS_IS")!;
  const asIs2 = units2.find((unit) => unit.packet.diagramArtifact === "AS_IS")!;
  const toBe1 = units1.find((unit) => unit.packet.diagramArtifact === "TO_BE")!;
  const toBe2 = units2.find((unit) => unit.packet.diagramArtifact === "TO_BE")!;
  const er1 = units1.find(
    (unit) => unit.packet.diagramArtifact === "ENTITY_RELATIONSHIP",
  )!;
  const er2 = units2.find(
    (unit) => unit.packet.diagramArtifact === "ENTITY_RELATIONSHIP",
  )!;

  assert.equal(asIs1.unitFingerprint, asIs2.unitFingerprint);
  assert.equal(toBe1.unitFingerprint, toBe2.unitFingerprint);
  assert.notEqual(er1.unitFingerprint, er2.unitFingerprint);
});

test("el modelo entidad-relación sin entidades nombrables no aborta el documento y queda vacío", async () => {
  const phrases = [
    "Se utilizan los siguientes sistemas, herramientas y plataformas para el proceso actual",
    "Información a ingresar: cliente, fecha, monto",
    "Los datos que debe conservar cada registro de la solicitud durante el proceso",
  ];
  const knowledge = buildKnowledgeIndex(
    phrases.map((description, index) =>
      normalizedFinding(`entity-${index}`, index + 1, "entities", description),
    ),
  );
  const plan = buildTwoBlockPlan(knowledge);
  const budget = resolveLocalOnlyV2InferenceBudget({
    configuredContextTokens: 16_384,
    configuredMaxOutputTokens: 8_192,
    configuredTimeoutMs: 600_000,
  });
  const solutionStarted = beginLocalOnlyV2Block(
    createLocalOnlyV2SequentialBlockExecution(plan),
    "template@1:solutionProposal",
  );
  const processStarted = beginLocalOnlyV2Block(
    completeLocalOnlyV2Block(solutionStarted, "template@1:solutionProposal"),
    "template@1:processFlow",
  );
  const packet = prepareLocalOnlyV2EvidenceForProcessingBlock(
    processStarted,
    plan,
    knowledge,
    LOCAL_ONLY_V2_DEFAULT_EVIDENCE_SELECTION_POLICY,
  );
  const unit = planLocalOnlyV2ProcessingUnits(
    processStarted,
    plan,
    packet,
    budget,
  ).find(
    (candidate) => candidate.packet.diagramArtifact === "ENTITY_RELATIONSHIP",
  )!;
  assert.ok(unit.packet.relevantFindings.length >= 3);
  const invalidClient: Pick<OllamaClient, "generate"> = {
    generate: async () =>
      JSON.stringify({ content: "Resumen sin el contrato de entidades." }),
  };

  const draft = await generateLocalOnlyV2ProcessingBlock(
    invalidClient,
    processStarted,
    plan,
    unit,
  );

  assert.equal(draft.content, ["ENTIDADES", "", "RELACIONES"].join("\n"));
});
