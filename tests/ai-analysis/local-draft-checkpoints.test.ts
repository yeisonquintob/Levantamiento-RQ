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

test("un bloque COMPLETED entrega los valores necesarios para un checkpoint", async () => {
  const raw = await localDraftFixture(true);
  const schema = buildAiAnalysisOutputSchemaV41(true, "LARGE_REQUIREMENT", [
    sourceId,
  ]);
  const blocks = buildLocalDraftLogicalBlocks(
    sections(),
    localDraftStages(schema),
  );
  const events: LocalDraftBlockCheckpointEvent[] = [];

  await new LocalDraftStages(
    schema,
    async (stage) => responseFor(raw, stage),
    undefined,
    blocks,
    async (progress) => {
      await Promise.resolve();
      events.push(progress);
    },
  ).run();

  const requirements = events.find(
    (event) => event.blockKey === "milestones" && event.status === "COMPLETED",
  );

  assert.ok(requirements);
  assert.ok(requirements.stageValues);
  assert.ok(
    "structuredAnalysis.functionalUserStories" in requirements.stageValues,
  );
  assert.ok("requirements" in requirements.stageValues);
  assert.ok("sections.milestones" in requirements.stageValues);
});

test("la migración crea checkpoints por AnalysisRequest con borrado en cascada", async () => {
  const migration = await readFile(
    "apps/ai-analysis-service/src/database/migrations/1789441200000-CreateLocalDraftBlockCheckpoints.ts",
    "utf8",
  );

  assert.match(migration, /CREATE TABLE dbo\.LocalDraftBlockCheckpoints/u);
  assert.match(migration, /AnalysisRequestId uniqueidentifier NOT NULL/u);
  assert.match(migration, /UNIQUE \(AnalysisRequestId, BlockKey\)/u);
  assert.match(migration, /REFERENCES dbo\.AnalysisRequests\(Id\)/u);
  assert.match(migration, /ON DELETE CASCADE/u);
  assert.match(migration, /StageValuesJson nvarchar\(max\) NULL/u);
});

test("el backend persiste sin resetear checkpoints existentes", async () => {
  const source = await readFile(
    "apps/ai-analysis-service/src/execution/ai-analysis-execution.service.ts",
    "utf8",
  );

  assert.match(source, /PASO_5_CHECKPOINTS_PERSISTENTES_V1/u);
  assert.match(source, /initializeLocalDraftBlockCheckpoints/u);
  assert.match(source, /existingKeys/u);
  assert.match(
    source,
    /filter\(\(block\) => !existingKeys\.has\(block\.blockKey\)\)/u,
  );
  assert.match(source, /persistLocalDraftBlockCheckpoint/u);
  assert.match(source, /JSON\.stringify\(progress\.stageValues \?\? \{\}\)/u);
});

test("Paso 6 reutiliza checkpoints sin cambiar el contrato persistente del Paso 5", async () => {
  const stages = await readFile(
    "apps/ai-analysis-service/src/execution/local-draft-stages.ts",
    "utf8",
  );

  assert.match(stages, /PASO_6_REANUDAR_REINTENTAR_BLOQUE_V1/u);
  assert.match(stages, /resumeStageValues/u);
  assert.match(stages, /if \(this\.values\.has\(stage\.path\)\) continue/u);
});

test("la API puede recuperar progreso persistido si la memoria está vacía", async () => {
  const [execution, service] = await Promise.all([
    readFile(
      "apps/ai-analysis-service/src/execution/ai-analysis-execution.service.ts",
      "utf8",
    ),
    readFile(
      "apps/ai-analysis-service/src/analysis/ai-analysis.service.ts",
      "utf8",
    ),
  ]);

  assert.match(execution, /if \(inMemory\.length > 0/u);
  assert.match(
    execution,
    /localDraftBlockCheckpoints\.find\([\s\S]*?blockNumber: "ASC"/u,
  );
  assert.match(
    service,
    /await this\.executionService\.getLocalDraftBlockProgress/u,
  );
});
