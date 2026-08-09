import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";

import {
  AI_PROVIDER_RUNTIME_CONFIG,
  type AiProviderRuntimeConfig,
} from "./ai-provider.config";

const execFileAsync = promisify(execFile);

export const AI_SECRET_VAULT = Symbol("AI_SECRET_VAULT");

export interface AiSecretVault {
  put(reference: string, secret: string): Promise<void>;
  resolve(reference: string): Promise<string>;
  has(reference: string): Promise<boolean>;
  delete(reference: string): Promise<void>;
}

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException(
    "La bóveda de secretos de IA no está disponible en este entorno.",
  );
}

@Injectable()
export class PlatformAiSecretVault implements AiSecretVault {
  constructor(
    @Inject(AI_PROVIDER_RUNTIME_CONFIG)
    private readonly config: AiProviderRuntimeConfig,
  ) {}

  async put(reference: string, secret: string): Promise<void> {
    this.requireMacKeychain();

    try {
      await execFileAsync("/usr/bin/security", [
        "add-generic-password",
        "-a",
        reference,
        "-s",
        this.config.keychainService,
        "-w",
        secret,
        "-U",
      ]);
    } catch {
      throw unavailable();
    }
  }

  async resolve(reference: string): Promise<string> {
    this.requireMacKeychain();

    try {
      const { stdout } = await execFileAsync("/usr/bin/security", [
        "find-generic-password",
        "-a",
        reference,
        "-s",
        this.config.keychainService,
        "-w",
      ]);
      const secret = stdout.trim();

      if (!secret) throw unavailable();

      return secret;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw unavailable();
    }
  }

  async has(reference: string): Promise<boolean> {
    try {
      await this.resolve(reference);
      return true;
    } catch {
      return false;
    }
  }

  async delete(reference: string): Promise<void> {
    this.requireMacKeychain();

    try {
      await execFileAsync("/usr/bin/security", [
        "delete-generic-password",
        "-a",
        reference,
        "-s",
        this.config.keychainService,
      ]);
    } catch {
      // Deleting an absent credential is idempotent.
    }
  }

  private requireMacKeychain(): void {
    if (this.config.vaultMode !== "MACOS_KEYCHAIN") throw unavailable();
  }
}

export class MemoryAiSecretVault implements AiSecretVault {
  private readonly secrets = new Map<string, string>();

  async put(reference: string, secret: string): Promise<void> {
    this.secrets.set(reference, secret);
  }

  async resolve(reference: string): Promise<string> {
    const secret = this.secrets.get(reference);
    if (!secret) throw unavailable();
    return secret;
  }

  async has(reference: string): Promise<boolean> {
    return this.secrets.has(reference);
  }

  async delete(reference: string): Promise<void> {
    this.secrets.delete(reference);
  }
}
