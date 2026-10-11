// LOCAL_ONLY_V2 etapa 3: sección 10, Alcance y Solución propuesta.
import assert from "node:assert/strict";
import test from "node:test";

import type { OllamaClient } from "../../apps/ai-analysis-service/src/local-ai/ollama.client.js";
import type {
  LocalOnlyV2BlockEvidencePacket,
  LocalOnlyV2SelectedFinding,
} from "../../apps/ai-analysis-service/src/execution/local-only-v2-evidence-selector.js";
import { resolveLocalOnlyV2InferenceBudget } from "../../apps/ai-analysis-service/src/execution/local-only-v2-inference-budget.js";
import {
  generateLocalOnlyV2ProcessingBlock,
  planLocalOnlyV2ProcessingUnits,
} from "../../apps/ai-analysis-service/src/execution/local-only-v2-sequential-block-generator.js";
import { normalizeLocalOnlyV2SectionContent } from "../../apps/ai-analysis-service/src/execution/local-only-v2-section-content.js";
import {
  beginLocalOnlyV2Block,
  createLocalOnlyV2SequentialBlockExecution,
} from "../../apps/ai-analysis-service/src/execution/local-only-v2-sequential-block-contract.js";
import type { LocalOnlyV2TemplateGenerationPlan } from "../../apps/ai-analysis-service/src/execution/local-only-v2-template-planner.js";

const PENDING = "[PENDIENTE POR DEFINIR]";
type Json = Record<string, unknown>;

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

function mixedFinding(
  index: number,
  category: LocalOnlyV2SelectedFinding["category"],
  description: string,
): LocalOnlyV2SelectedFinding {
  const sourceId = "source-a";
  const segmentId = `source-a#pending-${String(index).padStart(2, "0")}`;
  const evidenceText = `${"x".repeat(60)}-${index}`;
  return {
    canonicalId: `v2f-pending-${String(index).padStart(2, "0")}`,
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

function packetFor(
  blockId: string,
  sectionKey: string,
  relevantFindings: LocalOnlyV2SelectedFinding[],
  guardFindings: LocalOnlyV2SelectedFinding[] = [],
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
    sectionKey,
    title: "Sección",
    required: true,
    guidance: "Estructurar requisitos funcionales y no funcionales.",
    relevantFindings,
    guardFindings,
    selectedFindingIds: [...relevantFindings, ...guardFindings].map(
      (item) => item.canonicalId,
    ),
    sourceIds,
    segmentIds,
    metrics: {
      relevantFindingCount: relevantFindings.length,
      guardFindingCount: guardFindings.length,
      totalFindingCount: relevantFindings.length + guardFindings.length,
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

function setup(
  sectionKey: string,
  relevant: LocalOnlyV2SelectedFinding[],
  guards: LocalOnlyV2SelectedFinding[] = [],
) {
  const basePlan = plan();
  const block = {
    ...basePlan.blocks[0]!,
    blockId: `template@1:${sectionKey}-stage3`,
    sectionKey,
    title: "Sección",
    guidance: "Estructurar requisitos funcionales y no funcionales.",
  };
  const currentPlan: LocalOnlyV2TemplateGenerationPlan = {
    ...basePlan,
    blocks: [block],
  };
  const currentPacket = packetFor(block.blockId, sectionKey, relevant, guards);
  const execution = beginLocalOnlyV2Block(
    createLocalOnlyV2SequentialBlockExecution(currentPlan),
    block.blockId,
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
  return { execution, currentPlan, unit };
}

function clientReturning(content: string): Pick<OllamaClient, "generate"> {
  return { generate: async () => JSON.stringify({ content }) };
}

test("Sección 10: rótulos en una sola línea se separan en listas y no se crean contradicciones", () => {
  const result = normalizeLocalOnlyV2SectionContent(
    "assumptionsDependenciesPending",
    "Supuestos: El proveedor mantiene su política actual; Los usuarios se autentican por rol. Dependencias: Consulta de datos en D365. Restricciones: La trazabilidad depende del correo. Pendientes funcionales: Definir la meta de tiempos. Preguntas pendientes: ¿Cuál es el canal de notificación? Aspectos por revisar: Evidencia de una sola fuente.",
    {},
  ) as Json;
  assert.deepEqual(result.assumptions, [
    "El proveedor mantiene su política actual;",
    "Los usuarios se autentican por rol.",
  ]);
  assert.deepEqual(result.dependencies, [
    "Consulta de datos en D365.",
    "Restricción: La trazabilidad depende del correo.",
  ]);
  assert.deepEqual(result.pendingItems, ["Definir la meta de tiempos."]);
  assert.deepEqual(result.pendingQuestions, [
    "¿Cuál es el canal de notificación?",
  ]);
  assert.deepEqual(result.warnings, ["Evidencia de una sola fuente."]);
  assert.deepEqual(result.contradictions, []);
});

test("Sección 10: solo se registra una contradicción cuando el texto la rotula", () => {
  const result = normalizeLocalOnlyV2SectionContent(
    "assumptionsDependenciesPending",
    "Contradicciones por resolver: La respuesta A indica un envío diario y la B uno semanal.",
    {},
  ) as Json;
  assert.deepEqual(result.contradictions, [
    {
      statementA: "La respuesta A indica un envío diario y la B uno semanal.",
      statementB: PENDING,
      decision: PENDING,
    },
  ]);
});

test("Sección 10: un texto sin rótulos se conserva como narrativa", () => {
  const result = normalizeLocalOnlyV2SectionContent(
    "assumptionsDependenciesPending",
    "Texto libre sin clasificación alguna del modelo.",
    {},
  ) as Json;
  assert.equal(
    result.narrative,
    "Texto libre sin clasificación alguna del modelo.",
  );
  assert.deepEqual(result.assumptions, []);
});

test("Sección 10: el generador agrega las guardas de la evidencia dentro del presupuesto", async () => {
  const { execution, currentPlan, unit } = setup(
    "assumptionsDependenciesPending",
    [
      mixedFinding(
        1,
        "facts",
        "El proveedor entrega un comprobante semanal por correo.",
      ),
    ],
    [
      mixedFinding(
        2,
        "pendingQuestions",
        "¿La respuesta del proveedor llegará por solicitud individual o consolidada?",
      ),
      mixedFinding(
        3,
        "warnings",
        "La evidencia proviene de una única fuente con baja valoración.",
      ),
      mixedFinding(
        4,
        "contradictions",
        "Las notificaciones son parte del primer entregable pero también de una segunda etapa.",
      ),
    ],
  );
  const result = await generateLocalOnlyV2ProcessingBlock(
    clientReturning("Supuestos: El proveedor mantiene su política actual."),
    execution,
    currentPlan,
    unit,
  );
  assert.ok(
    result.content.length <= 850,
    `excede el presupuesto: ${result.content.length}`,
  );
  assert.match(
    result.content,
    /^Supuestos: El proveedor mantiene su política actual\./u,
  );
  assert.match(
    result.content,
    /\nContradicciones por resolver: Las notificaciones/u,
  );
  assert.match(
    result.content,
    /\nPreguntas pendientes: ¿La respuesta del proveedor/u,
  );
  assert.match(
    result.content,
    /\nAspectos por revisar: La evidencia proviene/u,
  );
  const normalized = normalizeLocalOnlyV2SectionContent(
    "assumptionsDependenciesPending",
    result.content,
    {},
  ) as Json;
  assert.equal((normalized.contradictions as Json[]).length, 1);
  assert.equal((normalized.pendingQuestions as string[]).length, 1);
  assert.equal((normalized.warnings as string[]).length, 1);
});

test("Alcance: separa por líneas y rótulos, y manda lo futuro a fuera de alcance", () => {
  const result = normalizeLocalOnlyV2SectionContent(
    "scope",
    [
      "INCLUIDO: Plataforma D365 para extracción manual de placa/VIN.",
      "- Control de acceso restringido según rol.",
      "- Optimización avanzada del dimensionamiento financiero en Cero Papel más allá de la validación básica.",
      "- Mejoras futuras en reportes o notificaciones no críticas para el primer entregable.",
      "Excluido: Generación final del comprobante semanal.",
    ].join("\n"),
    {},
  ) as { included: string[]; excluded: string[]; involvedSystems: string[] };
  assert.deepEqual(result.included, [
    "Plataforma D365 para extracción manual de placa/VIN.",
    "Control de acceso restringido según rol.",
  ]);
  assert.deepEqual(result.excluded, [
    "Optimización avanzada del dimensionamiento financiero en Cero Papel más allá de la validación básica.",
    "Mejoras futuras en reportes o notificaciones no críticas para el primer entregable.",
    "Generación final del comprobante semanal.",
  ]);
  assert.deepEqual(result.involvedSystems, [
    "Microsoft Dynamics 365 (D365)",
    "Cero Papel",
  ]);
});

test("Alcance: el generador agrega los sistemas mencionados en la evidencia", async () => {
  const { execution, currentPlan, unit } = setup("scope", [
    mixedFinding(
      1,
      "integrations",
      "El sistema consulta D365 y envía la solicitud por Outlook y Teams.",
    ),
    mixedFinding(2, "facts", "La plataforma Lockton recibe el archivo plano."),
  ]);
  const result = await generateLocalOnlyV2ProcessingBlock(
    clientReturning("INCLUIDO: Formulario web para registrar solicitudes."),
    execution,
    currentPlan,
    unit,
  );
  assert.match(result.content, /\nSistemas involucrados: /u);
  for (const name of ["D365", "Outlook", "Teams", "Lockton"]) {
    assert.ok(result.content.includes(name), `falta ${name}`);
  }
  const normalized = normalizeLocalOnlyV2SectionContent(
    "scope",
    result.content,
    {},
  ) as {
    included: string[];
    involvedSystems: string[];
  };
  assert.deepEqual(normalized.included, [
    "Formulario web para registrar solicitudes.",
  ]);
  assert.equal(normalized.involvedSystems.length, 4);
});

test("Solución propuesta: ninguna oración sirve a dos tarjetas ni se repite el objetivo", () => {
  const result = normalizeLocalOnlyV2SectionContent(
    "solutionProposal",
    "Objetivo: Implementar un formulario web integrado a D365 para digitalizar solicitudes. Correspondencia AS-IS/TO-BE: Estado Actual (AS-IS): Procesamiento manual sin control de estados. Evaluación: La falta de integración genera riesgos de errores. Resultado TO-BE: Un proceso digital con validaciones previas. Componentes: Interfaz web y motor de reglas de validación.",
    {},
  ) as {
    objective: string;
    description: string;
    involvedElements: string[];
    flowAlignment: {
      currentState: string;
      evaluation: string;
      expectedResult: string;
    };
  };
  const cards = [
    result.objective,
    result.flowAlignment.currentState,
    result.flowAlignment.evaluation,
    result.flowAlignment.expectedResult,
  ];
  assert.equal(new Set(cards).size, cards.length);
  assert.equal(
    result.flowAlignment.currentState,
    "Procesamiento manual sin control de estados.",
  );
  assert.equal(
    result.flowAlignment.evaluation,
    "La falta de integración genera riesgos de errores.",
  );
  assert.equal(
    result.flowAlignment.expectedResult,
    "Un proceso digital con validaciones previas.",
  );
  assert.deepEqual(result.involvedElements, [
    "Interfaz web y motor de reglas de validación.",
  ]);
  assert.ok(!result.description.includes(result.objective));
  assert.equal(result.description, PENDING);
});

test("Solución propuesta: sin resultado esperado queda pendiente y no copia el objetivo", () => {
  const result = normalizeLocalOnlyV2SectionContent(
    "solutionProposal",
    "Objetivo: Implementar un formulario web integrado a D365. Estado actual: Procesamiento manual sin control.",
    {},
  ) as { flowAlignment: { expectedResult: string; evaluation: string } };
  assert.equal(result.flowAlignment.expectedResult, PENDING);
  assert.equal(result.flowAlignment.evaluation, PENDING);
});
