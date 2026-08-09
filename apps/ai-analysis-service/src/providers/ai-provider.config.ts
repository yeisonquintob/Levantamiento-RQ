import { platform } from "node:os";

export const AI_PROVIDER_RUNTIME_CONFIG = Symbol("AI_PROVIDER_RUNTIME_CONFIG");

export type AiSecretVaultMode = "MACOS_KEYCHAIN" | "DISABLED";

export interface AiProviderRuntimeConfig {
  vaultMode: AiSecretVaultMode;
  keychainService: string;
}

export function loadAiProviderRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AiProviderRuntimeConfig {
  const rawMode = environment.AI_SECRET_VAULT?.trim().toUpperCase();
  const defaultMode = platform() === "darwin" ? "MACOS_KEYCHAIN" : "DISABLED";
  const vaultMode = (rawMode || defaultMode) as AiSecretVaultMode;

  if (!["MACOS_KEYCHAIN", "DISABLED"].includes(vaultMode)) {
    throw new Error("AI_SECRET_VAULT debe ser MACOS_KEYCHAIN o DISABLED.");
  }

  const keychainService =
    environment.AI_KEYCHAIN_SERVICE?.trim() ||
    "com.navitrans.levantamiento-rq.ai";

  if (!/^[a-zA-Z0-9._-]{3,120}$/.test(keychainService)) {
    throw new Error("AI_KEYCHAIN_SERVICE no es válido.");
  }

  return { vaultMode, keychainService };
}
