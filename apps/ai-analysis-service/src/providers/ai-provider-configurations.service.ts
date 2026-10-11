import { readAuditHistory } from "@levantamiento-rq/shared-persistence";
import {
  AI_AUDIT_FIELDS,
  auditFieldChanges,
  auditMetadata,
  auditMetadataChanges,
  type AuditHistoryResponse,
  type AuditChangeValue,
} from "@levantamiento-rq/shared-contracts";
import { randomUUID } from "node:crypto";

import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Not, Repository } from "typeorm";

import type {
  AiProviderConfigurationListResponse,
  AiProviderConfigurationSummary,
  AiProviderConnectionTestResult,
  AuthenticatedUser,
  CreateAiProviderConfiguration,
  DuplicateAiProviderConfiguration,
  RotateAiProviderCredential,
  UpdateAiProviderConfiguration,
  OllamaInstalledModelsResponse,
} from "@levantamiento-rq/shared-contracts";

import { AiProviderAuditEntity } from "./ai-provider-audit.entity";
import { AiProviderConfigurationEntity } from "./ai-provider-configuration.entity";
import {
  resolveSelectedProvider,
  type SelectedProviderSnapshot,
} from "./provider-selection";
import { AI_SECRET_VAULT, type AiSecretVault } from "./ai-secret-vault";
import { parseOllamaBaseUrl } from "../local-ai/ollama.config";
import {
  isCloudRestProvider,
  testCloudTextProvider,
} from "../execution/cloud-text-provider";
import { isCredentialProviderType, providerLabel } from "./ai-provider-input";
import {
  loadComfyUiWorkflowTemplate,
  parseComfyUiWorkflowReference,
} from "../comfyui/comfyui-workflow-template";

export interface AiProviderActorContext {
  actor: AuthenticatedUser;
  correlationId: string;
}

export interface ResolvedAiProvider {
  configuration: AiProviderConfigurationEntity;
  apiKey: string;
}

function iso(value: Date): string {
  return value.toISOString();
}

function optionalIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function providerAuditSnapshot(
  entity: AiProviderConfigurationEntity,
): Record<string, AuditChangeValue> {
  return Object.fromEntries(
    AI_AUDIT_FIELDS.filter((field) => field !== "credential").map((field) => {
      let value = entity[
        field as keyof AiProviderConfigurationEntity
      ] as AuditChangeValue;
      if (field === "baseUrl" && typeof value === "string") {
        const url = new URL(value);
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        value = url.toString();
      }
      return [field, value ?? null];
    }),
  );
}

@Injectable()
export class AiProviderConfigurationsService {
  constructor(
    @InjectRepository(AiProviderConfigurationEntity)
    private readonly configurations: Repository<AiProviderConfigurationEntity>,
    private readonly dataSource: DataSource,
    @Inject(AI_SECRET_VAULT)
    private readonly vault: AiSecretVault,
  ) {}

  async auditHistory(
    context: AiProviderActorContext,
    query: Readonly<Record<string, unknown>>,
  ): Promise<AuditHistoryResponse> {
    this.requireAdministrator(context.actor);
    const page = await readAuditHistory(
      this.dataSource
        .getRepository(AiProviderAuditEntity)
        .createQueryBuilder("audit")
        .leftJoinAndMapOne(
          "audit.provider",
          AiProviderConfigurationEntity,
          "provider",
          "provider.id = audit.providerConfigurationId",
        ),
      query,
      {
        date: "audit.createdAt",
        id: "audit.id",
        result: "audit.outcome",
        search: [
          "audit.action",
          "provider.name",
          "audit.metadataJson",
          "CONVERT(nvarchar(36), audit.actorUserId)",
        ],
      },
    );
    return {
      ...page,
      items: page.items.map((value) => {
        const row = value as AiProviderAuditEntity & {
          provider?: AiProviderConfigurationEntity;
        };
        const metadata = auditMetadata(row.metadataJson);
        return {
          id: row.id,
          occurredAt: row.createdAt.toISOString(),
          action: `AI_PROVIDER_${row.action}`,
          actorUserId: row.actorUserId,
          actorName:
            typeof metadata.actorName === "string" ? metadata.actorName : null,
          resourceId:
            row.providerConfigurationId ??
            (typeof metadata.providerConfigurationId === "string"
              ? metadata.providerConfigurationId
              : null),
          resourceLabel:
            typeof metadata.resourceLabel === "string"
              ? metadata.resourceLabel
              : (row.provider?.name ??
                (typeof metadata.model === "string"
                  ? `Proveedor de IA · ${metadata.model}`
                  : "Proveedor de IA eliminado o sin referencia")),
          projectId: null,
          result: row.outcome as "SUCCEEDED" | "FAILED",
          changes: auditMetadataChanges(metadata, AI_AUDIT_FIELDS),
          details:
            row.action === "CREDENTIAL_ROTATED"
              ? "Credencial reemplazada. Su valor no se registra."
              : Array.isArray(metadata.changedFields)
                ? `Campos modificados: ${metadata.changedFields.filter((value) => typeof value === "string" && (AI_AUDIT_FIELDS as readonly string[]).includes(value)).join(", ")}`
                : null,
        };
      }),
    };
  }

  async list(
    context: AiProviderActorContext,
  ): Promise<AiProviderConfigurationListResponse> {
    this.requireAdministrator(context.actor);
    const entities = await this.configurations.find({
      order: { purpose: "ASC", isDefault: "DESC", name: "ASC" },
    });
    const items = await Promise.all(
      entities.map((entity) => this.toSummary(entity)),
    );

    return {
      items,
      totalItems: items.length,
      enabled: items.filter((item) => item.isEnabled).length,
      credentialConfigured: items.filter((item) => item.credentialConfigured)
        .length,
    };
  }

  /**
   * Catálogo de modelos que la clave de un proveedor OpenAI puede usar. La clave
   * se resuelve desde la bóveda en el servidor y nunca se devuelve ni se registra.
   */
  async listOpenAiModels(
    context: AiProviderActorContext,
    id: string,
  ): Promise<{ models: { id: string }[] }> {
    this.requireAdministrator(context.actor);
    const entity = await this.requireEntity(id);
    if (entity.providerType !== "OPENAI") {
      throw new ConflictException(
        "Solo los proveedores OpenAI pueden consultar su catálogo de modelos.",
      );
    }
    if (!entity.secretReference) {
      throw new ConflictException(
        "El proveedor OpenAI no tiene una credencial configurada.",
      );
    }
    const apiKey = await this.vault.resolve(entity.secretReference);
    const response = await fetch(`${entity.baseUrl}/models`, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(Math.min(entity.timeoutMs, 30_000)),
    });
    if (!response.ok) {
      throw new ConflictException(
        `OpenAI respondió con HTTP ${response.status}.`,
      );
    }
    const payload = (await response.json()) as {
      data?: ReadonlyArray<{ id?: unknown }>;
    };
    const ids = (payload.data ?? [])
      .map((model) => model.id)
      .filter((value): value is string => typeof value === "string");
    return {
      models: [...new Set(ids)].sort().map((modelId) => ({ id: modelId })),
    };
  }

  async listOllamaModels(
    context: AiProviderActorContext,
    requestedBaseUrl: string,
  ): Promise<OllamaInstalledModelsResponse> {
    this.requireAdministrator(context.actor);
    const baseUrl = parseOllamaBaseUrl(
      requestedBaseUrl,
      process.env.LOCAL_AI_ALLOW_DOCKER_HOST === "true",
      undefined,
      true,
    );
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/tags`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      // Servidor apagado, puerto equivocado o equipo inalcanzable.
      throw new ConflictException(
        `No hay un servidor Ollama respondiendo en ${baseUrl}. Verifica que esté iniciado (ollama serve) y que la dirección sea correcta.`,
      );
    }
    if (!response.ok) {
      throw new ConflictException(
        `Ollama respondió con HTTP ${response.status}.`,
      );
    }
    const payload = (await response.json()) as {
      models?: Array<{
        name?: string;
        model?: string;
        size?: number;
        details?: {
          parameter_size?: string;
          quantization_level?: string;
          context_length?: number;
        };
        capabilities?: string[];
      }>;
    };
    return {
      baseUrl,
      models: (payload.models ?? []).flatMap((model) => {
        const name = model.name ?? model.model;
        return name
          ? [
              {
                name,
                size: typeof model.size === "number" ? model.size : null,
                parameterSize: model.details?.parameter_size ?? null,
                quantizationLevel: model.details?.quantization_level ?? null,
                contextLength: model.details?.context_length ?? null,
                capabilities: Array.isArray(model.capabilities)
                  ? model.capabilities.filter(
                      (item): item is string => typeof item === "string",
                    )
                  : [],
              },
            ]
          : [];
      }),
    };
  }

  /** Catálogo `/v1/models` de un servidor compatible con OpenAI (llama-swap). */
  async listOpenAiCompatibleModels(
    context: AiProviderActorContext,
    requestedBaseUrl: string,
  ): Promise<OllamaInstalledModelsResponse> {
    this.requireAdministrator(context.actor);
    const baseUrl = parseOllamaBaseUrl(
      requestedBaseUrl,
      process.env.LOCAL_AI_ALLOW_DOCKER_HOST === "true",
      undefined,
      true,
    );
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/v1/models`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new ConflictException(
        `No hay un servidor compatible con OpenAI respondiendo en ${baseUrl}. Verifica que esté iniciado y que la dirección sea correcta.`,
      );
    }
    if (!response.ok) {
      throw new ConflictException(
        `El servidor respondió con HTTP ${response.status} en /v1/models.`,
      );
    }
    const payload = (await response.json()) as {
      data?: Array<{ id?: string }>;
    };
    return {
      baseUrl,
      models: (payload.data ?? []).flatMap((model) =>
        typeof model.id === "string" && model.id
          ? [
              {
                name: model.id,
                size: null,
                parameterSize: null,
                quantizationLevel: null,
                contextLength: null,
                capabilities: [],
              },
            ]
          : [],
      ),
    };
  }

  async create(
    context: AiProviderActorContext,
    input: CreateAiProviderConfiguration,
  ): Promise<AiProviderConfigurationSummary> {
    this.requireAdministrator(context.actor);
    await this.requireUniqueName(input.name);

    if (input.isDefault && !input.isEnabled) {
      throw new ConflictException(
        "El proveedor predeterminado debe estar habilitado.",
      );
    }

    const now = new Date();
    const id = randomUUID();
    const secretReference = `provider-${id}`;

    if (isCredentialProviderType(input.providerType)) {
      if (!input.apiKey)
        throw new ConflictException(
          `${providerLabel(input.providerType)} requiere una API key.`,
        );
      await this.vault.put(secretReference, input.apiKey);
    }

    try {
      await this.dataSource.transaction(async (manager) => {
        if (input.isDefault) {
          await this.clearDefaults(
            manager,
            context,
            input.providerType,
            input.purpose,
            id,
          );
        }

        await manager.save(
          manager.create(AiProviderConfigurationEntity, {
            id,
            name: input.name,
            providerType: input.providerType,
            purpose: input.purpose,
            model: input.model,
            baseUrl: input.baseUrl,
            isEnabled: input.isEnabled,
            isDefault: input.isDefault,
            timeoutMs: input.timeoutMs,
            maxInputTokens: input.maxInputTokens,
            maxOutputTokens: input.maxOutputTokens,
            maxAttempts: input.maxAttempts,
            secretReference,
            lastConnectionTestAt: null,
            lastConnectionTestStatus: "NOT_TESTED",
            lastErrorCode: null,
            createdByUserId: context.actor.id,
            updatedByUserId: context.actor.id,
            createdAt: now,
            updatedAt: now,
          }),
        );

        await this.saveAudit(manager, context, id, "CREATED", "SUCCEEDED", {
          providerType: input.providerType,
          purpose: input.purpose,
          model: input.model,
          resourceLabel: input.name,
          changes: auditFieldChanges(
            {},
            providerAuditSnapshot({
              ...input,
            } as AiProviderConfigurationEntity),
          ),
        });
      });
    } catch (error) {
      if (isCredentialProviderType(input.providerType))
        await this.vault.delete(secretReference);
      throw error;
    }

    return this.toSummary(await this.requireEntity(id));
  }

  async update(
    context: AiProviderActorContext,
    id: string,
    input: UpdateAiProviderConfiguration,
  ): Promise<AiProviderConfigurationSummary> {
    this.requireAdministrator(context.actor);
    const entity = await this.requireEntity(id);
    const before = providerAuditSnapshot(entity);

    if (input.name && input.name !== entity.name) {
      await this.requireUniqueName(input.name, id);
    }

    const nextEnabled = input.isEnabled ?? entity.isEnabled;
    const nextDefault = input.isDefault ?? entity.isDefault;

    if (nextDefault && !nextEnabled) {
      throw new ConflictException(
        "El proveedor predeterminado debe estar habilitado.",
      );
    }

    if (
      entity.isDefault &&
      input.isEnabled === false &&
      input.isDefault !== false
    ) {
      throw new ConflictException(
        "Quita el estado predeterminado antes de deshabilitar el proveedor.",
      );
    }

    await this.dataSource.transaction(async (manager) => {
      if (input.isDefault === true) {
        await this.clearDefaults(
          manager,
          context,
          entity.providerType,
          entity.purpose,
          id,
        );
      }

      Object.assign(entity, input, {
        isEnabled: nextEnabled,
        isDefault: nextDefault,
        updatedByUserId: context.actor.id,
        updatedAt: new Date(),
      });
      if (
        input.model !== undefined ||
        input.baseUrl !== undefined ||
        input.timeoutMs !== undefined
      ) {
        entity.lastConnectionTestAt = null;
        entity.lastConnectionTestStatus = "NOT_TESTED";
        entity.lastErrorCode = null;
      }
      await manager.save(entity);
      await this.saveAudit(manager, context, id, "UPDATED", "SUCCEEDED", {
        changes: auditFieldChanges(before, providerAuditSnapshot(entity)),
        changedFields: Object.keys(input).filter(
          (name) =>
            input[name as keyof UpdateAiProviderConfiguration] !== undefined,
        ),
      });
    });

    return this.toSummary(entity);
  }

  async duplicate(
    context: AiProviderActorContext,
    sourceId: string,
    input: DuplicateAiProviderConfiguration,
  ): Promise<AiProviderConfigurationSummary> {
    this.requireAdministrator(context.actor);
    const source = await this.requireEntity(sourceId);
    await this.requireUniqueName(input.name);

    if (
      input.providerType !== source.providerType ||
      input.purpose !== source.purpose
    ) {
      throw new ConflictException(
        "El tipo y el módulo del proveedor no pueden cambiarse al duplicar.",
      );
    }

    const now = new Date();
    const id = randomUUID();
    const secretReference = `provider-${id}`;

    if (isCredentialProviderType(source.providerType)) {
      const apiKey = await this.vault.resolve(source.secretReference);
      await this.vault.put(secretReference, apiKey);
    }

    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.save(
          manager.create(AiProviderConfigurationEntity, {
            id,
            name: input.name,
            providerType: source.providerType,
            purpose: source.purpose,
            model: input.model,
            baseUrl: input.baseUrl,
            isEnabled: false,
            isDefault: false,
            timeoutMs: input.timeoutMs,
            maxInputTokens: input.maxInputTokens,
            maxOutputTokens: input.maxOutputTokens,
            maxAttempts: input.maxAttempts,
            secretReference,
            lastConnectionTestAt: null,
            lastConnectionTestStatus: "NOT_TESTED",
            lastErrorCode: null,
            createdByUserId: context.actor.id,
            updatedByUserId: context.actor.id,
            createdAt: now,
            updatedAt: now,
          }),
        );

        await this.saveAudit(manager, context, id, "DUPLICATED", "SUCCEEDED", {
          resourceLabel: input.name,
          changes: auditFieldChanges(
            {},
            providerAuditSnapshot({
              ...source,
              ...input,
              isEnabled: false,
              isDefault: false,
            }),
          ),
          sourceProviderConfigurationId: sourceId,
          providerType: source.providerType,
          purpose: source.purpose,
          model: input.model,
        });
      });
    } catch (error) {
      if (isCredentialProviderType(source.providerType)) {
        await this.vault.delete(secretReference);
      }
      throw error;
    }

    return this.toSummary(await this.requireEntity(id));
  }

  async rotateCredential(
    context: AiProviderActorContext,
    id: string,
    input: RotateAiProviderCredential,
  ): Promise<AiProviderConfigurationSummary> {
    this.requireAdministrator(context.actor);
    const entity = await this.requireEntity(id);

    if (!isCredentialProviderType(entity.providerType)) {
      throw new ConflictException("Este proveedor no utiliza credenciales.");
    }

    const previousReference = entity.secretReference;
    const nextReference = `provider-${id}-${randomUUID()}`;
    await this.vault.put(nextReference, input.apiKey);
    entity.secretReference = nextReference;
    entity.updatedAt = new Date();
    entity.updatedByUserId = context.actor.id;
    entity.lastConnectionTestAt = null;
    entity.lastConnectionTestStatus = "NOT_TESTED";
    entity.lastErrorCode = null;
    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.save(entity);
        await this.saveAudit(
          manager,
          context,
          id,
          "CREDENTIAL_ROTATED",
          "SUCCEEDED",
          { resourceLabel: entity.name },
        );
      });
    } catch (error) {
      await this.vault.delete(nextReference);
      throw error;
    }
    await this.vault.delete(previousReference);

    return this.toSummary(entity);
  }

  async testConnection(
    context: AiProviderActorContext,
    id: string,
  ): Promise<AiProviderConnectionTestResult> {
    this.requireAdministrator(context.actor);
    const entity = await this.requireEntity(id);
    const testedAt = new Date();
    let succeeded = false;
    let errorCode: string | null = null;
    const cloudTest =
      isCloudRestProvider(entity.providerType);
    let message = cloudTest
      ? `Conexión y modelo validados con ${providerLabel(entity.providerType)}.`
      : entity.providerType === "OLLAMA"
        ? "Conexión y modelo local validados con Ollama."
        : entity.providerType === "OPENAI_COMPATIBLE"
          ? "Conexión y modelo validados en el servidor compatible con OpenAI."
          : entity.providerType === "OLLAMA_IMAGES"
            ? "Conexión, runtime 0.32.5 y modelo validados con Ollama Images."
            : entity.providerType === "COMFYUI"
              ? "Conexión validada con ComfyUI local."
              : "Conexión validada con OpenAI.";

    if (cloudTest) {
      let apiKey: string | null = null;
      try {
        apiKey = await this.vault.resolve(entity.secretReference);
      } catch {
        apiKey = null;
      }
      // Solicitud fija y mínima: no incluye datos del usuario ni documentos.
      const outcome = apiKey
        ? await testCloudTextProvider({ configuration: entity, apiKey })
        : {
            succeeded: false,
            errorCode: `${entity.providerType}_CREDENTIAL_MISSING`,
            message: `${providerLabel(entity.providerType)} no tiene una credencial válida configurada.`,
          };
      succeeded = outcome.succeeded;
      errorCode = outcome.errorCode;
      if (!outcome.succeeded) message = outcome.message;
    } else
      try {
        const apiKey =
          entity.providerType === "OPENAI"
            ? await this.vault.resolve(entity.secretReference)
            : null;
        const response = await fetch(
          entity.providerType === "OPENAI"
            ? `${entity.baseUrl}/models/${encodeURIComponent(entity.model)}`
            : entity.providerType === "OPENAI_COMPATIBLE"
              ? `${entity.baseUrl}/v1/models`
              : entity.providerType === "OLLAMA" ||
                  entity.providerType === "OLLAMA_IMAGES"
                ? `${entity.baseUrl}/api/tags`
                : `${entity.baseUrl}/system_stats`,
          {
            headers: {
              accept: "application/json",
              ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
            },
            signal: AbortSignal.timeout(entity.timeoutMs),
          },
        );

        succeeded = response.ok;

        if (succeeded && entity.providerType === "COMFYUI") {
          try {
            const workflowReference = parseComfyUiWorkflowReference(
              entity.model,
            );
            if (workflowReference) {
              loadComfyUiWorkflowTemplate(workflowReference);
              message = `Conexión y workflow ${workflowReference.fileName} validados con ComfyUI local.`;
            }
          } catch (error) {
            succeeded = false;
            errorCode = "COMFYUI_WORKFLOW_INVALID";
            message =
              error instanceof Error
                ? error.message
                : "El workflow local de ComfyUI no es válido.";
          }
        }

        if (
          succeeded &&
          (entity.providerType === "OLLAMA" ||
            entity.providerType === "OLLAMA_IMAGES")
        ) {
          const payload = (await response.json()) as {
            models?: Array<{ name?: string; model?: string }>;
          };
          succeeded =
            payload.models?.some(
              (model) =>
                model.name === entity.model || model.model === entity.model,
            ) === true;
          if (!succeeded) {
            errorCode =
              entity.providerType === "OLLAMA_IMAGES"
                ? "OLLAMA_IMAGES_MODEL_NOT_INSTALLED"
                : "OLLAMA_MODEL_NOT_INSTALLED";
            message = `El modelo ${entity.model} no está instalado en Ollama.`;
          }

          if (succeeded && entity.providerType === "OLLAMA_IMAGES") {
            const versionResponse = await fetch(
              `${entity.baseUrl}/api/version`,
              {
                headers: { accept: "application/json" },
                signal: AbortSignal.timeout(Math.min(entity.timeoutMs, 30_000)),
              },
            );
            const versionPayload = versionResponse.ok
              ? ((await versionResponse.json()) as { version?: string })
              : {};
            if (!versionResponse.ok || versionPayload.version !== "0.32.5") {
              succeeded = false;
              errorCode = "OLLAMA_IMAGES_RUNTIME_UNSUPPORTED";
              message =
                "Ollama Images debe apuntar al runtime 0.32.5 configurado en el puerto 11435.";
            }
          }
        }
        if (succeeded && entity.providerType === "OPENAI_COMPATIBLE") {
          const payload = (await response.json()) as {
            data?: Array<{ id?: string }>;
          };
          succeeded =
            payload.data?.some((model) => model.id === entity.model) === true;
          if (!succeeded) {
            errorCode = "OPENAI_COMPATIBLE_MODEL_NOT_AVAILABLE";
            message = `El modelo ${entity.model} no aparece en /v1/models del servidor.`;
          }
        }
        if (!response.ok) {
          errorCode = `${entity.providerType}_HTTP_${response.status}`;
          message =
            response.status === 401
              ? "OpenAI rechazó la credencial configurada."
              : `${entity.providerType} respondió con estado HTTP ${response.status}.`;
        }
      } catch (error) {
        const prefix = entity.providerType;
        errorCode =
          error instanceof Error && error.name === "TimeoutError"
            ? `${prefix}_TIMEOUT`
            : `${prefix}_UNAVAILABLE`;
        message = errorCode.endsWith("_TIMEOUT")
          ? `La validación con ${entity.providerType} excedió el tiempo límite.`
          : `No fue posible establecer conexión con ${entity.providerType}.`;
      }

    entity.lastConnectionTestAt = testedAt;
    entity.lastConnectionTestStatus = succeeded ? "SUCCEEDED" : "FAILED";
    entity.lastErrorCode = errorCode;
    entity.updatedAt = testedAt;
    entity.updatedByUserId = context.actor.id;
    await this.configurations.save(entity);
    await this.saveAudit(
      this.dataSource.manager,
      context,
      id,
      "CONNECTION_TESTED",
      succeeded ? "SUCCEEDED" : "FAILED",
      { errorCode },
    );

    return {
      providerConfiguration: await this.toSummary(entity),
      succeeded,
      testedAt: iso(testedAt),
      message,
    };
  }

  async delete(
    context: AiProviderActorContext,
    id: string,
  ): Promise<{ deleted: true; id: string }> {
    this.requireAdministrator(context.actor);
    const entity = await this.requireEntity(id);

    if (entity.isEnabled || entity.isDefault) {
      throw new ConflictException(
        "Deshabilita el proveedor y quita su estado predeterminado antes de eliminarlo.",
      );
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.remove(entity);
      await this.saveAudit(manager, context, null, "DELETED", "SUCCEEDED", {
        providerConfigurationId: id,
        providerType: entity.providerType,
        resourceLabel: entity.name,
        changes: auditFieldChanges(providerAuditSnapshot(entity), {}),
      });
    });
    if (isCredentialProviderType(entity.providerType))
      await this.vault.delete(entity.secretReference);

    return { deleted: true, id };
  }

  async resolveDefault(
    selectedId?: string,
    snapshot?: SelectedProviderSnapshot,
  ): Promise<ResolvedAiProvider> {
    if (selectedId) {
      const configuration = await resolveSelectedProvider(
        this.configurations,
        "CLOUD",
        selectedId,
        snapshot,
      );
      return {
        configuration,
        apiKey: await this.vault.resolve(configuration.secretReference),
      };
    }
    const configuration = await this.configurations.findOneBy({
      isEnabled: true,
      isDefault: true,
      providerType: "OPENAI",
      purpose: "TEXT",
    });

    if (!configuration) {
      throw new ConflictException(
        "No hay un proveedor de IA habilitado y predeterminado.",
      );
    }

    return {
      configuration,
      apiKey: await this.vault.resolve(configuration.secretReference),
    };
  }

  async selectableProviders(): Promise<
    import("@levantamiento-rq/shared-contracts").AiSelectableProvider[]
  > {
    const providers = await this.configurations.find({
      order: { isDefault: "DESC", name: "ASC" },
    });
    return providers
      .filter(
        (p) =>
          p.purpose === "TEXT" &&
          (isCredentialProviderType(p.providerType) ||
            p.providerType === "OLLAMA" ||
            p.providerType === "OPENAI_COMPATIBLE"),
      )
      .map((p) => ({
        id: p.id,
        name: p.name,
        model: p.model,
        engine: isCredentialProviderType(p.providerType) ? "CLOUD" : "LOCAL",
        available: p.isEnabled && p.lastConnectionTestStatus === "SUCCEEDED",
        isDefault: p.isDefault,
        maxInputTokens: p.maxInputTokens,
        message: !p.isEnabled
          ? "Deshabilitado en Configuración"
          : p.lastConnectionTestStatus !== "SUCCEEDED"
            ? "Requiere prueba de conexión"
            : "Disponible",
      }));
  }

  async resolveImageProviderConfiguration(
    selectedId: string,
  ): Promise<AiProviderConfigurationEntity> {
    const configuration = await this.configurations.findOneBy({
      id: selectedId,
      purpose: "IMAGE",
      isEnabled: true,
    });

    if (
      !configuration ||
      !["OPENAI", "COMFYUI", "OLLAMA_IMAGES"].includes(
        configuration.providerType,
      )
    ) {
      throw new ConflictException(
        "El proveedor de imágenes seleccionado no está habilitado.",
      );
    }

    if (configuration.lastConnectionTestStatus !== "SUCCEEDED") {
      throw new ConflictException(
        "El proveedor de imágenes seleccionado requiere una prueba de conexión correcta.",
      );
    }

    return configuration;
  }

  async selectableImageProviders(): Promise<
    import("@levantamiento-rq/shared-contracts").PrototypeAiOption[]
  > {
    const providers = await this.configurations.find({
      order: { isDefault: "DESC", name: "ASC" },
    });

    return providers
      .filter(
        (provider) =>
          provider.purpose === "IMAGE" &&
          (provider.providerType === "OPENAI" ||
            provider.providerType === "COMFYUI" ||
            provider.providerType === "OLLAMA_IMAGES"),
      )
      .map((provider) => {
        const connectionReady =
          provider.isEnabled &&
          provider.lastConnectionTestStatus === "SUCCEEDED";
        const automaticCheckpoint =
          provider.providerType === "COMFYUI" &&
          ["workflow-pendiente", "auto", "auto-checkpoint"].includes(
            provider.model.trim().toLowerCase(),
          );

        return {
          id: provider.id,
          name: provider.name,
          model: automaticCheckpoint ? "Checkpoint automático" : provider.model,
          provider:
            provider.providerType === "COMFYUI"
              ? ("COMFYUI" as const)
              : provider.providerType === "OLLAMA_IMAGES"
                ? ("OLLAMA_IMAGES" as const)
                : ("OPENAI_IMAGES" as const),
          available: connectionReady,
          isDefault: provider.isDefault,
          message: !provider.isEnabled
            ? "Deshabilitado en Configuración"
            : provider.lastConnectionTestStatus !== "SUCCEEDED"
              ? "Requiere prueba de conexión"
              : provider.providerType === "COMFYUI"
                ? "Workflow integrado con Generar prototipo"
                : "Disponible",
        };
      });
  }

  async resolveImageProvider(selectedId: string): Promise<{
    configuration: AiProviderConfigurationEntity;
    apiKey: string | null;
  }> {
    const configuration = await this.configurations.findOneBy({
      id: selectedId,
      purpose: "IMAGE",
    });
    if (
      !configuration ||
      (configuration.providerType !== "OPENAI" &&
        configuration.providerType !== "COMFYUI")
    ) {
      throw new ConflictException(
        "El proveedor seleccionado no corresponde al módulo de generación de imágenes.",
      );
    }
    if (!configuration.isEnabled) {
      throw new ConflictException(
        "El proveedor de imágenes seleccionado está deshabilitado.",
      );
    }
    if (configuration.lastConnectionTestStatus !== "SUCCEEDED") {
      throw new ConflictException(
        "Prueba la conexión del proveedor de imágenes en Configuración antes de utilizarlo.",
      );
    }
    return {
      configuration,
      apiKey:
        configuration.providerType === "OPENAI"
          ? await this.vault.resolve(configuration.secretReference)
          : null,
    };
  }

  private requireAdministrator(actor: AuthenticatedUser): void {
    if (!actor.permissions.includes("system.admin")) {
      throw new ForbiddenException(
        "Solo un administrador puede configurar proveedores de IA.",
      );
    }
  }

  private async requireEntity(
    id: string,
  ): Promise<AiProviderConfigurationEntity> {
    const entity = await this.configurations.findOneBy({ id });
    if (!entity) {
      throw new NotFoundException("La configuración del proveedor no existe.");
    }
    return entity;
  }

  private async requireUniqueName(
    name: string,
    excludedId?: string,
  ): Promise<void> {
    const entity = await this.configurations.findOneBy(
      excludedId ? { name, id: Not(excludedId) } : { name },
    );
    if (entity) {
      throw new ConflictException("Ya existe un proveedor con ese nombre.");
    }
  }

  private async toSummary(
    entity: AiProviderConfigurationEntity,
  ): Promise<AiProviderConfigurationSummary> {
    return {
      id: entity.id,
      name: entity.name,
      providerType: entity.providerType,
      purpose: entity.purpose,
      model: entity.model,
      baseUrl: entity.baseUrl,
      isEnabled: entity.isEnabled,
      isDefault: entity.isDefault,
      timeoutMs: entity.timeoutMs,
      maxInputTokens: entity.maxInputTokens,
      maxOutputTokens: entity.maxOutputTokens,
      maxAttempts: entity.maxAttempts,
      credentialConfigured: isCredentialProviderType(entity.providerType)
        ? await this.vault.has(entity.secretReference)
        : false,
      requiresCredential: isCredentialProviderType(entity.providerType),
      lastConnectionTestAt: optionalIso(entity.lastConnectionTestAt),
      lastConnectionTestStatus: entity.lastConnectionTestStatus,
      lastErrorCode: entity.lastErrorCode,
      createdAt: iso(entity.createdAt),
      updatedAt: iso(entity.updatedAt),
    };
  }

  private async clearDefaults(
    manager: DataSource["manager"],
    context: AiProviderActorContext,
    providerType: AiProviderConfigurationEntity["providerType"],
    purpose: AiProviderConfigurationEntity["purpose"],
    exceptId: string,
  ): Promise<void> {
    const previous = await manager.find(AiProviderConfigurationEntity, {
      where: { isDefault: true, providerType, purpose, id: Not(exceptId) },
    });
    for (const item of previous) {
      item.isDefault = false;
      item.updatedByUserId = context.actor.id;
      item.updatedAt = new Date();
      await manager.save(item);
      await this.saveAudit(manager, context, item.id, "UPDATED", "SUCCEEDED", {
        resourceLabel: item.name,
        changes: [{ field: "isDefault", before: true, after: false }],
      });
    }
  }

  private async saveAudit(
    manager: DataSource["manager"],
    context: AiProviderActorContext,
    providerConfigurationId: string | null,
    action: string,
    outcome: "SUCCEEDED" | "FAILED",
    metadata: unknown,
  ): Promise<void> {
    await manager.save(
      manager.create(AiProviderAuditEntity, {
        id: randomUUID(),
        providerConfigurationId,
        action,
        actorUserId: context.actor.id,
        correlationId: context.correlationId.slice(0, 100),
        outcome,
        metadataJson: JSON.stringify({
          ...(metadata && typeof metadata === "object" ? metadata : {}),
          actorName: context.actor.displayName,
          resourceLabel:
            (metadata as { resourceLabel?: string } | null)?.resourceLabel ??
            (providerConfigurationId
              ? (
                  await manager.findOneBy(AiProviderConfigurationEntity, {
                    id: providerConfigurationId,
                  })
                )?.name
              : null) ??
            "Proveedor de IA",
        }),
        createdAt: new Date(),
      }),
    );
  }
}
