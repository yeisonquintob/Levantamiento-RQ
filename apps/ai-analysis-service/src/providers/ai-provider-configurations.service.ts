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
  RotateAiProviderCredential,
  UpdateAiProviderConfiguration,
} from "@levantamiento-rq/shared-contracts";

import { AiProviderAuditEntity } from "./ai-provider-audit.entity";
import { AiProviderConfigurationEntity } from "./ai-provider-configuration.entity";
import { AI_SECRET_VAULT, type AiSecretVault } from "./ai-secret-vault";

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

@Injectable()
export class AiProviderConfigurationsService {
  constructor(
    @InjectRepository(AiProviderConfigurationEntity)
    private readonly configurations: Repository<AiProviderConfigurationEntity>,
    private readonly dataSource: DataSource,
    @Inject(AI_SECRET_VAULT)
    private readonly vault: AiSecretVault,
  ) {}

  async list(
    context: AiProviderActorContext,
  ): Promise<AiProviderConfigurationListResponse> {
    this.requireAdministrator(context.actor);
    const entities = await this.configurations.find({
      order: { isDefault: "DESC", name: "ASC" },
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

    await this.vault.put(secretReference, input.apiKey);

    try {
      await this.dataSource.transaction(async (manager) => {
        if (input.isDefault) {
          await manager.update(
            AiProviderConfigurationEntity,
            { isDefault: true },
            { isDefault: false },
          );
        }

        await manager.save(
          manager.create(AiProviderConfigurationEntity, {
            id,
            name: input.name,
            providerType: input.providerType,
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
          model: input.model,
        });
      });
    } catch (error) {
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
        await manager.update(
          AiProviderConfigurationEntity,
          { isDefault: true, id: Not(id) },
          { isDefault: false },
        );
      }

      Object.assign(entity, input, {
        isEnabled: nextEnabled,
        isDefault: nextDefault,
        updatedByUserId: context.actor.id,
        updatedAt: new Date(),
      });
      await manager.save(entity);
      await this.saveAudit(manager, context, id, "UPDATED", "SUCCEEDED", {
        changedFields: Object.keys(input).filter(
          (name) =>
            input[name as keyof UpdateAiProviderConfiguration] !== undefined,
        ),
      });
    });

    return this.toSummary(entity);
  }

  async rotateCredential(
    context: AiProviderActorContext,
    id: string,
    input: RotateAiProviderCredential,
  ): Promise<AiProviderConfigurationSummary> {
    this.requireAdministrator(context.actor);
    const entity = await this.requireEntity(id);

    await this.vault.put(entity.secretReference, input.apiKey);
    entity.updatedAt = new Date();
    entity.updatedByUserId = context.actor.id;
    entity.lastConnectionTestAt = null;
    entity.lastConnectionTestStatus = "NOT_TESTED";
    entity.lastErrorCode = null;
    await this.configurations.save(entity);
    await this.saveAudit(
      this.dataSource.manager,
      context,
      id,
      "CREDENTIAL_ROTATED",
      "SUCCEEDED",
      null,
    );

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
    let message = "Conexión validada con OpenAI.";

    try {
      const apiKey = await this.vault.resolve(entity.secretReference);
      const response = await fetch(
        `${entity.baseUrl}/models/${encodeURIComponent(entity.model)}`,
        {
          headers: {
            accept: "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          signal: AbortSignal.timeout(entity.timeoutMs),
        },
      );

      succeeded = response.ok;
      if (!response.ok) {
        errorCode = `OPENAI_HTTP_${response.status}`;
        message =
          response.status === 401
            ? "OpenAI rechazó la credencial configurada."
            : `OpenAI respondió con estado HTTP ${response.status}.`;
      }
    } catch (error) {
      errorCode =
        error instanceof Error && error.name === "TimeoutError"
          ? "OPENAI_TIMEOUT"
          : "OPENAI_UNAVAILABLE";
      message =
        errorCode === "OPENAI_TIMEOUT"
          ? "La validación con OpenAI excedió el tiempo límite."
          : "No fue posible establecer conexión con OpenAI.";
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

    await this.configurations.remove(entity);
    await this.vault.delete(entity.secretReference);
    await this.saveAudit(
      this.dataSource.manager,
      context,
      null,
      "DELETED",
      "SUCCEEDED",
      { providerConfigurationId: id, providerType: entity.providerType },
    );

    return { deleted: true, id };
  }

  async resolveDefault(): Promise<ResolvedAiProvider> {
    const configuration = await this.configurations.findOneBy({
      isEnabled: true,
      isDefault: true,
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
      model: entity.model,
      baseUrl: entity.baseUrl,
      isEnabled: entity.isEnabled,
      isDefault: entity.isDefault,
      timeoutMs: entity.timeoutMs,
      maxInputTokens: entity.maxInputTokens,
      maxOutputTokens: entity.maxOutputTokens,
      maxAttempts: entity.maxAttempts,
      credentialConfigured: await this.vault.has(entity.secretReference),
      lastConnectionTestAt: optionalIso(entity.lastConnectionTestAt),
      lastConnectionTestStatus: entity.lastConnectionTestStatus,
      lastErrorCode: entity.lastErrorCode,
      createdAt: iso(entity.createdAt),
      updatedAt: iso(entity.updatedAt),
    };
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
        metadataJson: metadata === null ? null : JSON.stringify(metadata),
        createdAt: new Date(),
      }),
    );
  }
}
