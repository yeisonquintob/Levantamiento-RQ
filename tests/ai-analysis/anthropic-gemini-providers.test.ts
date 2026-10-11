import assert from "node:assert/strict";
import test from "node:test";

import type { AuthenticatedUser } from "../../libs/shared/contracts/src/index.js";
import type { AiAnalysisActorContext } from "../../apps/ai-analysis-service/src/analysis/ai-analysis.service.js";
import { RequirementDiscussionService } from "../../apps/ai-analysis-service/src/discussion/requirement-discussion.service.js";
import { assertAiDocumentGenerationBoundary } from "../../apps/ai-analysis-service/src/execution/ai-document-generation-mode.js";
import { AiProviderError } from "../../apps/ai-analysis-service/src/execution/ai-text-provider.js";
import { AnthropicMessagesProvider } from "../../apps/ai-analysis-service/src/execution/anthropic-messages.provider.js";
import { createCloudTextProvider } from "../../apps/ai-analysis-service/src/execution/cloud-text-provider.js";
import { FakeAiProvider } from "../../apps/ai-analysis-service/src/execution/fake-ai.provider.js";
import { GeminiGenerateContentProvider } from "../../apps/ai-analysis-service/src/execution/gemini-generate-content.provider.js";
import { OpenAiCompatibleCloudProvider } from "../../apps/ai-analysis-service/src/execution/openai-compatible-cloud.provider.js";
import { OpenAiResponsesProvider } from "../../apps/ai-analysis-service/src/execution/openai-responses.provider.js";
import { AiProviderConfigurationEntity } from "../../apps/ai-analysis-service/src/providers/ai-provider-configuration.entity.js";
import { AiProviderConfigurationsService } from "../../apps/ai-analysis-service/src/providers/ai-provider-configurations.service.js";
import {
  ANTHROPIC_BASE_URL,
  CEREBRAS_BASE_URL,
  GEMINI_BASE_URL,
  GROQ_BASE_URL,
  parseCreateAiProviderConfiguration,
  parseDuplicateAiProviderConfiguration,
} from "../../apps/ai-analysis-service/src/providers/ai-provider-input.js";
import { MemoryAiSecretVault } from "../../apps/ai-analysis-service/src/providers/ai-secret-vault.js";
import { resolveSelectedProvider } from "../../apps/ai-analysis-service/src/providers/provider-selection.js";

const SECRET = "sk-test-secret-value-never-exposed";
const ADMIN: AuthenticatedUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "admin@example.invalid",
  displayName: "Admin",
  roles: ["ADMIN"],
  permissions: ["system.admin"],
  mustChangePassword: false,
};

interface Captured {
  url: string;
  init: RequestInit;
}

function mockFetch(respond: (call: Captured) => Response | Promise<Response>): {
  calls: Captured[];
  restore: () => void;
} {
  const original = globalThis.fetch;
  const calls: Captured[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function json(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

function entity(
  providerType: "ANTHROPIC" | "GEMINI" | "OPENAI" | "GROQ" | "CEREBRAS",
  overrides: Partial<AiProviderConfigurationEntity> = {},
): AiProviderConfigurationEntity {
  const now = new Date("2026-10-01T12:00:00.000Z");
  return {
    id: "22222222-2222-4222-8222-222222222222",
    name: `Proveedor ${providerType}`,
    providerType,
    purpose: "TEXT",
    model:
      providerType === "GEMINI" ? "gemini-test-model" : "claude-test-model",
    baseUrl:
      providerType === "ANTHROPIC"
        ? ANTHROPIC_BASE_URL
        : providerType === "GEMINI"
          ? GEMINI_BASE_URL
          : providerType === "GROQ"
            ? GROQ_BASE_URL
            : providerType === "CEREBRAS"
              ? CEREBRAS_BASE_URL
              : "https://api.openai.com/v1",
    isEnabled: true,
    isDefault: false,
    timeoutMs: 30_000,
    maxInputTokens: 100_000,
    maxOutputTokens: 4_000,
    maxAttempts: 2,
    secretReference: "provider-test",
    lastConnectionTestAt: null,
    lastConnectionTestStatus: "NOT_TESTED",
    lastErrorCode: null,
    createdByUserId: ADMIN.id,
    updatedByUserId: ADMIN.id,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as AiProviderConfigurationEntity;
}

async function fakeDraftJson(): Promise<string> {
  const generated = await new FakeAiProvider([
    {
      id: "66666666-6666-4666-8666-666666666666",
      title: "Fuente",
      text: "Contenido de prueba",
    },
  ]).generate({
    systemInstruction: "s",
    userPrompt: "u",
    schema: { properties: { sections: {} } },
  });
  return JSON.stringify(generated.draft);
}

test("la entrada acepta Claude y Gemini solo como texto, con endpoint oficial y API key", () => {
  const claude = parseCreateAiProviderConfiguration({
    name: "Claude corporativo",
    providerType: "ANTHROPIC",
    purpose: "TEXT",
    model: "claude-test-model",
    apiKey: SECRET,
  });
  assert.equal(claude.baseUrl, ANTHROPIC_BASE_URL);
  assert.equal(claude.apiKey, SECRET);
  assert.equal(claude.timeoutMs, 60_000);

  const gemini = parseCreateAiProviderConfiguration({
    name: "Gemini corporativo",
    providerType: "GEMINI",
    purpose: "TEXT",
    model: "gemini-test-model",
    apiKey: SECRET,
  });
  assert.equal(gemini.baseUrl, GEMINI_BASE_URL);

  assert.throws(
    () =>
      parseCreateAiProviderConfiguration({
        ...claude,
        baseUrl: "https://api.openai.com/v1",
      }),
    /oficial de Anthropic/u,
  );
  assert.throws(
    () =>
      parseCreateAiProviderConfiguration({
        ...gemini,
        baseUrl: "https://attacker.invalid/v1beta",
      }),
    /oficial de Google Gemini/u,
  );
  assert.throws(
    () =>
      parseCreateAiProviderConfiguration({
        name: "Sin clave",
        providerType: "GEMINI",
        purpose: "TEXT",
        model: "gemini-test-model",
      }),
    /apiKey/u,
  );
  assert.throws(
    () => parseCreateAiProviderConfiguration({ ...claude, purpose: "IMAGE" }),
    /generadores de im/u,
  );
  assert.throws(
    () => parseCreateAiProviderConfiguration({ ...claude, timeoutMs: 600_001 }),
    /1000 y 600000/u,
  );
  const duplicate = parseDuplicateAiProviderConfiguration({
    ...claude,
    name: "Copia",
  });
  assert.equal("apiKey" in duplicate, false);
});

test("Claude llama a Messages con x-api-key, anthropic-version y esquema JSON", async () => {
  const http = mockFetch(() =>
    json(
      {
        id: "msg_body",
        content: [{ type: "text", text: '{"status":"ok"}' }],
        stop_reason: "end_turn",
        usage: { input_tokens: 11, output_tokens: 7 },
      },
      { "request-id": "req_header" },
    ),
  );
  try {
    const provider = new AnthropicMessagesProvider({
      configuration: entity("ANTHROPIC"),
      apiKey: SECRET,
    });
    const result = await provider.generateStructured({
      systemInstruction: "Sistema",
      userPrompt: "Usuario",
      schema: { type: "object" },
      maxOutputTokens: 321,
    });
    assert.equal(http.calls.length, 1);
    const [call] = http.calls;
    assert.equal(call.url, "https://api.anthropic.com/v1/messages");
    assert.equal(call.init.method, "POST");
    const headers = call.init.headers as Record<string, string>;
    assert.equal(headers["x-api-key"], SECRET);
    assert.equal(headers["anthropic-version"], "2023-06-01");
    assert.equal(headers.authorization, undefined);
    const body = JSON.parse(String(call.init.body));
    assert.equal(body.model, "claude-test-model");
    assert.equal(body.max_tokens, 321);
    assert.match(body.system, /Sistema/u);
    assert.match(body.system, /"type":"object"/u);
    assert.deepEqual(body.messages, [{ role: "user", content: "Usuario" }]);
    assert.equal(result.text, '{"status":"ok"}');
    assert.equal(result.providerRequestId, "req_header");
    assert.equal(result.inputTokens, 11);
    assert.equal(result.outputTokens, 7);
  } finally {
    http.restore();
  }
});

test("Gemini llama a generateContent con x-goog-api-key y salida JSON estructurada", async () => {
  const http = mockFetch(() =>
    json({
      responseId: "resp-1",
      candidates: [
        {
          finishReason: "STOP",
          content: { parts: [{ text: '{"status":"ok"}' }] },
        },
      ],
      usageMetadata: {
        promptTokenCount: 13,
        candidatesTokenCount: 5,
        thoughtsTokenCount: 2,
      },
    }),
  );
  try {
    const provider = new GeminiGenerateContentProvider({
      configuration: entity("GEMINI", { model: "models/gemini-test-model" }),
      apiKey: SECRET,
    });
    const result = await provider.generateStructured({
      systemInstruction: "Sistema",
      userPrompt: "Usuario",
      schema: { type: "object" },
      maxOutputTokens: 222,
    });
    const [call] = http.calls;
    assert.equal(
      call.url,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent",
    );
    const headers = call.init.headers as Record<string, string>;
    assert.equal(headers["x-goog-api-key"], SECRET);
    assert.equal(headers.authorization, undefined);
    assert.equal(call.url.includes(SECRET), false);
    const body = JSON.parse(String(call.init.body));
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.deepEqual(body.generationConfig.responseJsonSchema, {
      type: "object",
    });
    assert.equal(body.generationConfig.maxOutputTokens, 222);
    assert.equal(body.systemInstruction.parts[0].text, "Sistema");
    assert.equal(body.contents[0].parts[0].text, "Usuario");
    assert.equal(result.providerRequestId, "resp-1");
    assert.equal(result.inputTokens, 13);
    assert.equal(result.outputTokens, 7);
  } finally {
    http.restore();
  }
});

test("Gemini omite solo responseJsonSchema cuando el schema supera el límite de complejidad", async () => {
  const http = mockFetch(() =>
    json({
      candidates: [
        {
          finishReason: "STOP",
          content: { parts: [{ text: '{"status":"ok"}' }] },
        },
      ],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    }),
  );
  try {
    const provider = new GeminiGenerateContentProvider({
      configuration: entity("GEMINI"),
      apiKey: SECRET,
    });
    const small = { type: "object", properties: { a: { type: "string" } } };
    const large = {
      type: "object",
      description: "x".repeat(20_001),
    };
    await provider.generateStructured({
      systemInstruction: "Sistema",
      userPrompt: "Usuario",
      schema: small,
      maxOutputTokens: 111,
    });
    await provider.generateStructured({
      systemInstruction: "Sistema",
      userPrompt: "Usuario",
      schema: large,
      maxOutputTokens: 222,
    });
    const smallBody = JSON.parse(String(http.calls[0].init.body));
    assert.deepEqual(smallBody.generationConfig.responseJsonSchema, small);
    const largeBody = JSON.parse(String(http.calls[1].init.body));
    assert.equal("responseJsonSchema" in largeBody.generationConfig, false);
    assert.equal(
      largeBody.generationConfig.responseMimeType,
      "application/json",
    );
    assert.equal(largeBody.generationConfig.maxOutputTokens, 222);
    assert.equal(largeBody.systemInstruction.parts[0].text, "Sistema");
    assert.equal(largeBody.contents[0].parts[0].text, "Usuario");
  } finally {
    http.restore();
  }
});

test("los adaptadores devuelven un borrador validado y aplican DLP antes de enviar", async () => {
  const draft = await fakeDraftJson();
  const http = mockFetch((call) =>
    call.url.includes("anthropic")
      ? json({
          id: "msg_1",
          content: [{ type: "text", text: draft }],
          stop_reason: "end_turn",
          usage: { input_tokens: 3, output_tokens: 4 },
        })
      : json({
          candidates: [
            { finishReason: "STOP", content: { parts: [{ text: draft }] } },
          ],
          usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 },
        }),
  );
  try {
    for (const type of ["ANTHROPIC", "GEMINI"] as const) {
      const provider = createCloudTextProvider({
        configuration: entity(type),
        apiKey: SECRET,
      });
      const seen: string[] = [];
      const response = await provider.generate({
        systemInstruction: "s",
        userPrompt: "Necesito un sistema de inventario",
        schema: {},
        onProviderRequestId: (id) => {
          seen.push(id);
        },
      });
      assert.equal(response.draft.schemaVersion, "4.0.0");
      assert.equal(response.inputTokens, 3);
      assert.equal(response.outputTokens, 4);
    }
    const before = http.calls.length;
    await assert.rejects(
      () =>
        createCloudTextProvider({
          configuration: entity("GEMINI"),
          apiKey: SECRET,
        }).generate({
          systemInstruction: "s",
          userPrompt:
            "Mi clave es sk-proj-abcdefghijklmnopqrstuvwxyz0123456789",
          schema: {},
        }),
      (error) =>
        error instanceof AiProviderError &&
        error.code === "GEMINI_DLP_BLOCKED" &&
        error.retryable === false,
    );
    assert.equal(http.calls.length, before, "no debe salir ninguna solicitud");
  } finally {
    http.restore();
  }
});

test("los errores mencionan al proveedor real y nunca la clave ni el cuerpo remoto", async () => {
  const http = mockFetch(
    () =>
      new Response(JSON.stringify({ error: { message: `eco ${SECRET}` } }), {
        status: 401,
      }),
  );
  try {
    for (const [type, label] of [
      ["ANTHROPIC", "Claude"],
      ["GEMINI", "Gemini"],
    ] as const) {
      await assert.rejects(
        () =>
          createCloudTextProvider({
            configuration: entity(type),
            apiKey: SECRET,
          }).generate({
            systemInstruction: "s",
            userPrompt: "hola",
            schema: {},
          }),
        (error) => {
          assert.ok(error instanceof AiProviderError);
          assert.equal(error.code, `${type}_HTTP_401`);
          assert.match(error.message, new RegExp(label, "u"));
          assert.equal(error.message.includes(SECRET), false);
          assert.equal(error.retryable, false);
          return true;
        },
      );
    }
  } finally {
    http.restore();
  }
});

test("la factoría resuelve el adaptador correcto y conserva OpenAI", () => {
  assert.ok(
    createCloudTextProvider({
      configuration: entity("ANTHROPIC"),
      apiKey: SECRET,
    }) instanceof AnthropicMessagesProvider,
  );
  assert.ok(
    createCloudTextProvider({
      configuration: entity("GEMINI"),
      apiKey: SECRET,
    }) instanceof GeminiGenerateContentProvider,
  );
  assert.ok(
    createCloudTextProvider({
      configuration: entity("OPENAI"),
      apiKey: SECRET,
    }) instanceof OpenAiResponsesProvider,
  );
  assert.throws(
    () =>
      createCloudTextProvider({
        configuration: entity("OPENAI", {
          providerType: "OLLAMA",
        } as never),
        apiKey: SECRET,
      }),
    /no es un proveedor de IA nube/u,
  );
  for (const provider of ["ANTHROPIC", "GEMINI"]) {
    assert.doesNotThrow(() =>
      assertAiDocumentGenerationBoundary({
        mode: "CLOUD_ONLY",
        provider,
        hasKnowledgeSnapshot: false,
        snapshotPromptReady: false,
      }),
    );
  }
});

test("la selección CLOUD acepta Claude y Gemini solo habilitados y probados", async () => {
  for (const type of ["ANTHROPIC", "GEMINI"] as const) {
    const provider = entity(type, { lastConnectionTestStatus: "SUCCEEDED" });
    const repository = {
      findOneBy: async (where: Record<string, unknown>) => {
        const wanted = where.providerType as { value?: string[] } | string;
        const types =
          typeof wanted === "object" && wanted.value
            ? wanted.value
            : [wanted as string];
        return where.id === provider.id && types.includes(provider.providerType)
          ? provider
          : null;
      },
    };
    assert.equal(
      await resolveSelectedProvider(repository as never, "CLOUD", provider.id),
      provider,
    );
    // Un proveedor nube nunca se acepta como LOCAL.
    await assert.rejects(
      () => resolveSelectedProvider(repository as never, "LOCAL", provider.id),
      /ya no está habilitado/u,
    );
    provider.lastConnectionTestStatus = "NOT_TESTED";
    await assert.rejects(
      () => resolveSelectedProvider(repository as never, "CLOUD", provider.id),
      /Prueba la conexión/u,
    );
    provider.lastConnectionTestStatus = "SUCCEEDED";
    provider.isEnabled = false;
    await assert.rejects(
      () => resolveSelectedProvider(repository as never, "CLOUD", provider.id),
      /ya no está habilitado/u,
    );
  }
});

function serviceFixture() {
  const vault = new MemoryAiSecretVault();
  const store = new Map<string, AiProviderConfigurationEntity>();
  const audits: unknown[] = [];
  const repository = {
    findOneBy: async (where: { id?: string; name?: string }) =>
      where.id
        ? (store.get(where.id) ?? null)
        : ([...store.values()].find((item) => item.name === where.name) ??
          null),
    save: async (value: AiProviderConfigurationEntity) => {
      store.set(value.id, value);
      return value;
    },
    find: async () => [...store.values()],
  };
  const manager = {
    create: (_type: unknown, value: unknown) => value,
    save: async (value: AiProviderConfigurationEntity) => {
      if ("providerType" in value) store.set(value.id, value);
      else audits.push(value);
      return value;
    },
    findOneBy: async () => null,
    remove: async (value: AiProviderConfigurationEntity) => {
      store.delete(value.id);
    },
  };
  const dataSource = {
    manager,
    transaction: async (work: (value: typeof manager) => Promise<void>) =>
      work(manager),
  };
  const service = new AiProviderConfigurationsService(
    repository as never,
    dataSource as never,
    vault,
  );
  return { service, vault, store, audits };
}

test("el alta guarda la clave solo en la bóveda y nunca la devuelve ni la audita", async () => {
  const { service, vault, store, audits } = serviceFixture();
  const context = { actor: ADMIN, correlationId: "cloud-create" };
  for (const type of ["ANTHROPIC", "GEMINI"] as const) {
    const input = parseCreateAiProviderConfiguration({
      name: `Cuenta ${type}`,
      providerType: type,
      purpose: "TEXT",
      model: "modelo-prueba",
      apiKey: SECRET,
    });
    const summary = await service.create(context, input);
    assert.equal(summary.providerType, type);
    assert.equal(summary.requiresCredential, true);
    assert.equal(summary.credentialConfigured, true);
    assert.equal(summary.lastConnectionTestStatus, "NOT_TESTED");
    assert.equal(summary.isEnabled, false);
    const stored = store.get(summary.id) as AiProviderConfigurationEntity;
    assert.equal(await vault.resolve(stored.secretReference), SECRET);
    assert.equal(JSON.stringify(summary).includes(SECRET), false);
    assert.equal(JSON.stringify(stored).includes(SECRET), false);

    const duplicated = await service.duplicate(
      context,
      summary.id,
      parseDuplicateAiProviderConfiguration({
        ...input,
        name: `Copia ${type}`,
      }),
    );
    const copy = store.get(duplicated.id) as AiProviderConfigurationEntity;
    assert.notEqual(copy.secretReference, stored.secretReference);
    assert.equal(await vault.resolve(copy.secretReference), SECRET);

    const originalReference = stored.secretReference;
    const rotated = await service.rotateCredential(context, summary.id, {
      apiKey: "rotated-secret-value-0123456789",
    });
    assert.equal(rotated.lastConnectionTestStatus, "NOT_TESTED");
    const afterRotation = store.get(
      summary.id,
    ) as AiProviderConfigurationEntity;
    assert.equal(
      await vault.resolve(afterRotation.secretReference),
      "rotated-secret-value-0123456789",
    );
    assert.equal(await vault.has(originalReference), false);

    await service.delete(context, summary.id);
    assert.equal(await vault.has(afterRotation.secretReference), false);
  }
  assert.equal(JSON.stringify(audits).includes(SECRET), false);
  assert.equal(JSON.stringify(audits).includes("rotated-secret"), false);
});

test("la prueba de conexión usa una solicitud fija y actualiza estado y auditoría", async () => {
  const { service, vault, store, audits } = serviceFixture();
  const context = { actor: ADMIN, correlationId: "cloud-test" };
  const summary = await service.create(
    context,
    parseCreateAiProviderConfiguration({
      name: "Claude prueba",
      providerType: "ANTHROPIC",
      purpose: "TEXT",
      model: "claude-test-model",
      apiKey: SECRET,
    }),
  );
  const stored = store.get(summary.id) as AiProviderConfigurationEntity;
  void vault;

  const okHttp = mockFetch(() =>
    json({
      content: [{ type: "text", text: '{"status":"ok"}' }],
      stop_reason: "end_turn",
      usage: { input_tokens: 5, output_tokens: 3 },
    }),
  );
  try {
    const ok = await service.testConnection(context, summary.id);
    assert.equal(ok.succeeded, true);
    assert.equal(stored.lastConnectionTestStatus, "SUCCEEDED");
    assert.equal(stored.lastErrorCode, null);
    assert.match(ok.message, /Claude/u);
    assert.equal(okHttp.calls.length, 1);
    const body = String(okHttp.calls[0].init.body);
    assert.match(body, /status/u);
    assert.equal(body.length < 1_000, true, "solicitud fija y mínima");
  } finally {
    okHttp.restore();
  }

  const failingHttp = mockFetch(() => new Response("{}", { status: 404 }));
  try {
    const failed = await service.testConnection(context, summary.id);
    assert.equal(failed.succeeded, false);
    assert.equal(stored.lastConnectionTestStatus, "FAILED");
    assert.equal(stored.lastErrorCode, "ANTHROPIC_HTTP_404");
    assert.match(failed.message, /Claude/u);
    assert.equal(failed.message.includes(SECRET), false);
  } finally {
    failingHttp.restore();
  }
  assert.equal(JSON.stringify(audits).includes(SECRET), false);
  assert.ok(
    JSON.stringify(audits).includes("CONNECTION_TESTED"),
    "la prueba queda auditada",
  );
});

test("selectableProviders publica Claude y Gemini como nube y OpenAI sigue siendo el default histórico", async () => {
  const { service, store } = serviceFixture();
  const claude = entity("ANTHROPIC", {
    id: "33333333-3333-4333-8333-333333333333",
    lastConnectionTestStatus: "SUCCEEDED",
  });
  const gemini = entity("GEMINI", {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Gemini",
  });
  const openai = entity("OPENAI", {
    id: "55555555-5555-4555-8555-555555555555",
    name: "OpenAI",
    isDefault: true,
    lastConnectionTestStatus: "SUCCEEDED",
  });
  for (const item of [claude, gemini, openai]) store.set(item.id, item);

  const options = await service.selectableProviders();
  const byId = new Map(options.map((item) => [item.id, item]));
  assert.equal(byId.get(claude.id)?.engine, "CLOUD");
  assert.equal(byId.get(claude.id)?.available, true);
  assert.equal(byId.get(gemini.id)?.engine, "CLOUD");
  assert.equal(byId.get(gemini.id)?.available, false);
  assert.match(byId.get(gemini.id)?.message ?? "", /prueba de conexión/u);
});

test("la discusión CLOUD usa el adaptador Gemini con DLP previa y sin exponer la clave", async () => {
  const answers = JSON.stringify({
    answers: [{ questionId: "q1", answer: "Respuesta consolidada" }],
  });
  const http = mockFetch(() =>
    json({
      candidates: [
        { finishReason: "STOP", content: { parts: [{ text: answers }] } },
      ],
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 2 },
    }),
  );
  try {
    const resolved = {
      configuration: entity("GEMINI"),
      apiKey: SECRET,
    };
    const service = new RequirementDiscussionService(
      { requireCreate: async () => undefined } as never,
      {} as never,
      { resolveDefault: async () => resolved } as never,
      { executionMode: "OPENAI" } as never,
      null,
    );
    const context: AiAnalysisActorContext = {
      actor: { id: "user-1" } as never,
      accessToken: "token-1",
      correlationId: "corr-1",
    };
    const response = await service.process(context, "project-1", {
      engine: "CLOUD",
      conversation: "Conversación de prueba",
      answers: [{ questionId: "q1", answer: "Borrador" } as never],
    });
    assert.equal(response.provider, "CLOUD");
    assert.equal(response.model, "gemini-test-model");
    assert.deepEqual(response.answers, [
      { questionId: "q1", answer: "Respuesta consolidada" },
    ]);
    assert.equal(http.calls.length, 1);
    assert.match(http.calls[0].url, /:generateContent$/u);
    assert.equal(JSON.stringify(response).includes(SECRET), false);

    await assert.rejects(
      () =>
        service.process(context, "project-1", {
          engine: "CLOUD",
          conversation: "clave sk-proj-abcdefghijklmnopqrstuvwxyz0123456789",
          answers: [{ questionId: "q1", answer: "Borrador" } as never],
        }),
      /información sensible/u,
    );
    assert.equal(http.calls.length, 1, "DLP bloquea antes de salir");
  } finally {
    http.restore();
  }
});

const OPENAI_COMPATIBLE_CLOUD = [
  ["GROQ", "Groq", "https://api.groq.com/openai/v1"],
  ["CEREBRAS", "Cerebras", "https://api.cerebras.ai/v1"],
] as const;

test("la entrada acepta Groq y Cerebras solo como texto, con endpoint oficial y API key", () => {
  for (const [type, , url] of OPENAI_COMPATIBLE_CLOUD) {
    const created = parseCreateAiProviderConfiguration({
      name: `Cuenta ${type}`,
      providerType: type,
      purpose: "TEXT",
      model: "modelo-prueba",
      apiKey: SECRET,
    });
    assert.equal(created.baseUrl, url);
    assert.equal(created.apiKey, SECRET);
    assert.equal(created.timeoutMs, 60_000);
    assert.throws(
      () =>
        parseCreateAiProviderConfiguration({
          ...created,
          baseUrl: "http://192.168.1.10:8080",
        }),
      /endpoint oficial/u,
    );
    assert.throws(
      () => parseCreateAiProviderConfiguration({ ...created, apiKey: undefined }),
      /apiKey/u,
    );
    assert.throws(
      () => parseCreateAiProviderConfiguration({ ...created, purpose: "IMAGE" }),
      /generadores de im/u,
    );
    const duplicate = parseDuplicateAiProviderConfiguration({
      ...created,
      name: "Copia",
    });
    assert.equal("apiKey" in duplicate, false);
  }
});

test("Groq y Cerebras llaman a /chat/completions con Bearer y json_schema estricto", async () => {
  const http = mockFetch(() =>
    json({
      id: "chatcmpl-1",
      choices: [
        {
          finish_reason: "stop",
          message: { role: "assistant", content: '{"status":"ok"}' },
        },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 6 },
    }),
  );
  try {
    for (const [type, , url] of OPENAI_COMPATIBLE_CLOUD) {
      const provider = new OpenAiCompatibleCloudProvider(
        { configuration: entity(type), apiKey: SECRET },
        type,
      );
      const result = await provider.generateStructured({
        systemInstruction: "Sistema",
        userPrompt: "Usuario",
        schema: { type: "object" },
        maxOutputTokens: 333,
      });
      const call = http.calls[http.calls.length - 1];
      assert.equal(call.url, `${url}/chat/completions`);
      assert.equal(call.init.method, "POST");
      const headers = call.init.headers as Record<string, string>;
      assert.equal(headers.authorization, `Bearer ${SECRET}`);
      assert.equal(call.url.includes(SECRET), false);
      const body = JSON.parse(String(call.init.body));
      assert.equal(body.model, "claude-test-model");
      assert.deepEqual(body.messages, [
        { role: "system", content: "Sistema" },
        { role: "user", content: "Usuario" },
      ]);
      assert.equal(body.max_completion_tokens, 333);
      assert.equal(body.response_format.type, "json_schema");
      assert.equal(body.response_format.json_schema.strict, type !== "GROQ");
      assert.deepEqual(body.response_format.json_schema.schema, {
        type: "object",
      });
      assert.equal(result.text, '{"status":"ok"}');
      assert.equal(result.providerRequestId, "chatcmpl-1");
      assert.equal(result.inputTokens, 12);
      assert.equal(result.outputTokens, 6);
    }
  } finally {
    http.restore();
  }
});

test("Groq y Cerebras aplican DLP, devuelven borrador y no filtran la clave en errores", async () => {
  const draft = await fakeDraftJson();
  const http = mockFetch(() =>
    json({
      id: "chatcmpl-2",
      choices: [{ finish_reason: "stop", message: { content: draft } }],
      usage: { prompt_tokens: 3, completion_tokens: 4 },
    }),
  );
  try {
    for (const [type, label] of OPENAI_COMPATIBLE_CLOUD) {
      const provider = createCloudTextProvider({
        configuration: entity(type),
        apiKey: SECRET,
      });
      assert.ok(provider instanceof OpenAiCompatibleCloudProvider);
      const response = await provider.generate({
        systemInstruction: "s",
        userPrompt: "Necesito un sistema de inventario",
        schema: {},
      });
      assert.equal(response.draft.schemaVersion, "4.0.0");
      assert.equal(response.inputTokens, 3);
      assert.equal(response.outputTokens, 4);

      const before = http.calls.length;
      await assert.rejects(
        () =>
          provider.generate({
            systemInstruction: "s",
            userPrompt:
              "Mi clave es sk-proj-abcdefghijklmnopqrstuvwxyz0123456789",
            schema: {},
          }),
        (error) =>
          error instanceof AiProviderError &&
          error.code === `${type}_DLP_BLOCKED`,
      );
      assert.equal(http.calls.length, before);

      const failing = mockFetch(
        () =>
          new Response(JSON.stringify({ error: `eco ${SECRET}` }), {
            status: 401,
          }),
      );
      try {
        await assert.rejects(
          () => provider.generate({ systemInstruction: "s", userPrompt: "hola", schema: {} }),
          (error) => {
            assert.ok(error instanceof AiProviderError);
            assert.equal(error.code, `${type}_HTTP_401`);
            assert.match(error.message, new RegExp(label, "u"));
            assert.equal(error.message.includes(SECRET), false);
            return true;
          },
        );
      } finally {
        failing.restore();
      }
    }
  } finally {
    http.restore();
  }
});

test("la selección CLOUD, la frontera y la prueba de conexión resuelven Groq y Cerebras", async () => {
  for (const [type, label] of OPENAI_COMPATIBLE_CLOUD) {
    assert.doesNotThrow(() =>
      assertAiDocumentGenerationBoundary({
        mode: "CLOUD_ONLY",
        provider: type,
        hasKnowledgeSnapshot: false,
        snapshotPromptReady: false,
      }),
    );
    const provider = entity(type, { lastConnectionTestStatus: "SUCCEEDED" });
    const repository = {
      findOneBy: async (where: Record<string, unknown>) => {
        const wanted = where.providerType as { value?: string[] } | string;
        const types =
          typeof wanted === "object" && wanted.value
            ? wanted.value
            : [wanted as string];
        return where.id === provider.id && types.includes(provider.providerType)
          ? provider
          : null;
      },
    };
    assert.equal(
      await resolveSelectedProvider(repository as never, "CLOUD", provider.id),
      provider,
    );
    await assert.rejects(
      () => resolveSelectedProvider(repository as never, "LOCAL", provider.id),
      /ya no está habilitado/u,
    );
    provider.lastConnectionTestStatus = "NOT_TESTED";
    await assert.rejects(
      () => resolveSelectedProvider(repository as never, "CLOUD", provider.id),
      /Prueba la conexión/u,
    );

    const { service, store, audits } = serviceFixture();
    const context = { actor: ADMIN, correlationId: `cloud-test-${type}` };
    const summary = await service.create(
      context,
      parseCreateAiProviderConfiguration({
        name: `Prueba ${type}`,
        providerType: type,
        purpose: "TEXT",
        model: "modelo-prueba",
        apiKey: SECRET,
      }),
    );
    assert.equal(summary.requiresCredential, true);
    assert.equal(summary.credentialConfigured, true);
    assert.equal(JSON.stringify(summary).includes(SECRET), false);
    const stored = store.get(summary.id) as AiProviderConfigurationEntity;
    const http = mockFetch(() =>
      json({
        id: "chatcmpl-3",
        choices: [{ finish_reason: "stop", message: { content: '{"status":"ok"}' } }],
        usage: { prompt_tokens: 2, completion_tokens: 2 },
      }),
    );
    try {
      const ok = await service.testConnection(context, summary.id);
      assert.equal(ok.succeeded, true);
      assert.match(ok.message, new RegExp(label, "u"));
      assert.equal(stored.lastConnectionTestStatus, "SUCCEEDED");
      assert.equal(http.calls.length, 1);
      assert.match(http.calls[0].url, /\/chat\/completions$/u);
      assert.equal(String(http.calls[0].init.body).length < 1_000, true);
    } finally {
      http.restore();
    }
    const failing = mockFetch(() => new Response("{}", { status: 404 }));
    try {
      const failed = await service.testConnection(context, summary.id);
      assert.equal(failed.succeeded, false);
      assert.equal(stored.lastErrorCode, `${type}_HTTP_404`);
    } finally {
      failing.restore();
    }
    assert.equal(JSON.stringify(audits).includes(SECRET), false);

    const options = await service.selectableProviders();
    assert.equal(options.find((item) => item.id === summary.id)?.engine, "CLOUD");
  }
});

test("la discusión CLOUD usa Groq o Cerebras con DLP previa", async () => {
  const answers = JSON.stringify({
    answers: [{ questionId: "q1", answer: "Respuesta consolidada" }],
  });
  const http = mockFetch(() =>
    json({
      id: "chatcmpl-4",
      choices: [{ finish_reason: "stop", message: { content: answers } }],
      usage: { prompt_tokens: 2, completion_tokens: 2 },
    }),
  );
  try {
    for (const [type, , url] of OPENAI_COMPATIBLE_CLOUD) {
      const resolved = { configuration: entity(type), apiKey: SECRET };
      const service = new RequirementDiscussionService(
        { requireCreate: async () => undefined } as never,
        {} as never,
        { resolveDefault: async () => resolved } as never,
        { executionMode: "OPENAI" } as never,
        null,
      );
      const context: AiAnalysisActorContext = {
        actor: { id: "user-1" } as never,
        accessToken: "token-1",
        correlationId: "corr-1",
      };
      const before = http.calls.length;
      const response = await service.process(context, "project-1", {
        engine: "CLOUD",
        conversation: "Conversación de prueba",
        answers: [{ questionId: "q1", answer: "Borrador" } as never],
      });
      assert.equal(response.provider, "CLOUD");
      assert.equal(http.calls.length, before + 1);
      assert.equal(http.calls[before].url, `${url}/chat/completions`);
      assert.equal(JSON.stringify(response).includes(SECRET), false);
      await assert.rejects(
        () =>
          service.process(context, "project-1", {
            engine: "CLOUD",
            conversation: "clave sk-proj-abcdefghijklmnopqrstuvwxyz0123456789",
            answers: [{ questionId: "q1", answer: "Borrador" } as never],
          }),
        /información sensible/u,
      );
      assert.equal(http.calls.length, before + 1);
    }
  } finally {
    http.restore();
  }
});
