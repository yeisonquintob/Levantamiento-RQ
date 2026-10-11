import { BadRequestException, ConflictException } from "@nestjs/common";
import type {
  AiEngine,
  AiProviderSelections,
} from "@levantamiento-rq/shared-contracts";
import { In, type Repository } from "typeorm";
import { AiProviderConfigurationEntity } from "./ai-provider-configuration.entity";

export function parseProviderSelections(
  value: unknown,
): AiProviderSelections | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("La selección de proveedores no es válida.");
  }
  const result: AiProviderSelections = {};
  for (const [engine, id] of Object.entries(value)) {
    if (
      (engine !== "LOCAL" && engine !== "CLOUD") ||
      typeof id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
        id,
      )
    ) {
      throw new BadRequestException(
        "Selecciona un proveedor registrado para LOCAL o CLOUD.",
      );
    }
    result[engine] = id;
  }
  return result;
}

// Stored with the request so changing a global default cannot redirect a job.
export interface SelectedProviderSnapshot {
  id: string;
  model: string;
  baseUrl: string;
}
export type SelectedProviderSnapshots = Partial<
  Record<AiEngine, SelectedProviderSnapshot>
>;

export function readProviderSnapshots(
  json?: string | null,
): SelectedProviderSnapshots {
  return json ? (JSON.parse(json) as SelectedProviderSnapshots) : {};
}

export async function resolveSelectedProvider(
  repository: Repository<AiProviderConfigurationEntity>,
  engine: AiEngine,
  id: string,
  snapshot?: SelectedProviderSnapshot,
): Promise<AiProviderConfigurationEntity> {
  const provider = await repository.findOneBy({
    id,
    providerType:
      engine === "LOCAL"
        ? In(["OLLAMA", "OPENAI_COMPATIBLE"])
        : In(["OPENAI", "ANTHROPIC", "GEMINI", "GROQ", "CEREBRAS"]),
    purpose: "TEXT",
  });
  if (!provider?.isEnabled) {
    throw new ConflictException(
      "El proveedor seleccionado ya no está habilitado o no corresponde al tipo de IA.",
    );
  }
  if (provider.lastConnectionTestStatus !== "SUCCEEDED") {
    throw new ConflictException(
      "Prueba la conexión del proveedor seleccionado en Configuración antes de utilizarlo.",
    );
  }
  if (
    snapshot &&
    (snapshot.model !== provider.model || snapshot.baseUrl !== provider.baseUrl)
  ) {
    throw new ConflictException(
      "La configuración del modelo cambió después de iniciar la solicitud. Inicia una nueva generación con el modelo deseado.",
    );
  }
  return provider;
}
