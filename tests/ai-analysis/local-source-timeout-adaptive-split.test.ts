import assert from "node:assert/strict";
import test from "node:test";

import type { OllamaClient } from "../../apps/ai-analysis-service/src/local-ai/ollama.client.js";
import { LocalAiError } from "../../apps/ai-analysis-service/src/local-ai/ollama.client.js";
import { OllamaSourceAnalyzerService } from "../../apps/ai-analysis-service/src/local-ai/ollama-source-analyzer.service.js";
import {
  LOCAL_AI_CATEGORIES,
  LOCAL_AI_SCHEMA_VERSION,
} from "../../apps/ai-analysis-service/src/local-ai/local-ai-output.js";

function validPayload(sourceId: string): string {
  return JSON.stringify({
    schemaVersion: LOCAL_AI_SCHEMA_VERSION,
    sourceId,
    summary: "Segmento procesado.",
    ...Object.fromEntries(
      LOCAL_AI_CATEGORIES.map((category) => [category, []]),
    ),
  });
}

test("OLLAMA_TIMEOUT divide adaptativamente solo el segmento afectado y luego lo fusiona", async () => {
  const sourceId = "11111111-1111-4111-8111-111111111111";
  let calls = 0;

  const client = {
    async generate() {
      calls += 1;

      if (calls === 1) {
        throw new LocalAiError(
          "OLLAMA_TIMEOUT",
          "Ollama excedió el tiempo límite.",
          true,
        );
      }

      return validPayload(sourceId);
    },
  } as unknown as OllamaClient;

  const analyzer = new OllamaSourceAnalyzerService(client);

  const result = await analyzer.analyze({
    sourceId,
    title: "Fuente con timeout recuperable",
    classification: "OTHER",
    text: "x".repeat(4_000),
  });

  // 1 llamada original que vence + 2 subsegmentos de ~2.000.
  assert.equal(calls, 3);
  assert.equal(result.sourceId, sourceId);
  assert.equal(result.schemaVersion, LOCAL_AI_SCHEMA_VERSION);
});

test("OLLAMA_TIMEOUT no divide indefinidamente cuando el segmento ya está en el mínimo", async () => {
  const sourceId = "22222222-2222-4222-8222-222222222222";
  let calls = 0;

  const client = {
    async generate() {
      calls += 1;
      throw new LocalAiError(
        "OLLAMA_TIMEOUT",
        "Ollama excedió el tiempo límite.",
        true,
      );
    },
  } as unknown as OllamaClient;

  const analyzer = new OllamaSourceAnalyzerService(client);

  await assert.rejects(
    analyzer.analyze({
      sourceId,
      title: "Fuente en mínimo",
      classification: "OTHER",
      text: "x".repeat(2_000),
    }),
    (error: unknown) =>
      error instanceof LocalAiError && error.code === "OLLAMA_TIMEOUT",
  );

  assert.equal(
    calls,
    1,
    "Un segmento en el mínimo de 2.000 no debe seguir dividiéndose.",
  );
});
