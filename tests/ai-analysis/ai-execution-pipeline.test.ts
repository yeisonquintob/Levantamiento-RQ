import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DOCUMENT_SECTION_DEFINITIONS,
  type AiAnalysisDraft,
} from "../../libs/shared/contracts/src/index.js";
import {
  AI_ANALYSIS_OUTPUT_SCHEMA,
  parseAiAnalysisDraft,
} from "../../apps/ai-analysis-service/src/execution/ai-analysis-draft.js";
import { FakeAiProvider } from "../../apps/ai-analysis-service/src/execution/fake-ai.provider.js";
import { OpenAiResponsesProvider } from "../../apps/ai-analysis-service/src/execution/openai-responses.provider.js";
import { loadAiProviderRuntimeConfig } from "../../apps/ai-analysis-service/src/providers/ai-provider.config.js";

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";

function draft(): AiAnalysisDraft {
  return {
    schemaVersion: "1.0.0",
    sections: DOCUMENT_SECTION_DEFINITIONS.map((section) => ({
      key: section.key,
      title: section.title,
      content: `Contenido de ${section.key}`,
    })),
    requirements: [
      {
        clientId: "req-1",
        sectionKey: "milestones",
        code: "RF-001",
        title: "Requisito",
        description: "Descripción verificable",
        requirementType: "FUNCTIONAL",
        acceptanceCriteria: ["Criterio verificable"],
        sourceIds: [SOURCE_ID],
      },
    ],
    pendingQuestions: [],
    contradictions: [],
    warnings: [],
  };
}

test("el contrato de salida exige las 13 secciones en orden", () => {
  assert.equal(parseAiAnalysisDraft(draft()).sections.length, 13);
  const invalid = draft();
  const reversed = { ...invalid, sections: [...invalid.sections].reverse() };
  assert.throws(() => parseAiAnalysisDraft(reversed), /orden canónico/i);
  assert.equal(AI_ANALYSIS_OUTPUT_SCHEMA.properties.sections.minItems, 13);
  assert.equal(AI_ANALYSIS_OUTPUT_SCHEMA.properties.sections.maxItems, 13);
});

test("el proveedor FAKE produce un borrador trazable y determinista", async () => {
  const provider = new FakeAiProvider([
    { id: SOURCE_ID, title: "Entrevista", text: "El usuario registra ventas." },
  ]);
  const result = await provider.generate({
    systemInstruction: "system",
    userPrompt: "prompt",
    schema: AI_ANALYSIS_OUTPUT_SCHEMA,
  });

  assert.equal(result.draft.sections.length, 13);
  assert.deepEqual(result.draft.requirements[0]?.sourceIds, [SOURCE_ID]);
  assert.match(result.draft.warnings[0] ?? "", /FAKE/);
});

test("Responses API usa salida estructurada, no persiste la respuesta y no filtra la clave", async () => {
  const originalFetch = globalThis.fetch;
  let receivedUrl = "";
  let receivedAuthorization = "";
  let receivedBody: Readonly<Record<string, unknown>> = {};
  globalThis.fetch = async (input, init) => {
    receivedUrl = String(input);
    receivedAuthorization = (init?.headers as Record<string, string>)
      .authorization;
    receivedBody = JSON.parse(String(init?.body)) as Readonly<
      Record<string, unknown>
    >;
    return new Response(
      JSON.stringify({
        id: "resp_test",
        output: [
          {
            content: [{ type: "output_text", text: JSON.stringify(draft()) }],
          },
        ],
        usage: { input_tokens: 100, output_tokens: 200 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const provider = new OpenAiResponsesProvider({
      configuration: {
        id: "22222222-2222-4222-8222-222222222222",
        name: "OpenAI",
        providerType: "OPENAI",
        model: "model-enabled-for-test",
        baseUrl: "https://api.openai.com/v1",
        isEnabled: true,
        isDefault: true,
        timeoutMs: 5000,
        maxInputTokens: 120000,
        maxOutputTokens: 12000,
        maxAttempts: 3,
        secretReference: "reference",
        lastConnectionTestAt: new Date(),
        lastConnectionTestStatus: "SUCCEEDED",
        lastErrorCode: null,
        createdByUserId: SOURCE_ID,
        updatedByUserId: SOURCE_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      apiKey: "secret-api-key-for-unit-test",
    });
    const result = await provider.generate({
      systemInstruction: "system",
      userPrompt: "user",
      schema: AI_ANALYSIS_OUTPUT_SCHEMA,
    });

    assert.equal(receivedUrl, "https://api.openai.com/v1/responses");
    assert.equal(receivedAuthorization, "Bearer secret-api-key-for-unit-test");
    assert.equal(receivedBody.store, false);
    assert.equal(result.providerRequestId, "resp_test");
    assert.doesNotMatch(
      JSON.stringify(receivedBody),
      /secret-api-key-for-unit-test/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("el modo FAKE está bloqueado en producción", () => {
  assert.throws(
    () =>
      loadAiProviderRuntimeConfig({
        NODE_ENV: "production",
        AI_EXECUTION_MODE: "FAKE",
      }),
    /no está permitido/i,
  );
});

test("prompt, cola y migración conservan defensa e idempotencia", async () => {
  const [promptBuilder, queue, migration] = await Promise.all([
    readFile(
      "apps/ai-analysis-service/src/execution/ai-prompt-builder.ts",
      "utf8",
    ),
    readFile(
      "apps/ai-analysis-service/src/execution/ai-analysis.queue.ts",
      "utf8",
    ),
    readFile(
      "apps/ai-analysis-service/src/database/migrations/1786579200000-AddAiExecutionPipeline.ts",
      "utf8",
    ),
  ]);

  assert.match(promptBuilder, /dato no confiable/i);
  assert.match(promptBuilder, /nunca una instrucción/i);
  assert.match(queue, /jobId/);
  assert.match(queue, /exponential/);
  assert.match(migration, /AnalysisPromptVersions/);
  assert.match(migration, /AnalysisResults/);
  assert.match(migration, /ISJSON\(ContentJson\)/);
});
