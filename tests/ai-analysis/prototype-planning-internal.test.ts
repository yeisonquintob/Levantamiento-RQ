import assert from "node:assert/strict";
import test from "node:test";
import type { PrototypePlan } from "../../libs/shared/contracts/src/lib/prototypes";
import { InternalStructuredExecutionService } from "../../apps/ai-analysis-service/src/internal/internal-structured-execution.service";
import { InternalStructuredExecutionController } from "../../apps/ai-analysis-service/src/internal/internal-structured-execution.controller";

const plan: PrototypePlan = {
  applicationName: "Portal",
  summary: "Consulta",
  targetDevice: "WEB",
  screens: [
    {
      code: "home",
      name: "Inicio",
      objective: "Consultar información",
      origin: "EXPLICIT",
      route: "/",
      components: ["Tabla"],
      order: 1,
    },
  ],
};

test("la ejecución interna usa Structured Output y no devuelve secretos", async () => {
  const originalFetch = globalThis.fetch;
  let outbound: Record<string, unknown> | null = null;
  globalThis.fetch = (async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    outbound = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({ id: "resp-1", output_text: JSON.stringify(plan) }),
      { status: 200 },
    );
  }) as typeof fetch;
  try {
    const providers = {
      resolveDefault: async () => ({
        configuration: {
          id: "provider-1",
          model: "gpt-test",
          baseUrl: "https://api.openai.com/v1",
          timeoutMs: 1000,
          maxOutputTokens: 4000,
          maxAttempts: 1,
        },
        apiKey: "test-secret-never-returned",
      }),
    };
    const audits = {
      create: (value: unknown) => value,
      save: async (value: unknown) => value,
    };
    const service = new InternalStructuredExecutionService(
      providers as never,
      audits as never,
    );
    const result = await service.execute(
      {
        purpose: "PROTOTYPE_PLANNING",
        input: { markdown: "# Portal", targetDevice: "WEB" },
      },
      "corr-1",
    );
    assert.deepEqual(result.structuredResult, plan);
    assert.equal(result.model, "gpt-test");
    assert.equal("apiKey" in result, false);
    assert.equal("secretReference" in result, false);
    assert.equal(
      (outbound?.text as { format?: { type?: string } })?.format?.type,
      "json_schema",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("el endpoint interno rechaza identidades distintas de prototypes-service", () => {
  const controller = new InternalStructuredExecutionController({
    execute: async () => ({}),
  } as never);
  assert.throws(() =>
    controller.execute(
      { headers: {}, serviceIdentity: undefined },
      {
        purpose: "PROTOTYPE_PLANNING",
        input: { markdown: "# RQ", targetDevice: "WEB" },
      },
    ),
  );
});
