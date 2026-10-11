// LOCAL_ONLY_V2_16_INFERENCE_BUDGET
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  LocalAiError,
  type OllamaClient,
} from "../../apps/ai-analysis-service/src/local-ai/ollama.client.js";
import type { LocalAiCategory } from "../../apps/ai-analysis-service/src/local-ai/local-ai-output.js";
import type {
  LocalOnlyV2BlockEvidencePacket,
  LocalOnlyV2SelectedFinding,
} from "../../apps/ai-analysis-service/src/execution/local-only-v2-evidence-selector.js";
import {
  assessLocalOnlyV2MicroDraftInference,
  buildLocalOnlyV2BudgetedMicroDraftPlan,
  generateLocalOnlyV2BudgetedMicroDraftWithOllama,
  resolveLocalOnlyV2InferenceBudget,
} from "../../apps/ai-analysis-service/src/execution/local-only-v2-inference-budget.js";
import { buildLocalOnlyV2MicroDraftTask } from "../../apps/ai-analysis-service/src/execution/local-only-v2-micro-draft.js";
import {
  generateLocalOnlyV2ProcessingBlock,
  LOCAL_ONLY_V2_MILESTONES_MAX_CONTENT_CHARACTERS,
  LOCAL_ONLY_V2_MILESTONES_MAX_OUTPUT_TOKENS,
  LOCAL_ONLY_V2_OBJECTIVES_MAX_CONTENT_CHARACTERS,
  LOCAL_ONLY_V2_OBJECTIVES_MAX_OUTPUT_TOKENS,
  LOCAL_ONLY_V2_PROBLEM_DESCRIPTION_MAX_CONTENT_CHARACTERS,
  LOCAL_ONLY_V2_PROBLEM_DESCRIPTION_MAX_OUTPUT_TOKENS,
  LOCAL_ONLY_V2_PROCESS_FLOW_DIAGRAM_REPAIR_MARKER,
  LOCAL_ONLY_V2_PROCESS_FLOW_ER_MAX_CONTENT_CHARACTERS,
  LOCAL_ONLY_V2_PROCESS_FLOW_ER_MAX_OUTPUT_TOKENS,
  LOCAL_ONLY_V2_PROCESS_FLOW_MAX_CONTENT_CHARACTERS,
  LOCAL_ONLY_V2_PROCESS_FLOW_MAX_OUTPUT_TOKENS,
  LOCAL_ONLY_V2_SEQUENTIAL_MAX_CONTENT_CHARACTERS,
  LOCAL_ONLY_V2_SEQUENTIAL_MAX_OUTPUT_TOKENS,
  planLocalOnlyV2ProcessingUnits,
} from "../../apps/ai-analysis-service/src/execution/local-only-v2-sequential-block-generator.js";
import { normalizeLocalOnlyV2SectionContent } from "../../apps/ai-analysis-service/src/execution/local-only-v2-section-content.js";
import {
  beginLocalOnlyV2Block,
  createLocalOnlyV2SequentialBlockExecution,
} from "../../apps/ai-analysis-service/src/execution/local-only-v2-sequential-block-contract.js";
import type { LocalOnlyV2TemplateGenerationPlan } from "../../apps/ai-analysis-service/src/execution/local-only-v2-template-planner.js";

function plan(): LocalOnlyV2TemplateGenerationPlan {
  return {
    pipelineId: "LOCAL_ONLY_V2",
    schemaVersion: "1.0.0",
    template: {
      id: "template-16",
      code: "GENERIC-16",
      name: "Plantilla 16",
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
      projectId: "project-16",
      fingerprint: "c".repeat(64),
      sourceCount: 2,
      segmentCount: 2,
      canonicalFindingCount: 12,
      questionnaireFindingCount: 1,
    },
    blocks: [
      {
        blockId: "template@1:context",
        blockNumber: 1,
        blockTotal: 1,
        sectionKey: "context",
        sectionOrder: 1,
        title: "Contexto",
        required: true,
        guidance: "Describir el contexto sin inventar información.",
      },
    ],
  };
}

function finding(
  index: number,
  evidenceLength = 120,
  questionnaire = false,
): LocalOnlyV2SelectedFinding {
  const sourceId = questionnaire ? "discussion" : "source-a";
  const segmentId = questionnaire ? "discussion#0001" : "source-a#0001";
  const evidenceText = `${"x".repeat(evidenceLength)}-${index}`;
  return {
    canonicalId: `v2f-${String(index).padStart(2, "0")}`,
    category: index % 2 === 0 ? "facts" : "problems",
    description: `Hallazgo ${index}`,
    selectionScore: 10,
    sourceIds: [sourceId],
    segmentIds: [segmentId],
    mandatoryQuestionnaireEvidence: questionnaire,
    occurrenceCount: 1,
    occurrences: [
      {
        sourceId,
        sourceTitle: questionnaire ? "Preguntas" : "Fuente",
        sourcePosition: questionnaire ? 2 : 1,
        segmentId,
        segmentIndex: 0,
        evidenceText,
        evidenceStartCharacter: 0,
        evidenceEndCharacter: evidenceText.length,
        mandatoryQuestionnaireEvidence: questionnaire,
      },
    ],
  };
}

function packet(
  relevantCount = 2,
  evidenceLength = 120,
): LocalOnlyV2BlockEvidencePacket {
  const relevantFindings = Array.from({ length: relevantCount }, (_, index) =>
    finding(index + 1, evidenceLength, index === 0),
  );
  const guardFindings = [finding(99, 80, false)];
  const all = [...relevantFindings, ...guardFindings];
  const sourceIds = [...new Set(all.flatMap((item) => item.sourceIds))];
  const segmentIds = [...new Set(all.flatMap((item) => item.segmentIds))];
  const evidenceCharacterCount = all.reduce(
    (total, item) =>
      total +
      item.description.length +
      item.occurrences.reduce(
        (nested, occurrence) => nested + occurrence.evidenceText.length,
        0,
      ),
    0,
  );

  return {
    pipelineId: "LOCAL_ONLY_V2",
    schemaVersion: "1.0.0",
    projectId: "project-16",
    knowledgeFingerprint: "c".repeat(64),
    templatePlanFingerprint: "b".repeat(64),
    blockId: "template@1:context",
    blockNumber: 1,
    blockTotal: 1,
    sectionKey: "context",
    title: "Contexto",
    required: true,
    guidance: "Describir el contexto sin inventar información.",
    relevantFindings,
    guardFindings,
    selectedFindingIds: all.map((item) => item.canonicalId),
    sourceIds,
    segmentIds,
    metrics: {
      relevantFindingCount: relevantFindings.length,
      guardFindingCount: guardFindings.length,
      totalFindingCount: all.length,
      questionnaireFindingCount: 1,
      sourceCount: sourceIds.length,
      segmentCount: segmentIds.length,
      evidenceCharacterCount,
      estimatedEvidenceTokens: Math.max(
        1,
        Math.ceil(evidenceCharacterCount / 4),
      ),
    },
    fingerprint: "d".repeat(64),
  };
}

test("una subunidad truncada conserva determinísticamente su evidencia", async () => {
  const currentPlan = plan();
  const initial = createLocalOnlyV2SequentialBlockExecution(currentPlan);
  const execution = beginLocalOnlyV2Block(
    initial,
    currentPlan.blocks[0]!.blockId,
  );
  const budget = resolveLocalOnlyV2InferenceBudget({
    configuredContextTokens: 8_192,
    configuredMaxOutputTokens: 8_192,
    configuredTimeoutMs: 600_000,
  });
  const unit = planLocalOnlyV2ProcessingUnits(
    execution,
    currentPlan,
    packet(),
    budget,
  )[0];
  assert.ok(unit);

  const client: Pick<OllamaClient, "generate"> = {
    generate: async () => {
      throw new LocalAiError(
        "OLLAMA_OUTPUT_TRUNCATED",
        "Ollama agotó la salida.",
        true,
      );
    },
  };

  const result = await generateLocalOnlyV2ProcessingBlock(
    client,
    execution,
    currentPlan,
    unit,
  );

  assert.match(result.content, /Hallazgo 1/u);
  assert.match(result.content, /Aspecto por revisar: Hallazgo 99/u);
  assert.ok(
    result.content.length <= LOCAL_ONLY_V2_SEQUENTIAL_MAX_CONTENT_CHARACTERS,
  );
  assert.deepEqual(result.selectedFindingIds, unit.packet.selectedFindingIds);
  assert.equal(result.blockId, unit.packet.blockId);
});

test("el perfil de calidad local limita cada subunidad y evita repetir guardas", async () => {
  const currentPlan = plan();
  const execution = beginLocalOnlyV2Block(
    createLocalOnlyV2SequentialBlockExecution(currentPlan),
    currentPlan.blocks[0]!.blockId,
  );
  const budget = resolveLocalOnlyV2InferenceBudget({
    configuredContextTokens: 8_192,
    configuredMaxOutputTokens: 8_192,
    configuredTimeoutMs: 600_000,
  });
  const units = planLocalOnlyV2ProcessingUnits(
    execution,
    currentPlan,
    packet(14, 600),
    budget,
  );
  assert.ok(units.length > 1);
  assert.ok(units[0]!.packet.guardFindings.length > 0);
  assert.ok(
    units.slice(1).every((unit) => unit.packet.guardFindings.length === 0),
  );

  let capturedPrompt = "";
  let capturedSchema: Readonly<Record<string, unknown>> | null = null;
  let capturedMaxOutputTokens: number | null = null;
  const client: Pick<OllamaClient, "generate"> = {
    generate: async (...args: Parameters<OllamaClient["generate"]>) => {
      capturedPrompt = args[0];
      capturedSchema = args[1];
      capturedMaxOutputTokens = args[5]?.runtimeLimits?.maxOutputTokens ?? null;
      return JSON.stringify({ content: "Resumen compacto sustentado." });
    },
  };

  await generateLocalOnlyV2ProcessingBlock(
    client,
    execution,
    currentPlan,
    units[0]!,
  );

  const properties = capturedSchema?.properties as
    Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined;
  assert.equal(
    properties?.content?.maxLength,
    LOCAL_ONLY_V2_SEQUENTIAL_MAX_CONTENT_CHARACTERS,
  );
  assert.equal(
    capturedMaxOutputTokens,
    LOCAL_ONLY_V2_SEQUENTIAL_MAX_OUTPUT_TOKENS,
  );
  assert.match(capturedPrompt, /cloud-parity-v1/u);
  assert.match(capturedPrompt, /una sola vez/u);
});

// AI_ANALYSIS_LOCAL_ONLY_V2_PROCESS_FLOW_DIAGRAM_SUBUNITS_V1
//
// El punto 6 ahora produce TRES subunidades independientes (AS-IS, TO-BE,
// modelo entidad-relación), cada una con su propia evidencia especializada,
// prompt, validación y como máximo una reparación localizada. Este helper
// construye un paquete de evidencia de processFlow con hallazgos ya
// categorizados (actores, procesos, problemas, entidades) para que
// planLocalOnlyV2ProcessingUnits pueda repartirlos entre las tres.
function processFlowFinding(
  canonicalId: string,
  category: LocalAiCategory,
  description: string,
): LocalOnlyV2SelectedFinding {
  const sourceId = "source-a";
  const segmentId = `source-a#${canonicalId}`;
  const evidenceText = `${description} (evidencia).`;
  return {
    canonicalId,
    category,
    description,
    selectionScore: 10,
    sourceIds: [sourceId],
    segmentIds: [segmentId],
    mandatoryQuestionnaireEvidence: false,
    occurrenceCount: 1,
    occurrences: [
      {
        sourceId,
        sourceTitle: "Fuente",
        sourcePosition: 1,
        segmentId,
        segmentIndex: 0,
        evidenceText,
        evidenceStartCharacter: 0,
        evidenceEndCharacter: evidenceText.length,
        mandatoryQuestionnaireEvidence: false,
      },
    ],
  };
}

function processFlowPacket(
  blockId: string,
  findings: readonly LocalOnlyV2SelectedFinding[],
): LocalOnlyV2BlockEvidencePacket {
  const sourceIds = [...new Set(findings.flatMap((item) => item.sourceIds))];
  const segmentIds = [
    ...new Set(findings.flatMap((item) => item.segmentIds)),
  ];
  const evidenceCharacterCount = findings.reduce(
    (total, item) =>
      total +
      item.description.length +
      item.occurrences.reduce(
        (nested, occurrence) => nested + occurrence.evidenceText.length,
        0,
      ),
    0,
  );
  return {
    pipelineId: "LOCAL_ONLY_V2",
    schemaVersion: "1.0.0",
    projectId: "project-16",
    knowledgeFingerprint: "c".repeat(64),
    templatePlanFingerprint: "b".repeat(64),
    blockId,
    blockNumber: 1,
    blockTotal: 1,
    sectionKey: "processFlow",
    title: "Diagrama de flujo",
    required: true,
    guidance: "Representar AS-IS, TO-BE y modelo entidad-relación.",
    relevantFindings: findings,
    guardFindings: [],
    selectedFindingIds: findings.map((item) => item.canonicalId),
    sourceIds,
    segmentIds,
    metrics: {
      relevantFindingCount: findings.length,
      guardFindingCount: 0,
      totalFindingCount: findings.length,
      questionnaireFindingCount: 0,
      sourceCount: sourceIds.length,
      segmentCount: segmentIds.length,
      evidenceCharacterCount,
      estimatedEvidenceTokens: Math.max(
        1,
        Math.ceil(evidenceCharacterCount / 4),
      ),
    },
    fingerprint: "d".repeat(64),
  };
}

test("processFlow genera AS-IS, TO-BE y modelo entidad-relación como tres subunidades independientes", async () => {
  const basePlan = plan();
  const processBlock = {
    ...basePlan.blocks[0]!,
    blockId: "template@1:processFlow",
    sectionKey: "processFlow",
    title: "Diagrama de flujo",
    guidance: "Representar AS-IS, TO-BE y modelo entidad-relación.",
  };
  const currentPlan: LocalOnlyV2TemplateGenerationPlan = {
    ...basePlan,
    blocks: [processBlock],
  };
  const findings = [
    processFlowFinding(
      "v2f-actor-01",
      "actors",
      "Solicitante: persona que radica la solicitud del trámite",
    ),
    processFlowFinding(
      "v2f-actor-02",
      "actors",
      "Responsable de validación: revisa la información recibida",
    ),
    processFlowFinding(
      "v2f-proc-01",
      "currentProcesses",
      "El solicitante registra la información en un formulario físico",
    ),
    processFlowFinding(
      "v2f-prob-01",
      "problems",
      "La validación manual genera reprocesos",
    ),
    processFlowFinding(
      "v2f-exp-01",
      "expectedProcesses",
      "El sistema de gestión captura y valida la información automáticamente",
    ),
    processFlowFinding(
      "v2f-req-01",
      "functionalRequirements",
      "El sistema debe permitir aprobar o rechazar la solicitud digital",
    ),
    processFlowFinding(
      "v2f-ent-01",
      "entities",
      "La Solicitud es la entidad principal del proceso",
    ),
    processFlowFinding(
      "v2f-ent-02",
      "entities",
      "El Usuario registra una o varias Solicitudes",
    ),
  ];
  const currentPacket = processFlowPacket(processBlock.blockId, findings);
  const execution = beginLocalOnlyV2Block(
    createLocalOnlyV2SequentialBlockExecution(currentPlan),
    processBlock.blockId,
  );
  const budget = resolveLocalOnlyV2InferenceBudget({
    configuredContextTokens: 16_384,
    configuredMaxOutputTokens: 8_192,
    configuredTimeoutMs: 600_000,
  });
  const units = planLocalOnlyV2ProcessingUnits(
    execution,
    currentPlan,
    currentPacket,
    budget,
  );
  assert.equal(units.length, 3);
  assert.deepEqual(
    units.map((unit) => unit.packet.diagramArtifact),
    ["AS_IS", "TO_BE", "ENTITY_RELATIONSHIP"],
  );
  const [asIsUnit, toBeUnit, erUnit] = units;

  // AS-IS: primera respuesta resumida (no canónica) dispara exactamente una
  // reparación localizada; la reparación entrega el contrato canónico con
  // dos carriles reales (no un único carril genérico).
  const asIsPrompts: string[] = [];
  const asIsMaxOutputTokens: Array<number | undefined> = [];
  const asIsSchemaMaxLengths: Array<number | undefined> = [];
  const asIsSummarized = "Flujo actual:\n- Registrar solicitud.\n- Validar información.";
  const asIsStructured = [
    "FLUJO AS-IS",
    "CARRIL | ASIS-L01 | Solicitante | ACTOR",
    "CARRIL | ASIS-L02 | Responsable de validación | ACTOR",
    "NODO | ASIS-N01 | ASIS-L01 | START | Inicia la necesidad del trámite",
    "NODO | ASIS-N02 | ASIS-L01 | PROCESS | Registra la información inicial",
    "NODO | ASIS-N03 | ASIS-L02 | DECISION | ¿La información está completa?",
    "NODO | ASIS-N04 | ASIS-L02 | PROCESS | Corrige la información",
    "NODO | ASIS-N05 | ASIS-L01 | END | Finaliza el proceso",
    "ARISTA | ASIS-N01 | ASIS-N02 | ",
    "ARISTA | ASIS-N02 | ASIS-N03 | ",
    "ARISTA | ASIS-N03 | ASIS-N04 | No",
    "ARISTA | ASIS-N03 | ASIS-N05 | Sí",
    "PROBLEMA | La validación manual genera reprocesos.",
  ].join("\n");
  const asIsClient: Pick<OllamaClient, "generate"> = {
    generate: async (...args: Parameters<OllamaClient["generate"]>) => {
      asIsPrompts.push(args[0]);
      asIsMaxOutputTokens.push(args[5]?.runtimeLimits?.maxOutputTokens);
      const schema = args[1] as {
        properties?: { content?: { maxLength?: number } };
      };
      asIsSchemaMaxLengths.push(schema.properties?.content?.maxLength);
      return JSON.stringify({
        content: asIsPrompts.length === 1 ? asIsSummarized : asIsStructured,
      });
    },
  };
  const asIsResult = await generateLocalOnlyV2ProcessingBlock(
    asIsClient,
    execution,
    currentPlan,
    asIsUnit!,
  );
  assert.equal(asIsPrompts.length, 2);
  assert.match(
    asIsPrompts[0] ?? "",
    /Representa ÚNICAMENTE el proceso ACTUAL/u,
  );
  assert.match(
    asIsPrompts[1] ?? "",
    new RegExp(LOCAL_ONLY_V2_PROCESS_FLOW_DIAGRAM_REPAIR_MARKER),
  );
  assert.equal(asIsMaxOutputTokens[0], LOCAL_ONLY_V2_PROCESS_FLOW_MAX_OUTPUT_TOKENS);
  assert.equal(
    asIsSchemaMaxLengths[0],
    LOCAL_ONLY_V2_PROCESS_FLOW_MAX_CONTENT_CHARACTERS,
  );

  // TO-BE: sale bien formado en el primer intento, con una decisión real de
  // dos ramas etiquetadas de forma distinta.
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
  let toBeCallCount = 0;
  const toBeClient: Pick<OllamaClient, "generate"> = {
    generate: async () => {
      toBeCallCount += 1;
      return JSON.stringify({ content: toBeContent });
    },
  };
  const toBeResult = await generateLocalOnlyV2ProcessingBlock(
    toBeClient,
    execution,
    currentPlan,
    toBeUnit!,
  );
  assert.equal(toBeCallCount, 1, "TO-BE bien formado no debería disparar reparación");

  // Modelo entidad-relación: dos entidades y una relación en el primer
  // intento.
  const erContent = [
    "ENTIDAD | ER-E01 | Solicitud | Solicitud gestionada en el proceso",
    "ATRIBUTO | ER-E01 | solicitud_id | Texto | PK | SI",
    "ENTIDAD | ER-E02 | Usuario | Usuario participante",
    "ATRIBUTO | ER-E02 | usuario_id | Texto | PK | SI",
    "RELACION | ER-E02 | ER-E01 | 1:N | registra",
  ].join("\n");
  let erCallCount = 0;
  const erMaxOutputTokens: Array<number | undefined> = [];
  const erSchemaMaxLengths: Array<number | undefined> = [];
  const erClient: Pick<OllamaClient, "generate"> = {
    generate: async (...args: Parameters<OllamaClient["generate"]>) => {
      erCallCount += 1;
      erMaxOutputTokens.push(args[5]?.runtimeLimits?.maxOutputTokens);
      const schema = args[1] as {
        properties?: { content?: { maxLength?: number } };
      };
      erSchemaMaxLengths.push(schema.properties?.content?.maxLength);
      return JSON.stringify({ content: erContent });
    },
  };
  const erResult = await generateLocalOnlyV2ProcessingBlock(
    erClient,
    execution,
    currentPlan,
    erUnit!,
  );
  assert.equal(erCallCount, 1);
  assert.equal(erMaxOutputTokens[0], LOCAL_ONLY_V2_PROCESS_FLOW_ER_MAX_OUTPUT_TOKENS);
  assert.equal(
    erSchemaMaxLengths[0],
    LOCAL_ONLY_V2_PROCESS_FLOW_ER_MAX_CONTENT_CHARACTERS,
  );

  // Ensamblaje: igual que assembleLocalOnlyV2SequentialSections, los tres
  // borradores del mismo bloque se concatenan en orden antes de normalizar.
  const assembledContent = [
    asIsResult.content,
    toBeResult.content,
    erResult.content,
  ].join("\n");

  const normalized = normalizeLocalOnlyV2SectionContent(
    "processFlow",
    assembledContent,
    {},
  ) as Record<string, unknown>;
  const processFlows = normalized.processFlows as Record<
    string,
    Record<string, unknown>
  >;
  const asIs = processFlows.asIs;
  const toBe = processFlows.toBe;

  assert.equal((asIs.lanes as unknown[]).length, 2);
  assert.equal((toBe.lanes as unknown[]).length, 2);
  assert.ok((asIs.nodes as unknown[]).length >= 5);
  assert.ok((toBe.nodes as unknown[]).length >= 5);

  const asIsNodes = asIs.nodes as Array<Record<string, unknown>>;
  const asIsLaneIds = new Set(
    (asIs.lanes as Array<Record<string, unknown>>).map((lane) => lane.id),
  );
  for (const node of asIsNodes) {
    assert.ok(asIsLaneIds.has(node.laneId));
    assert.doesNotMatch(String(node.label), /^(?:pregunta|respuesta)\s*:/iu);
  }
  const asIsNodeIds = new Set(asIsNodes.map((node) => node.id));
  for (const edge of asIs.edges as Array<Record<string, unknown>>) {
    assert.ok(asIsNodeIds.has(edge.from));
    assert.ok(asIsNodeIds.has(edge.to));
  }

  const decisionNode = (toBe.nodes as Array<Record<string, unknown>>).find(
    (node) => node.kind === "DECISION",
  );
  assert.ok(decisionNode);
  const outgoingFromDecision = (
    toBe.edges as Array<Record<string, unknown>>
  ).filter((edge) => edge.from === decisionNode!.id);
  assert.equal(outgoingFromDecision.length, 2);
  assert.deepEqual(
    outgoingFromDecision.map((edge) => edge.label).sort(),
    ["No", "Sí"],
  );

  assert.deepEqual(asIs.problems, ["La validación manual genera reprocesos."]);
  assert.deepEqual(asIs.improvements, []);
  assert.deepEqual(toBe.improvements, [
    "Estandarización del registro y la validación.",
  ]);
  assert.deepEqual(toBe.expectedResults, ["Mayor trazabilidad del trámite."]);
  assert.deepEqual(toBe.problems, []);

  const entityRelationship = normalized.entityRelationship as Record<
    string,
    unknown
  >;
  assert.equal((entityRelationship.entities as unknown[]).length, 2);
  assert.equal((entityRelationship.relationships as unknown[]).length, 1);
  const relationship = (
    entityRelationship.relationships as Array<Record<string, unknown>>
  )[0]!;
  assert.equal(relationship.cardinality, "1:N");
});

test("milestones usa contrato estructurado amplio y repara una sola vez la salida narrativa", async () => {
  const basePlan = plan();
  const milestoneBlock = {
    ...basePlan.blocks[0]!,
    blockId: "template@1:milestones",
    sectionKey: "milestones",
    title: "Requerimientos",
    guidance: "Estructurar requisitos funcionales y no funcionales.",
  };
  const currentPlan: LocalOnlyV2TemplateGenerationPlan = {
    ...basePlan,
    blocks: [milestoneBlock],
  };
  const basePacket = packet(4, 120);
  const currentPacket: LocalOnlyV2BlockEvidencePacket = {
    ...basePacket,
    blockId: milestoneBlock.blockId,
    sectionKey: milestoneBlock.sectionKey,
    title: milestoneBlock.title,
    guidance: milestoneBlock.guidance,
  };
  const execution = beginLocalOnlyV2Block(
    createLocalOnlyV2SequentialBlockExecution(currentPlan),
    milestoneBlock.blockId,
  );
  const budget = resolveLocalOnlyV2InferenceBudget({
    configuredContextTokens: 16_384,
    configuredMaxOutputTokens: 8_192,
    configuredTimeoutMs: 600_000,
  });
  const unit = planLocalOnlyV2ProcessingUnits(
    execution,
    currentPlan,
    currentPacket,
    budget,
  )[0]!;
  assert.equal(unit.unitNumber, 1);

  const narrative = [
    "REQUERIMIENTOS FUNCIONALES",
    "Hito: Gestión de solicitudes.",
    "- El sistema debe registrar la solicitud.",
    "- El usuario debe consultar su estado.",
  ].join("\n");

  const structured = [
    "HITO | H-001 | Gestión de solicitudes | Organizar el registro y seguimiento del proceso sustentado.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud mediante una captura estructurada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar una solicitud con la información requerida",
    "PARA | iniciar el proceso de forma estandarizada",
    "CONTEXTO | La evidencia describe un registro que requiere control y trazabilidad.",
    "CAMPO | Identificador | Texto | SI | Debe estar informado para registrar la solicitud.",
    "CA | CA-F-001 | existe información válida | el usuario registra la solicitud | el sistema conserva el registro para su seguimiento",
  ].join("\n");

  const prompts: string[] = [];
  const maxOutputTokens: Array<number | undefined> = [];
  const schemaMaxLengths: Array<number | undefined> = [];

  const client: Pick<OllamaClient, "generate"> = {
    generate: async (...args: Parameters<OllamaClient["generate"]>) => {
      prompts.push(args[0]);
      maxOutputTokens.push(args[5]?.runtimeLimits?.maxOutputTokens);
      const schema = args[1] as {
        properties?: { content?: { maxLength?: number } };
      };
      schemaMaxLengths.push(schema.properties?.content?.maxLength);
      return JSON.stringify({
        content: prompts.length === 1 ? narrative : structured,
      });
    },
  };

  const result = await generateLocalOnlyV2ProcessingBlock(
    client,
    execution,
    currentPlan,
    unit,
  );

  assert.equal(prompts.length, 2);
  assert.match(
    prompts[0] ?? "",
    /NO resumas ni redactes Requerimientos como prosa/u,
  );
  assert.doesNotMatch(
    prompts[0] ?? "",
    /Resume solo los hallazgos necesarios para Requerimientos/u,
  );
  assert.match(
    prompts[1] ?? "",
    /LOCAL_ONLY_V2_MILESTONES_STRUCTURED_REPAIR_V1/u,
  );
  assert.equal(maxOutputTokens[0], LOCAL_ONLY_V2_MILESTONES_MAX_OUTPUT_TOKENS);
  assert.equal(maxOutputTokens[1], LOCAL_ONLY_V2_MILESTONES_MAX_OUTPUT_TOKENS);
  assert.equal(
    schemaMaxLengths[0],
    LOCAL_ONLY_V2_MILESTONES_MAX_CONTENT_CHARACTERS,
  );
  assert.equal(
    schemaMaxLengths[1],
    LOCAL_ONLY_V2_MILESTONES_MAX_CONTENT_CHARACTERS,
  );
  assert.match(result.content, /^HITO \| H-001 \|/u);
  assert.match(result.content, /\nHU \| HU-F-001 \|/u);
  assert.match(result.content, /\nCOMO \|/u);
  assert.match(result.content, /\nQUIERO \|/u);
  assert.match(result.content, /\nPARA \|/u);
  assert.match(result.content, /\nCONTEXTO \|/u);
  assert.match(result.content, /\nCAMPO \|/u);
  assert.match(result.content, /\nCA \| CA-F-001 \|/u);

  const normalized = normalizeLocalOnlyV2SectionContent(
    "milestones",
    result.content,
    {},
  ) as Record<string, unknown>;
  const functionalRequirements = normalized.functionalRequirements as Array<
    Record<string, unknown>
  >;
  assert.equal(functionalRequirements.length, 1);
  assert.equal(functionalRequirements[0]?.code, "HU-F-001");
  assert.equal(functionalRequirements[0]?.milestone, "H-001");
  assert.equal(
    (functionalRequirements[0]?.fields as unknown[] | undefined)?.length,
    1,
  );
  assert.equal(
    (functionalRequirements[0]?.acceptanceCriteria as unknown[] | undefined)
      ?.length,
    1,
  );
});

test("el presupuesto de milestones cubre lo que el modelo escribe por lote de 3 hallazgos", () => {
  assert.equal(LOCAL_ONLY_V2_MILESTONES_MAX_OUTPUT_TOKENS, 3_000);
  assert.equal(LOCAL_ONLY_V2_MILESTONES_MAX_CONTENT_CHARACTERS, 7_000);
});

function milestonesTruncationFinding(
  index: number,
  descriptionLength: number,
): LocalOnlyV2SelectedFinding {
  const sourceId = "source-a";
  const segmentId = `source-a#trunc-${String(index).padStart(2, "0")}`;
  const description = `Hallazgo funcional extenso ${index}: ${"a".repeat(descriptionLength)}`;
  const evidenceText = `${"x".repeat(60)}-${index}`;
  return {
    canonicalId: `v2f-trunc-${String(index).padStart(2, "0")}`,
    category: "functionalRequirements",
    description,
    selectionScore: 10,
    sourceIds: [sourceId],
    segmentIds: [segmentId],
    mandatoryQuestionnaireEvidence: false,
    occurrenceCount: 1,
    occurrences: [
      {
        sourceId,
        sourceTitle: "Fuente",
        sourcePosition: 1,
        segmentId,
        segmentIndex: 0,
        evidenceText,
        evidenceStartCharacter: 0,
        evidenceEndCharacter: evidenceText.length,
        mandatoryQuestionnaireEvidence: false,
      },
    ],
  };
}

function milestonesTruncationPacket(
  blockId: string,
  relevantFindings: LocalOnlyV2SelectedFinding[],
): LocalOnlyV2BlockEvidencePacket {
  const sourceIds = [
    ...new Set(relevantFindings.flatMap((item) => item.sourceIds)),
  ];
  const segmentIds = [
    ...new Set(relevantFindings.flatMap((item) => item.segmentIds)),
  ];
  const evidenceCharacterCount = relevantFindings.reduce(
    (total, item) =>
      total +
      item.description.length +
      item.occurrences.reduce(
        (nested, occurrence) => nested + occurrence.evidenceText.length,
        0,
      ),
    0,
  );

  return {
    pipelineId: "LOCAL_ONLY_V2",
    schemaVersion: "1.0.0",
    projectId: "project-16",
    knowledgeFingerprint: "c".repeat(64),
    templatePlanFingerprint: "b".repeat(64),
    blockId,
    blockNumber: 1,
    blockTotal: 1,
    sectionKey: "milestones",
    title: "Requerimientos",
    required: true,
    guidance: "Estructurar requisitos funcionales y no funcionales.",
    relevantFindings,
    guardFindings: [],
    selectedFindingIds: relevantFindings.map((item) => item.canonicalId),
    sourceIds,
    segmentIds,
    metrics: {
      relevantFindingCount: relevantFindings.length,
      guardFindingCount: 0,
      totalFindingCount: relevantFindings.length,
      questionnaireFindingCount: 0,
      sourceCount: sourceIds.length,
      segmentCount: segmentIds.length,
      evidenceCharacterCount,
      estimatedEvidenceTokens: Math.max(
        1,
        Math.ceil(evidenceCharacterCount / 4),
      ),
    },
    fingerprint: "d".repeat(64),
  };
}

test("milestones truncado por Ollama conserva HUs pendientes en vez de abortar el documento", async () => {
  const basePlan = plan();
  const milestoneBlock = {
    ...basePlan.blocks[0]!,
    blockId: "template@1:milestones-truncated",
    sectionKey: "milestones",
    title: "Requerimientos",
    guidance: "Estructurar requisitos funcionales y no funcionales.",
  };
  const currentPlan: LocalOnlyV2TemplateGenerationPlan = {
    ...basePlan,
    blocks: [milestoneBlock],
  };
  // 900 caracteres por hallazgo mantiene los cuatro hallazgos funcionales
  // extensos dentro del límite de evidencia por lote de milestones (1.200
  // tokens estimados), igual que en el caso real donde llegan juntos a la
  // primera subunidad.
  const relevantFindings = Array.from({ length: 3 }, (_, index) =>
    milestonesTruncationFinding(index + 1, 900),
  );
  const currentPacket = milestonesTruncationPacket(
    milestoneBlock.blockId,
    relevantFindings,
  );
  const execution = beginLocalOnlyV2Block(
    createLocalOnlyV2SequentialBlockExecution(currentPlan),
    milestoneBlock.blockId,
  );
  const budget = resolveLocalOnlyV2InferenceBudget({
    configuredContextTokens: 16_384,
    configuredMaxOutputTokens: 8_192,
    configuredTimeoutMs: 600_000,
  });
  const unit = planLocalOnlyV2ProcessingUnits(
    execution,
    currentPlan,
    currentPacket,
    budget,
  )[0]!;
  assert.equal(unit.packet.relevantFindings.length, 3);

  const maxOutputTokens: Array<number | undefined> = [];
  const client: Pick<OllamaClient, "generate"> = {
    generate: async (...args: Parameters<OllamaClient["generate"]>) => {
      maxOutputTokens.push(args[5]?.runtimeLimits?.maxOutputTokens);
      throw new LocalAiError(
        "OLLAMA_OUTPUT_TRUNCATED",
        "Ollama agotó la salida.",
        true,
      );
    },
  };

  const result = await generateLocalOnlyV2ProcessingBlock(
    client,
    execution,
    currentPlan,
    unit,
  );

  assert.match(result.content, /^HITO \|/u);
  assert.match(result.content, /\nHU \| HU-PEND-001-01 \|/u);
  for (const relevantFinding of relevantFindings) {
    assert.ok(
      result.content.includes(relevantFinding.description.slice(0, 24)),
      `esperaba conservar el inicio de: ${relevantFinding.description}`,
    );
  }
  assert.ok(
    result.content.length <= LOCAL_ONLY_V2_MILESTONES_MAX_CONTENT_CHARACTERS,
  );
  assert.deepEqual(result.selectedFindingIds, unit.packet.selectedFindingIds);
  assert.ok(
    maxOutputTokens.every(
      (value) => value === LOCAL_ONLY_V2_MILESTONES_MAX_OUTPUT_TOKENS,
    ),
  );

  const normalized = normalizeLocalOnlyV2SectionContent(
    "milestones",
    result.content,
    {},
  ) as Record<string, unknown>;
  const functionalRequirements = normalized.functionalRequirements as Array<
    Record<string, unknown>
  >;
  assert.equal(functionalRequirements.length, relevantFindings.length);
  for (const requirement of functionalRequirements) {
    assert.equal(requirement.documentationStatus, "PENDING_DOCUMENTATION");
    assert.equal(
      (requirement.acceptanceCriteria as unknown[] | undefined)?.length,
      0,
    );
  }
});

test("milestones con content JSON válido pero sobredimensionado usa el fallback HITO/HU en vez de abortar", async () => {
  const basePlan = plan();
  const milestoneBlock = {
    ...basePlan.blocks[0]!,
    blockId: "template@1:milestones-oversized-json",
    sectionKey: "milestones",
    title: "Requerimientos",
    guidance: "Estructurar requisitos funcionales y no funcionales.",
  };
  const currentPlan: LocalOnlyV2TemplateGenerationPlan = {
    ...basePlan,
    blocks: [milestoneBlock],
  };
  const relevantFindings = Array.from({ length: 3 }, (_, index) =>
    milestonesTruncationFinding(index + 1, 900),
  );
  const currentPacket = milestonesTruncationPacket(
    milestoneBlock.blockId,
    relevantFindings,
  );
  const execution = beginLocalOnlyV2Block(
    createLocalOnlyV2SequentialBlockExecution(currentPlan),
    milestoneBlock.blockId,
  );
  const budget = resolveLocalOnlyV2InferenceBudget({
    configuredContextTokens: 16_384,
    configuredMaxOutputTokens: 8_192,
    configuredTimeoutMs: 600_000,
  });
  const unit = planLocalOnlyV2ProcessingUnits(
    execution,
    currentPlan,
    currentPacket,
    budget,
  )[0]!;
  assert.equal(unit.packet.relevantFindings.length, 3);

  // Reproduce la sonda real: Ollama devolvió JSON sintácticamente válido con
  // un content desmedido, que excede tanto el límite global del
  // micro-borrador (12_000) como el específico de milestones (7_000).
  // El parser estricto lanzaría "excedió el máximo de 12000 caracteres" antes
  // de que el chequeo de sección pudiera redirigir al fallback determinístico,
  // así que este caso debe detectarse sobre el JSON crudo, no después del
  // parseo estricto.
  const oversizedContent = "HITO | H-1 | Título | Descripción\n".repeat(500);
  assert.ok(oversizedContent.length > 12_000);

  const client: Pick<OllamaClient, "generate"> = {
    generate: async () => JSON.stringify({ content: oversizedContent }),
  };

  const result = await generateLocalOnlyV2ProcessingBlock(
    client,
    execution,
    currentPlan,
    unit,
  );

  assert.match(result.content, /^HITO \|/u);
  assert.match(result.content, /\nHU \| HU-PEND-001-01 \|/u);
  for (const relevantFinding of relevantFindings) {
    assert.ok(
      result.content.includes(relevantFinding.description.slice(0, 24)),
      `esperaba conservar el inicio de: ${relevantFinding.description}`,
    );
  }
  assert.ok(
    result.content.length <= LOCAL_ONLY_V2_MILESTONES_MAX_CONTENT_CHARACTERS,
  );
  assert.deepEqual(result.selectedFindingIds, unit.packet.selectedFindingIds);

  const normalized = normalizeLocalOnlyV2SectionContent(
    "milestones",
    result.content,
    {},
  ) as Record<string, unknown>;
  const functionalRequirements = normalized.functionalRequirements as Array<
    Record<string, unknown>
  >;
  assert.equal(functionalRequirements.length, relevantFindings.length);
  for (const requirement of functionalRequirements) {
    assert.equal(requirement.documentationStatus, "PENDING_DOCUMENTATION");
    assert.equal(
      (requirement.acceptanceCriteria as unknown[] | undefined)?.length,
      0,
    );
  }
});

test("milestones repara Hitos vacíos y canonicaliza HU-F y CA-F repetidas entre Hitos", async () => {
  const basePlan = plan();
  const milestoneBlock = {
    ...basePlan.blocks[0]!,
    blockId: "template@1:milestones-hierarchy-v2",
    sectionKey: "milestones",
    title: "Requerimientos",
    guidance: "Estructurar requisitos funcionales y no funcionales.",
  };
  const currentPlan: LocalOnlyV2TemplateGenerationPlan = {
    ...basePlan,
    blocks: [milestoneBlock],
  };
  const basePacket = packet(4, 120);
  const currentPacket: LocalOnlyV2BlockEvidencePacket = {
    ...basePacket,
    blockId: milestoneBlock.blockId,
    sectionKey: milestoneBlock.sectionKey,
    title: milestoneBlock.title,
    guidance: milestoneBlock.guidance,
  };
  const execution = beginLocalOnlyV2Block(
    createLocalOnlyV2SequentialBlockExecution(currentPlan),
    milestoneBlock.blockId,
  );
  const budget = resolveLocalOnlyV2InferenceBudget({
    configuredContextTokens: 16_384,
    configuredMaxOutputTokens: 8_192,
    configuredTimeoutMs: 600_000,
  });
  const unit = planLocalOnlyV2ProcessingUnits(
    execution,
    currentPlan,
    currentPacket,
    budget,
  )[0]!;
  assert.equal(unit.unitNumber, 1);

  const withEmptyMilestone = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HITO | H-002 | Aprobación | Gestión de aprobación.",
    "HU | HU-F-001 | Aprobar solicitud | Permitir la decisión sobre una solicitud.",
    "COMO | Usuario aprobador",
    "QUIERO | aprobar o rechazar la solicitud",
    "PARA | continuar el proceso con una decisión registrada",
    "CONTEXTO | La evidencia describe una aprobación de solicitudes.",
    "CA | CA-F-001 | existe una solicitud pendiente | el aprobador decide | el sistema registra la decisión",
  ].join("\n");

  const repaired = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
    "HITO | H-001 | Aprobación | Gestión de aprobación.",
    "HU | HU-F-001 | Aprobar solicitud | Permitir la decisión sobre una solicitud.",
    "COMO | Usuario aprobador",
    "QUIERO | aprobar o rechazar la solicitud",
    "PARA | continuar el proceso con una decisión registrada",
    "CONTEXTO | La evidencia describe una aprobación de solicitudes.",
    "CA | CA-F-001 | existe una solicitud pendiente | el aprobador decide | el sistema registra la decisión",
  ].join("\n");

  const prompts: string[] = [];
  const client: Pick<OllamaClient, "generate"> = {
    generate: async (...args: Parameters<OllamaClient["generate"]>) => {
      prompts.push(args[0]);
      return JSON.stringify({
        content: prompts.length === 1 ? withEmptyMilestone : repaired,
      });
    },
  };

  const result = await generateLocalOnlyV2ProcessingBlock(
    client,
    execution,
    currentPlan,
    unit,
  );

  assert.equal(prompts.length, 2);
  assert.match(prompts[0] ?? "", /LOCAL_ONLY_V2_REQUIREMENTS_HIERARCHY_V2/u);
  assert.match(prompts[1] ?? "", /No devuelvas ningún HITO vacío/u);

  const normalized = normalizeLocalOnlyV2SectionContent(
    "milestones",
    result.content,
    {},
  ) as Record<string, unknown>;
  const functionalRequirements = normalized.functionalRequirements as Array<
    Record<string, unknown>
  >;

  assert.equal(functionalRequirements.length, 2);
  assert.deepEqual(
    functionalRequirements.map((story) => story.code),
    ["HU-F-001", "HU-F-002"],
  );
  assert.deepEqual(
    functionalRequirements.map((story) => story.milestone),
    ["H-001", "H-002"],
  );
  assert.deepEqual(
    functionalRequirements.flatMap((story) =>
      (story.acceptanceCriteria as Array<Record<string, unknown>>).map(
        (criterion) => criterion.code,
      ),
    ),
    ["CA-F-001", "CA-F-002"],
  );
});

// AI_ANALYSIS_LOCAL_ONLY_V2_MILESTONES_PENDING_CLASSIFICATION_V1
//
// Una HU incompleta ya no debe abortar todo el punto de Requerimientos: se
// conserva como PENDING_DOCUMENTATION (sin inventar datos) mientras las HU
// completas sobreviven. Solo debe fallar cerrado cuando la salida no tiene
// ninguna estructura HITO/HU reconocible.
async function generateMilestonesUnitWithContent(
  content: string,
  relevantCount = 4,
): Promise<{
  contentOut: string;
  normalized: { functionalRequirements: Array<Record<string, unknown>> };
}> {
  const basePlan = plan();
  const milestoneBlock = {
    ...basePlan.blocks[0]!,
    blockId: "template@1:milestones-caso",
    sectionKey: "milestones",
    title: "Requerimientos",
    guidance: "Estructurar requisitos funcionales y no funcionales.",
  };
  const currentPlan: LocalOnlyV2TemplateGenerationPlan = {
    ...basePlan,
    blocks: [milestoneBlock],
  };
  const basePacket = packet(relevantCount, 120);
  // El fallback de Requerimientos solo convierte en HU los hallazgos
  // funcionales (no actores, hechos ni problemas).
  const functionalFindings = basePacket.relevantFindings.map((item) => ({
    ...item,
    category: "functionalRequirements" as const,
    description: `Requisito funcional sustentado ${item.canonicalId}: el sistema registra y valida la solicitud.`,
  }));
  const currentPacket: LocalOnlyV2BlockEvidencePacket = {
    ...basePacket,
    relevantFindings: functionalFindings,
    blockId: milestoneBlock.blockId,
    sectionKey: milestoneBlock.sectionKey,
    title: milestoneBlock.title,
    guidance: milestoneBlock.guidance,
  };
  const execution = beginLocalOnlyV2Block(
    createLocalOnlyV2SequentialBlockExecution(currentPlan),
    milestoneBlock.blockId,
  );
  const budget = resolveLocalOnlyV2InferenceBudget({
    configuredContextTokens: 16_384,
    configuredMaxOutputTokens: 8_192,
    configuredTimeoutMs: 600_000,
  });
  const unit = planLocalOnlyV2ProcessingUnits(
    execution,
    currentPlan,
    currentPacket,
    budget,
  )[0]!;

  const client: Pick<OllamaClient, "generate"> = {
    generate: async () => JSON.stringify({ content }),
  };

  const result = await generateLocalOnlyV2ProcessingBlock(
    client,
    execution,
    currentPlan,
    unit,
  );
  const normalized = normalizeLocalOnlyV2SectionContent(
    "milestones",
    result.content,
    {},
  ) as { functionalRequirements: Array<Record<string, unknown>> };
  return { contentOut: result.content, normalized };
}

// AI_ANALYSIS_LOCAL_ONLY_V2_MILESTONES_PENDING_FALLBACK_ASSERTION_V1
//
// Antes de la corrección, una salida UNPARSEABLE (incluso tras la
// reparación localizada) hacía que generateMilestonesUnitWithContent
// rechazara la promesa con "LOCAL_ONLY_V2 rechazó Requerimientos...",
// abortando todo el documento. Ahora esa salida corrupta no se acepta ni se
// conserva, pero tampoco aborta el documento: se sustituye por el fallback
// determinista pendiente construido exclusivamente desde
// unit.packet.relevantFindings (una HU pendiente por cada hallazgo). Este
// helper concentra las aserciones comunes a todos los casos que antes
// esperaban el rechazo.
async function assertMilestonesFallbackReplacesCorruptOutput(
  content: string,
  relevantCount = 4,
): Promise<{
  contentOut: string;
  normalized: { functionalRequirements: Array<Record<string, unknown>> };
}> {
  const result = await generateMilestonesUnitWithContent(content, relevantCount);
  assert.notEqual(result.contentOut, content);
  assert.match(result.contentOut, /^HITO \| H-PEND-\d{3} \| Necesidades funcionales identificadas \| .*requieren especificación detallada\.\n/u);
  // La primera subunidad solo recibe un lote de hallazgos.
  assert.equal(
    result.normalized.functionalRequirements.length,
    Math.min(relevantCount, 3),
  );
  for (const requirement of result.normalized.functionalRequirements) {
    assert.equal(requirement.documentationStatus, "PENDING_DOCUMENTATION");
    assert.equal(
      (requirement.acceptanceCriteria as unknown[] | undefined)?.length,
      0,
    );
  }
  return result;
}

test("CASO 1 — 1 Hito con 1 HU completa: PASS normal", async () => {
  const content = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
  ].join("\n");

  const { normalized } = await generateMilestonesUnitWithContent(content);
  assert.equal(normalized.functionalRequirements.length, 1);
  assert.equal(normalized.functionalRequirements[0]?.documentationStatus, "COMPLETE");
  assert.equal(normalized.functionalRequirements[0]?.milestone, "H-001");
});

test("CASO 2 — 2 Hitos con HU completas: PASS normal", async () => {
  const content = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
    "HITO | H-002 | Aprobación | Gestión de aprobación.",
    "HU | HU-F-002 | Aprobar solicitud | Permitir la decisión sobre una solicitud.",
    "COMO | Usuario aprobador",
    "QUIERO | aprobar o rechazar la solicitud",
    "PARA | continuar el proceso con una decisión registrada",
    "CONTEXTO | La evidencia describe una aprobación de solicitudes.",
    "CA | CA-F-002 | existe una solicitud pendiente | el aprobador decide | el sistema registra la decisión",
  ].join("\n");

  const { normalized } = await generateMilestonesUnitWithContent(content);
  assert.equal(normalized.functionalRequirements.length, 2);
  assert.deepEqual(
    normalized.functionalRequirements.map((story) => story.documentationStatus),
    ["COMPLETE", "COMPLETE"],
  );
  assert.deepEqual(
    normalized.functionalRequirements.map((story) => story.milestone),
    ["H-001", "H-002"],
  );
});

test("CASO 3 — 1 HU completa + 1 necesidad insuficiente: conserva la HU, conserva la pendiente, no aborta", async () => {
  const content = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
    "HITO | H-002 | Notificaciones | Gestión de notificaciones.",
    "HU | HU-F-002 | Notificar cambio de estado | [PENDIENTE POR DEFINIR]",
    "COMO | [PENDIENTE POR DEFINIR]",
    "QUIERO | [PENDIENTE POR DEFINIR]",
    "PARA | [PENDIENTE POR DEFINIR]",
    "CONTEXTO | [PENDIENTE POR DEFINIR]",
  ].join("\n");

  // Antes de esta corrección, esta llamada lanzaba
  // "LOCAL_ONLY_V2 rechazó Requerimientos..." y abortaba todo el documento.
  const { normalized } = await generateMilestonesUnitWithContent(content);
  assert.equal(normalized.functionalRequirements.length, 2);
  assert.equal(normalized.functionalRequirements[0]?.documentationStatus, "COMPLETE");
  assert.equal(
    normalized.functionalRequirements[1]?.documentationStatus,
    "PENDING_DOCUMENTATION",
  );
  // No se inventó ningún dato: los campos siguen marcados como pendientes.
  assert.equal(normalized.functionalRequirements[1]?.role, "[PENDIENTE POR DEFINIR]");
  assert.equal(
    (normalized.functionalRequirements[1]?.acceptanceCriteria as unknown[])
      .length,
    0,
  );
});

test("CASO 4 — solo necesidades funcionales insuficientes: 0 HU inventadas, pendientes preservadas, no tumba el documento", async () => {
  const content = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | [PENDIENTE POR DEFINIR]",
    "COMO | [PENDIENTE POR DEFINIR]",
    "QUIERO | [PENDIENTE POR DEFINIR]",
    "PARA | [PENDIENTE POR DEFINIR]",
    "CONTEXTO | [PENDIENTE POR DEFINIR]",
  ].join("\n");

  const { normalized } = await generateMilestonesUnitWithContent(content);
  assert.equal(normalized.functionalRequirements.length, 1);
  assert.equal(
    normalized.functionalRequirements[0]?.documentationStatus,
    "PENDING_DOCUMENTATION",
  );
  assert.equal(normalized.functionalRequirements[0]?.want, "[PENDIENTE POR DEFINIR]");
});

test("CASO 5 — Ollama genera un HITO vacío: el Hito vacío se elimina", async () => {
  const content = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HITO | H-002 | Aprobación | Gestión de aprobación.",
    "HU | HU-F-001 | Aprobar solicitud | Permitir la decisión sobre una solicitud.",
    "COMO | Usuario aprobador",
    "QUIERO | aprobar o rechazar la solicitud",
    "PARA | continuar el proceso con una decisión registrada",
    "CONTEXTO | La evidencia describe una aprobación de solicitudes.",
    "CA | CA-F-001 | existe una solicitud pendiente | el aprobador decide | el sistema registra la decisión",
  ].join("\n");

  const { normalized } = await generateMilestonesUnitWithContent(content);
  // El HITO "Registro" (H-001) nunca tuvo una HU debajo: no debe sobrevivir
  // como agrupación vacía en la salida ensamblada.
  assert.equal(normalized.functionalRequirements.length, 1);
  assert.equal(normalized.functionalRequirements[0]?.milestone, "H-002");
});

test("CASO 6 — HU con COMO/QUIERO/PARA/CONTEXTO pero sin CA: no es completa, se conserva pendiente", async () => {
  const content = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
  ].join("\n");

  const { normalized } = await generateMilestonesUnitWithContent(content);
  assert.equal(normalized.functionalRequirements.length, 1);
  assert.equal(
    normalized.functionalRequirements[0]?.documentationStatus,
    "PENDING_DOCUMENTATION",
  );
  assert.equal(
    (normalized.functionalRequirements[0]?.acceptanceCriteria as unknown[])
      .length,
    0,
  );
});

test("CASO 7 — salida sin relación con el contrato: falla cerrado", async () => {
  const content =
    "Este es un resumen narrativo sin ningún formato estructurado ni etiquetas reconocibles.";

  await assertMilestonesFallbackReplacesCorruptOutput(
    content,
  );
});

test("CASO 10 — una HU válida y otra inválida en el mismo procesamiento: la válida sobrevive, la inválida se vuelve pendiente", async () => {
  const content = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
    "HU | HU-F-002 | Actualizar solicitud | [PENDIENTE POR DEFINIR]",
    "COMO | [PENDIENTE POR DEFINIR]",
    "QUIERO | [PENDIENTE POR DEFINIR]",
    "PARA | [PENDIENTE POR DEFINIR]",
    "CONTEXTO | [PENDIENTE POR DEFINIR]",
  ].join("\n");

  const { normalized } = await generateMilestonesUnitWithContent(content);
  assert.equal(normalized.functionalRequirements.length, 2);
  assert.equal(normalized.functionalRequirements[0]?.documentationStatus, "COMPLETE");
  assert.equal(
    normalized.functionalRequirements[1]?.documentationStatus,
    "PENDING_DOCUMENTATION",
  );
});

// AI_ANALYSIS_LOCAL_ONLY_V2_MILESTONES_HIERARCHY_AND_REPAIR_GUARD_V1
//
// Corrección de revisión Codex sobre LOCAL_ONLY_V2 / milestones:
// 1) classifyMilestonesContent debe validar jerarquía HITO/HU antes de
//    clasificar HAS_PENDING_NEEDS: una HU o un atributo huérfano (sin Hito o
//    sin HU que lo contenga) es UNPARSEABLE, no una necesidad pendiente.
// 2) Una HU con campos "[PENDIENTE POR DEFINIR]" (incluida su variante con
//    anotación ": ...") nunca debe clasificarse COMPLETE.
// 3) Una reparación que produce legítimamente HAS_PENDING_NEEDS es una
//    salida recuperable válida y debe conservarse, no descartarse.
// 4) La sustitución por la salida reparada nunca debe eliminar en silencio
//    un Hito, una HU o una necesidad pendiente que ya existía.
async function generateMilestonesUnitWithSequentialContents(
  contents: string[],
  relevantCount = 4,
): Promise<{
  contentOut: string;
  normalized: { functionalRequirements: Array<Record<string, unknown>> };
  callCount: number;
}> {
  const basePlan = plan();
  const milestoneBlock = {
    ...basePlan.blocks[0]!,
    blockId: "template@1:milestones-repair-guard",
    sectionKey: "milestones",
    title: "Requerimientos",
    guidance: "Estructurar requisitos funcionales y no funcionales.",
  };
  const currentPlan: LocalOnlyV2TemplateGenerationPlan = {
    ...basePlan,
    blocks: [milestoneBlock],
  };
  const basePacket = packet(relevantCount, 120);
  const currentPacket: LocalOnlyV2BlockEvidencePacket = {
    ...basePacket,
    blockId: milestoneBlock.blockId,
    sectionKey: milestoneBlock.sectionKey,
    title: milestoneBlock.title,
    guidance: milestoneBlock.guidance,
  };
  const execution = beginLocalOnlyV2Block(
    createLocalOnlyV2SequentialBlockExecution(currentPlan),
    milestoneBlock.blockId,
  );
  const budget = resolveLocalOnlyV2InferenceBudget({
    configuredContextTokens: 16_384,
    configuredMaxOutputTokens: 8_192,
    configuredTimeoutMs: 600_000,
  });
  const unit = planLocalOnlyV2ProcessingUnits(
    execution,
    currentPlan,
    currentPacket,
    budget,
  )[0]!;

  let callIndex = 0;
  const client: Pick<OllamaClient, "generate"> = {
    generate: async () => {
      const content = contents[Math.min(callIndex, contents.length - 1)]!;
      callIndex += 1;
      return JSON.stringify({ content });
    },
  };

  const result = await generateLocalOnlyV2ProcessingBlock(
    client,
    execution,
    currentPlan,
    unit,
  );
  const normalized = normalizeLocalOnlyV2SectionContent(
    "milestones",
    result.content,
    {},
  ) as { functionalRequirements: Array<Record<string, unknown>> };
  return { contentOut: result.content, normalized, callCount: callIndex };
}

test("CASO 11 — HU huérfana sin Hito que la contenga: falla cerrado aunque use etiquetas reconocibles", async () => {
  const content = [
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
  ].join("\n");

  await assertMilestonesFallbackReplacesCorruptOutput(
    content,
  );
});

test("CASO 12 — atributo huérfano antes de cualquier HU: falla cerrado por jerarquía rota", async () => {
  const content = [
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
  ].join("\n");

  await assertMilestonesFallbackReplacesCorruptOutput(
    content,
  );
});

test("CASO 13 — COMO con [PENDIENTE POR DEFINIR: rol] nunca es COMPLETE aunque el contrato estructurado sea válido", async () => {
  const content = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | [PENDIENTE POR DEFINIR: rol]",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
  ].join("\n");

  const { normalized } = await generateMilestonesUnitWithContent(content);
  assert.equal(normalized.functionalRequirements.length, 1);
  assert.equal(
    normalized.functionalRequirements[0]?.documentationStatus,
    "PENDING_DOCUMENTATION",
  );
  // No se inventa un rol: se conserva el pendiente anotado tal como llegó.
  assert.equal(
    normalized.functionalRequirements[0]?.role,
    "[PENDIENTE POR DEFINIR: rol]",
  );
});

test("CASO 14 — QUIERO/PARA/CONTEXTO con variantes de pendiente (con anotación y minúsculas) nunca son COMPLETE", async () => {
  const content = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | [PENDIENTE POR DEFINIR: capacidad]",
    "PARA | [pendiente por definir]",
    "CONTEXTO | [PENDIENTE POR DEFINIR]",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
  ].join("\n");

  const { normalized } = await generateMilestonesUnitWithContent(content);
  assert.equal(normalized.functionalRequirements.length, 1);
  assert.equal(
    normalized.functionalRequirements[0]?.documentationStatus,
    "PENDING_DOCUMENTATION",
  );
  assert.equal(normalized.functionalRequirements[0]?.role, "Usuario solicitante");
});

test("CASO 15 — CA con dado/cuando/entonces pendientes: la HU no es COMPLETE aunque tenga COMO/QUIERO/PARA/CONTEXTO", async () => {
  const content = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
    "CA | CA-F-001 | [PENDIENTE POR DEFINIR] | [PENDIENTE POR DEFINIR] | [PENDIENTE POR DEFINIR]",
  ].join("\n");

  const { normalized } = await generateMilestonesUnitWithContent(content);
  assert.equal(normalized.functionalRequirements.length, 1);
  assert.equal(
    normalized.functionalRequirements[0]?.documentationStatus,
    "PENDING_DOCUMENTATION",
  );
});

test("CASO 16 — una reparación que termina HAS_PENDING_NEEDS se conserva en lugar de descartarse", async () => {
  const unstructured = [
    "REQUERIMIENTOS FUNCIONALES",
    "Hito: Gestión de solicitudes.",
    "- El sistema debe registrar la solicitud.",
  ].join("\n");

  const repairedButStillPending = [
    "HITO | H-001 | Gestión de solicitudes | Organizar el registro del proceso sustentado.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud mediante captura estructurada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar una solicitud con la información requerida",
    "PARA | iniciar el proceso de forma estandarizada",
    "CONTEXTO | [PENDIENTE POR DEFINIR]",
  ].join("\n");

  // Antes de esta corrección: como la reparación no cumplía
  // hasStructuredMilestonesContract (sin CA), se descartaba y se conservaba
  // la salida narrativa original, que es UNPARSEABLE → lanzaba y abortaba
  // todo el punto de Requerimientos.
  const { contentOut, normalized } =
    await generateMilestonesUnitWithSequentialContents([
      unstructured,
      repairedButStillPending,
    ]);

  assert.equal(contentOut, repairedButStillPending);
  assert.equal(normalized.functionalRequirements.length, 1);
  assert.equal(
    normalized.functionalRequirements[0]?.documentationStatus,
    "PENDING_DOCUMENTATION",
  );
  assert.equal(
    normalized.functionalRequirements[0]?.context,
    "[PENDIENTE POR DEFINIR]",
  );
});

test("CASO 17 — una reparación que omite una HU completa anterior no puede eliminarla", async () => {
  const original = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
    "HITO | H-002 | Aprobación | Gestión de aprobación.",
    "HITO | H-003 | Notificaciones | Gestión de notificaciones.",
    "HU | HU-F-002 | Notificar cambio de estado | Notificar el cambio de estado al usuario.",
    "COMO | Usuario notificado",
    "QUIERO | recibir la notificación",
    "PARA | conocer el estado",
    "CONTEXTO | La evidencia describe la notificación de cambios.",
    "CA | CA-F-002 | existe un cambio de estado | el sistema notifica | el usuario recibe la notificación",
  ].join("\n");

  // La reparación "arregla" el Hito vacío eliminando por completo el primer
  // Hito y su HU en lugar de completarlo: una pérdida silenciosa de una HU
  // ya válida que no debe aceptarse.
  const repairedDroppingFirstStory = [
    "HITO | H-003 | Notificaciones | Gestión de notificaciones.",
    "HU | HU-F-002 | Notificar cambio de estado | Notificar el cambio de estado al usuario.",
    "COMO | Usuario notificado",
    "QUIERO | recibir la notificación",
    "PARA | conocer el estado",
    "CONTEXTO | La evidencia describe la notificación de cambios.",
    "CA | CA-F-002 | existe un cambio de estado | el sistema notifica | el usuario recibe la notificación",
  ].join("\n");

  const { normalized } = await generateMilestonesUnitWithSequentialContents([
    original,
    repairedDroppingFirstStory,
  ]);

  assert.equal(normalized.functionalRequirements.length, 2);
  assert.deepEqual(
    normalized.functionalRequirements.map((story) => story.code),
    ["HU-F-001", "HU-F-002"],
  );
  assert.equal(normalized.functionalRequirements[0]?.documentationStatus, "COMPLETE");
  assert.equal(normalized.functionalRequirements[1]?.documentationStatus, "COMPLETE");
});

test("CASO 18 — una reparación que omite una necesidad pendiente anterior no puede eliminarla", async () => {
  const original = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
    "HITO | H-002 | Notificaciones | Gestión de notificaciones.",
    "HU | HU-F-002 | Notificar cambio de estado | [PENDIENTE POR DEFINIR]",
    "COMO | [PENDIENTE POR DEFINIR]",
    "QUIERO | [PENDIENTE POR DEFINIR]",
    "PARA | [PENDIENTE POR DEFINIR]",
    "CONTEXTO | [PENDIENTE POR DEFINIR]",
  ].join("\n");

  // La reparación descarta la necesidad pendiente entera en lugar de
  // conservarla: una pérdida silenciosa de trazabilidad que no debe
  // aceptarse.
  const repairedDroppingPendingNeed = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
  ].join("\n");

  const { normalized } = await generateMilestonesUnitWithSequentialContents([
    original,
    repairedDroppingPendingNeed,
  ]);

  assert.equal(normalized.functionalRequirements.length, 2);
  assert.equal(normalized.functionalRequirements[0]?.documentationStatus, "COMPLETE");
  assert.equal(
    normalized.functionalRequirements[1]?.documentationStatus,
    "PENDING_DOCUMENTATION",
  );
  assert.equal(
    normalized.functionalRequirements[1]?.role,
    "[PENDIENTE POR DEFINIR]",
  );
});

// AI_ANALYSIS_LOCAL_ONLY_V2_MILESTONES_SECOND_AUDIT_V1
//
// Segunda auditoría Codex sobre LOCAL_ONLY_V2 / milestones:
// 1) classifyMilestonesContent no debe convertir en HAS_PENDING_NEEDS un
//    HITO/HU aislado o sin ningún contenido funcional recuperable: eso es
//    UNPARSEABLE. Solo hay HAS_PENDING_NEEDS cuando existe al menos una
//    unidad (HU/RNF) con contenido funcional real.
// 2) hasStructuredMilestonesContract (y por tanto classifyMilestonesContent)
//    debe exigir valores realmente definidos en COMO/QUIERO/PARA/CONTEXTO y
//    en los tres componentes del CA (DADO/CUANDO/ENTONCES), no solo texto no
//    vacío: un marcador "[PENDIENTE POR DEFINIR]" (con o sin anotación) no
//    cuenta como definido en ninguna capa (contrato, clasificador ni
//    normalización downstream).
// 3) La reparación lossless no puede identificar HU/RNF solo por título: dos
//    HU distintas con el mismo título (y códigos distintos) deben
//    preservarse ambas, y un código que desaparece no puede "colarse" como
//    preservado solo porque el título coincide con otro elemento.
test("CASO 19 — 'HITO' solo (sin ninguna columna) es UNPARSEABLE", async () => {
  await assertMilestonesFallbackReplacesCorruptOutput(
    "HITO",
  );
});

test("CASO 20 — HITO válido sin ninguna HU es UNPARSEABLE", async () => {
  const content = "HITO | H-001 | Registro | Gestión del registro.";
  await assertMilestonesFallbackReplacesCorruptOutput(
    content,
  );
});

test("CASO 21 — HITO + HU sin ningún contenido funcional recuperable es UNPARSEABLE", async () => {
  await assertMilestonesFallbackReplacesCorruptOutput(
    "HITO\nHU",
  );
});

test("CASO 22 — HITO + HU incompleta pero con necesidad funcional real es HAS_PENDING_NEEDS, no falla cerrado", async () => {
  const content = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
  ].join("\n");

  const { normalized } = await generateMilestonesUnitWithContent(content);
  assert.equal(normalized.functionalRequirements.length, 1);
  assert.equal(
    normalized.functionalRequirements[0]?.documentationStatus,
    "PENDING_DOCUMENTATION",
  );
});

test("CASO 23 — COMO/QUIERO/PARA/CONTEXTO pendientes disparan reparación (el contrato ya no los acepta como definidos) y nunca son COMPLETE", async () => {
  const fields = ["COMO", "QUIERO", "PARA", "CONTEXTO"] as const;
  for (const pendingField of fields) {
    const content = [
      "HITO | H-001 | Registro | Gestión del registro.",
      "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
      `COMO | ${pendingField === "COMO" ? "[PENDIENTE POR DEFINIR: rol]" : "Usuario solicitante"}`,
      `QUIERO | ${pendingField === "QUIERO" ? "[PENDIENTE POR DEFINIR]" : "registrar la solicitud"}`,
      `PARA | ${pendingField === "PARA" ? "[PENDIENTE POR DEFINIR]" : "iniciar el proceso"}`,
      `CONTEXTO | ${pendingField === "CONTEXTO" ? "[pendiente por definir]" : "La evidencia describe el registro de una solicitud."}`,
      "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
    ].join("\n");

    const { normalized, callCount } =
      await generateMilestonesUnitWithSequentialContents([content]);

    assert.equal(
      callCount,
      2,
      `${pendingField} pendiente debe seguir disparando una reparación`,
    );
    assert.equal(
      normalized.functionalRequirements[0]?.documentationStatus,
      "PENDING_DOCUMENTATION",
      `HU con ${pendingField} pendiente nunca debe ser COMPLETE`,
    );
  }
});

test("CASO 24 — DADO/CUANDO/ENTONCES pendientes en el CA disparan reparación y nunca son COMPLETE", async () => {
  const caFields = ["DADO", "CUANDO", "ENTONCES"] as const;
  for (const pendingField of caFields) {
    const given =
      pendingField === "DADO"
        ? "[PENDIENTE POR DEFINIR]"
        : "existe información válida";
    const when =
      pendingField === "CUANDO"
        ? "[PENDIENTE POR DEFINIR: condición]"
        : "el usuario registra";
    const then =
      pendingField === "ENTONCES"
        ? "[PENDIENTE POR DEFINIR]"
        : "el sistema conserva la solicitud";
    const content = [
      "HITO | H-001 | Registro | Gestión del registro.",
      "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
      "COMO | Usuario solicitante",
      "QUIERO | registrar la solicitud",
      "PARA | iniciar el proceso",
      "CONTEXTO | La evidencia describe el registro de una solicitud.",
      `CA | CA-F-001 | ${given} | ${when} | ${then}`,
    ].join("\n");

    const { normalized, callCount } =
      await generateMilestonesUnitWithSequentialContents([content]);

    assert.equal(
      callCount,
      2,
      `${pendingField} pendiente en el CA debe seguir disparando una reparación`,
    );
    assert.equal(
      normalized.functionalRequirements[0]?.documentationStatus,
      "PENDING_DOCUMENTATION",
      `CA con ${pendingField} pendiente nunca debe permitir COMPLETE`,
    );
  }
});

test("CASO 25 — todo definido (COMO/QUIERO/PARA/CONTEXTO/CA reales) sigue siendo COMPLETE en una sola llamada", async () => {
  const content = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
  ].join("\n");

  const { normalized, callCount } =
    await generateMilestonesUnitWithSequentialContents([content]);

  assert.equal(callCount, 1, "una HU realmente completa no debe disparar reparación");
  assert.equal(normalized.functionalRequirements[0]?.documentationStatus, "COMPLETE");
});

test("CASO 26 — dos HU con el mismo título pero código distinto: ambas deben preservarse; si la reparación elimina una, se rechaza", async () => {
  const original = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud inicial del cliente.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud inicial",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro inicial de una solicitud.",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
    "HU | HU-F-002 | Registrar solicitud | Registrar una solicitud complementaria del mismo cliente.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar una solicitud complementaria",
    "PARA | ampliar el proceso iniciado",
    "CONTEXTO | La evidencia describe una solicitud complementaria distinta.",
  ].join("\n");

  const repairedDroppingOne = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud inicial del cliente.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud inicial",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro inicial de una solicitud.",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
  ].join("\n");

  const { normalized } = await generateMilestonesUnitWithSequentialContents([
    original,
    repairedDroppingOne,
  ]);

  // La reparación eliminó HU-F-002 (mismo título que HU-F-001, código
  // distinto): debe rechazarse y conservar ambas HU de la salida original.
  assert.equal(normalized.functionalRequirements.length, 2);
  assert.deepEqual(
    normalized.functionalRequirements.map((story) => story.code),
    ["HU-F-001", "HU-F-002"],
  );
  assert.equal(normalized.functionalRequirements[0]?.documentationStatus, "COMPLETE");
  assert.equal(
    normalized.functionalRequirements[1]?.documentationStatus,
    "PENDING_DOCUMENTATION",
  );
});

test("CASO 27 — dos HU con el mismo título pero código distinto: si la reparación conserva ambas (completando la pendiente), se acepta", async () => {
  const original = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud inicial del cliente.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud inicial",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro inicial de una solicitud.",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
    "HU | HU-F-002 | Registrar solicitud | Registrar una solicitud complementaria del mismo cliente.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar una solicitud complementaria",
    "PARA | ampliar el proceso iniciado",
    "CONTEXTO | La evidencia describe una solicitud complementaria distinta.",
  ].join("\n");

  const repairedKeepingBoth = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud inicial del cliente.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud inicial",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro inicial de una solicitud.",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
    "HU | HU-F-002 | Registrar solicitud | Registrar una solicitud complementaria del mismo cliente.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar una solicitud complementaria",
    "PARA | ampliar el proceso iniciado",
    "CONTEXTO | La evidencia describe una solicitud complementaria distinta.",
    "CA | CA-F-002 | existe una solicitud previa | el usuario complementa | el sistema conserva ambas solicitudes",
  ].join("\n");

  const { normalized } = await generateMilestonesUnitWithSequentialContents([
    original,
    repairedKeepingBoth,
  ]);

  assert.equal(normalized.functionalRequirements.length, 2);
  assert.deepEqual(
    normalized.functionalRequirements.map((story) => story.code),
    ["HU-F-001", "HU-F-002"],
  );
  assert.deepEqual(
    normalized.functionalRequirements.map((story) => story.documentationStatus),
    ["COMPLETE", "COMPLETE"],
  );
});

test("CASO 28 — mismo título, código diferente: no son el mismo elemento (sustituir una HU por otra con el mismo título no basta para 'preservar')", async () => {
  const original = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud inicial del cliente.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud inicial",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro inicial de una solicitud.",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
    "HU | HU-F-002 | Registrar solicitud | Registrar una solicitud complementaria del mismo cliente.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar una solicitud complementaria",
    "PARA | ampliar el proceso iniciado",
    "CONTEXTO | La evidencia describe una solicitud complementaria distinta.",
  ].join("\n");

  // La reparación conserva el título "Registrar solicitud" para la segunda
  // HU, pero cambia el código Y el contenido funcional por algo no
  // relacionado (HU-F-009, "Eliminar historial"): no es la misma HU
  // pendiente, es una sustitución distinta que no debe aceptarse como
  // "preservación" de HU-F-002.
  const repairedSwappingContent = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud inicial del cliente.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud inicial",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro inicial de una solicitud.",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
    "HU | HU-F-009 | Registrar solicitud | Eliminar historial de solicitudes previas del cliente.",
    "COMO | Administrador",
    "QUIERO | eliminar el historial de solicitudes",
    "PARA | depurar información obsoleta",
    "CONTEXTO | La evidencia describe una necesidad de depuración distinta.",
    "CA | CA-F-009 | existe historial previo | el administrador elimina | el sistema depura el historial",
  ].join("\n");

  const { normalized } = await generateMilestonesUnitWithSequentialContents([
    original,
    repairedSwappingContent,
  ]);

  // HU-F-002 (identidad por código) desapareció: la reparación se rechaza y
  // se conserva la salida original con ambas HU tal como estaban.
  assert.equal(normalized.functionalRequirements.length, 2);
  assert.deepEqual(
    normalized.functionalRequirements.map((story) => story.code),
    ["HU-F-001", "HU-F-002"],
  );
  assert.equal(
    normalized.functionalRequirements[1]?.description,
    "Registrar una solicitud complementaria del mismo cliente.",
  );
});

test("CASO 29 — una reparación que elimina un RNF existente no puede eliminarlo", async () => {
  const original = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
    "RNF | RNF-001 | Tiempo de respuesta | El sistema debe responder en menos de 2 segundos. | RENDIMIENTO | tiempo de respuesta | 2 segundos | Se verifica con pruebas de carga",
  ].join("\n");

  const repairedDroppingRnf = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
  ].join("\n");

  const { contentOut, normalized } =
    await generateMilestonesUnitWithSequentialContents([
      original,
      repairedDroppingRnf,
    ]);

  // La reparación eliminó el RNF-001: se rechaza y se conserva la salida
  // original (con la HU aún pendiente, sin CA, y el RNF intacto).
  assert.match(contentOut, /RNF \| RNF-001/u);
  assert.equal(normalized.functionalRequirements.length, 1);
  assert.equal(
    normalized.functionalRequirements[0]?.documentationStatus,
    "PENDING_DOCUMENTATION",
  );
});

test("CASO 30 — una reparación que elimina un HITO completo (con su HU) no puede eliminarlo", async () => {
  const original = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
    "HITO | H-002 | Aprobación | Gestión de aprobación.",
    "HU | HU-F-002 | Aprobar solicitud | Permitir la decisión sobre una solicitud.",
    "COMO | Usuario aprobador",
    "QUIERO | aprobar o rechazar la solicitud",
    "PARA | continuar el proceso con una decisión registrada",
    "CONTEXTO | La evidencia describe una aprobación de solicitudes.",
    "CA | CA-F-002 | existe una solicitud pendiente | el aprobador decide | el sistema registra la decisión",
  ].join("\n");

  const repairedDroppingFirstMilestone = [
    "HITO | H-002 | Aprobación | Gestión de aprobación.",
    "HU | HU-F-002 | Aprobar solicitud | Permitir la decisión sobre una solicitud.",
    "COMO | Usuario aprobador",
    "QUIERO | aprobar o rechazar la solicitud",
    "PARA | continuar el proceso con una decisión registrada",
    "CONTEXTO | La evidencia describe una aprobación de solicitudes.",
    "CA | CA-F-002 | existe una solicitud pendiente | el aprobador decide | el sistema registra la decisión",
  ].join("\n");

  const { normalized } = await generateMilestonesUnitWithSequentialContents([
    original,
    repairedDroppingFirstMilestone,
  ]);

  // El HITO "Registro" desapareció por completo: se rechaza y ambos Hitos
  // (uno pendiente, uno completo) sobreviven de la salida original.
  assert.equal(normalized.functionalRequirements.length, 2);
  assert.deepEqual(
    normalized.functionalRequirements.map((story) => story.milestone),
    ["H-001", "H-002"],
  );
  assert.equal(
    normalized.functionalRequirements[0]?.documentationStatus,
    "PENDING_DOCUMENTATION",
  );
  assert.equal(normalized.functionalRequirements[1]?.documentationStatus, "COMPLETE");
});

// AI_ANALYSIS_LOCAL_ONLY_V2_MILESTONES_THIRD_AUDIT_V1
//
// Tercera auditoría Codex sobre LOCAL_ONLY_V2 / milestones:
// 1) classifyMilestonesContent seguía contando como "recuperable" contenido
//    sin ninguna necesidad funcional real: separadores producidos por
//    join("|") sobre columnas vacías, valores "[PENDIENTE POR DEFINIR]", y
//    el propio código de un CA sin ningún DADO/CUANDO/ENTONCES.
// 2) repairPreservesExistingMilestonesElements preservaba identidad (código)
//    pero permitía que la reparación cambiara en silencio el significado de
//    un campo ya definido (título, descripción, COMO/QUIERO/PARA/CONTEXTO,
//    DADO/CUANDO/ENTONCES de un CA), o lo degradara a pendiente.
// 3) hasStructuredMilestonesContract podía decir HAS_PENDING_NEEDS para una
//    HU que requirementsFromText ya consideraba COMPLETE (un CA definido +
//    otro CA pendiente), disparando reparaciones innecesarias.
test("CASO 39 — HU con columnas vacías (artefacto de separador join) no cuenta como recuperable: UNPARSEABLE", async () => {
  await assertMilestonesFallbackReplacesCorruptOutput(
    ["HITO | H-001 | Registro | Gestión", "HU | HU-F-001 | |"].join("\n"),
  );
});

test("CASO 40 — HU con título y descripción ambos [PENDIENTE POR DEFINIR] no cuenta como recuperable: UNPARSEABLE", async () => {
  await assertMilestonesFallbackReplacesCorruptOutput(
    [
          "HITO | H-001 | Registro | Gestión",
          "HU | HU-F-001 | [PENDIENTE POR DEFINIR] | [PENDIENTE POR DEFINIR]",
        ].join("\n"),
  );
});

test("CASO 41 — HITO + HU + CA con solo código (sin DADO/CUANDO/ENTONCES) no cuenta como recuperable: UNPARSEABLE", async () => {
  await assertMilestonesFallbackReplacesCorruptOutput(
    [
          "HITO | H-001 | Registro | Gestión",
          "HU",
          "CA | CA-001",
        ].join("\n"),
  );
});

test("CASO 42 — mismo código, mismo contenido y solo se completa un campo pendiente: la reparación se acepta", async () => {
  const original = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | [PENDIENTE POR DEFINIR]",
  ].join("\n");

  const repairedCompletingContext = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
  ].join("\n");

  const { normalized } = await generateMilestonesUnitWithSequentialContents([
    original,
    repairedCompletingContext,
  ]);

  assert.equal(normalized.functionalRequirements.length, 1);
  assert.equal(normalized.functionalRequirements[0]?.documentationStatus, "COMPLETE");
  assert.equal(
    normalized.functionalRequirements[0]?.context,
    "La evidencia describe el registro de una solicitud.",
  );
});

test("CASO 43 — mismo código: cambiar un QUIERO ya definido por otro valor definido se rechaza", async () => {
  const original = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | [PENDIENTE POR DEFINIR]",
  ].join("\n");

  // Completa CONTEXTO (legítimo) pero además sustituye el QUIERO ya
  // definido por una capacidad distinta y no relacionada: no es una
  // reparación lossless.
  const repairedChangingQuiero = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | eliminar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
  ].join("\n");

  const { normalized } = await generateMilestonesUnitWithSequentialContents([
    original,
    repairedChangingQuiero,
  ]);

  // Se rechaza la reparación completa: se conserva la salida original tal
  // como estaba (QUIERO original, CONTEXTO aún pendiente).
  assert.equal(normalized.functionalRequirements.length, 1);
  assert.equal(normalized.functionalRequirements[0]?.want, "registrar la solicitud");
  assert.equal(
    normalized.functionalRequirements[0]?.documentationStatus,
    "PENDING_DOCUMENTATION",
  );
});

test("CASO 44 — mismo código: cambiar la descripción ya definida de la HU se rechaza", async () => {
  const original = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | [PENDIENTE POR DEFINIR]",
  ].join("\n");

  const repairedChangingDescription = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Eliminar el historial de solicitudes previas.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
  ].join("\n");

  const { normalized } = await generateMilestonesUnitWithSequentialContents([
    original,
    repairedChangingDescription,
  ]);

  assert.equal(normalized.functionalRequirements.length, 1);
  assert.equal(
    normalized.functionalRequirements[0]?.description,
    "Registrar la solicitud con la información sustentada.",
  );
  assert.equal(
    normalized.functionalRequirements[0]?.documentationStatus,
    "PENDING_DOCUMENTATION",
  );
});

test("CASO 45 — mismo código: degradar un valor ya definido a [PENDIENTE POR DEFINIR] se rechaza", async () => {
  const original = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | [PENDIENTE POR DEFINIR]",
  ].join("\n");

  const repairedDowngradingPara = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | [PENDIENTE POR DEFINIR]",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
  ].join("\n");

  const { normalized } = await generateMilestonesUnitWithSequentialContents([
    original,
    repairedDowngradingPara,
  ]);

  assert.equal(normalized.functionalRequirements.length, 1);
  assert.equal(normalized.functionalRequirements[0]?.benefit, "iniciar el proceso");
  assert.equal(
    normalized.functionalRequirements[0]?.documentationStatus,
    "PENDING_DOCUMENTATION",
  );
});

test("CASO 46 — mismo código: cambiar un DADO/CUANDO/ENTONCES ya definido de un CA se rechaza", async () => {
  const original = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
    "HITO | H-002 | Notificaciones | Gestión de notificaciones.",
    "HU | HU-F-002 | Notificar cambio de estado | [PENDIENTE POR DEFINIR]",
    "COMO | [PENDIENTE POR DEFINIR]",
    "QUIERO | [PENDIENTE POR DEFINIR]",
    "PARA | [PENDIENTE POR DEFINIR]",
    "CONTEXTO | [PENDIENTE POR DEFINIR]",
  ].join("\n");

  // La reparación completa legítimamente HU-F-002, pero además sustituye el
  // "ENTONCES" ya definido de CA-F-001 por una consecuencia distinta y no
  // relacionada.
  const repairedChangingExistingCa = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema elimina la solicitud",
    "HITO | H-002 | Notificaciones | Gestión de notificaciones.",
    "HU | HU-F-002 | Notificar cambio de estado | Notificar al usuario sobre el cambio de estado.",
    "COMO | Usuario notificado",
    "QUIERO | recibir la notificación",
    "PARA | conocer el estado",
    "CONTEXTO | La evidencia describe la notificación de cambios.",
    "CA | CA-F-002 | existe un cambio de estado | el sistema notifica | el usuario recibe la notificación",
  ].join("\n");

  const { normalized } = await generateMilestonesUnitWithSequentialContents([
    original,
    repairedChangingExistingCa,
  ]);

  // Se rechaza toda la sustitución: ambas HU sobreviven tal como estaban en
  // la salida original (HU-F-001 completa e intacta, HU-F-002 aún pendiente).
  assert.equal(normalized.functionalRequirements.length, 2);
  assert.equal(normalized.functionalRequirements[0]?.documentationStatus, "COMPLETE");
  assert.equal(
    (normalized.functionalRequirements[0]?.acceptanceCriteria as Array<
      Record<string, unknown>
    >)[0]?.then,
    "el sistema conserva la solicitud",
  );
  assert.equal(
    normalized.functionalRequirements[1]?.documentationStatus,
    "PENDING_DOCUMENTATION",
  );
});

test("CASO 47 — un CA completamente definido y otro CA pendiente en la misma HU: sigue siendo COMPLETE en una sola llamada", async () => {
  const content = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
    "CA | CA-F-002 | [PENDIENTE POR DEFINIR] | [PENDIENTE POR DEFINIR] | [PENDIENTE POR DEFINIR]",
  ].join("\n");

  const { normalized, callCount } =
    await generateMilestonesUnitWithSequentialContents([content]);

  assert.equal(
    callCount,
    1,
    "un CA válido ya satisface el mínimo: no debe disparar una reparación innecesaria",
  );
  assert.equal(normalized.functionalRequirements.length, 1);
  assert.equal(normalized.functionalRequirements[0]?.documentationStatus, "COMPLETE");
});

// AI_ANALYSIS_LOCAL_ONLY_V2_MILESTONES_FOURTH_AUDIT_V1
//
// Cuarta auditoría Codex sobre LOCAL_ONLY_V2 / milestones:
// 1) milestonesStructuralElementCounts no rastreaba CA (solo HITO/HU/RNF),
//    así que repairPreservesDefinedFields (que delega la detección de
//    ausencia total a ese conteo) dejaba pasar reparaciones que eliminaban
//    o sustituían un CA ya definido por otro con código distinto.
// 2) hasDefinedFunctionalValue solo excluía marcadores pendientes, no
//    códigos estructurales (H-001, HU-F-001, CA-001, ...) repetidos en
//    cualquier columna (título, COMO, QUIERO, CA, ...): contenido compuesto
//    únicamente por códigos repetidos podía clasificarse HAS_PENDING_NEEDS.
function huOriginalConCaPendienteDeDado() {
  return [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
    "CA | CA-F-001 | [PENDIENTE POR DEFINIR] | el usuario registra | el sistema conserva la solicitud",
  ].join("\n");
}

function huOriginalConContextoPendienteYUnCa() {
  return [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | [PENDIENTE POR DEFINIR]",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
  ].join("\n");
}

test("CASO 48 — un CA previamente definido eliminado por completo: la reparación se rechaza", async () => {
  const repairedDroppingCa = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
  ].join("\n");

  const { normalized } = await generateMilestonesUnitWithSequentialContents([
    huOriginalConContextoPendienteYUnCa(),
    repairedDroppingCa,
  ]);

  assert.equal(normalized.functionalRequirements.length, 1);
  assert.equal(
    (normalized.functionalRequirements[0]?.acceptanceCriteria as unknown[])
      .length,
    1,
  );
  assert.equal(
    normalized.functionalRequirements[0]?.documentationStatus,
    "PENDING_DOCUMENTATION",
  );
});

test("CASO 49 — CA-F-001 sustituido en silencio por CA-F-002 (mismo contenido, código distinto): la reparación se rechaza", async () => {
  const repairedSwappingCaCode = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
    "CA | CA-F-002 | existe información válida | el usuario registra | el sistema conserva la solicitud",
  ].join("\n");

  const { normalized } = await generateMilestonesUnitWithSequentialContents([
    huOriginalConContextoPendienteYUnCa(),
    repairedSwappingCaCode,
  ]);

  // Se rechaza toda la sustitución: como el código del CA cambió, se
  // conserva la salida original completa (incluido el CONTEXTO todavía
  // pendiente), no solo el CA anterior.
  assert.equal(normalized.functionalRequirements.length, 1);
  assert.equal(
    normalized.functionalRequirements[0]?.context,
    "[PENDIENTE POR DEFINIR]",
  );
  assert.equal(
    normalized.functionalRequirements[0]?.documentationStatus,
    "PENDING_DOCUMENTATION",
  );
});

test("CASO 50 — mismo código de CA: cambiar el DADO ya definido se rechaza", async () => {
  const repairedChangingDado = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
    "CA | CA-F-001 | existe una solicitud duplicada | el usuario registra | el sistema conserva la solicitud",
  ].join("\n");

  const { normalized } = await generateMilestonesUnitWithSequentialContents([
    huOriginalConContextoPendienteYUnCa(),
    repairedChangingDado,
  ]);

  assert.equal(
    (normalized.functionalRequirements[0]?.acceptanceCriteria as Array<
      Record<string, unknown>
    >)[0]?.given,
    "existe información válida",
  );
  assert.equal(
    normalized.functionalRequirements[0]?.documentationStatus,
    "PENDING_DOCUMENTATION",
  );
});

test("CASO 51 — mismo código de CA: cambiar el CUANDO ya definido se rechaza", async () => {
  const repairedChangingCuando = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
    "CA | CA-F-001 | existe información válida | el sistema rechaza la solicitud | el sistema conserva la solicitud",
  ].join("\n");

  const { normalized } = await generateMilestonesUnitWithSequentialContents([
    huOriginalConContextoPendienteYUnCa(),
    repairedChangingCuando,
  ]);

  assert.equal(
    (normalized.functionalRequirements[0]?.acceptanceCriteria as Array<
      Record<string, unknown>
    >)[0]?.when,
    "el usuario registra",
  );
  assert.equal(
    normalized.functionalRequirements[0]?.documentationStatus,
    "PENDING_DOCUMENTATION",
  );
});

test("CASO 52 — un CA con DADO pendiente se completa correctamente: la reparación se acepta", async () => {
  const repairedCompletingDado = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
  ].join("\n");

  const { normalized } = await generateMilestonesUnitWithSequentialContents([
    huOriginalConCaPendienteDeDado(),
    repairedCompletingDado,
  ]);

  assert.equal(normalized.functionalRequirements.length, 1);
  assert.equal(normalized.functionalRequirements[0]?.documentationStatus, "COMPLETE");
  assert.equal(
    (normalized.functionalRequirements[0]?.acceptanceCriteria as Array<
      Record<string, unknown>
    >)[0]?.given,
    "existe información válida",
  );
});

test("CASO 53 — dos CA distintos: la reparación que conserva ambos se acepta", async () => {
  const original = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | [PENDIENTE POR DEFINIR]",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
    "CA | CA-F-002 | existe una solicitud repetida | el sistema detecta duplicado | el sistema rechaza el duplicado",
  ].join("\n");

  const repairedKeepingBothCa = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
    "CA | CA-F-002 | existe una solicitud repetida | el sistema detecta duplicado | el sistema rechaza el duplicado",
  ].join("\n");

  const { normalized } = await generateMilestonesUnitWithSequentialContents([
    original,
    repairedKeepingBothCa,
  ]);

  assert.equal(normalized.functionalRequirements.length, 1);
  assert.equal(normalized.functionalRequirements[0]?.documentationStatus, "COMPLETE");
  assert.equal(
    (normalized.functionalRequirements[0]?.acceptanceCriteria as unknown[])
      .length,
    2,
  );
});

test("CASO 54 — dos CA distintos: la reparación que elimina uno se rechaza", async () => {
  const original = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | [PENDIENTE POR DEFINIR]",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
    "CA | CA-F-002 | existe una solicitud repetida | el sistema detecta duplicado | el sistema rechaza el duplicado",
  ].join("\n");

  const repairedDroppingOneCa = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
  ].join("\n");

  const { normalized } = await generateMilestonesUnitWithSequentialContents([
    original,
    repairedDroppingOneCa,
  ]);

  // Se rechaza la reparación completa: se conserva la salida original con
  // ambos CA y CONTEXTO todavía pendiente.
  assert.equal(normalized.functionalRequirements.length, 1);
  assert.equal(
    (normalized.functionalRequirements[0]?.acceptanceCriteria as unknown[])
      .length,
    2,
  );
  assert.equal(
    normalized.functionalRequirements[0]?.documentationStatus,
    "PENDING_DOCUMENTATION",
  );
});

test("CASO 55 — solo códigos estructurales repetidos como título de la HU: UNPARSEABLE", async () => {
  await assertMilestonesFallbackReplacesCorruptOutput(
    ["HITO | H-001", "HU | HU-F-001 | HU-F-001"].join("\n"),
  );
});

test("CASO 56 — solo códigos estructurales repetidos en COMO/QUIERO/CA: UNPARSEABLE", async () => {
  await assertMilestonesFallbackReplacesCorruptOutput(
    [
          "HITO | H-001",
          "HU | HU-F-001",
          "COMO | H-001",
          "QUIERO | HU-F-001",
          "CA | CA-001 | CA-001",
        ].join("\n"),
  );
});

test("CASO 57 — una descripción funcional real junto a otros campos pendientes: HAS_PENDING_NEEDS (no UNPARSEABLE)", async () => {
  const content = [
    "HITO | H-001 | Registro de compras",
    "HU | HU-F-001 | Registrar compras",
    "QUIERO | registrar una compra en el sistema",
  ].join("\n");

  const { normalized } = await generateMilestonesUnitWithContent(content);
  assert.equal(normalized.functionalRequirements.length, 1);
  assert.equal(
    normalized.functionalRequirements[0]?.documentationStatus,
    "PENDING_DOCUMENTATION",
  );
  assert.equal(normalized.functionalRequirements[0]?.want, "registrar una compra en el sistema");
});

// AI_ANALYSIS_LOCAL_ONLY_V2_MILESTONES_E2E_DIAGNOSIS_V1
//
// Diagnóstico genérico (no SOAT, no proyecto real) sobre un fallo E2E real:
// generando milestones contra Ollama real (qwen3.5:9b) con evidencia neutral
// (un escenario de préstamo de equipos, sin relación con ningún proyecto),
// el modelo produjo dos patrones de ruido reales y reproducibles que hacían
// fallar TODO el bloque con "LOCAL_ONLY_V2 rechazó Requerimientos" aunque el
// resto de la estructura era perfectamente válida:
//
// 1) Una línea suelta con una etiqueta no reconocida (p. ej. "cuando | ...")
//    partiendo QUIERO en dos líneas, dentro de una HU por lo demás completa.
// 2) Las columnas finales de un RNF (categoría, medida, objetivo, criterio
//    verificable) escritas como líneas propias en vez de columnas de la
//    misma línea "RNF | ...", tanto en el intento inicial como en el único
//    repair permitido.
//
// classifyMilestonesContent/hasStructuredMilestonesContract fallaban cerrado
// ante CUALQUIER etiqueta no reconocida, sin importar que apareciera dentro
// de una HU/RNF ya válida. La corrección la trata como ruido estructural
// descartable (nunca se usa su contenido, nunca se inventa a qué campo
// pertenece) solo cuando aparece dentro de una HU ya abierta o después de un
// RNF; fuera de ese contexto sigue fallando cerrado (ver CASO 7 y CASO 12).
test("CASO 58 — una etiqueta no reconocida partiendo un campo dentro de una HU abierta se descarta como ruido, no invalida la HU", async () => {
  const content = [
    "HITO | H-001 | Gestión de recordatorios | Envío de notificaciones antes de una fecha límite.",
    "HU | HU-F-001 | Recordatorio automático | El sistema envía una notificación antes de la fecha límite.",
    "COMO | solicitante",
    "QUIERO | recibir un recordatorio automático",
    "cuando | se acerque la fecha límite",
    "PARA | evitar el incumplimiento del plazo",
    "CONTEXTO | existe una fecha límite definida para la acción pendiente",
    "CA | CA-F-001 | el sistema envía el recordatorio | cuando la fecha actual esté cerca del límite | entonces se dispara la notificación",
  ].join("\n");

  const { normalized, callCount } =
    await generateMilestonesUnitWithSequentialContents([content]);

  assert.equal(
    callCount,
    1,
    "la línea 'cuando | ...' debe descartarse como ruido sin disparar reparación",
  );
  assert.equal(normalized.functionalRequirements.length, 1);
  assert.equal(normalized.functionalRequirements[0]?.documentationStatus, "COMPLETE");
  assert.equal(
    normalized.functionalRequirements[0]?.want,
    "recibir un recordatorio automático",
  );
});

test("CASO 59 — las columnas finales de un RNF escritas como líneas separadas se descartan como ruido, no invalidan el RNF ni el resto del bloque", async () => {
  const content = [
    "HITO | H-001 | Registro de solicitudes | Gestión del registro de solicitudes.",
    "HU | HU-F-001 | Registrar solicitud | El sistema registra una solicitud nueva.",
    "COMO | usuario",
    "QUIERO | registrar una solicitud",
    "PARA | iniciar el proceso correspondiente",
    "CONTEXTO | existe una necesidad de registrar solicitudes de forma centralizada",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
    "RNF | RNF-001 | Disponibilidad del servicio | El sistema debe estar disponible en horario laboral.",
    "categoría | disponibilidad",
    "medida | porcentaje de tiempo operativo",
    "objetivo | 99% de disponibilidad durante horario laboral",
    "criterio verificable | registro de tiempos de inactividad no autorizados",
  ].join("\n");

  const { normalized, callCount } =
    await generateMilestonesUnitWithSequentialContents([content]);

  assert.equal(
    callCount,
    1,
    "las líneas categoría/medida/objetivo/criterio deben descartarse como ruido sin disparar reparación",
  );
  assert.equal(normalized.functionalRequirements.length, 1);
  assert.equal(normalized.functionalRequirements[0]?.documentationStatus, "COMPLETE");
});

test("CASO 60 — una etiqueta no reconocida sigue fallando cerrado cuando NO hay ninguna HU abierta (no es ruido tolerable en cualquier lugar)", async () => {
  const content = [
    "HITO | H-001 | Registro de solicitudes | Gestión del registro de solicitudes.",
    "notas | comentarios sueltos del analista sin ninguna estructura reconocible",
    "HU | HU-F-001 | Registrar solicitud | El sistema registra una solicitud nueva.",
    "COMO | usuario",
    "QUIERO | registrar una solicitud",
    "PARA | iniciar el proceso correspondiente",
    "CONTEXTO | existe una necesidad de registrar solicitudes de forma centralizada",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
  ].join("\n");

  await assertMilestonesFallbackReplacesCorruptOutput(
    content,
  );
});

// AI_ANALYSIS_LOCAL_ONLY_V2_MILESTONES_NOISE_TOLERANCE_NARROWING_V1
//
// Segunda auditoría Codex sobre la tolerancia de ruido de CASO 58/59: la
// tolerancia genérica ("cualquier etiqueta no reconocida dentro de una HU
// abierta es ruido") era demasiado amplia. Se corrigió para:
// 1) Nunca tolerar narrativa/comentarios arbitrarios dentro de una HU/RNF:
//    solo el conjunto CERRADO y explícito de etiquetas realmente observadas
//    en Ollama (cuando/tipo/categoría/medida/objetivo/criterio verificable)
//    se descarta como ruido.
// 2) Nunca tolerar variantes malformadas de una etiqueta ESTRUCTURAL
//    (HITO:, HU:, HISTORIA:, RNF:): siempre fallan cerrado, sin importar el
//    contexto, porque son jerarquía corrupta disfrazada, no ruido de un
//    atributo secundario.
test("CASO 61 — narrativa arbitraria dentro de una HU por lo demás completa NO se descarta como ruido: falla cerrado, no puede quedar COMPLETE", async () => {
  const content = [
    "HITO | H-001 | Registro de solicitudes | Gestión del registro de solicitudes.",
    "HU | HU-F-001 | Registrar solicitud | El sistema registra una solicitud nueva.",
    "COMO | usuario",
    "QUIERO | registrar una solicitud",
    "No implementar el registro: este requisito fue cancelado por el cliente.",
    "PARA | iniciar el proceso correspondiente",
    "CONTEXTO | existe una necesidad de registrar solicitudes de forma centralizada",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
  ].join("\n");

  await assertMilestonesFallbackReplacesCorruptOutput(
    content,
  );
});

test("CASO 62 — 'HITO:' (variante malformada) después de un RNF válido es UNPARSEABLE, no ruido tolerable", async () => {
  const content = [
    "HITO | H-001 | Registro de solicitudes | Gestión del registro de solicitudes.",
    "HU | HU-F-001 | Registrar solicitud | El sistema registra una solicitud nueva.",
    "COMO | usuario",
    "QUIERO | registrar una solicitud",
    "PARA | iniciar el proceso correspondiente",
    "CONTEXTO | existe una necesidad de registrar solicitudes de forma centralizada",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
    "RNF | RNF-001 | Disponibilidad del servicio | El sistema debe estar disponible en horario laboral. | disponibilidad | 99% | garantizar operatividad | monitoreo continuo",
    "HITO: | H-002 | Pagos | Gestión de pagos.",
    "HU: | HU-F-002 | Cobrar | Cobrar el pago correspondiente.",
  ].join("\n");

  await assertMilestonesFallbackReplacesCorruptOutput(
    content,
  );
});

test("CASO 63 — 'HU:' (variante malformada) después de una HU completa no puede desaparecer silenciosamente: falla cerrado", async () => {
  const content = [
    "HITO | H-001 | Registro de solicitudes | Gestión del registro de solicitudes.",
    "HU | HU-F-001 | Registrar solicitud | El sistema registra una solicitud nueva.",
    "COMO | usuario",
    "QUIERO | registrar una solicitud",
    "PARA | iniciar el proceso correspondiente",
    "CONTEXTO | existe una necesidad de registrar solicitudes de forma centralizada",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
    "HU: | HU-F-002 | Anular solicitud | Anular una solicitud registrada previamente.",
  ].join("\n");

  await assertMilestonesFallbackReplacesCorruptOutput(
    content,
  );
});

test("CASO 64 — HITO/HU exactos (sin variantes malformadas) siguen comportándose estrictamente: reabrir jerarquía después de RNF sigue siendo UNPARSEABLE", async () => {
  const content = [
    "HITO | H-001 | Registro de solicitudes | Gestión del registro de solicitudes.",
    "HU | HU-F-001 | Registrar solicitud | El sistema registra una solicitud nueva.",
    "COMO | usuario",
    "QUIERO | registrar una solicitud",
    "PARA | iniciar el proceso correspondiente",
    "CONTEXTO | existe una necesidad de registrar solicitudes de forma centralizada",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
    "RNF | RNF-001 | Disponibilidad del servicio | El sistema debe estar disponible en horario laboral. | disponibilidad | 99% | garantizar operatividad | monitoreo continuo",
    "HITO | H-002 | Pagos | Gestión de pagos.",
    "HU | HU-F-002 | Cobrar | Cobrar el pago correspondiente.",
    "COMO | usuario",
    "QUIERO | cobrar un pago",
    "PARA | registrar el cobro",
    "CONTEXTO | existe una necesidad de cobro",
    "CA | CA-F-002 | existe un pago pendiente | el usuario cobra | el sistema registra el cobro",
  ].join("\n");

  await assertMilestonesFallbackReplacesCorruptOutput(
    content,
  );
});

test("CASO 65 — los dos patrones reales de ruido de Ollama (cuando/categoría/medida/objetivo/criterio verificable) siguen siendo tolerados tras acotar la lista", async () => {
  const strayCuandoInsideHu = [
    "HITO | H-001 | Registro de solicitudes | Gestión del registro de solicitudes.",
    "HU | HU-F-001 | Registrar solicitud | El sistema registra una solicitud nueva.",
    "COMO | usuario",
    "QUIERO | registrar una solicitud",
    "cuando | se recibe la información completa",
    "PARA | iniciar el proceso correspondiente",
    "CONTEXTO | existe una necesidad de registrar solicitudes de forma centralizada",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
  ].join("\n");

  const rnfWithSplitColumns = [
    "HITO | H-001 | Registro de solicitudes | Gestión del registro de solicitudes.",
    "HU | HU-F-001 | Registrar solicitud | El sistema registra una solicitud nueva.",
    "COMO | usuario",
    "QUIERO | registrar una solicitud",
    "PARA | iniciar el proceso correspondiente",
    "CONTEXTO | existe una necesidad de registrar solicitudes de forma centralizada",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
    "RNF | RNF-001 | Disponibilidad del servicio | El sistema debe estar disponible en horario laboral.",
    "categoría | disponibilidad",
    "medida | porcentaje de tiempo operativo",
    "objetivo | 99% de disponibilidad durante horario laboral",
    "criterio verificable | registro de tiempos de inactividad no autorizados",
  ].join("\n");

  for (const content of [strayCuandoInsideHu, rnfWithSplitColumns]) {
    const { normalized, callCount } =
      await generateMilestonesUnitWithSequentialContents([content]);
    assert.equal(callCount, 1, "el ruido demostrado no debe disparar reparación");
    assert.equal(normalized.functionalRequirements.length, 1);
    assert.equal(
      normalized.functionalRequirements[0]?.documentationStatus,
      "COMPLETE",
    );
  }
});

test("backlogStructure canonicaliza Epic raíz repetidas para que el editor no reciba dos EP-001", () => {
  const normalized = normalizeLocalOnlyV2SectionContent(
    "backlogStructure",
    [
      "EPICA | EP-001 | Gestión de solicitudes | Primera raíz.",
      "FEATURE | FE-001 | Registro | Registrar solicitudes.",
      "HU-P | HU-P-001 | Implementar registro | Implementación del registro. |  | HU-F-001",
      "TAREA | T-001 | Implementar formulario | Construir formulario. |  | DEVELOPMENT | EVIDENCE |",
      "EPICA | EP-001 | Gestión de aprobaciones | Segunda raíz.",
      "FEATURE | FE-001 | Aprobación | Gestionar decisiones.",
      "HU-P | HU-P-001 | Implementar aprobación | Implementación de aprobación. |  | HU-F-002",
      "TAREA | T-001 | Implementar decisión | Construir decisión. |  | DEVELOPMENT | EVIDENCE |",
    ].join("\n"),
    {},
  ) as Record<string, unknown>;

  const epics = normalized.epics as Array<Record<string, unknown>>;
  assert.equal(epics.length, 2);
  assert.deepEqual(
    epics.map((epic) => epic.code),
    ["EP-001", "EP-002"],
  );
});

test("objectives hace un único reintento localizado cuando faltan los cuatro cualitativos", async () => {
  const basePlan = plan();
  const objectiveBlock = {
    ...basePlan.blocks[0]!,
    blockId: "template@1:objectives",
    sectionKey: "objectives",
    title: "Objetivos del proyecto",
    guidance: "Redactar objetivos sustentados.",
  };
  const currentPlan: LocalOnlyV2TemplateGenerationPlan = {
    ...basePlan,
    blocks: [objectiveBlock],
  };
  const basePacket = packet(6, 120);
  const currentPacket: LocalOnlyV2BlockEvidencePacket = {
    ...basePacket,
    blockId: objectiveBlock.blockId,
    sectionKey: objectiveBlock.sectionKey,
    title: objectiveBlock.title,
    guidance: objectiveBlock.guidance,
  };
  const execution = beginLocalOnlyV2Block(
    createLocalOnlyV2SequentialBlockExecution(currentPlan),
    objectiveBlock.blockId,
  );
  const budget = resolveLocalOnlyV2InferenceBudget({
    configuredContextTokens: 16_384,
    configuredMaxOutputTokens: 8_192,
    configuredTimeoutMs: 600_000,
  });
  const unit = planLocalOnlyV2ProcessingUnits(
    execution,
    currentPlan,
    currentPacket,
    budget,
  )[0]!;
  assert.equal(unit.unitNumber, 1);

  const first = [
    "Objetivo general: Centralizar la gestión sustentada en la evidencia.",
    "Objetivos específicos cualitativos:",
    "1. [PENDIENTE POR DEFINIR: objetivo cualitativo 1]",
    "2. [PENDIENTE POR DEFINIR: objetivo cualitativo 2]",
    "3. [PENDIENTE POR DEFINIR: objetivo cualitativo 3]",
    "4. [PENDIENTE POR DEFINIR: objetivo cualitativo 4]",
    "Objetivos específicos cuantitativos:",
    "1. Mantener una meta medible pendiente de línea base.",
    "2. Medir la tasa operativa pendiente de definición.",
    "3. Medir el tiempo de respuesta pendiente de definición.",
  ].join("\n");

  const repaired = [
    "Objetivo general: Centralizar la gestión sustentada en la evidencia.",
    "Objetivos específicos cualitativos:",
    "1. Estandarizar la gestión del proceso descrito.",
    "2. Mejorar la trazabilidad de la información disponible.",
    "3. Reducir reprocesos asociados al manejo actual.",
    "4. Fortalecer el control sobre la validación del proceso.",
    "Objetivos específicos cuantitativos:",
    "1. Mantener una meta medible pendiente de línea base.",
    "2. Medir la tasa operativa pendiente de definición.",
    "3. Medir el tiempo de respuesta pendiente de definición.",
  ].join("\n");

  const prompts: string[] = [];
  const client: Pick<OllamaClient, "generate"> = {
    generate: async (...args: Parameters<OllamaClient["generate"]>) => {
      prompts.push(args[0]);
      return JSON.stringify({
        content: prompts.length === 1 ? first : repaired,
      });
    },
  };

  const result = await generateLocalOnlyV2ProcessingBlock(
    client,
    execution,
    currentPlan,
    unit,
  );

  assert.equal(prompts.length, 2);
  assert.match(
    prompts[1] ?? "",
    /LOCAL_ONLY_V2_OBJECTIVES_QUALITATIVE_REPAIR_V1/u,
  );
  assert.match(
    prompts[1] ?? "",
    /exactamente cuatro objetivos específicos cualitativos/u,
  );
  assert.doesNotMatch(result.content, /objetivo cualitativo [1-4]/iu);
  assert.match(result.content, /Estandarizar la gestión/u);
  assert.match(result.content, /Mejorar la trazabilidad/u);
  assert.match(result.content, /Reducir reprocesos/u);
  assert.match(result.content, /Fortalecer el control/u);
});

test("problemDescription elimina numeración residual y conserva impactos operacionales limpios", async () => {
  const basePlan = plan();
  const problemBlock = {
    ...basePlan.blocks[0]!,
    blockId: "template@1:problemDescription",
    sectionKey: "problemDescription",
    title: "Descripción del problema",
    guidance: "Describir situación actual e impactos operacionales.",
  };
  const currentPlan: LocalOnlyV2TemplateGenerationPlan = {
    ...basePlan,
    blocks: [problemBlock],
  };
  const basePacket = packet(6, 120);
  const currentPacket: LocalOnlyV2BlockEvidencePacket = {
    ...basePacket,
    blockId: problemBlock.blockId,
    sectionKey: problemBlock.sectionKey,
    title: problemBlock.title,
    guidance: problemBlock.guidance,
  };
  const execution = beginLocalOnlyV2Block(
    createLocalOnlyV2SequentialBlockExecution(currentPlan),
    problemBlock.blockId,
  );
  const budget = resolveLocalOnlyV2InferenceBudget({
    configuredContextTokens: 16_384,
    configuredMaxOutputTokens: 8_192,
    configuredTimeoutMs: 600_000,
  });
  const unit = planLocalOnlyV2ProcessingUnits(
    execution,
    currentPlan,
    currentPacket,
    budget,
  )[0]!;
  assert.equal(unit.unitNumber, 1);

  const malformed = [
    "Situación actual: La gestión actual depende de correos electrónicos y validación manual centralizada.",
    "Los impactos operacionales identificados son: 1.",
    "Retrasos en la emisión de solicitudes. 2.",
    "Sobrecarga operativa para el usuario centralizador. 4.",
  ].join("\n");

  const repairedImpacts = [
    "IMPACTO | Retrasos en la emisión de solicitudes por validaciones manuales.",
    "IMPACTO | Sobrecarga operativa para el usuario centralizador por concentración de tareas.",
    "IMPACTO | Riesgo de errores u omisiones durante el registro manual.",
    "IMPACTO | Dificultad de trazabilidad por el seguimiento distribuido en correos.",
  ].join("\n");

  const prompts: string[] = [];
  const maxOutputTokens: Array<number | undefined> = [];
  const schemaMaxLengths: Array<number | undefined> = [];

  const client: Pick<OllamaClient, "generate"> = {
    generate: async (...args: Parameters<OllamaClient["generate"]>) => {
      prompts.push(args[0]);
      maxOutputTokens.push(args[5]?.runtimeLimits?.maxOutputTokens);
      const schema = args[1] as {
        properties?: { content?: { maxLength?: number } };
      };
      schemaMaxLengths.push(schema.properties?.content?.maxLength);
      return JSON.stringify({
        content: prompts.length === 1 ? malformed : repairedImpacts,
      });
    },
  };

  const result = await generateLocalOnlyV2ProcessingBlock(
    client,
    execution,
    currentPlan,
    unit,
  );

  assert.equal(prompts.length, 2);
  assert.match(
    prompts[0] ?? "",
    /SITUACION_ACTUAL \| \.\.\. y entre una y cinco líneas IMPACTO \|/u,
  );
  assert.match(
    prompts[1] ?? "",
    /LOCAL_ONLY_V2_PROBLEM_DESCRIPTION_IMPACTS_REPAIR_V1/u,
  );
  assert.match(
    prompts[1] ?? "",
    /CORRIGE ÚNICAMENTE LOS IMPACTOS OPERACIONALES/u,
  );

  assert.equal(
    maxOutputTokens[0],
    LOCAL_ONLY_V2_PROBLEM_DESCRIPTION_MAX_OUTPUT_TOKENS,
  );
  assert.equal(
    maxOutputTokens[1],
    LOCAL_ONLY_V2_PROBLEM_DESCRIPTION_MAX_OUTPUT_TOKENS,
  );
  assert.equal(
    schemaMaxLengths[0],
    LOCAL_ONLY_V2_PROBLEM_DESCRIPTION_MAX_CONTENT_CHARACTERS,
  );
  assert.equal(
    schemaMaxLengths[1],
    LOCAL_ONLY_V2_PROBLEM_DESCRIPTION_MAX_CONTENT_CHARACTERS,
  );

  assert.doesNotMatch(
    result.content,
    /Los impactos operacionales identificados son/iu,
  );
  assert.doesNotMatch(result.content, /\.\s+[1-5]\.$/mu);
  assert.match(
    result.content,
    /SITUACION_ACTUAL \| La gestión actual depende de correos electrónicos y validación manual centralizada\./u,
  );

  const normalized = normalizeLocalOnlyV2SectionContent(
    "problemDescription",
    result.content,
    {},
  ) as {
    currentState: string;
    operationalImpact: string[];
  };

  assert.equal(
    normalized.currentState,
    "La gestión actual depende de correos electrónicos y validación manual centralizada.",
  );
  assert.deepEqual(normalized.operationalImpact, [
    "Retrasos en la emisión de solicitudes por validaciones manuales.",
    "Sobrecarga operativa para el usuario centralizador por concentración de tareas.",
    "Riesgo de errores u omisiones durante el registro manual.",
    "Dificultad de trazabilidad por el seguimiento distribuido en correos.",
  ]);
});

test("objectives repara solo los tres cuantitativos y preserva general y cuatro cualitativos", async () => {
  const basePlan = plan();
  const objectiveBlock = {
    ...basePlan.blocks[0]!,
    blockId: "template@1:objectives",
    sectionKey: "objectives",
    title: "Objetivos del proyecto",
    guidance: "Redactar objetivos sustentados.",
  };
  const currentPlan: LocalOnlyV2TemplateGenerationPlan = {
    ...basePlan,
    blocks: [objectiveBlock],
  };
  const basePacket = packet(6, 120);
  const currentPacket: LocalOnlyV2BlockEvidencePacket = {
    ...basePacket,
    blockId: objectiveBlock.blockId,
    sectionKey: objectiveBlock.sectionKey,
    title: objectiveBlock.title,
    guidance: objectiveBlock.guidance,
  };
  const execution = beginLocalOnlyV2Block(
    createLocalOnlyV2SequentialBlockExecution(currentPlan),
    objectiveBlock.blockId,
  );
  const budget = resolveLocalOnlyV2InferenceBudget({
    configuredContextTokens: 16_384,
    configuredMaxOutputTokens: 8_192,
    configuredTimeoutMs: 600_000,
  });
  const unit = planLocalOnlyV2ProcessingUnits(
    execution,
    currentPlan,
    currentPacket,
    budget,
  )[0]!;
  assert.equal(unit.unitNumber, 1);

  const first = [
    "Objetivo general: Centralizar la gestión sustentada en la evidencia.",
    "Objetivos específicos cualitativos:",
    "1. Estandarizar la gestión del proceso descrito.",
    "2. Mejorar la trazabilidad de la información disponible.",
    "3. Reducir reprocesos asociados al manejo actual.",
    "4. Fortalecer el control sobre la validación del proceso.",
    "Objetivos específicos cuantitativos:",
    "1. Optimizar la dim",
    "2. [PENDIENTE POR DEFINIR: objetivo cuantitativo 2]",
    "3. [PENDIENTE POR DEFINIR: objetivo cuantitativo 3]",
  ].join("\n");

  const repairedQuantitative = [
    "Objetivos específicos cuantitativos:",
    "1. Reducir el tiempo requerido para completar el registro; meta: [PENDIENTE POR DEFINIR].",
    "2. Incrementar la cantidad de registros procesados mediante el flujo digital; meta: [PENDIENTE POR DEFINIR].",
    "3. Medir la tasa de registros que requieren corrección durante la validación; línea base: [PENDIENTE POR DEFINIR].",
  ].join("\n");

  const prompts: string[] = [];
  const maxOutputTokens: Array<number | undefined> = [];
  const schemaMaxLengths: Array<number | undefined> = [];

  const client: Pick<OllamaClient, "generate"> = {
    generate: async (...args: Parameters<OllamaClient["generate"]>) => {
      prompts.push(args[0]);
      maxOutputTokens.push(args[5]?.runtimeLimits?.maxOutputTokens);
      const schema = args[1] as {
        properties?: { content?: { maxLength?: number } };
      };
      schemaMaxLengths.push(schema.properties?.content?.maxLength);
      return JSON.stringify({
        content: prompts.length === 1 ? first : repairedQuantitative,
      });
    },
  };

  const result = await generateLocalOnlyV2ProcessingBlock(
    client,
    execution,
    currentPlan,
    unit,
  );

  assert.equal(prompts.length, 2);
  assert.match(
    prompts[0] ?? "",
    /exactamente un objetivo general, cuatro objetivos específicos cualitativos y tres objetivos específicos cuantitativos/u,
  );
  assert.match(
    prompts[1] ?? "",
    /LOCAL_ONLY_V2_OBJECTIVES_QUANTITATIVE_REPAIR_V1/u,
  );
  assert.match(
    prompts[1] ?? "",
    /CORRIGE ÚNICAMENTE LOS OBJETIVOS ESPECÍFICOS CUANTITATIVOS/u,
  );

  assert.equal(maxOutputTokens[0], LOCAL_ONLY_V2_OBJECTIVES_MAX_OUTPUT_TOKENS);
  assert.equal(maxOutputTokens[1], LOCAL_ONLY_V2_OBJECTIVES_MAX_OUTPUT_TOKENS);
  assert.equal(
    schemaMaxLengths[0],
    LOCAL_ONLY_V2_OBJECTIVES_MAX_CONTENT_CHARACTERS,
  );
  assert.equal(
    schemaMaxLengths[1],
    LOCAL_ONLY_V2_OBJECTIVES_MAX_CONTENT_CHARACTERS,
  );

  assert.match(result.content, /Estandarizar la gestión del proceso descrito/u);
  assert.match(
    result.content,
    /Fortalecer el control sobre la validación del proceso/u,
  );
  assert.doesNotMatch(result.content, /Optimizar la dim/u);
  assert.doesNotMatch(
    result.content,
    /\[PENDIENTE POR DEFINIR: objetivo cuantitativo [123]\]/iu,
  );

  const normalized = normalizeLocalOnlyV2SectionContent(
    "objectives",
    result.content,
    {},
  ) as {
    general: string;
    qualitative: string[];
    quantitative: string[];
  };

  assert.equal(normalized.qualitative.length, 4);
  assert.equal(normalized.quantitative.length, 3);
  assert.ok(
    normalized.quantitative.every(
      (objective) =>
        !/^\[PENDIENTE POR DEFINIR(?::[^\]]+)?\]$/iu.test(objective.trim()),
    ),
  );
  assert.match(normalized.quantitative[0] ?? "", /tiempo/iu);
  assert.match(normalized.quantitative[1] ?? "", /cantidad/iu);
  assert.match(normalized.quantitative[2] ?? "", /tasa/iu);
});

test("presupuesto V2 reduce 131k/8192/600s a límites pequeños por inferencia", () => {
  const budget = resolveLocalOnlyV2InferenceBudget({
    configuredContextTokens: 131_072,
    configuredMaxOutputTokens: 8_192,
    configuredTimeoutMs: 600_000,
  });

  assert.equal(budget.runtimeContextCapTokens, 65_536);
  assert.equal(budget.maxOutputTokens, 1_200);
  assert.equal(budget.maxAtomicOutputTokens, 1_600);
  assert.equal(budget.targetOutputTokens, 700);
  assert.equal(budget.maxCallDurationMs, 300_000);
  assert.equal(budget.maxPromptContextRatio, 0.5);
  assert.equal(budget.maxSplitParts, 4);
});

test("microbloque pequeño usa una sola llamada y nunca num_predict 8192", () => {
  const currentPacket = packet(2, 80);
  const budget = resolveLocalOnlyV2InferenceBudget({
    configuredContextTokens: 131_072,
    configuredMaxOutputTokens: 8_192,
    configuredTimeoutMs: 600_000,
  });
  const task = buildLocalOnlyV2MicroDraftTask(plan(), currentPacket);
  const assessment = assessLocalOnlyV2MicroDraftInference(task, budget);
  const planned = buildLocalOnlyV2BudgetedMicroDraftPlan(
    plan(),
    currentPacket,
    budget,
  );

  assert.equal(assessment.allowed, true);
  assert.equal(planned.parts.length, 1);
  assert.equal(planned.splitRequired, false);
  assert.ok(
    (planned.parts[0]!.assessment.runtimeLimits.maxOutputTokens ?? 0) <= 1_200,
  );
  assert.ok(
    (planned.parts[0]!.assessment.runtimeLimits.contextTokens ?? 0) <= 65_536,
  );
  assert.equal(planned.parts[0]!.assessment.runtimeLimits.timeoutMs, 300_000);
});

test("prompt grande se auto-divide antes de superar 50% del contexto efectivo", () => {
  const currentPacket = packet(12, 1_500);
  const budget = resolveLocalOnlyV2InferenceBudget({
    configuredContextTokens: 8_192,
    configuredMaxOutputTokens: 8_192,
    configuredTimeoutMs: 600_000,
  });
  const originalTask = buildLocalOnlyV2MicroDraftTask(plan(), currentPacket);
  const original = assessLocalOnlyV2MicroDraftInference(originalTask, budget);
  const planned = buildLocalOnlyV2BudgetedMicroDraftPlan(
    plan(),
    currentPacket,
    budget,
  );

  assert.equal(original.allowed, false);
  assert.ok(original.reasons.includes("PROMPT_CONTEXT_RATIO"));
  assert.equal(planned.splitRequired, true);
  assert.ok(planned.parts.length >= 2);
  assert.ok(planned.parts.length <= 4);
  assert.ok(
    planned.parts.every(
      (part) =>
        part.assessment.allowed && part.assessment.promptContextRatio <= 0.5,
    ),
  );

  const coveredRelevant = [
    ...new Set(
      planned.parts.flatMap((part) =>
        part.packet.relevantFindings.map((item) => item.canonicalId),
      ),
    ),
  ];
  assert.deepEqual(
    coveredRelevant,
    currentPacket.relevantFindings.map((item) => item.canonicalId),
  );
});

test("telemetría lenta puede forzar reducción/split por tiempo antes del timeout", () => {
  const currentPacket = packet(6, 250);
  const budget = resolveLocalOnlyV2InferenceBudget({
    configuredContextTokens: 16_384,
    configuredMaxOutputTokens: 8_192,
    configuredTimeoutMs: 120_000,
    observation: {
      promptTokensPerSecond: 100,
      outputTokensPerSecond: 10,
    },
  });
  const original = assessLocalOnlyV2MicroDraftInference(
    buildLocalOnlyV2MicroDraftTask(plan(), currentPacket),
    budget,
  );
  const planned = buildLocalOnlyV2BudgetedMicroDraftPlan(
    plan(),
    currentPacket,
    budget,
  );

  assert.equal(original.allowed, false);
  assert.ok(original.reasons.includes("PREDICTED_TIME"));
  assert.ok(
    planned.parts.every(
      (part) =>
        part.assessment.predictedDurationMs !== null &&
        part.assessment.predictedDurationMs <= budget.maxCallDurationMs,
    ),
  );
  assert.ok(
    planned.parts.every(
      (part) =>
        (part.assessment.runtimeLimits.maxOutputTokens ?? 1_201) < 1_200,
    ),
  );
});

test("si ni cuatro partes caben, falla cerrado antes de llamar a Ollama", () => {
  const currentPacket = packet(4, 30_000);
  const budget = resolveLocalOnlyV2InferenceBudget({
    configuredContextTokens: 8_192,
    configuredMaxOutputTokens: 8_192,
    configuredTimeoutMs: 600_000,
  });

  assert.throws(
    () => buildLocalOnlyV2BudgetedMicroDraftPlan(plan(), currentPacket, budget),
    /aun después de 4 partes/u,
  );
});

test("ejecutor budgeted usa runtimeLimits, preserva AbortSignal y recompone trazabilidad original", async () => {
  const currentPacket = packet(10, 1_800);
  const budget = resolveLocalOnlyV2InferenceBudget({
    configuredContextTokens: 8_192,
    configuredMaxOutputTokens: 8_192,
    configuredTimeoutMs: 600_000,
  });
  const calls: Array<Parameters<OllamaClient["generate"]>> = [];
  const fakeClient: Pick<OllamaClient, "generate"> = {
    async generate(...args: Parameters<OllamaClient["generate"]>) {
      calls.push(args);
      return JSON.stringify({
        content: `Parte ${calls.length} sustentada.`,
      });
    },
  };
  const controller = new AbortController();

  const result = await generateLocalOnlyV2BudgetedMicroDraftWithOllama(
    fakeClient,
    plan(),
    currentPacket,
    budget,
    controller.signal,
  );

  assert.ok(calls.length >= 2);
  assert.ok(calls.length <= 4);
  assert.ok(
    calls.every(
      (call) =>
        call[5]?.profile === "LOCAL_DOCUMENT" &&
        (call[5]?.runtimeLimits?.maxOutputTokens ?? 0) <= 1_200 &&
        (call[5]?.runtimeLimits?.contextTokens ?? 0) <= 65_536 &&
        call[5]?.runtimeLimits?.timeoutMs === 300_000,
    ),
  );
  assert.ok(calls.every((call) => call[4] === controller.signal));
  assert.deepEqual(result.selectedFindingIds, currentPacket.selectedFindingIds);
  assert.deepEqual(result.sourceIds, currentPacket.sourceIds);
  assert.deepEqual(result.segmentIds, currentPacket.segmentIds);
  assert.equal(result.evidenceFingerprint, currentPacket.fingerprint);
  assert.match(result.content, /Parte 1 sustentada/u);
});

test("runtimeLimits de Ollama son opt-in y solo pueden REDUCIR configuración", async () => {
  const source = await readFile(
    "apps/ai-analysis-service/src/local-ai/ollama.client.ts",
    "utf8",
  );

  assert.match(source, /runtimeLimits\?: OllamaRuntimeLimitsOverride/u);
  assert.match(
    source,
    /options\.runtimeLimits\?\.contextTokens[\s\S]*?this\.config\.contextTokens/u,
  );
  assert.match(
    source,
    /options\.runtimeLimits\?\.maxOutputTokens[\s\S]*?this\.config\.maxOutputTokens \?\? 8192/u,
  );
  assert.match(
    source,
    /options\.runtimeLimits\?\.timeoutMs[\s\S]*?this\.config\.timeoutMs/u,
  );
  assert.match(source, /return Math\.min\(requested, configured\)/u);
  assert.match(source, /runtimeTimeoutMs/u);
});

test("Paso 16 no toca OpenAI, TypeORM, BD ni hardcodea SOAT", async () => {
  const production = await readFile(
    "apps/ai-analysis-service/src/execution/local-only-v2-inference-budget.ts",
    "utf8",
  );
  const executable = production
    .split(/\r?\n/u)
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

  assert.doesNotMatch(executable, /OpenAi/u);
  assert.doesNotMatch(executable, /from "typeorm"/u);
  assert.doesNotMatch(executable, /Repository</u);
  assert.doesNotMatch(production, /SOAT/iu);
  assert.match(production, /LOCAL_ONLY_V2_MAX_MICRO_DRAFT_SPLIT_PARTS/u);
  assert.match(production, /runtimeLimits/u);
  assert.match(production, /PREDICTED_TIME/u);
});

test("la instrucción humana llega al prompt del bloque y cambia el fingerprint de la subunidad", async () => {
  const currentPlan = plan();
  const execution = beginLocalOnlyV2Block(
    createLocalOnlyV2SequentialBlockExecution(currentPlan),
    currentPlan.blocks[0]!.blockId,
  );
  const budget = resolveLocalOnlyV2InferenceBudget({
    configuredContextTokens: 8_192,
    configuredMaxOutputTokens: 8_192,
    configuredTimeoutMs: 600_000,
  });

  const withoutInstruction = planLocalOnlyV2ProcessingUnits(
    execution,
    currentPlan,
    packet(),
    budget,
  );
  const withInstruction = planLocalOnlyV2ProcessingUnits(
    execution,
    currentPlan,
    packet(),
    budget,
    {
      instruction: "Enfatiza los riesgos de seguridad reportados.",
      purpose: "AI_VERSION",
    },
  );

  assert.equal(withoutInstruction.length, withInstruction.length);
  assert.doesNotMatch(
    withoutInstruction[0]!.task.prompt,
    /Enfatiza los riesgos de seguridad reportados\./u,
  );
  assert.match(
    withInstruction[0]!.task.prompt,
    /SOLICITUD DE CAMBIO CONFIABLE DEL USUARIO/u,
  );
  assert.match(
    withInstruction[0]!.task.prompt,
    /Enfatiza los riesgos de seguridad reportados\./u,
  );
  assert.match(withInstruction[0]!.task.prompt, /AI_VERSION/u);

  // El checkpoint de subunidad se identifica por unitFingerprint: si la
  // instrucción humana cambia, un checkpoint previo no debe reutilizarse.
  assert.notEqual(
    withoutInstruction[0]!.unitFingerprint,
    withInstruction[0]!.unitFingerprint,
  );

  const repeatWithInstruction = planLocalOnlyV2ProcessingUnits(
    execution,
    currentPlan,
    packet(),
    budget,
    {
      instruction: "Enfatiza los riesgos de seguridad reportados.",
      purpose: "AI_VERSION",
    },
  );
  assert.equal(
    withInstruction[0]!.unitFingerprint,
    repeatWithInstruction[0]!.unitFingerprint,
  );
});

// AI_ANALYSIS_LOCAL_ONLY_V2_MILESTONES_PUBLISHABLE_TITLES_TESTS_V1
//
// Una salida con jerarquía HITO/HU válida pero títulos contaminados por el
// cuestionario debe sustituirse por el fallback determinista.
const storyLines = (code: string, title: string, description: string) => [
  `HU | ${code} | ${title} | ${description}`,
  "COMO | Usuario",
  "QUIERO | operar",
  "PARA | avanzar",
  "CONTEXTO | evidencia",
];
const MILESTONES_DEFECTIVE_TITLE_CASES: Array<[string, string]> = [
  [
    "rótulos de cuestionario",
    [
      "HITO | H-001 | Gestión | Gestión de solicitudes.",
      ...storyLines("HU-F-001", "Escenarios a probar", "Registrar la solicitud."),
      ...storyLines("HU-F-002", "Resultado observable", "Aprobar la solicitud."),
    ].join("\n"),
  ],
  [
    "títulos vacíos o pendientes",
    [
      "HITO | H-001 | Requerimientos por agrupar | [PENDIENTE POR DEFINIR]",
      ...storyLines("HU-F-001", "", "Registrar la solicitud."),
      ...storyLines("HU-F-002", "[PENDIENTE POR DEFINIR]", "Aprobar la solicitud."),
    ].join("\n"),
  ],
  [
    "rótulos Rol/Notificaciones/Pantallas/Información",
    [
      "HITO | H-001 | Gestión | Gestión de solicitudes.",
      ...storyLines("HU-F-001", "Rol que aprueba la solicitud?", "Registrar."),
      ...storyLines("HU-F-002", "Notificaciones", "Aprobar la solicitud."),
      ...storyLines("HU-F-003", "Pantallas necesarias", "Consultar la solicitud."),
      ...storyLines("HU-F-004", "Información a registrar", "Editar la solicitud."),
    ].join("\n"),
  ],
];

for (const [name, content] of MILESTONES_DEFECTIVE_TITLE_CASES) {
  test(`Requerimientos con ${name} activa el fallback determinista publicable`, async () => {
    const result = await assertMilestonesFallbackReplacesCorruptOutput(content, 3);
    const lines = result.contentOut.split("\n");
    assert.match(
      lines[0]!,
      /^HITO \| H-PEND-\d{3} \| Necesidades funcionales identificadas \| /u,
    );
    const titles = lines
      .filter((line) => line.startsWith("HU | "))
      .map((line) => line.split(" | ")[2]!.trim());
    assert.ok(titles.length > 0);
    for (const title of titles) {
      assert.ok(title.length > 0);
      assert.doesNotMatch(
        title,
        /Escenarios a probar|Resultado observable|Requerimientos por agrupar|PENDIENTE POR DEFINIR|^(Rol|Notificaciones|Pantallas|Información)\b/u,
      );
    }
    assert.equal(new Set(titles.map((t) => t.toLowerCase())).size, titles.length);
    assert.doesNotMatch(result.contentOut, /Requerimientos por agrupar/u);
  });
}

test("Requerimientos con títulos de HU duplicados no activa el fallback y preserva ambas HU", async () => {
  const content = [
    "HITO | H-001 | Gestión | Gestión de solicitudes.",
    ...storyLines("HU-F-001", "Registrar solicitud", "Registrar la solicitud."),
    ...storyLines("HU-F-002", "registrar  solicitud", "Registrar otra."),
  ].join("\n");
  const result = await generateMilestonesUnitWithContent(content);
  assert.equal(result.contentOut, content);
  assert.match(result.contentOut, /HU \| HU-F-001 \|/u);
  assert.match(result.contentOut, /HU \| HU-F-002 \|/u);
});

test("Requerimientos con títulos publicables no activa el fallback", async () => {
  const content = [
    "HITO | H-001 | Registro | Gestión del registro.",
    "HU | HU-F-001 | Registrar solicitud | Registrar la solicitud con la información sustentada.",
    "COMO | Usuario solicitante",
    "QUIERO | registrar la solicitud",
    "PARA | iniciar el proceso",
    "CONTEXTO | La evidencia describe el registro de una solicitud.",
    "CA | CA-F-001 | existe información válida | el usuario registra | el sistema conserva la solicitud",
  ].join("\n");
  const result = await generateMilestonesUnitWithContent(content);
  assert.equal(result.contentOut, content);
});
