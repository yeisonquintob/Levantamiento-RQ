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
        currentVersionDetail: {
          revision: 3,
          status: "DRAFT",
          sections: DOCUMENT_SECTION_DEFINITIONS.map((section, index) => ({
            key: section.key,
            title: section.title,
            order: index + 1,
            content: `Contenido ${section.key}`,
            templateControlled: index >= 10,
          })),
        },
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

function fakeQueryBuilder(claimAffected: number) {
  return {
    update: () => ({
      set: () => ({
        where: () => ({
          andWhere: () => ({
            execute: async () => ({ affected: claimAffected }),
          }),
        }),
      }),
    }),
  };
}

function fakePromptsRepository() {
  return {
    findOneBy: async () => ({
      id: "prompt-1",
      code: "REQUIREMENT_DOCUMENT",
      isActive: true,
      systemInstruction: "Instrucción de prueba.",
    }),
  };
}

function fakeExecutionsRepository() {
  return {
    find: async () => [],
    create: (input: unknown) => input,
    save: async () => undefined,
    update: async () => undefined,
  };
}

function fakeRequestsRepository(request: unknown, claimAffected: number) {
  return {
    findOneBy: async () => request,
    createQueryBuilder: () => fakeQueryBuilder(claimAffected),
  };
}

function buildGenerationRequest(requestId: string) {
  const sections = DOCUMENT_SECTION_DEFINITIONS.map((section, index) => ({
    key: section.key,
    title: section.title,
    order: index + 1,
    content: `Contenido ${section.key}`,
    templateControlled: false,
  }));
  return {
    id: requestId,
    projectId: "33333333-3333-4333-8333-333333333333",
    documentId: "44444444-4444-4444-8444-444444444444",
    documentVersionId: "55555555-5555-4555-8555-555555555555",
    generatedVersionNumber: 1,
    generatedVersion: "v1",
    purpose: "INITIAL_DRAFT",
    instruction: null,
    useLocalAi: false,
    useCloudAi: true,
    providerSelectionsJson: null,
    requestedByUserId: "66666666-6666-4666-8666-666666666666",
    status: "PENDING",
    documentSnapshotJson: JSON.stringify({
      template: { id: "t1", version: 1, templateType: "MEDIUM_REQUIREMENT" },
      currentVersionDetail: {
        revision: 1,
        status: "DRAFT",
        sections,
        evidence: [],
      },
    }),
  };
}

test("cancelar durante la generación evita aplicar el resultado al documento", async () => {
  const requestId = "11111111-1111-4111-8111-111111111111";
  const request = buildGenerationRequest(requestId);
  const events: string[] = [];
  let applyAiDraftCalls = 0;
  let requireCurrentVersionCalls = 0;

  const service = new AiAnalysisExecutionService(
    fakeRequestsRepository(request, 1) as never,
    { find: async () => [] } as never,
    fakeExecutionsRepository() as never,
    fakePromptsRepository() as never,
    {
      findOneBy: async () => undefined,
      findOneByOrFail: async () => {
        throw new Error("No debe consultarse un resultado tras cancelar.");
      },
    } as never,
    {
      transaction: async (
        work: (manager: {
          save: (...args: unknown[]) => Promise<void>;
          create: (entity: unknown, input: unknown) => unknown;
          update: (...args: unknown[]) => Promise<void>;
          createQueryBuilder: () => ReturnType<typeof fakeQueryBuilder>;
        }) => Promise<void>,
      ) =>
        work({
          save: async () => undefined,
          create: (_entity, input) => input,
          update: async () => undefined,
          // Simula que cancel() ya marcó CANCELLED antes de este update.
          createQueryBuilder: () => fakeQueryBuilder(0),
        }),
    } as never,
    {} as never,
    {
      requireCurrentVersion: async () => {
        requireCurrentVersionCalls += 1;
        throw new Error("No debe aplicarse un resultado tras cancelar.");
      },
      applyAiDraft: async () => {
        applyAiDraftCalls += 1;
      },
    } as never,
    { issue: async () => "service-token" } as never,
    { executionMode: "FAKE" } as never,
    {
      publish: async ({ eventName }: { eventName: string }) => {
        events.push(eventName);
      },
    } as never,
  );

  await service.process(requestId, false, "cancel-race-test");

  assert.equal(requireCurrentVersionCalls, 0);
  assert.equal(applyAiDraftCalls, 0);
  assert.ok(events.includes("analysis.started"));
  assert.ok(!events.includes("analysis.completed"));
});

test("sin cancelación concurrente, la generación se aplica normalmente", async () => {
  const requestId = "11111111-1111-4111-8111-111111111112";
  const request = buildGenerationRequest(requestId);
  const events: string[] = [];
  let applyAiDraftCalls = 0;
  let capturedResult: Readonly<Record<string, unknown>> | null = null;

  const service = new AiAnalysisExecutionService(
    fakeRequestsRepository(request, 1) as never,
    { find: async () => [] } as never,
    fakeExecutionsRepository() as never,
    fakePromptsRepository() as never,
    {
      findOneBy: async () => undefined,
      findOneByOrFail: async () => capturedResult,
    } as never,
    {
      transaction: async (
        work: (manager: {
          save: (...args: unknown[]) => Promise<void>;
          create: (entity: unknown, input: unknown) => unknown;
          update: (...args: unknown[]) => Promise<void>;
          createQueryBuilder: () => ReturnType<typeof fakeQueryBuilder>;
        }) => Promise<void>,
      ) =>
        work({
          save: async (input: unknown) => {
            capturedResult = input as Readonly<Record<string, unknown>>;
          },
          create: (_entity, input) => input,
          update: async () => undefined,
          createQueryBuilder: () => fakeQueryBuilder(1),
        }),
    } as never,
    {} as never,
    {
      requireCurrentVersion: async () => ({
        currentVersionDetail: {
          revision: 1,
          status: "DRAFT",
          sections: DOCUMENT_SECTION_DEFINITIONS.map((section, index) => ({
            key: section.key,
            title: section.title,
            order: index + 1,
            content: `Contenido ${section.key}`,
            templateControlled: index >= 10,
          })),
        },
      }),
      applyAiDraft: async () => {
        applyAiDraftCalls += 1;
      },
    } as never,
    { issue: async () => "service-token" } as never,
    { executionMode: "FAKE" } as never,
    {
      publish: async ({ eventName }: { eventName: string }) => {
        events.push(eventName);
      },
    } as never,
  );

  await service.process(requestId, false, "no-cancel-race-test");

  assert.equal(applyAiDraftCalls, 1);
  assert.ok(events.includes("analysis.completed"));
});
