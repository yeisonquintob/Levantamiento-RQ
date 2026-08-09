import { platform } from "node:os";

export const AI_PROVIDER_RUNTIME_CONFIG = Symbol("AI_PROVIDER_RUNTIME_CONFIG");

export type AiSecretVaultMode =
  "MACOS_KEYCHAIN" | "AZURE_KEY_VAULT" | "DISABLED";

export interface AiProviderRuntimeConfig {
  vaultMode: AiSecretVaultMode;
  keychainService: string;
  keyVaultUrl: string | null;
  executionMode: "OPENAI" | "FAKE";
}

function parseKeyVaultUrl(
  value: string | undefined,
  required: boolean,
): string | null {
  if (!value?.trim()) {
    if (required) {
      throw new Error(
        "AI_KEY_VAULT_URL es obligatoria con AI_SECRET_VAULT=AZURE_KEY_VAULT.",
      );
    }
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("AI_KEY_VAULT_URL debe ser una URL HTTPS válida.");
  }

  const allowedHost = [
    ".vault.azure.net",
    ".vault.azure.cn",
    ".vault.usgovcloudapi.net",
    ".vault.microsoftazure.de",
  ].some((suffix) => parsed.hostname.endsWith(suffix));

  if (
    parsed.protocol !== "https:" ||
    !allowedHost ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      "AI_KEY_VAULT_URL debe apuntar a un endpoint oficial HTTPS de Azure Key Vault.",
    );
  }

  return parsed.origin;
}

export function loadAiProviderRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AiProviderRuntimeConfig {
  const rawMode = environment.AI_SECRET_VAULT?.trim().toUpperCase();
  const defaultMode = platform() === "darwin" ? "MACOS_KEYCHAIN" : "DISABLED";
  const vaultMode = (rawMode || defaultMode) as AiSecretVaultMode;

  if (!["MACOS_KEYCHAIN", "AZURE_KEY_VAULT", "DISABLED"].includes(vaultMode)) {
    throw new Error(
      "AI_SECRET_VAULT debe ser MACOS_KEYCHAIN, AZURE_KEY_VAULT o DISABLED.",
    );
  }

  const keychainService =
    environment.AI_KEYCHAIN_SERVICE?.trim() ||
    "com.navitrans.levantamiento-rq.ai";

  if (!/^[a-zA-Z0-9._-]{3,120}$/.test(keychainService)) {
    throw new Error("AI_KEYCHAIN_SERVICE no es válido.");
  }

  const rawExecutionMode =
    environment.AI_EXECUTION_MODE?.trim().toUpperCase() || "OPENAI";
  if (!["OPENAI", "FAKE"].includes(rawExecutionMode)) {
    throw new Error("AI_EXECUTION_MODE debe ser OPENAI o FAKE.");
  }
  if (rawExecutionMode === "FAKE" && environment.NODE_ENV === "production") {
    throw new Error("AI_EXECUTION_MODE=FAKE no está permitido en producción.");
  }

  return {
    vaultMode,
    keychainService,
    keyVaultUrl: parseKeyVaultUrl(
      environment.AI_KEY_VAULT_URL,
      vaultMode === "AZURE_KEY_VAULT",
    ),
    executionMode: rawExecutionMode as "OPENAI" | "FAKE",
  };
}
