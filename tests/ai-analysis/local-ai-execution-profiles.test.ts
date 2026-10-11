import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { loadLocalAiConfig } from "../../apps/ai-analysis-service/src/local-ai/ollama.config";
import {
  OllamaClient,
  resolveLocalAiExecutionProfile,
} from "../../apps/ai-analysis-service/src/local-ai/ollama.client";

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

test("Paso 5: LOCAL_EXTRACT resuelve CHAT + thinking deshabilitado", () => {
  assert.deepEqual(resolveLocalAiExecutionProfile("LOCAL_EXTRACT"), {
    structuredTransport: "CHAT",
    structuredThinking: "DISABLED",
  });
});

test("Paso 5: LOCAL_DOCUMENT resuelve AUTO + thinking bajo", () => {
  assert.deepEqual(resolveLocalAiExecutionProfile("LOCAL_DOCUMENT"), {
    structuredTransport: "AUTO",
    structuredThinking: "LOW",
  });
});

test("Paso 5: qwen3.5 LOCAL_EXTRACT conserva /api/chat + think:false", async () => {
  const original = globalThis.fetch;
  let requestedUrl = "";
  let requestBody: Record<string, any> = {};

  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;

    return new Response(
      JSON.stringify({
        model: "qwen3.5:9b",
        message: {
          role: "assistant",
          content: '{"value":{"title":"SOAT"}}',
        },
        done: true,
        done_reason: "stop",
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  try {
    const client = new OllamaClient(
      loadLocalAiConfig({
        OLLAMA_MODEL: "qwen3.5:9b",
        LOCAL_AI_TIMEOUT_MS: "1000",
      }),
    );

    await client.generate("extract", schema, [], {}, undefined, {
      profile: "LOCAL_EXTRACT",
    });

    assert.match(requestedUrl, /\/api\/chat$/u);
    assert.equal(requestBody.think, false);
    assert.deepEqual(requestBody.format, schema);
  } finally {
    globalThis.fetch = original;
  }
});

test("Paso 5: qwen3.5 LOCAL_DOCUMENT conserva /api/chat + think low", async () => {
  const original = globalThis.fetch;
  let requestedUrl = "";
  let requestBody: Record<string, any> = {};

  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;

    return new Response(
      JSON.stringify({
        model: "qwen3.5:9b",
        message: {
          role: "assistant",
          content: '{"value":{"title":"SOAT"}}',
        },
        done: true,
        done_reason: "stop",
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  try {
    const client = new OllamaClient(
      loadLocalAiConfig({
        OLLAMA_MODEL: "qwen3.5:9b",
        LOCAL_AI_TIMEOUT_MS: "1000",
      }),
    );

    await client.generate("document", schema, [], {}, undefined, {
      profile: "LOCAL_DOCUMENT",
    });

    assert.match(requestedUrl, /\/api\/chat$/u);
    assert.equal(requestBody.think, "low");
    assert.deepEqual(requestBody.format, schema);
  } finally {
    globalThis.fetch = original;
  }
});

test("Paso 5: LOCAL_DOCUMENT no fuerza chat a modelos que conservan generate", async () => {
  const original = globalThis.fetch;
  let requestedUrl = "";
  let requestBody: Record<string, any> = {};

  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;

    return new Response(
      JSON.stringify({
        model: "gemma4:12b",
        response: '{"value":{"title":"SOAT"}}',
        done: true,
        done_reason: "stop",
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  try {
    const client = new OllamaClient(
      loadLocalAiConfig({
        OLLAMA_MODEL: "gemma4:12b",
        LOCAL_AI_TIMEOUT_MS: "1000",
      }),
    );

    await client.generate("document", schema, [], {}, undefined, {
      profile: "LOCAL_DOCUMENT",
    });

    assert.match(requestedUrl, /\/api\/generate$/u);
    assert.equal(requestBody.think, false);
    assert.deepEqual(requestBody.format, schema);
  } finally {
    globalThis.fetch = original;
  }
});

test("Paso 5: Extract y Document están conectados a flujos distintos", async () => {
  const [execution, analyzer, draftProvider, pipeline, discussion] =
    await Promise.all([
      readFile(
        "apps/ai-analysis-service/src/execution/ai-analysis-execution.service.ts",
        "utf8",
      ),
      readFile(
        "apps/ai-analysis-service/src/local-ai/ollama-source-analyzer.service.ts",
        "utf8",
      ),
      readFile(
        "apps/ai-analysis-service/src/execution/ollama-draft.provider.ts",
        "utf8",
      ),
      readFile(
        "apps/ai-analysis-service/src/local-ai/local-ai-pipeline.service.ts",
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
  assert.match(analyzer, /profile:\s*"LOCAL_EXTRACT"/u);

  const documentProfiles = draftProvider.match(/profile:\s*"LOCAL_DOCUMENT"/gu);
  assert.equal(documentProfiles?.length, 2);

  // La versión de caché del Paso 4 no cambia por este refactor nominal.
  assert.match(
    pipeline,
    /local-only-extract-think-false-v1\+compact-prompt-v1/u,
  );

  // Discusión sigue fuera de los dos perfiles documentales.
  assert.match(discussion, /structuredTransport:\s*"GENERATE"/u);
});

test("Paso 5: límites previamente validados permanecen intactos", async () => {
  const [analyzer, client, draftProvider] = await Promise.all([
    readFile(
      "apps/ai-analysis-service/src/local-ai/ollama-source-analyzer.service.ts",
      "utf8",
    ),
    readFile("apps/ai-analysis-service/src/local-ai/ollama.client.ts", "utf8"),
    readFile(
      "apps/ai-analysis-service/src/execution/ollama-draft.provider.ts",
      "utf8",
    ),
  ]);

  assert.match(analyzer, /LOCAL_SOURCE_CHUNK_CHARACTERS = 8_000/u);
  assert.match(analyzer, /LOCAL_ADAPTIVE_SPLIT_MIN_CHARACTERS = 2_000/u);
  assert.match(analyzer, /LOCAL_ADAPTIVE_SPLIT_MAX_DEPTH = 3/u);
  assert.match(client, /configuredOutputTokens = 8192/u);
  assert.match(client, /OLLAMA_RUNTIME_CONTEXT_CAP = 65_536/u);
  assert.match(draftProvider, /LOCAL_DRAFT_OUTPUT_CAP = 8192/u);
});
