import { randomUUID } from "node:crypto";
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, type Repository } from "typeorm";
import type {
  PrototypeGenerationDetail,
  PrototypeScreenDetail,
  PrototypeVisualSpecification,
  PrototypeVisualSpecificationBuildResult,
} from "@levantamiento-rq/shared-contracts";
import { PrototypeGenerationEntity } from "../prototypes/prototype-generation.entity";
import { PrototypeScreenEntity } from "../prototypes/prototype-screen.entity";
import { PrototypeVisualSpecificationBuilder } from "./prototype-visual-specification.builder";
import { PrototypeVisualSpecificationEntity } from "./prototype-visual-specification.entity";

@Injectable()
export class PrototypeVisualSpecificationService {
  constructor(
    @InjectRepository(PrototypeGenerationEntity)
    private readonly generations: Repository<PrototypeGenerationEntity>,
    @InjectRepository(PrototypeScreenEntity)
    private readonly screens: Repository<PrototypeScreenEntity>,
    @InjectRepository(PrototypeVisualSpecificationEntity)
    private readonly specifications: Repository<PrototypeVisualSpecificationEntity>,
    private readonly dataSource: DataSource,
    private readonly builder: PrototypeVisualSpecificationBuilder,
  ) {}
  async buildForGeneration(
    id: string,
    requestedByUserId: string,
    selectedScreenCodes?: string[],
  ): Promise<PrototypeVisualSpecificationBuildResult> {
    const generation = await this.requireGeneration(id, requestedByUserId);
    if (
      generation.status !== "PLANNED" &&
      generation.status !== "VISUAL_SPEC_READY"
    )
      throw new ConflictException(
        "La generación debe tener un plan listo antes de preparar el formato visual.",
      );
    const previousStatus = generation.status;
    generation.status = "VISUAL_SPEC_BUILDING";
    generation.errorCode = null;
    generation.errorMessage = null;
    generation.updatedAt = new Date();
    await this.generations.save(generation);
    try {
      const screens = await this.screens.find({
        where: { generationId: id },
        order: { order: "ASC" },
      });
      if (screens.length === 0) throw new Error("PROTOTYPE_SCREENS_EMPTY");
      const selected = selectedScreenCodes?.length
        ? screens.filter((screen) => selectedScreenCodes.includes(screen.code))
        : screens;
      if (selected.length !== (selectedScreenCodes?.length ?? selected.length))
        throw new Error("PROTOTYPE_SCREEN_SELECTION_INVALID");
      const drafts = selected.flatMap((screen) =>
        this.builder.build(this.screenDetail(screen), generation.targetDevice, {
          applicationName: generation.applicationName,
          applicationSummary: generation.summary,
          screens,
        }),
      );
      const now = new Date();
      const entities = drafts.map((draft) =>
        this.specifications.create({
          id: randomUUID(),
          generationId: draft.generationId,
          screenId: draft.screenId,
          device: draft.device,
          templateCode: draft.templateCode,
          designSystemCode: draft.designSystemCode,
          specificationJson: JSON.stringify(draft),
          createdAt: now,
          updatedAt: now,
        }),
      );
      await this.dataSource.transaction(async (manager) => {
        await manager.delete(PrototypeVisualSpecificationEntity, {
          generationId: id,
        });
        await manager.save(PrototypeVisualSpecificationEntity, entities);
        Object.assign(generation, {
          status: "VISUAL_SPEC_READY",
          totalVisualSpecifications: entities.length,
          errorCode: null,
          errorMessage: null,
          updatedAt: now,
        });
        await manager.save(PrototypeGenerationEntity, generation);
      });
      const result = entities.map((entity) => this.detail(entity));
      return {
        generation: this.generationDetail(generation),
        specifications: result,
        webCount: result.filter((item) => item.device === "WEB").length,
        mobileCount: result.filter((item) => item.device === "MOBILE").length,
        total: result.length,
      };
    } catch {
      // El plan sigue vigente: se vuelve al estado anterior para poder reintentar sin reinterpretar
      // el Markdown (pasar a FAILED lo hacía parecer un fallo de planificación).
      Object.assign(generation, {
        status: previousStatus,
        errorCode: "PROTOTYPE_VISUAL_SPEC_FAILED",
        errorMessage: "No fue posible preparar las especificaciones visuales.",
        updatedAt: new Date(),
      });
      await this.generations.save(generation);
      throw new ConflictException(
        "No fue posible preparar las especificaciones visuales.",
      );
    }
  }
  async list(
    id: string,
    requestedByUserId: string,
  ): Promise<PrototypeVisualSpecification[]> {
    await this.requireGeneration(id, requestedByUserId);
    return (
      await this.specifications.find({
        where: { generationId: id },
        order: { device: "ASC", createdAt: "ASC" },
      })
    ).map((entity) => this.detail(entity));
  }
  private async requireGeneration(id: string, requestedByUserId: string) {
    const generation = await this.generations.findOne({
      where: { id, requestedByUserId },
    });
    if (!generation)
      throw new NotFoundException("La generación de prototipo no existe.");
    return generation;
  }
  private screenDetail(screen: PrototypeScreenEntity): PrototypeScreenDetail {
    return {
      id: screen.id,
      generationId: screen.generationId,
      order: screen.order,
      code: screen.code,
      name: screen.name,
      objective: screen.objective,
      origin: screen.origin,
      route: screen.route,
      components: JSON.parse(screen.componentsJson) as string[],
      device: screen.device,
      status: screen.status,
      imageStorageKey: screen.imageStorageKey,
    };
  }
  private detail(
    entity: PrototypeVisualSpecificationEntity,
  ): PrototypeVisualSpecification {
    const value = JSON.parse(entity.specificationJson) as Omit<
      PrototypeVisualSpecification,
      "id" | "createdAt" | "updatedAt"
    >;
    return {
      ...value,
      id: entity.id,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
  private generationDetail(
    entity: PrototypeGenerationEntity,
  ): PrototypeGenerationDetail {
    return {
      id: entity.id,
      projectId: entity.projectId,
      sourceFileName: entity.sourceFileName,
      sourceSizeBytes: Number(entity.sourceSizeBytes),
      sourceSha256: entity.sourceSha256,
      targetDevice: entity.targetDevice,
      status: entity.status,
      plannerProvider: entity.plannerProvider,
      plannerModel: entity.plannerModel,
      applicationName: entity.applicationName,
      summary: entity.summary,
      imageProvider: entity.imageProvider,
      totalScreens: entity.totalScreens,
      generatedScreens: entity.generatedScreens,
      totalVisualSpecifications: entity.totalVisualSpecifications,
      totalImages: entity.totalImages,
      completedImages: entity.completedImages,
      failedImages: entity.failedImages,
      errorCode: entity.errorCode,
      errorMessage: entity.errorMessage,
      requestedByUserId: entity.requestedByUserId,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}
