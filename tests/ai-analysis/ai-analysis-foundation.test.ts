import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AI_ANALYSIS_STATUSES,
  AI_ANALYSIS_TYPES,
  AI_PROVIDER_CODES,
} from "../../libs/shared/contracts/src/lib/ai-analysis.js";

test("el contrato publica el alcance aprobado del Paso 18.1A", () => {
  assert.deepEqual(AI_ANALYSIS_TYPES, ["REQUIREMENT_DOCUMENT"]);
  assert.deepEqual(AI_ANALYSIS_STATUSES, [
    "PENDING",
    "PROCESSING",
    "COMPLETED",
    "FAILED",
    "CANCELLED",
  ]);
  assert.deepEqual(AI_PROVIDER_CODES, ["DISABLED", "OPENAI", "FAKE"]);
});

test("RqAiDb contiene tres tablas y solo relaciones internas", async () => {
  const migration = await readFile(
    "apps/ai-analysis-service/src/database/migrations/1786320000000-CreateAiAnalysisFoundation.ts",
    "utf8",
  );

  for (const table of [
    "AnalysisRequests",
    "AnalysisRequestSources",
    "AnalysisExecutions",
  ]) {
    assert.match(migration, new RegExp(`dbo\\.${table}`));
  }

  assert.match(migration, /FK_AnalysisRequestSources_Request/);
  assert.match(migration, /FK_AnalysisExecutions_Request/);
  assert.match(migration, /ON DELETE CASCADE/);
  assert.doesNotMatch(
    migration,
    /RqProjectsDb|RqDocumentsDb|RqSourcesDb|RqIdentityDb/,
  );
});

test("las restricciones protegen estados, intentos y trazabilidad", async () => {
  const migration = await readFile(
    "apps/ai-analysis-service/src/database/migrations/1786320000000-CreateAiAnalysisFoundation.ts",
    "utf8",
  );

  assert.match(migration, /CK_AnalysisRequests_AnalysisType/);
  assert.match(migration, /CK_AnalysisRequests_Status/);
  assert.match(migration, /CK_AnalysisRequestSources_Position/);
  assert.match(migration, /UQ_AnalysisRequestSources_Request_Source/);
  assert.match(migration, /CK_AnalysisExecutions_Attempt/);
  assert.match(migration, /CK_AnalysisExecutions_Provider/);
  assert.match(migration, /UQ_AnalysisExecutions_Request_Attempt/);
  assert.match(migration, /SourceUpdatedAt/);
  assert.match(migration, /SourceSha256/);
});

test("TypeORM registra las tres entidades solo con persistencia habilitada", async () => {
  const moduleFile = await readFile(
    "apps/ai-analysis-service/src/app/app.module.ts",
    "utf8",
  );
  const requestEntity = await readFile(
    "apps/ai-analysis-service/src/analysis/analysis-request.entity.ts",
    "utf8",
  );
  const sourceEntity = await readFile(
    "apps/ai-analysis-service/src/analysis/analysis-request-source.entity.ts",
    "utf8",
  );
  const executionEntity = await readFile(
    "apps/ai-analysis-service/src/analysis/analysis-execution.entity.ts",
    "utf8",
  );

  assert.match(moduleFile, /TypeOrmModule\.forFeature\(aiAnalysisEntities\)/);
  assert.match(moduleFile, /databaseConfig\.enabled/);
  assert.match(requestEntity, /@Entity\(\{ name: "AnalysisRequests" \}\)/);
  assert.match(sourceEntity, /@Entity\(\{ name: "AnalysisRequestSources" \}\)/);
  assert.match(executionEntity, /@Entity\(\{ name: "AnalysisExecutions" \}\)/);
});

test("la integración no acopla el dominio al SDK de un proveedor", async () => {
  const packageFile = await readFile(
    "apps/ai-analysis-service/package.json",
    "utf8",
  );
  const moduleFile = await readFile(
    "apps/ai-analysis-service/src/app/app.module.ts",
    "utf8",
  );

  assert.doesNotMatch(packageFile, /"openai"/i);
  assert.match(moduleFile, /AiAnalysisController/);
  assert.match(moduleFile, /AI_SECRET_VAULT/);
  assert.doesNotMatch(moduleFile, /ChatCompletion|AzureOpenAI|Responses API/);
});
