import assert from "node:assert/strict";
import test from "node:test";
import type { Repository, DataSource } from "typeorm";
import { AiProviderConfigurationEntity } from "../../apps/ai-analysis-service/src/providers/ai-provider-configuration.entity";
import {
  parseProviderSelections,
  resolveSelectedProvider,
} from "../../apps/ai-analysis-service/src/providers/provider-selection";
import { AiProviderConfigurationsService } from "../../apps/ai-analysis-service/src/providers/ai-provider-configurations.service";
import { MemoryAiSecretVault } from "../../apps/ai-analysis-service/src/providers/ai-secret-vault";
import { LocalAiSettingsService } from "../../apps/ai-analysis-service/src/local-ai/local-ai-settings.service";
import { loadLocalAiConfig } from "../../apps/ai-analysis-service/src/local-ai/ollama.config";
import {
  parseCreateAiAnalysisRequest,
  parseAiAnalysisTokenEstimateRequest,
  parseProcessRequirementDiscussionRequest,
} from "../../apps/ai-analysis-service/src/analysis/ai-analysis-input";

const id = "11111111-1111-4111-8111-111111111111";
function fixture(type: "OPENAI" | "OLLAMA" = "OPENAI") {
  const provider = {
    id,
    name: "Modelo alternativo",
    providerType: type,
    // El catálogo de selección separa los modelos de texto de los de imagen.
    purpose: "TEXT",
    model: "modelo-elegido",
    baseUrl:
      type === "OPENAI"
        ? "https://api.openai.com/v1"
        : "http://127.0.0.1:11434",
    isEnabled: true,
    isDefault: false,
    lastConnectionTestStatus: "SUCCEEDED",
    secretReference: "internal-secret",
    maxInputTokens: 24000,
    maxOutputTokens: 4000,
    timeoutMs: 60000,
  } as AiProviderConfigurationEntity;
  const repository = {
    find: async () => [provider],
    findOneBy: async (where: Record<string, unknown>) => {
      // `In([...])` de TypeORM expone los valores en `value`.
      const wanted = where.providerType;
      const types =
        wanted && typeof wanted === "object" && "value" in wanted
          ? ((wanted as { value: unknown[] }).value as string[])
          : [wanted as string];
      return where.id === provider.id && types.includes(provider.providerType)
        ? provider
        : null;
    },
  } as unknown as Repository<AiProviderConfigurationEntity>;
  return { provider, repository };
}

test("la selección solo acepta IDs registrados y rechaza endpoints, motores y secretos arbitrarios", () => {
  assert.deepEqual(parseProviderSelections({ LOCAL: id, CLOUD: id }), {
    LOCAL: id,
    CLOUD: id,
  });
  for (const value of [
    { LOCAL: "http://127.0.0.1:8188" },
    { IMAGE: id },
    { apiKey: "secret" },
    [],
    null,
  ])
    assert.throws(() => parseProviderSelections(value));
});

test("los tres contratos conservan el proveedor elegido", () => {
  const base = {
    documentId: id,
    documentVersionId: id,
    sourceIds: [id],
    engines: ["CLOUD"],
    providerSelections: { CLOUD: id },
  };
  assert.deepEqual(parseCreateAiAnalysisRequest(base).providerSelections, {
    CLOUD: id,
  });
  assert.deepEqual(
    parseAiAnalysisTokenEstimateRequest(base).providerSelections,
    { CLOUD: id },
  );
  assert.equal(
    parseProcessRequirementDiscussionRequest({
      engine: "CLOUD",
      providerConfigurationId: id,
      conversation: "Una conversación de requerimientos",
      answers: [
        {
          questionId: "question-1",
          question: "¿Qué necesitas?",
          answer: "Un sistema de inventario",
          score: 5,
        },
      ],
    }).providerConfigurationId,
    id,
  );
});

test("un modelo habilitado no predeterminado se resuelve con su credencial en el servidor", async () => {
  const { provider, repository } = fixture();
  const vault = new MemoryAiSecretVault();
  await vault.put(provider.secretReference, "test-secret-only");
  const service = new AiProviderConfigurationsService(
    repository,
    {} as DataSource,
    vault,
  );
  const result = await service.resolveDefault(id);
  assert.equal(result.configuration.model, "modelo-elegido");
  assert.equal(result.apiKey, "test-secret-only");
  const catalog = await service.selectableProviders();
  assert.equal(catalog[0].available, true);
  assert.equal(JSON.stringify(catalog).includes("secret"), false);
  assert.equal(JSON.stringify(catalog).includes("baseUrl"), false);
});

test("rechaza proveedor deshabilitado, sin validar o del otro motor sin usar un fallback", async () => {
  const { provider, repository } = fixture();
  await assert.rejects(resolveSelectedProvider(repository, "LOCAL", id));
  provider.isEnabled = false;
  await assert.rejects(resolveSelectedProvider(repository, "CLOUD", id));
  provider.isEnabled = true;
  provider.lastConnectionTestStatus = "FAILED";
  await assert.rejects(resolveSelectedProvider(repository, "CLOUD", id));
});

test("una solicitud conserva su elección aunque cambie el predeterminado y detecta cambios del modelo", async () => {
  const { provider, repository } = fixture();
  const snapshot = { id, model: provider.model, baseUrl: provider.baseUrl };
  provider.isDefault = true;
  assert.equal(
    (await resolveSelectedProvider(repository, "CLOUD", id, snapshot)).model,
    snapshot.model,
  );
  provider.model = "otro-modelo";
  await assert.rejects(
    resolveSelectedProvider(repository, "CLOUD", id, snapshot),
    /cambió/,
  );
});

test("Ollama utiliza modelo, endpoint y límites de la configuración elegida", async () => {
  const { repository } = fixture("OLLAMA");
  const service = new LocalAiSettingsService(repository, loadLocalAiConfig({}));
  const config = await service.resolve(id);
  assert.equal(config.model, "modelo-elegido");
  assert.equal(config.contextTokens, 24000);
  assert.equal(config.maxOutputTokens, 4000);
});
