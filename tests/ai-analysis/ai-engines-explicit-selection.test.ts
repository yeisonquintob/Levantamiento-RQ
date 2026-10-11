import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { BadRequestException } from "@nestjs/common";

import {
  AI_ENGINES_REQUIRED_CODE,
  parseAiAnalysisTokenEstimateRequest,
  parseCreateAiAnalysisRequest,
  requireExplicitAiEngines,
} from "../../apps/ai-analysis-service/src/analysis/ai-analysis-input.js";
import { AiAnalysisService } from "../../apps/ai-analysis-service/src/analysis/ai-analysis.service.js";
import { AiProviderConfigurationEntity } from "../../apps/ai-analysis-service/src/providers/ai-provider-configuration.entity.js";
import { DOCUMENT_SECTION_DEFINITIONS } from "../../libs/shared/contracts/src/index.js";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";

const createBase = {
  documentId: UUID_A,
  documentVersionId: UUID_B,
  sourceIds: [UUID_C],
};
const estimateBase = { documentId: UUID_A, sourceIds: [UUID_C] };

function assertEnginesRequired(action: () => unknown) {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof BadRequestException);
    const response = error.getResponse() as { code: string; message: string };
    assert.equal(response.code, AI_ENGINES_REQUIRED_CODE);
    assert.equal(response.code, "AI_ENGINES_REQUIRED");
    assert.match(response.message, /motor de IA/u);
    return true;
  });
}

test("(a) crear sin engines se rechaza sin activar la nube", () => {
  assertEnginesRequired(() => parseCreateAiAnalysisRequest(createBase));
  assertEnginesRequired(() =>
    parseCreateAiAnalysisRequest({ ...createBase, engines: null }),
  );
});

test("(b) engines vacío se rechaza", () => {
  assertEnginesRequired(() =>
    parseCreateAiAnalysisRequest({ ...createBase, engines: [] }),
  );
  assertEnginesRequired(() =>
    parseAiAnalysisTokenEstimateRequest({ ...estimateBase, engines: [] }),
  );
});

test("(c) estimar sin engines aplica la misma regla compartida", () => {
  assertEnginesRequired(() => parseAiAnalysisTokenEstimateRequest(estimateBase));
  assertEnginesRequired(() => requireExplicitAiEngines(undefined));
});

test("los valores inválidos o duplicados siguen rechazándose con código estable", () => {
  for (const engines of [["OTRO"], ["LOCAL", "LOCAL"], "CLOUD", ["LOCAL", "CLOUD", "LOCAL"]]) {
    assert.throws(
      () => parseCreateAiAnalysisRequest({ ...createBase, engines }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        (error.getResponse() as { code: string }).code === "AI_ENGINES_INVALID",
    );
  }
  assert.deepEqual(
    parseCreateAiAnalysisRequest({ ...createBase, engines: ["LOCAL"] }).engines,
    ["LOCAL"],
  );
  assert.deepEqual(
    parseAiAnalysisTokenEstimateRequest({
      ...estimateBase,
      engines: ["LOCAL", "CLOUD"],
    }).engines,
    ["LOCAL", "CLOUD"],
  );
});

function buildService(providerLookups: Array<Record<string, unknown>>) {
  let dependencyCalls = 0;
  const touched = () => {
    dependencyCalls += 1;
    return undefined;
  };
  const sections = DOCUMENT_SECTION_DEFINITIONS.map((section, index) => ({
    key: section.key,
    title: section.title,
    order: index + 1,
    content: "x",
    templateControlled: false,
  }));
  const dataSource = {
    getRepository: (entity: unknown) => {
      if (entity === AiProviderConfigurationEntity) {
        return {
          findOneBy: async (where: Record<string, unknown>) => {
            providerLookups.push(where);
            return { model: "m", maxInputTokens: 100_000 };
          },
        };
      }
      return { findOneBy: async () => null, find: async () => [] };
    },
  };
  const service = new AiAnalysisService(
    { findOneBy: touched } as never,
    { create: (input: unknown) => input } as never,
    {} as never,
    {} as never,
    dataSource as never,
    { requireCreate: touched } as never,
    {
      requireCurrentVersion: touched,
      requireCurrentDocumentForEstimate: async () => ({
        id: "doc-1",
        projectId: "project-1",
        title: "Doc",
        currentVersionDetail: { id: "v", sections },
        sections,
      }),
    } as never,
    {
      requireReadySources: async () => [
        {
          id: "source-1",
          title: "Fuente",
          classification: "INTERNAL",
          mediaType: "text/plain",
          fileExtension: "TXT",
          sha256: "a".repeat(64),
          extractedText: "texto",
          content: "texto",
          sourceType: "FILE",
        },
      ],
    } as never,
    {} as never,
    { publish: touched } as never,
    {
      enabled: true,
      baseUrl: "http://127.0.0.1:11434",
      model: "local-model-test",
      maxConcurrentJobs: 1,
      timeoutMs: 120_000,
      contextTokens: 16_384,
      maxOutputTokens: 8_192,
      fallbackToRawSources: false,
      maxResponseBytes: 2_097_152,
    } as never,
  );
  return { service, calls: () => dependencyCalls };
}

const context = {
  actor: { id: "user-1" } as never,
  accessToken: "token-1",
  correlationId: "corr-1",
};

test("el servicio rechaza create y estimateTokens sin engines antes de consultar dependencias ni proveedores", async () => {
  const lookups: Array<Record<string, unknown>> = [];
  const { service, calls } = buildService(lookups);
  for (const engines of [undefined, [] as never[]]) {
    await assert.rejects(
      service.create(context, "project-1", {
        analysisType: "REQUIREMENT_DOCUMENT",
        documentId: UUID_A,
        documentVersionId: UUID_B,
        sourceIds: [UUID_C],
        ...(engines ? { engines } : {}),
        idempotencyKey: "k1",
      }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        (error.getResponse() as { code: string }).code === "AI_ENGINES_REQUIRED",
    );
    await assert.rejects(
      service.estimateTokens(context, "project-1", {
        documentId: UUID_A,
        sourceIds: [UUID_C],
        ...(engines ? { engines } : {}),
      }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        (error.getResponse() as { code: string }).code === "AI_ENGINES_REQUIRED",
    );
  }
  assert.equal(calls(), 0);
  assert.deepEqual(lookups, []);
});

test("(d) engines [LOCAL] nunca resuelve un proveedor de nube", async () => {
  const lookups: Array<Record<string, unknown>> = [];
  const { service } = buildService(lookups);
  await service
    .estimateTokens(context, "project-1", {
      documentId: UUID_A,
      sourceIds: [UUID_C],
      engines: ["LOCAL"],
    })
    .catch(() => undefined);
  assert.ok(lookups.length > 0);
  assert.ok(lookups.every((where) => where.providerType === "OLLAMA"));
  assert.ok(!lookups.some((where) => where.providerType === "OPENAI"));

  const cloudLookups: Array<Record<string, unknown>> = [];
  await buildService(cloudLookups)
    .service.estimateTokens(context, "project-1", {
      documentId: UUID_A,
      sourceIds: [UUID_C],
      engines: ["CLOUD"],
    })
    .catch(() => undefined);
  assert.ok(cloudLookups.some((where) => where.providerType === "OPENAI"));
});

test("el código ya no contiene valores predeterminados implícitos de nube", async () => {
  const [service, entity] = await Promise.all([
    readFile("apps/ai-analysis-service/src/analysis/ai-analysis.service.ts", "utf8"),
    readFile("apps/ai-analysis-service/src/analysis/analysis-request.entity.ts", "utf8"),
  ]);
  assert.doesNotMatch(service, /input\.engines\s*\?\s*input\.engines\.includes\("CLOUD"\)\s*:\s*true/u);
  assert.doesNotMatch(service, /input\.engines\s*\?\?\s*\[\s*"CLOUD"\s*\]/u);
  assert.match(service, /requireExplicitAiEngines\(input\.engines\)/u);
  assert.doesNotMatch(entity, /name:\s*"UseCloudAi"[^}]*default:\s*true/u);
});
