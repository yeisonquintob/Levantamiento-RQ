import assert from "node:assert/strict";
import test from "node:test";
import {
  LocalDraftStages,
  type LocalDraftStage,
} from "../../apps/ai-analysis-service/src/execution/local-draft-stages.js";
import { OllamaDraftProvider } from "../../apps/ai-analysis-service/src/execution/ollama-draft.provider.js";
import {
  buildAiAnalysisOutputSchemaV41,
  parseAiAnalysisDraft,
} from "../../apps/ai-analysis-service/src/execution/ai-analysis-draft.js";
import { AiProviderError } from "../../apps/ai-analysis-service/src/execution/ai-text-provider.js";
import { loadLocalAiConfig } from "../../apps/ai-analysis-service/src/local-ai/ollama.config.js";
import { localDraftFixture } from "./local-draft.fixture.js";

const sourceId = "22222222-2222-4222-8222-222222222222";
const schema = buildAiAnalysisOutputSchemaV41(false, "MEDIUM_REQUIREMENT", [
  sourceId,
]);

function responseFor(
  raw: Record<string, any>,
  stage: LocalDraftStage,
): unknown {
  const plan = stage.path.endsWith(".__plan");
  const path = stage.path.replace(/\.__plan$/u, "");
  const parts = path.replace(/\[(\d+)\]/gu, ".$1").split(".");
  let value: any = raw;
  if (parts[0] === "sections") {
    value = raw.sections.find((section: any) => section.key === parts[1]);
    parts.splice(0, 2);
  }
  for (const part of parts) value = value[part];
  if (plan) {
    const keys = Object.keys((stage.schema.items as any).properties);
    return value.map((item: any) =>
      Object.fromEntries(
        keys.map((key) => [key, item[key] ?? "Elemento de prueba"]),
      ),
    );
  }
  return structuredClone(value);
}

test("local ensambla el mismo contrato y conserva evidencias, historias y orden canónico", async () => {
  const raw = await localDraftFixture();
  const calls: string[] = [];
  const result = await new LocalDraftStages(schema, async (stage) => {
    calls.push(stage.path);
    return responseFor(raw, stage);
  }).run();
  assert.deepEqual(result, parseAiAnalysisDraft(raw));
  assert.ok(
    calls.indexOf("structuredAnalysis.backlogStructure") <
      calls.indexOf("structuredAnalysis.functionalUserStories[0]"),
  );
  assert.ok(calls.includes("structuredAnalysis.tests[0]"));
  assert.ok(!calls.includes("structuredAnalysis.functionalUserStories"));
  assert.ok(!calls.includes("structuredAnalysis.scrumPlan"));
});

test("una respuesta inválida reintenta solo el fragmento afectado", async () => {
  const raw = await localDraftFixture();
  const calls = new Map<string, number>();
  await new LocalDraftStages(schema, async (stage, _context, correction) => {
    const count = (calls.get(stage.path) ?? 0) + 1;
    calls.set(stage.path, count);
    if (stage.path === "sections.header" && count === 1) return {};
    if (stage.path === "sections.header") assert.match(correction, /required/u);
    return responseFor(raw, stage);
  }).run();
  assert.equal(calls.get("sections.header"), 2);
  assert.equal(calls.get("sections.objectives"), 1);
});

test("el validador rechaza sourceIds ajenos antes de incorporar la historia", async () => {
  const raw = await localDraftFixture();
  let count = 0;
  await new LocalDraftStages(schema, async (stage) => {
    const result: any = responseFor(raw, stage);
    if (
      stage.path === "structuredAnalysis.functionalUserStories[0]" &&
      ++count === 1
    ) {
      result.sourceIds = ["11111111-1111-4111-8111-111111111111"];
    }
    return result;
  }).run();
  assert.equal(count, 2);
});

test("un error de relación KPI-objetivo regenera alcance sin repetir el resto", async () => {
  const raw = await localDraftFixture();
  const calls = new Map<string, number>();
  const result = await new LocalDraftStages(schema, async (stage) => {
    const count = (calls.get(stage.path) ?? 0) + 1;
    calls.set(stage.path, count);
    const value: any = responseFor(raw, stage);
    if (stage.path === "sections.scope" && count === 1)
      value.content.kpis[0].relatedObjective = "Objetivo completamente ajeno";
    return value;
  }).run();
  assert.deepEqual(result, parseAiAnalysisDraft(raw));
  assert.equal(calls.get("sections.scope"), 2);
  assert.equal(calls.get("structuredAnalysis.backlogStructure"), 1);
});

test("un bloque truncado se divide sin descartar sus campos", async () => {
  const raw = await localDraftFixture();
  const calls: string[] = [];
  const result = await new LocalDraftStages(schema, async (stage) => {
    calls.push(stage.path);
    if (stage.path === "structuredAnalysis.processFlows")
      throw new AiProviderError(
        "OLLAMA_OUTPUT_TRUNCATED",
        "Salida truncada",
        true,
      );
    return responseFor(raw, stage);
  }).run();
  assert.deepEqual(result, parseAiAnalysisDraft(raw));
  assert.ok(calls.includes("structuredAnalysis.processFlows.asIs"));
  assert.ok(calls.includes("structuredAnalysis.processFlows.toBe"));
});

test("los errores semánticos persistentes no producen un borrador aprobado", async () => {
  const raw = await localDraftFixture();
  await assert.rejects(
    new LocalDraftStages(
      schema,
      async (stage) => responseFor(raw, stage),
      () => ["structuredAnalysis.functionalUserStories: evidencia incompleta"],
    ).run(),
    (error: unknown) =>
      error instanceof AiProviderError &&
      error.code === "OLLAMA_DRAFT_INVALID" &&
      !error.retryable,
  );
});

test("cada HU de planificación se documenta individualmente", async () => {
  const raw = await localDraftFixture();
  const planned =
    raw.structuredAnalysis.backlogStructure.epics[0].features[0].userStories;
  planned.push({
    ...structuredClone(planned[0]),
    code: "HU-P-002",
    title: "Consultar mantenimiento",
    functionalRequirementCodes: ["HU-F-002"],
    tasks: [],
  });
  const stories = raw.structuredAnalysis.functionalUserStories;
  stories.push({
    ...structuredClone(stories[0]),
    code: "HU-F-002",
    title: "Consultar mantenimiento",
    acceptanceCriteria: [
      { ...stories[0].acceptanceCriteria[0], code: "CA-F-002-01" },
    ],
  });
  const calls: string[] = [];
  const result = await new LocalDraftStages(schema, async (stage) => {
    calls.push(stage.path);
    return responseFor(raw, stage);
  }).run();
  assert.deepEqual(result, parseAiAnalysisDraft(raw));
  assert.ok(calls.includes("structuredAnalysis.functionalUserStories[1]"));
});

test("Ollama recibe solo fragmentos con contexto compartido y acumula tokens", async () => {
  const raw = await localDraftFixture();
  let calls = 0;
  const provider = new OllamaDraftProvider(loadLocalAiConfig(), {
    async generate(prompt, envelope, _images, trace) {
      calls += 1;
      assert.match(prompt, /EVIDENCIA_ORIGINAL/u);
      assert.match(prompt, /CONTEXTO_COMPARTIDO/u);
      const path = prompt.match(/FRAGMENTO=([^\n]+)/u)![1];
      trace?.onTraceId?.(`trace-${calls}`);
      return JSON.stringify({
        value: responseFor(raw, {
          path,
          schema: (envelope.properties as any).value,
        }),
      });
    },
  });
  const result = await provider.generate({
    systemInstruction: "Reglas",
    userPrompt: "EVIDENCIA_ORIGINAL",
    schema,
  });
  assert.ok(calls > 15);
  assert.equal(result.providerRequestId, `trace-${calls}`);
  assert.ok(result.inputTokens! > 0 && result.outputTokens! > 0);
  assert.deepEqual(result.draft, parseAiAnalysisDraft(raw));
});

test("un contexto excesivo se rechaza antes de llamar a Ollama, sin truncarlo", async () => {
  let calls = 0;
  const provider = new OllamaDraftProvider(loadLocalAiConfig(), {
    async generate() {
      calls += 1;
      return "{}";
    },
  });
  await assert.rejects(
    provider.generate({
      systemInstruction: "Reglas",
      userPrompt: "x".repeat(300000),
      schema,
    }),
    (error: unknown) =>
      error instanceof AiProviderError &&
      error.code === "OLLAMA_STAGE_CONTEXT_EXCEEDED",
  );
  assert.equal(calls, 0);
});

test("cancelar impide continuar con más fragmentos", async () => {
  const raw = await localDraftFixture();
  let calls = 0;
  const provider = new OllamaDraftProvider(
    loadLocalAiConfig(),
    {
      async generate(prompt, envelope) {
        calls += 1;
        const path = prompt.match(/FRAGMENTO=([^\n]+)/u)![1];
        return JSON.stringify({
          value: responseFor(raw, {
            path,
            schema: (envelope.properties as any).value,
          }),
        });
      },
    },
    async () => {
      if (calls === 2)
        throw new AiProviderError("AI_CANCELLED", "Cancelado", false);
    },
  );
  await assert.rejects(
    provider.generate({
      systemInstruction: "Reglas",
      userPrompt: "Evidencia",
      schema,
    }),
    /Cancelado/u,
  );
  assert.equal(calls, 2);
});

test("la truncación real del cliente Ollama divide el bloque aunque no permita repetir la llamada completa", async () => {
  const { LocalAiError } =
    await import("../../apps/ai-analysis-service/src/local-ai/ollama.client.js");
  const raw = await localDraftFixture();
  const calls: string[] = [];
  const provider = new OllamaDraftProvider(loadLocalAiConfig(), {
    async generate(prompt, envelope) {
      const path = prompt.match(/FRAGMENTO=([^\n]+)/u)?.[1];
      assert.ok(path);
      calls.push(path);
      if (path === "structuredAnalysis.processFlows")
        throw new LocalAiError(
          "OLLAMA_OUTPUT_TRUNCATED",
          "JSON truncado",
          false,
        );
      return JSON.stringify({
        value: responseFor(raw, {
          path,
          schema: (envelope.properties as any).value,
        }),
      });
    },
  });
  const result = await provider.generate({
    systemInstruction: "Reglas",
    userPrompt: "Evidencia",
    schema,
  });
  assert.deepEqual(result.draft, parseAiAnalysisDraft(raw));
  assert.equal(
    calls.filter((path) => path === "structuredAnalysis.processFlows").length,
    1,
  );
  assert.ok(calls.includes("structuredAnalysis.processFlows.toBe"));
});

test("la cancelación durante la última respuesta impide devolver el documento", async () => {
  const raw = await localDraftFixture();
  let cancelled = false;
  const provider = new OllamaDraftProvider(
    loadLocalAiConfig(),
    {
      async generate(prompt, envelope) {
        const path = prompt.match(/FRAGMENTO=([^\n]+)/u)?.[1];
        assert.ok(path);
        if (path === "warnings") cancelled = true;
        return JSON.stringify({
          value: responseFor(raw, {
            path,
            schema: (envelope.properties as any).value,
          }),
        });
      },
    },
    async () => {
      if (cancelled)
        throw new AiProviderError("AI_CANCELLED", "Cancelado", false);
    },
  );
  await assert.rejects(
    provider.generate({
      systemInstruction: "Reglas",
      userPrompt: "Evidencia",
      schema,
    }),
    /Cancelado/u,
  );
});

test("la plantilla con Scrum conserva su sección y el plan estructurado", async () => {
  const raw = await localDraftFixture(true);
  const result = await new LocalDraftStages(
    buildAiAnalysisOutputSchemaV41(true),
    async (stage) => responseFor(raw, stage),
  ).run();
  assert.deepEqual(result, parseAiAnalysisDraft(raw));
  assert.equal(result.sections.at(-1)?.key, "scrumPlan");
});

// PASO_0_CANCELACION_OLLAMA_ACTIVA_V1
test("cancelar aborta la inferencia Ollama activa del borrador local", async () => {
  let cancelled = false;
  let observedSignal: AbortSignal | undefined;

  const provider = new OllamaDraftProvider(
    loadLocalAiConfig(),
    {
      async generate(_prompt, _envelope, _images, _trace, cancellationSignal) {
        observedSignal = cancellationSignal;

        await new Promise<never>((_resolve, reject) => {
          if (!cancellationSignal) {
            reject(new Error("La inferencia no recibió AbortSignal."));
            return;
          }

          const rejectAsAborted = () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          };

          if (cancellationSignal.aborted) {
            rejectAsAborted();
            return;
          }

          cancellationSignal.addEventListener("abort", rejectAsAborted, {
            once: true,
          });
        });

        throw new Error(
          "La inferencia simulada no debía finalizar normalmente.",
        );
      },
    },
    async () => {
      if (cancelled) {
        throw new AiProviderError("AI_CANCELLED", "Cancelado", false);
      }
    },
  );

  const pending = provider.generate({
    systemInstruction: "Reglas",
    userPrompt: "Evidencia",
    schema,
  });

  // Primero dejamos que la llamada a Ollama quede activa.
  await new Promise((resolve) => setTimeout(resolve, 50));
  cancelled = true;

  await assert.rejects(
    pending,
    (error: unknown) =>
      error instanceof AiProviderError && error.code === "AI_CANCELLED",
  );

  assert.equal(observedSignal?.aborted, true);
});
