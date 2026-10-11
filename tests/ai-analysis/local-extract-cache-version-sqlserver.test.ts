import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildLocalExtractPersistentCacheVersion,
  buildLocalPromptCacheVersion,
} from "../../apps/ai-analysis-service/src/local-ai/local-ai-pipeline.service.js";

test("Paso 14.1 V3: PromptVersion LOCAL_EXTRACT cabe en nvarchar(30)", () => {
  const base = buildLocalPromptCacheVersion(
    "Guía extensa de plantilla para requisitos.",
  );
  const logical =
    `${base}+local-only-extract-think-false-v1` +
    "+compact-prompt-v1+compact-output-v1";

  assert.ok(logical.length > 30);

  const persisted = buildLocalExtractPersistentCacheVersion(logical);

  assert.equal(persisted.length, 30);
  assert.match(persisted, /^lex-v1-[0-9a-f]{23}$/u);
});

test("Paso 14.1 V3: misma firma conserva clave y cambios invalidan caché", () => {
  const first = buildLocalExtractPersistentCacheVersion("firma-a");
  const repeated = buildLocalExtractPersistentCacheVersion("firma-a");
  const changed = buildLocalExtractPersistentCacheVersion("firma-b");

  assert.equal(first, repeated);
  assert.notEqual(first, changed);
});

test("Paso 14.1 V3: conserva anclas históricas Paso 4 y Paso 14", async () => {
  const pipeline = await readFile(
    "apps/ai-analysis-service/src/local-ai/local-ai-pipeline.service.ts",
    "utf8",
  );

  assert.match(
    pipeline,
    /LOCAL_EXTRACT"[\s\S]*?compact-prompt-v1\+compact-output-v1/u,
  );

  assert.match(
    pipeline,
    /analysisProfile === "LOCAL_EXTRACT"[\s\S]*?local-only-extract-think-false-v1\+compact-prompt-v1[\s\S]*?: basePromptVersion/u,
  );
});

test("Paso 14.1 V3: BD y migración mantienen nvarchar(30)", async () => {
  const [sourceEntity, snapshotEntity, migration] = await Promise.all([
    readFile(
      "apps/ai-analysis-service/src/local-ai/source-local-analysis.entity.ts",
      "utf8",
    ),
    readFile(
      "apps/ai-analysis-service/src/local-ai/project-knowledge-snapshot.entity.ts",
      "utf8",
    ),
    readFile(
      "apps/ai-analysis-service/src/database/migrations/1787094000000-AddLocalAiKnowledgeCache.ts",
      "utf8",
    ),
  ]);

  assert.match(sourceEntity, /PromptVersion", length: 30/u);
  assert.match(snapshotEntity, /PromptVersion", length: 30/u);
  assert.match(migration, /PromptVersion nvarchar\(30\) NOT NULL/u);
});
