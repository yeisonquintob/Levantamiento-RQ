import assert from "node:assert/strict";
import test from "node:test";

import {
  isPrivateNetworkHost,
  parseOllamaBaseUrl,
  type LocalAiConfig,
} from "../../apps/ai-analysis-service/src/local-ai/ollama.config";
import {
  LocalAiError,
  OllamaClient,
} from "../../apps/ai-analysis-service/src/local-ai/ollama.client";
import { parseCreateAiProviderConfiguration } from "../../apps/ai-analysis-service/src/providers/ai-provider-input";

const config: LocalAiConfig = {
  api: "OPENAI_COMPATIBLE",
  enabled: true,
  baseUrl: "http://192.168.1.129:8080",
  model: "A/gemma-4-31b",
  maxConcurrentJobs: 1,
  timeoutMs: 30000,
  contextTokens: 131072,
  maxOutputTokens: 4096,
  fallbackToRawSources: false,
  maxResponseBytes: 2097152,
};

function mockFetch(
  handler: (url: string, init?: RequestInit) => unknown,
): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) =>
    new Response(JSON.stringify(handler(String(input), init)), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("acepta IP privada, VPN 100.64/10 y .local; rechaza IP pública", () => {
  for (const host of [
    "192.168.1.129",
    "10.0.0.5",
    "100.101.5.9",
    "mac.local",
  ]) {
    assert.equal(isPrivateNetworkHost(host), true, host);
  }
  for (const host of ["8.8.8.8", "100.128.0.1", "100.63.1.1", "example.com"]) {
    assert.equal(isPrivateNetworkHost(host), false, host);
  }
  assert.equal(
    parseOllamaBaseUrl("http://100.101.5.9:8080", false, undefined, true),
    "http://100.101.5.9:8080",
  );
  assert.throws(() =>
    parseOllamaBaseUrl("http://8.8.8.8:8080", false, undefined, true),
  );
});

test("el proveedor OPENAI_COMPATIBLE se registra sin credencial como texto", () => {
  const parsed = parseCreateAiProviderConfiguration({
    name: "Servidor llama-swap",
    providerType: "OPENAI_COMPATIBLE",
    purpose: "TEXT",
    model: "A/gemma-4-31b",
    baseUrl: "http://192.168.1.129:8080",
  });
  assert.equal(parsed.providerType, "OPENAI_COMPATIBLE");
  assert.equal("apiKey" in parsed, false);
  assert.throws(() =>
    parseCreateAiProviderConfiguration({
      name: "Imagen",
      providerType: "OPENAI_COMPATIBLE",
      purpose: "IMAGE",
      model: "x",
      baseUrl: "http://192.168.1.129:8080",
    }),
  );
  assert.throws(() =>
    parseCreateAiProviderConfiguration({
      name: "Pública",
      providerType: "OPENAI_COMPATIBLE",
      purpose: "TEXT",
      model: "x",
      baseUrl: "http://8.8.8.8:8080",
    }),
  );
});

test("health consulta /v1/models y exige el modelo configurado", async () => {
  const urls: string[] = [];
  const restore = mockFetch((url) => {
    urls.push(url);
    return { data: [{ id: "A/gemma-4-31b" }] };
  });
  try {
    await new OllamaClient(config).health();
    assert.deepEqual(urls, ["http://192.168.1.129:8080/v1/models"]);
    await assert.rejects(
      new OllamaClient({ ...config, model: "otro" }).health(),
      (error) =>
        error instanceof LocalAiError &&
        error.code === "OLLAMA_MODEL_NOT_INSTALLED",
    );
  } finally {
    restore();
  }
});

test("generate usa chat/completions con json_schema y devuelve el JSON", async () => {
  let captured: { url: string; body: Record<string, unknown> } | null = null;
  const restore = mockFetch((url, init) => {
    captured = { url, body: JSON.parse(String(init?.body)) };
    return {
      choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 3 },
    };
  });
  try {
    const result = await new OllamaClient(config).generate("hola", {
      type: "object",
    });
    assert.equal(result, '{"ok":true}');
    assert.ok(captured);
    const request = captured as { url: string; body: Record<string, any> };
    assert.equal(request.url, "http://192.168.1.129:8080/v1/chat/completions");
    assert.equal(request.body.model, "A/gemma-4-31b");
    assert.equal(request.body.response_format.type, "json_schema");
    assert.equal(request.body.temperature, 0);
  } finally {
    restore();
  }
});

test("finish_reason length se trata como salida truncada", async () => {
  const restore = mockFetch(() => ({
    choices: [{ finish_reason: "length", message: { content: '{"a":' } }],
  }));
  try {
    await assert.rejects(
      new OllamaClient(config).generate("hola", { type: "object" }),
      (error) =>
        error instanceof LocalAiError &&
        error.code === "OLLAMA_OUTPUT_TRUNCATED",
    );
  } finally {
    restore();
  }
});
