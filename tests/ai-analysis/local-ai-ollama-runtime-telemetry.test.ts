import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { sanitizeAiProviderTrace } from "../../apps/ai-analysis-service/src/execution/ai-provider-trace.js";
import {
  ollamaRuntimeTelemetry,
  OllamaClient,
} from "../../apps/ai-analysis-service/src/local-ai/ollama.client.js";
import { loadLocalAiConfig } from "../../apps/ai-analysis-service/src/local-ai/ollama.config.js";

test("Paso 13: convierte métricas nativas de Ollama", () => {
  const metrics = ollamaRuntimeTelemetry({
    total_duration: 451_465_530_000,
    load_duration: 8_200_000_000,
    prompt_eval_duration: 21_600_000_000,
    eval_duration: 421_100_000_000,
    prompt_eval_count: 640,
    eval_count: 1830,
    message: { content: "DOCUMENTO PRIVADO" },
  });

  assert.deepEqual(metrics, {
    totalDurationMs: 451465.53,
    loadDurationMs: 8200,
    promptEvalDurationMs: 21600,
    evalDurationMs: 421100,
    inputTokens: 640,
    outputTokens: 1830,
    promptTokensPerSecond: 29.63,
    outputTokensPerSecond: 4.35,
  });

  assert.doesNotMatch(JSON.stringify(metrics), /DOCUMENTO PRIVADO/u);
});

test("Paso 13: sanitizador conserva telemetría y descarta contenido", () => {
  const sanitized = sanitizeAiProviderTrace({
    provider: "OLLAMA",
    model: "qwen3.5:9b",
    phase: "OLLAMA_RUNTIME_METRICS_V1",
    totalDurationMs: 451465.53,
    loadDurationMs: 8200,
    promptEvalDurationMs: 21600,
    evalDurationMs: 421100,
    inputTokens: 640,
    outputTokens: 1830,
    promptTokensPerSecond: 29.63,
    outputTokensPerSecond: 4.35,
    effectiveContextTokens: 16384,
    effectiveOutputTokens: 8192,
    structuredFallbackUsed: true,
    prompt: "SECRETO",
    bodyRaw: '{"privado":true}',
  });

  assert.equal(sanitized.totalDurationMs, 451465.53);
  assert.equal(sanitized.loadDurationMs, 8200);
  assert.equal(sanitized.promptEvalDurationMs, 21600);
  assert.equal(sanitized.evalDurationMs, 421100);
  assert.equal(sanitized.inputTokens, 640);
  assert.equal(sanitized.outputTokens, 1830);
  assert.equal(sanitized.promptTokensPerSecond, 29.63);
  assert.equal(sanitized.outputTokensPerSecond, 4.35);
  assert.equal(sanitized.effectiveContextTokens, 16384);
  assert.equal(sanitized.effectiveOutputTokens, 8192);
  assert.equal(sanitized.structuredFallbackUsed, true);

  const serialized = JSON.stringify(sanitized);
  assert.doesNotMatch(serialized, /SECRETO|privado|bodyRaw|prompt"/u);
});

test("Paso 13: generate conserva salida y transporte LOCAL_DOCUMENT", async () => {
  const original = globalThis.fetch;
  let requestedUrl = "";
  let requestBody: Record<string, any> = {};

  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestBody = JSON.parse(String(init?.body ?? "{}"));

    return new Response(
      JSON.stringify({
        model: "qwen3.5:9b",
        message: {
          role: "assistant",
          content: '{"value":{"title":"SOAT"}}',
        },
        done: true,
        done_reason: "stop",
        total_duration: 5_000_000_000,
        load_duration: 100_000_000,
        prompt_eval_duration: 900_000_000,
        eval_duration: 4_000_000_000,
        prompt_eval_count: 90,
        eval_count: 40,
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
        LOCAL_AI_CONTEXT_TOKENS: "300000",
        LOCAL_AI_MAX_OUTPUT_TOKENS: "8192",
      }),
    );

    const result = await client.generate(
      "prompt",
      {
        type: "object",
        properties: {
          value: {
            type: "object",
            properties: { title: { type: "string" } },
            required: ["title"],
          },
        },
        required: ["value"],
      },
      [],
      {},
      undefined,
      { profile: "LOCAL_DOCUMENT" },
    );

    assert.match(requestedUrl, /\/api\/chat$/u);
    assert.equal(requestBody.think, "low");
    assert.equal(requestBody.options?.num_predict, 8192);
    assert.ok(requestBody.options?.num_ctx <= 65536);
    assert.equal(result, '{"value":{"title":"SOAT"}}');
  } finally {
    globalThis.fetch = original;
  }
});

test("Paso 13: emite runtime-metrics sin alterar fallback", async () => {
  const [client, trace] = await Promise.all([
    readFile("apps/ai-analysis-service/src/local-ai/ollama.client.ts", "utf8"),
    readFile(
      "apps/ai-analysis-service/src/execution/ai-provider-trace.ts",
      "utf8",
    ),
  ]);

  assert.match(client, /structuredFallbackUsed = true/u);
  assert.match(client, /"runtime-metrics"/u);
  assert.match(client, /phase: "OLLAMA_RUNTIME_METRICS_V1"/u);
  assert.match(client, /effectiveContextTokens: limits\.contextTokens/u);
  assert.match(client, /effectiveOutputTokens: limits\.outputTokens/u);
  assert.match(client, /OLLAMA_STRUCTURED_GRAMMAR_JSON_FALLBACK/u);

  assert.match(trace, /\| "runtime-metrics"/u);
  assert.match(trace, /"structuredFallbackUsed"/u);
  assert.match(trace, /"outputTokensPerSecond"/u);
});
