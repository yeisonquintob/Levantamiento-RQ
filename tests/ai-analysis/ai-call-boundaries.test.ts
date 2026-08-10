import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DOCUMENT_SECTION_DEFINITIONS,
  type AiAnalysisDraft,
} from "../../libs/shared/contracts/src/index.js";
import { AiAnalysisExecutionService } from "../../apps/ai-analysis-service/src/execution/ai-analysis-execution.service.js";

function between(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `No se encontró ${start}.`);
  assert.notEqual(endIndex, -1, `No se encontró ${end}.`);
  return source.slice(startIndex, endIndex);
}

test("Web llama IA solo al generar el borrador o una versión IA explícita", async () => {
  const [sources, editor, validation] = await Promise.all([
    readFile(
      "apps/web/src/app/workspace/sources/sources-workspace.tsx",
      "utf8",
    ),
    readFile(
      "apps/web/src/app/workspace/documents/[documentId]/requirement-document-editor.tsx",
      "utf8",
    ),
    readFile(
      "apps/web/src/app/workspace/validation/validation-workspace.tsx",
      "utf8",
    ),
  ]);

  const sourceSelection = between(
    sources,
    "function toggleSourceSelection",
    "function toggleAllEligibleVisible",
  );
  const batchGeneration = between(
    sources,
    "async function processBatch",
    "async function reprocessSource",
  );
  const technicalReprocess = between(
    sources,
    "async function reprocessSource",
    "async function archiveSource",
  );
  const save = between(
    editor,
    "async function saveSection",
    "async function loadVersion",
  );
  const manualVersion = between(
    editor,
    "async function createVersion",
    "async function loadReview",
  );
  const historyAndCompare = between(
    editor,
    "async function openHistory",
    "async function loadAiRequests",
  );
  const aiVersion = between(
    editor,
    "async function createAiVersion",
    "\n\n  return (",
  );

  assert.doesNotMatch(sourceSelection, /analysis-requests/);
  assert.match(batchGeneration, /purpose/);
  assert.match(batchGeneration, /INITIAL_DRAFT/);
  assert.match(batchGeneration, /AI_VERSION/);
  assert.match(batchGeneration, /idempotencyKey: operationKey/);
  assert.doesNotMatch(technicalReprocess, /analysis-requests|\/documents\//);
  assert.doesNotMatch(save, /analysis-requests/);
  assert.doesNotMatch(manualVersion, /analysis-requests/);
  assert.doesNotMatch(historyAndCompare, /analysis-requests/);
  assert.match(aiVersion, /purpose: "AI_VERSION"/);
  assert.match(aiVersion, /idempotencyKey: operationKey/);
  assert.doesNotMatch(validation, /analysis-requests/);
  assert.match(validation, /Esta acción\s+no ejecuta IA/);
});

test("un reintento con resultado persistido no vuelve a resolver ni llamar al proveedor", async () => {
  const requestId = "11111111-1111-4111-8111-111111111111";
  const resultId = "22222222-2222-4222-8222-222222222222";
  const draft: AiAnalysisDraft = {
    schemaVersion: "1.0.0",
    sections: DOCUMENT_SECTION_DEFINITIONS.map((section) => ({
      key: section.key,
      title: section.title,
      content: `Contenido ${section.key}`,
    })),
    requirements: [],
    pendingQuestions: [],
    contradictions: [],
    warnings: [],
  };
  let providerResolutions = 0;
  let applications = 0;
  const transactionUpdates: Array<Readonly<Record<string, unknown>>> = [];

  const service = new AiAnalysisExecutionService(
    {
      findOneBy: async () => ({
        id: requestId,
        projectId: "33333333-3333-4333-8333-333333333333",
        documentId: "44444444-4444-4444-8444-444444444444",
        documentVersionId: "55555555-5555-4555-8555-555555555555",
        generatedVersionNumber: 1,
        purpose: "INITIAL_DRAFT",
        requestedByUserId: "66666666-6666-4666-8666-666666666666",
        status: "FAILED",
      }),
      update: async () => ({ affected: 1 }),
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {
      findOneBy: async () => ({
        id: resultId,
        analysisRequestId: requestId,
        analysisExecutionId: "77777777-7777-4777-8777-777777777777",
        status: "GENERATED",
        contentJson: JSON.stringify(draft),
      }),
    } as never,
    {
      transaction: async (
        work: (manager: {
          update: (
            entity: unknown,
            id: string,
            values: Readonly<Record<string, unknown>>,
          ) => Promise<void>;
        }) => Promise<void>,
      ) =>
        work({
          update: async (_entity, _id, values) => {
            transactionUpdates.push(values);
          },
        }),
    } as never,
    {
      resolveDefault: async () => {
        providerResolutions += 1;
        throw new Error("El proveedor no debe resolverse en este camino.");
      },
    } as never,
    {
      requireCurrentVersion: async () => ({
        currentVersionDetail: { revision: 3, status: "DRAFT" },
      }),
      applyAiDraft: async () => {
        applications += 1;
      },
    } as never,
    { issue: async () => "service-token" } as never,
    { executionMode: "OPENAI" } as never,
    { publish: async () => undefined } as never,
  );

  await service.process(requestId, false, "e2e-recovered-application");

  assert.equal(providerResolutions, 0);
  assert.equal(applications, 1);
  assert.ok(transactionUpdates.some((values) => values.status === "ACCEPTED"));
  assert.ok(transactionUpdates.some((values) => values.status === "COMPLETED"));
});
