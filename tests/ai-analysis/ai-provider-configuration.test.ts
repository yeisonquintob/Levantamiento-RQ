import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { AuthenticatedUser } from "../../libs/shared/contracts/src/index.js";
import { AiProviderConfigurationsService } from "../../apps/ai-analysis-service/src/providers/ai-provider-configurations.service.js";
import {
  OPENAI_BASE_URL,
  parseCreateAiProviderConfiguration,
  parseUpdateAiProviderConfiguration,
} from "../../apps/ai-analysis-service/src/providers/ai-provider-input.js";
import { loadAiProviderRuntimeConfig } from "../../apps/ai-analysis-service/src/providers/ai-provider.config.js";
import {
  AzureKeyVaultAiSecretVault,
  MemoryAiSecretVault,
} from "../../apps/ai-analysis-service/src/providers/ai-secret-vault.js";

const ADMIN: AuthenticatedUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "admin@example.invalid",
  displayName: "Admin",
  roles: ["ADMIN"],
  permissions: ["system.admin"],
  mustChangePassword: false,
};

test("la entrada restringe OpenAI al endpoint oficial y valida límites", () => {
  const parsed = parseCreateAiProviderConfiguration({
    name: "OpenAI corporativo",
    providerType: "OPENAI",
    model: "modelo-habilitado",
    apiKey: "secret-value-with-minimum-length",
  });

  assert.equal(parsed.baseUrl, OPENAI_BASE_URL);
  assert.equal(parsed.timeoutMs, 60000);
  assert.equal(parsed.maxAttempts, 3);
  assert.throws(
    () =>
      parseCreateAiProviderConfiguration({
        ...parsed,
        baseUrl: "https://attacker.invalid/v1",
      }),
    /endpoint oficial/i,
  );
  assert.throws(
    () => parseUpdateAiProviderConfiguration({ timeoutMs: 10 }),
    /1000 y 300000/i,
  );
});

test("la bóveda de pruebas soporta ciclo de vida sin exponer almacenamiento", async () => {
  const vault = new MemoryAiSecretVault();
  assert.equal(await vault.has("provider-test"), false);
  await vault.put("provider-test", "top-secret");
  assert.equal(await vault.has("provider-test"), true);
  assert.equal(await vault.resolve("provider-test"), "top-secret");
  await vault.delete("provider-test");
  assert.equal(await vault.has("provider-test"), false);
});

test("Azure Key Vault soporta alta, consulta, rotación y borrado idempotente", async () => {
  const secrets = new Map<string, string>();
  const client = {
    setSecret: async (name: string, value: string) => {
      secrets.set(name, value);
      return { name, value };
    },
    getSecret: async (name: string) => {
      const value = secrets.get(name);
      if (!value) {
        throw Object.assign(new Error("not found"), { statusCode: 404 });
      }
      return { name, value };
    },
    beginDeleteSecret: async (name: string) => {
      if (!secrets.delete(name)) {
        throw Object.assign(new Error("not found"), { statusCode: 404 });
      }
      return {};
    },
  };
  const vault = new AzureKeyVaultAiSecretVault(client as never);

  assert.equal(await vault.has("provider-test"), false);
  await vault.put("provider-test", "first-secret");
  assert.equal(await vault.resolve("provider-test"), "first-secret");
  await vault.put("provider-test", "rotated-secret");
  assert.equal(await vault.resolve("provider-test"), "rotated-secret");
  await vault.delete("provider-test");
  await vault.delete("provider-test");
  assert.equal(await vault.has("provider-test"), false);
});

test("la configuración de runtime rechaza bóvedas inseguras o desconocidas", () => {
  assert.throws(
    () => loadAiProviderRuntimeConfig({ AI_SECRET_VAULT: "PLAINTEXT" }),
    /MACOS_KEYCHAIN, AZURE_KEY_VAULT o DISABLED/,
  );
  assert.deepEqual(
    loadAiProviderRuntimeConfig({
      AI_SECRET_VAULT: "MACOS_KEYCHAIN",
      AI_KEYCHAIN_SERVICE: "com.example.ai",
      AI_EXECUTION_MODE: "OPENAI",
    }),
    {
      vaultMode: "MACOS_KEYCHAIN",
      keychainService: "com.example.ai",
      keyVaultUrl: null,
      executionMode: "OPENAI",
    },
  );
  assert.equal(
    loadAiProviderRuntimeConfig({
      AI_SECRET_VAULT: "AZURE_KEY_VAULT",
      AI_KEY_VAULT_URL: "https://rq-prod.vault.azure.net",
    }).keyVaultUrl,
    "https://rq-prod.vault.azure.net",
  );
  assert.throws(
    () =>
      loadAiProviderRuntimeConfig({
        AI_SECRET_VAULT: "AZURE_KEY_VAULT",
        AI_KEY_VAULT_URL: "http://127.0.0.1/secrets",
      }),
    /endpoint oficial HTTPS de Azure Key Vault/,
  );
});

test("las respuestas administrativas nunca incluyen clave ni referencia secreta", async () => {
  const vault = new MemoryAiSecretVault();
  await vault.put("provider-reference", "top-secret");
  const now = new Date("2026-08-08T12:00:00.000Z");
  const repository = {
    find: async () => [
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "OpenAI",
        providerType: "OPENAI",
        model: "modelo-habilitado",
        baseUrl: OPENAI_BASE_URL,
        isEnabled: true,
        isDefault: true,
        timeoutMs: 60000,
        maxInputTokens: 120000,
        maxOutputTokens: 12000,
        maxAttempts: 3,
        secretReference: "provider-reference",
        lastConnectionTestAt: null,
        lastConnectionTestStatus: "NOT_TESTED",
        lastErrorCode: null,
        createdByUserId: ADMIN.id,
        updatedByUserId: ADMIN.id,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
  const service = new AiProviderConfigurationsService(
    repository as never,
    {} as never,
    vault,
  );
  const result = await service.list({ actor: ADMIN, correlationId: "test" });
  const serialized = JSON.stringify(result);

  assert.equal(result.items[0]?.credentialConfigured, true);
  assert.doesNotMatch(serialized, /top-secret|provider-reference|apiKey/i);
});

test("persistencia, auditoría y UI no definen una columna o almacén local para la clave", async () => {
  const [migration, entity, audit, workspace] = await Promise.all([
    readFile(
      "apps/ai-analysis-service/src/database/migrations/1786492800000-AddAiProviderConfiguration.ts",
      "utf8",
    ),
    readFile(
      "apps/ai-analysis-service/src/providers/ai-provider-configuration.entity.ts",
      "utf8",
    ),
    readFile(
      "apps/ai-analysis-service/src/providers/ai-provider-audit.entity.ts",
      "utf8",
    ),
    readFile(
      "apps/web/src/app/workspace/settings/ai-providers/ai-providers-workspace.tsx",
      "utf8",
    ),
  ]);

  assert.match(migration, /AiProviderConfigurations/);
  assert.match(migration, /AiProviderAuditEvents/);
  assert.match(migration, /SecretReference/);
  assert.doesNotMatch(
    `${migration}\n${entity}\n${audit}`,
    /ApiKey|SecretValue/,
  );
  assert.doesNotMatch(workspace, /localStorage|sessionStorage/);
  assert.match(workspace, /type="password"/);
});

test("Azure prepara Key Vault con identidad administrada y la base correcta", async () => {
  const [bicep, dependencies, environment] = await Promise.all([
    readFile("infrastructure/azure/main.bicep", "utf8"),
    readFile("apps/ai-analysis-service/package.json", "utf8"),
    readFile("apps/ai-analysis-service/.env.example", "utf8"),
  ]);

  assert.match(bicep, /'RqAiDb'/);
  assert.doesNotMatch(bicep, /RqAiAnalysisDb/);
  assert.match(bicep, /AI_SECRET_VAULT', value: 'AZURE_KEY_VAULT'/);
  assert.match(
    bicep,
    /AI_KEY_VAULT_URL', value: aiVault\.properties\.vaultUri/,
  );
  assert.match(bicep, /keyVaultSecretsOfficerRoleId/);
  assert.match(bicep, /scope: aiVault/);
  assert.match(dependencies, /"@azure\/identity": "4\.13\.1"/);
  assert.match(dependencies, /"@azure\/keyvault-secrets": "4\.11\.2"/);
  assert.match(
    environment,
    /AI_KEY_VAULT_URL=https:\/\/<vault>\.vault\.azure\.net/,
  );
});
