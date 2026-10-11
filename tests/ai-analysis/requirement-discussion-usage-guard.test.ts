import assert from "node:assert/strict";
import test from "node:test";

import { HttpException, HttpStatus } from "@nestjs/common";

import type { AiAnalysisActorContext } from "../../apps/ai-analysis-service/src/analysis/ai-analysis.service.js";
import { RequirementDiscussionService } from "../../apps/ai-analysis-service/src/discussion/requirement-discussion.service.js";

function context(): AiAnalysisActorContext {
  return {
    actor: { id: "user-1" } as never,
    accessToken: "token-1",
    correlationId: "corr-1",
  };
}

function projectsAccess() {
  return { requireCreate: async () => undefined } as never;
}

function cloudProviderConfigurations(resolveDefaultCalls: { count: number }) {
  return {
    resolveDefault: async () => {
      resolveDefaultCalls.count += 1;
      return {
        configuration: {
          id: "provider-1",
          model: "gpt-5.4",
          baseUrl: "https://api.openai.com/v1",
          timeoutMs: 5_000,
          maxOutputTokens: 4_000,
          maxInputTokens: 100_000,
          maxAttempts: 1,
        },
        apiKey: "test-secret-never-returned",
      };
    },
  } as never;
}

function request() {
  return {
    engine: "CLOUD" as const,
    answers: [{ questionId: "q1", answer: "Respuesta 1" }],
    conversation: "",
  };
}

test("un presupuesto agotado bloquea la llamada al proveedor y no libera una reserva inexistente", async () => {
  const resolveDefaultCalls = { count: 0 };
  let releaseCalls = 0;
  const usageGuard = {
    reserve: async () => {
      throw new HttpException(
        { code: "AI_BUDGET_EXCEEDED", message: "Presupuesto agotado." },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    },
    release: async () => {
      releaseCalls += 1;
    },
    reconcileActualCost: async () => undefined,
  };

  const service = new RequirementDiscussionService(
    projectsAccess(),
    {} as never,
    cloudProviderConfigurations(resolveDefaultCalls),
    { executionMode: "OPENAI" } as never,
    usageGuard as never,
  );

  await assert.rejects(
    () => service.process(context(), "project-1", request()),
    (error: unknown) => error instanceof HttpException,
  );

  assert.equal(
    resolveDefaultCalls.count,
    0,
    "no debe resolverse el proveedor de nube si la reserva de uso fue rechazada",
  );
  assert.equal(
    releaseCalls,
    0,
    "no debe liberarse una reserva que nunca se concretó",
  );
});

test("una falla de red del proveedor libera la reserva de uso igual", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;

  const resolveDefaultCalls = { count: 0 };
  const reserveCalls: unknown[] = [];
  const releaseCalls: unknown[] = [];
  const usageGuard = {
    reserve: async (input: unknown) => {
      reserveCalls.push(input);
    },
    release: async (input: unknown) => {
      releaseCalls.push(input);
    },
    reconcileActualCost: async () => undefined,
  };

  try {
    const service = new RequirementDiscussionService(
      projectsAccess(),
      {} as never,
      cloudProviderConfigurations(resolveDefaultCalls),
      { executionMode: "OPENAI" } as never,
      usageGuard as never,
    );

    await assert.rejects(() =>
      service.process(context(), "project-1", request()),
    );

    assert.equal(resolveDefaultCalls.count, 1);
    assert.equal(reserveCalls.length, 1);
    assert.equal(
      releaseCalls.length,
      1,
      "la reserva debe liberarse aunque el proveedor falle",
    );
    const reserved = reserveCalls[0] as { requestId: string };
    const released = releaseCalls[0] as { requestId: string };
    assert.equal(released.requestId, reserved.requestId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("una respuesta exitosa reconcilia el costo real por el requestId reservado y libera la reserva", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        output_text: JSON.stringify({
          answers: [{ questionId: "q1", answer: "Respuesta consolidada." }],
        }),
        usage: { input_tokens: 500, output_tokens: 100 },
      }),
      { status: 200 },
    )) as typeof fetch;

  const resolveDefaultCalls = { count: 0 };
  const reserveCalls: unknown[] = [];
  const releaseCalls: unknown[] = [];
  const reconcileCalls: Array<{ requestId: string; actualCostUsd: number }> =
    [];
  const usageGuard = {
    reserve: async (input: unknown) => {
      reserveCalls.push(input);
    },
    release: async (input: unknown) => {
      releaseCalls.push(input);
    },
    reconcileActualCost: async (requestId: string, actualCostUsd: number) => {
      reconcileCalls.push({ requestId, actualCostUsd });
    },
  };

  try {
    const service = new RequirementDiscussionService(
      projectsAccess(),
      {} as never,
      cloudProviderConfigurations(resolveDefaultCalls),
      { executionMode: "OPENAI" } as never,
      usageGuard as never,
    );

    const result = await service.process(context(), "project-1", request());

    assert.equal(result.answers[0]?.answer, "Respuesta consolidada.");
    assert.equal(reserveCalls.length, 1);
    assert.equal(reconcileCalls.length, 1);
    assert.ok(reconcileCalls[0]!.actualCostUsd > 0);
    const reserved = reserveCalls[0] as { requestId: string };
    assert.equal(reconcileCalls[0]!.requestId, reserved.requestId);
    assert.equal(releaseCalls.length, 1);
    assert.equal((releaseCalls[0] as { requestId: string }).requestId, reserved.requestId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
