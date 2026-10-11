import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { loadLocalAiConfig } from "../../apps/ai-analysis-service/src/local-ai/ollama.config";
import { OllamaClient } from "../../apps/ai-analysis-service/src/local-ai/ollama.client";

const schema = {
  type: "object",
  properties: {
    value: {
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
    },
  },
  required: ["value"],
};

function chatResponse(): Response {
  return new Response(
    JSON.stringify({
      model: "qwen3.5:9b",
      message: {
        role: "assistant",
        content: '{"value":{"title":"SOAT"}}',
      },
      done: true,
      done_reason: "stop",
      prompt_eval_count: 100,
      eval_count: 20,
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}

test("Paso 3: LOCAL_ONLY puede usar /api/chat + think:false por opt-in", async () => {
  const original = globalThis.fetch;
  let requestedUrl = "";
  let requestBody: Record<string, any> = {};

  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
    return chatResponse();
  };

  try {
    const client = new OllamaClient(
      loadLocalAiConfig({
        OLLAMA_MODEL: "qwen3.5:9b",
        LOCAL_AI_TIMEOUT_MS: "1000",
      }),
    );

    await client.generate("preanalisis local only", schema, [], {}, undefined, {
      profile: "LOCAL_EXTRACT",
    });

    assert.match(requestedUrl, /\/api\/chat$/u);
    assert.equal(requestBody.think, false);
    assert.deepEqual(requestBody.format, schema);
    assert.equal(requestBody.messages?.[0]?.content, "preanalisis local only");
  } finally {
    globalThis.fetch = original;
  }
});

test("Paso 3: el comportamiento por defecto de qwen3.5 sigue en think low", async () => {
  const original = globalThis.fetch;
  let requestedUrl = "";
  let requestBody: Record<string, any> = {};

  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
    return chatResponse();
  };

  try {
    const client = new OllamaClient(
      loadLocalAiConfig({
        OLLAMA_MODEL: "qwen3.5:9b",
        LOCAL_AI_TIMEOUT_MS: "1000",
      }),
    );

    await client.generate("documental o hibrido", schema);

    assert.match(requestedUrl, /\/api\/chat$/u);
    assert.equal(requestBody.think, "low");
    assert.deepEqual(requestBody.format, schema);
  } finally {
    globalThis.fetch = original;
  }
});

test("Paso 3: el perfil se activa solo para LOCAL_ONLY y separa cache", async () => {
  const [execution, pipeline, queue, analyzer, client, discussion] =
    await Promise.all([
      readFile(
        "apps/ai-analysis-service/src/execution/ai-analysis-execution.service.ts",
        "utf8",
      ),
      readFile(
        "apps/ai-analysis-service/src/local-ai/local-ai-pipeline.service.ts",
        "utf8",
      ),
      readFile(
        "apps/ai-analysis-service/src/local-ai/local-source-analysis.queue.ts",
        "utf8",
      ),
      readFile(
        "apps/ai-analysis-service/src/local-ai/ollama-source-analyzer.service.ts",
        "utf8",
      ),
      readFile(
        "apps/ai-analysis-service/src/local-ai/ollama.client.ts",
        "utf8",
      ),
      readFile(
        "apps/ai-analysis-service/src/discussion/requirement-discussion.service.ts",
        "utf8",
      ),
    ]);

  assert.match(
    execution,
    /generationMode === "LOCAL_ONLY"[\s\S]*?"LOCAL_EXTRACT"[\s\S]*?: "DEFAULT"/u,
  );
  assert.match(pipeline, /local-only-extract-think-false-v1/u);
  assert.match(pipeline, /analysisProfile/u);
  assert.match(queue, /LocalSourceAnalysisProfile/u);
  assert.match(analyzer, /profile:\s*"LOCAL_EXTRACT"/u);
  assert.match(
    client,
    /profile === "LOCAL_EXTRACT"[\s\S]*?structuredTransport: "CHAT"[\s\S]*?structuredThinking: "DISABLED"/u,
  );
  assert.match(
    client,
    /structuredThinking === "DISABLED" \? false : \("low" as const\)/u,
  );
  assert.match(discussion, /structuredTransport:\s*"GENERATE"/u);
});

test("Paso 3: la frontera de proveedores de los tres modos sigue presente", async () => {
  const source = await readFile(
    "apps/ai-analysis-service/src/execution/ai-analysis-execution.service.ts",
    "utf8",
  );

  const guardIndex = source.indexOf("assertAiDocumentGenerationBoundary({");
  const providerIndex = source.indexOf(
    "const generated = await provider.generate({",
  );

  assert.ok(guardIndex >= 0);
  assert.ok(providerIndex > guardIndex);
});

test("Híbrido: la IA local compacta con el perfil compacto en ejecución y en el estimado", async () => {
  const [execution, analysis] = await Promise.all([
    readFile(
      "apps/ai-analysis-service/src/execution/ai-analysis-execution.service.ts",
      "utf8",
    ),
    readFile(
      "apps/ai-analysis-service/src/analysis/ai-analysis.service.ts",
      "utf8",
    ),
  ]);
  assert.match(
    execution,
    /generationMode === "LOCAL_ONLY" \|\| generationMode === "LOCAL_CLOUD"\s*\?\s*"LOCAL_EXTRACT"\s*:\s*"DEFAULT"/u,
  );
  assert.match(
    analysis,
    /requestedEngines\.includes\("LOCAL"\)\s*\?\s*"LOCAL_EXTRACT"\s*:\s*"DEFAULT"/u,
  );
});

test("el prompt de nube del modo Híbrido sigue construyéndose sobre el prompt estándar de snapshot", async () => {
  const pipeline = await readFile(
    "apps/ai-analysis-service/src/local-ai/local-ai-pipeline.service.ts",
    "utf8",
  );
  const hybrid = /export function buildHybridCloudPromptFromKnowledgeSnapshot\([\s\S]*?\n\}\n/u.exec(
    pipeline,
  )?.[0];
  assert.ok(hybrid, "debe existir el constructor del prompt Híbrido");
  // El Híbrido parte del prompt estándar y solo sustituye el snapshot por su
  // versión compacta; no redefine el contrato del prompt de nube.
  assert.match(
    hybrid,
    /const fullPrompt = buildAiAnalysisPromptFromKnowledgeSnapshot\(/u,
  );
  // Falla cerrado si no puede sustituir el snapshot de forma segura.
  assert.match(hybrid, /LOCAL_CLOUD_SNAPSHOT_PROMPT_INVALID/u);
});
