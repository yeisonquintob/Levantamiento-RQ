import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildAiAnalysisOutputSchemaV41 } from "../../apps/ai-analysis-service/src/execution/ai-analysis-draft.js";
import {
  buildLocalDraftLogicalBlocks,
  type LocalDraftBlockCheckpointEvent,
  type LocalDraftTemplateSection,
} from "../../apps/ai-analysis-service/src/execution/local-draft-block-map.js";
import {
  LocalDraftStages,
  localDraftStages,
  type LocalDraftStage,
} from "../../apps/ai-analysis-service/src/execution/local-draft-stages.js";
import {
  DOCUMENT_SECTION_DEFINITIONS,
  DOCUMENT_SCRUM_SECTION_DEFINITION,
} from "../../libs/shared/contracts/src/lib/documents.js";
import { localDraftFixture } from "./local-draft.fixture.js";

const sourceId = "22222222-2222-4222-8222-222222222222";

function sections(): LocalDraftTemplateSection[] {
  return [
    ...DOCUMENT_SECTION_DEFINITIONS,
    DOCUMENT_SCRUM_SECTION_DEFINITION,
  ].map((section, index) => ({
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

test("reanudar omite llamadas de los stage paths de un bloque COMPLETED", async () => {
  const raw = await localDraftFixture(true);
  const schema = buildAiAnalysisOutputSchemaV41(true, "LARGE_REQUIREMENT", [
    sourceId,
  ]);
  const stages = localDraftStages(schema);
  const blocks = buildLocalDraftLogicalBlocks(sections(), stages);
  const events: LocalDraftBlockCheckpointEvent[] = [];

  await new LocalDraftStages(
    schema,
    async (stage) => responseFor(raw, stage),
    undefined,
    blocks,
    async (progress) => {
      events.push(progress);
    },
  ).run();

  const checkpoint = events.find(
    (event) =>
      event.blockKey === "milestones" &&
      event.status === "COMPLETED" &&
      event.stageValues &&
      Object.keys(event.stageValues).length > 0,
  );

  assert.ok(checkpoint?.stageValues);
  assert.ok(
    Object.hasOwn(
      checkpoint.stageValues,
      "structuredAnalysis.backlogStructure",
    ),
    "El checkpoint de Requerimientos debe conservar su prerrequisito de planificación.",
  );

  const resumedCalls: string[] = [];
  const result = await new LocalDraftStages(
    schema,
    async (stage) => {
      resumedCalls.push(stage.path);
      return responseFor(raw, stage);
    },
    undefined,
    blocks,
    undefined,
    checkpoint.stageValues,
  ).run();

  for (const stagePath of Object.keys(checkpoint.stageValues)) {
    assert.equal(
      resumedCalls.includes(stagePath),
      false,
      `${stagePath} no debía volver a llamar a Ollama`,
    );
  }

  assert.equal(result.schemaVersion, "4.1.0");
});

test("un valor de checkpoint inválido se ignora y se regenera", async () => {
  const raw = await localDraftFixture(true);
  const schema = buildAiAnalysisOutputSchemaV41(true, "LARGE_REQUIREMENT", [
    sourceId,
  ]);
  const stages = localDraftStages(schema);
  const blocks = buildLocalDraftLogicalBlocks(sections(), stages);

  const calls: string[] = [];
  await new LocalDraftStages(
    schema,
    async (stage) => {
      calls.push(stage.path);
      return responseFor(raw, stage);
    },
    undefined,
    blocks,
    undefined,
    { "sections.header": "__checkpoint_invalido__" },
  ).run();

  assert.ok(calls.includes("sections.header"));
});

test("execution service conserva COMPLETED y resetea únicamente checkpoints no reutilizables", async () => {
  const source = await readFile(
    "apps/ai-analysis-service/src/execution/ai-analysis-execution.service.ts",
    "utf8",
  );

  assert.match(source, /PASO_6_REANUDAR_REINTENTAR_BLOQUE_V1/u);
  assert.match(source, /prepareLocalDraftBlockResume/u);
  assert.match(source, /localDraftBlockPrerequisiteStagePaths/u);
  assert.match(source, /checkpoint\.status === "COMPLETED"/u);
  assert.match(source, /checkpoint\.schemaVersion === "4\.1\.0"/u);
  assert.match(source, /expectedPaths\.every/u);
  assert.match(source, /checkpoint\.status = "PENDING"/u);
  assert.match(source, /checkpoint\.stageValuesJson = null/u);
  assert.match(source, /resumeStageValues/u);
});

test("Paso 6 reutiliza el endpoint retry existente y no altera cancelación", async () => {
  const [controller, service, provider] = await Promise.all([
    readFile(
      "apps/ai-analysis-service/src/analysis/ai-analysis.controller.ts",
      "utf8",
    ),
    readFile(
      "apps/ai-analysis-service/src/analysis/ai-analysis.service.ts",
      "utf8",
    ),
    readFile(
      "apps/ai-analysis-service/src/execution/ollama-draft.provider.ts",
      "utf8",
    ),
  ]);

  assert.match(controller, /analysis-requests\/:analysisRequestId\/retry/u);
  assert.match(service, /Solo una solicitud FAILED puede reintentarse\./u);
  assert.match(provider, /LOCAL_DRAFT_ACTIVE_ABORT_V1/u);
  assert.match(provider, /resumeStageValues/u);
});

test("Fuentes ofrece un reintento compacto únicamente cuando existen bloques locales", async () => {
  const dir = "apps/web/src/app/workspace/sources/";
  const source = (
    await Promise.all(
      ["sources-workspace.tsx", "sources-generation-panel.tsx"].map((file) =>
        readFile(dir + file, "utf8"),
      ),
    )
  ).join("\n");

  assert.match(source, /retryGenerationFromCheckpoint/u);
  assert.match(source, /localDraftBlocks\.length > 0/u);
  assert.match(source, /Reintentar desde checkpoint/u);
  assert.match(source, /Reanudando desde bloques guardados/u);
});
