import assert from "node:assert/strict";
import test from "node:test";

import {
  DOCUMENT_SCRUM_SECTION_DEFINITION,
  DOCUMENT_SECTION_DEFINITIONS,
} from "../../libs/shared/contracts/src/lib/documents.js";
import {
  buildAiAnalysisOutputSchemaV41,
  parseAiAnalysisDraft,
} from "../../apps/ai-analysis-service/src/execution/ai-analysis-draft.js";
import {
  buildLocalDraftLogicalBlocks,
  LocalDraftBlockProgressStore,
  type LocalDraftBlockProgress,
  type LocalDraftTemplateSection,
} from "../../apps/ai-analysis-service/src/execution/local-draft-block-map.js";
import {
  LocalDraftStages,
  localDraftStages,
  type LocalDraftStage,
} from "../../apps/ai-analysis-service/src/execution/local-draft-stages.js";
import { AiProviderError } from "../../apps/ai-analysis-service/src/execution/ai-text-provider.js";
import { localDraftFixture } from "./local-draft.fixture.js";

const sourceId = "22222222-2222-4222-8222-222222222222";

function templateSections(includesScrum: boolean): LocalDraftTemplateSection[] {
  const definitions = includesScrum
    ? [...DOCUMENT_SECTION_DEFINITIONS, DOCUMENT_SCRUM_SECTION_DEFINITION]
    : [...DOCUMENT_SECTION_DEFINITIONS];

  return definitions.map((section, index) => ({
    key: section.key,
    order: index + 1,
    title: section.title,
  }));
}

function responseFor(
  raw: Record<string, any>,
  stage: LocalDraftStage,
): unknown {
  const plan = stage.path.endsWith(".__plan");
  const path = stage.path.replace(/\.__plan$/u, "");
  const parts = path.replace(/\[(\d+)\]/gu, ".$1").split(".");
  let value: any = raw;

  if (parts[0] === "sections") {
    value = raw.sections.find((section: any) => section.key === parts[1]);
    parts.splice(0, 2);
  }

  for (const part of parts) value = value[part];

  if (plan) {
    const keys = Object.keys((stage.schema.items as any).properties);
    return value.map((item: any) =>
      Object.fromEntries(
        keys.map((key) => [key, item[key] ?? "Elemento de prueba"]),
      ),
    );
  }

  return structuredClone(value);
}

test("el store mantiene estados por solicitud sin persistencia", () => {
  const schema = buildAiAnalysisOutputSchemaV41(true, "LARGE_REQUIREMENT", [
    sourceId,
  ]);
  const blocks = buildLocalDraftLogicalBlocks(
    templateSections(true),
    localDraftStages(schema),
  );
  const store = new LocalDraftBlockProgressStore();
  const requestId = "11111111-1111-4111-8111-111111111111";

  store.initialize(requestId, blocks);

  let state = store.get(requestId);
  assert.equal(state.length, 15);
  assert.ok(state.every((block) => block.status === "PENDING"));

  const block8 = state.find((block) => block.blockNumber === 8);
  assert.ok(block8);

  store.update(requestId, { ...block8, status: "PROCESSING" });
  state = store.get(requestId);
  assert.equal(
    state.find((block) => block.blockNumber === 8)?.status,
    "PROCESSING",
  );

  const block7 = state.find((block) => block.blockNumber === 7);
  assert.ok(block7);
  store.update(requestId, { ...block7, status: "PROCESSING" });

  state = store.get(requestId);
  assert.equal(
    state.find((block) => block.blockNumber === 8)?.status,
    "PENDING",
  );
  assert.equal(
    state.find((block) => block.blockNumber === 7)?.status,
    "PROCESSING",
  );

  store.update(requestId, { ...block7, status: "COMPLETED" });
  assert.equal(
    store.get(requestId).find((block) => block.blockNumber === 7)?.status,
    "COMPLETED",
  );
});

test("LocalDraftStages ejecuta cada punto de plantilla completo antes del siguiente", async () => {
  const raw = await localDraftFixture(true);
  const schema = buildAiAnalysisOutputSchemaV41(true, "LARGE_REQUIREMENT", [
    sourceId,
  ]);
  const stages = localDraftStages(schema);
  const blocks = buildLocalDraftLogicalBlocks(templateSections(true), stages);
  const events: LocalDraftBlockProgress[] = [];
  const stageCalls: string[] = [];

  const result = await new LocalDraftStages(
    schema,
    async (stage) => {
      stageCalls.push(stage.path);
      return responseFor(raw, stage);
    },
    undefined,
    blocks,
    (progress) => events.push(progress),
  ).run();

  assert.deepEqual(result, parseAiAnalysisDraft(raw));

  const expectedBlockOrder = Array.from(
    { length: blocks.length },
    (_, index) => index + 1,
  );
  // Contrato actual: además del evento de entrada del punto, cada etapa interna
  // publica un PROCESSING efímero con `currentStagePath` (diagnóstico visible).
  // La entrada del punto (sin diagnóstico) ocurre una sola vez y en orden.
  const processing = events.filter(
    (event) =>
      event.status === "PROCESSING" && event.currentStagePath === undefined,
  );
  const stageUpdates = events.filter(
    (event) =>
      event.status === "PROCESSING" && event.currentStagePath !== undefined,
  );
  const completed = events.filter((event) => event.status === "COMPLETED");

  assert.deepEqual(
    processing.map((event) => event.blockNumber),
    expectedBlockOrder,
    "Cada punto debe entrar en PROCESSING una sola vez y en el orden de la plantilla.",
  );
  assert.ok(
    stageUpdates.length > 0,
    "las etapas internas publican diagnóstico",
  );
  // Un diagnóstico de etapa se atribuye al punto dueño de esa etapa, que puede
  // diferir del punto en curso (Requerimientos genera internamente la
  // planificación del Esquema). Debe ser siempre un punto válido de la
  // plantilla y una operación conocida.
  for (const event of stageUpdates) {
    assert.ok(
      event.blockNumber >= 1 && event.blockNumber <= blocks.length,
      `El diagnóstico de ${event.currentStagePath} apunta a un punto inexistente.`,
    );
    assert.ok(
      event.operation === "GENERATING" || event.operation === "REPAIRING",
    );
  }
  assert.deepEqual(
    completed.map((event) => event.blockNumber),
    expectedBlockOrder,
    "Cada punto debe validarse y completar su checkpoint antes del siguiente.",
  );

  const backlogIndex = stageCalls.findIndex(
    (path) => path === "structuredAnalysis.backlogStructure",
  );
  const functionalIndex = stageCalls.findIndex((path) =>
    path.startsWith("structuredAnalysis.functionalUserStories["),
  );

  assert.ok(backlogIndex >= 0);
  assert.ok(functionalIndex > backlogIndex);
  assert.ok(
    stageCalls.findIndex((path) => path === "sections.milestones") >
      functionalIndex,
    "Requerimientos debe cerrar después de su planificación interna y sus HU-F.",
  );
});

test("una cancelación activa marca CANCELLED en el bloque que estaba procesándose", async () => {
  const schema = buildAiAnalysisOutputSchemaV41(false, "ERP_FDD", [sourceId]);
  const blocks = buildLocalDraftLogicalBlocks(
    templateSections(false),
    localDraftStages(schema),
  );
  const events: LocalDraftBlockProgress[] = [];

  await assert.rejects(
    new LocalDraftStages(
      schema,
      async (stage) => {
        if (stage.path === "sections.header") {
          throw new AiProviderError("AI_CANCELLED", "Cancelado", false);
        }
        throw new Error(`No debía continuar a ${stage.path}.`);
      },
      undefined,
      blocks,
      (progress) => events.push(progress),
    ).run(),
    (error: unknown) =>
      error instanceof AiProviderError && error.code === "AI_CANCELLED",
  );

  // El diagnóstico de la etapa interna y el cierre del punto reportan el mismo
  // estado más de una vez; lo que importa es la secuencia de estados distintos.
  const transitions = events
    .map((event) => [event.blockNumber, event.status] as const)
    .filter(
      (item, index, all) =>
        index === 0 ||
        item[0] !== all[index - 1]![0] ||
        item[1] !== all[index - 1]![1],
    );
  assert.deepEqual(transitions, [
    [1, "PROCESSING"],
    [1, "CANCELLED"],
  ]);
  assert.ok(
    events.every((event) => event.blockNumber === 1),
    "La cancelación no debe iniciar ningún otro punto.",
  );
  assert.equal(events.at(-1)?.status, "CANCELLED");
});
