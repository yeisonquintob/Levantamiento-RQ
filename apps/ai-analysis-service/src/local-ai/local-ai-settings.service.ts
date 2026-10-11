import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AiProviderConfigurationEntity } from "../providers/ai-provider-configuration.entity";
import { LOCAL_AI_CONFIG, type LocalAiConfig } from "./ollama.config";
import {
  resolveSelectedProvider,
  type SelectedProviderSnapshot,
} from "../providers/provider-selection";

@Injectable()
export class LocalAiSettingsService {
  constructor(
    @InjectRepository(AiProviderConfigurationEntity)
    private readonly providers: Repository<AiProviderConfigurationEntity>,
    @Inject(LOCAL_AI_CONFIG) private readonly environment: LocalAiConfig,
  ) {}

  async resolve(
    selectedId?: string,
    snapshot?: SelectedProviderSnapshot,
  ): Promise<LocalAiConfig> {
    if (selectedId) {
      const provider = await resolveSelectedProvider(
        this.providers,
        "LOCAL",
        selectedId,
        snapshot,
      );
      return {
        ...this.environment,
        api:
          provider.providerType === "OPENAI_COMPATIBLE"
            ? "OPENAI_COMPATIBLE"
            : "OLLAMA",
        enabled: true,
        baseUrl: provider.baseUrl,
        model: provider.model,
        timeoutMs: provider.timeoutMs,
        contextTokens: provider.maxInputTokens,
        maxOutputTokens: provider.maxOutputTokens,
      };
    }
    const configured = await this.providers.find({
      where: { providerType: "OLLAMA" },
      order: { isDefault: "DESC", updatedAt: "DESC" },
    });
    if (configured.length === 0) return this.environment;
    const provider = configured.find((item) => item.isDefault);
    if (!provider) {
      if (configured.some((item) => item.isEnabled)) {
        throw new ConflictException(
          "Existe un proveedor Ollama habilitado, pero ninguno está marcado como predeterminado.",
        );
      }
      return { ...this.environment, enabled: false };
    }
    if (
      provider.isEnabled &&
      provider.lastConnectionTestStatus !== "SUCCEEDED"
    ) {
      throw new ConflictException(
        "El proveedor Ollama predeterminado debe superar una prueba de conexión antes de procesar fuentes.",
      );
    }
    return {
      ...this.environment,
      enabled: provider.isEnabled,
      baseUrl: provider.baseUrl,
      model: provider.model,
      timeoutMs: provider.timeoutMs,
      contextTokens: provider.maxInputTokens,
      maxOutputTokens: provider.maxOutputTokens,
    };
  }
}
