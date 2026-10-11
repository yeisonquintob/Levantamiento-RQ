import { createHash } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import type {
  PrototypeGenerationCreateRequest,
  PrototypeGenerationDetail,
  PrototypeScreenDetail,
} from "@levantamiento-rq/shared-contracts";
import { PrototypeGenerationEntity } from "./prototype-generation.entity";
import { PrototypeScreenEntity } from "./prototype-screen.entity";

export function normalizeMarkdown(markdown: string): string {
  return markdown.replace(/\r\n?/g, "\n");
}
export function markdownSha256(markdown: string): string {
  return createHash("sha256")
    .update(normalizeMarkdown(markdown), "utf8")
    .digest("hex");
}

@Injectable()
export class PrototypeGenerationService {
  constructor(
    @InjectRepository(PrototypeGenerationEntity)
    private readonly generations: Repository<PrototypeGenerationEntity>,
    @InjectRepository(PrototypeScreenEntity)
    private readonly screens: Repository<PrototypeScreenEntity>,
  ) {}

  async createSource(
    input: PrototypeGenerationCreateRequest,
    requestedByUserId: string,
  ): Promise<PrototypeGenerationDetail> {
    const markdown = normalizeMarkdown(input.markdown);
    const entity = this.generations.create({
      projectId: input.projectId ?? null,
      sourceFileName: input.sourceFileName,
      plannerConfigurationId: input.plannerConfigurationId ?? null,
      imageConfigurationId: input.imageConfigurationId ?? null,
      sourceMarkdown: markdown,
      sourceSha256: markdownSha256(markdown),
      sourceSizeBytes: String(Buffer.byteLength(markdown, "utf8")),
      targetDevice: input.targetDevice,
      status: "SOURCE_READY",
      plannerProvider: null,
      plannerModel: null,
      applicationName: null,
      summary: null,
      imageProvider: null,
      totalScreens: 0,
      generatedScreens: 0,
      totalVisualSpecifications: 0,
      totalImages: 0,
      completedImages: 0,
      failedImages: 0,
      errorCode: null,
      errorMessage: null,
      requestedByUserId,
    });
    return this.toDetail(await this.generations.save(entity));
  }

  async getGeneration(
    id: string,
    requestedByUserId: string,
  ): Promise<PrototypeGenerationDetail> {
    const entity = await this.generations.findOne({
      where: { id, requestedByUserId },
    });
    if (!entity)
      throw new NotFoundException("La generación de prototipo no existe.");
    return this.toDetail(entity);
  }

  async listGenerations(
    requestedByUserId: string,
  ): Promise<PrototypeGenerationDetail[]> {
    const entities = await this.generations.find({
      where: { requestedByUserId },
      order: { updatedAt: "DESC", createdAt: "DESC" },
      take: 250,
    });
    return entities.map((entity) => this.toDetail(entity));
  }

  async listScreens(
    generationId: string,
    requestedByUserId: string,
  ): Promise<PrototypeScreenDetail[]> {
    const generation = await this.generations.findOne({
      where: { id: generationId, requestedByUserId },
    });
    if (!generation)
      throw new NotFoundException("La generación de prototipo no existe.");
    const screens = await this.screens.find({
      where: { generationId },
      order: { order: "ASC" },
    });
    return screens.map((screen) => ({
      id: screen.id,
      generationId: screen.generationId,
      order: screen.order,
      code: screen.code,
      name: screen.name,
      objective: screen.objective,
      origin: screen.origin,
      route: screen.route,
      device: screen.device,
      status: screen.status,
      imageStorageKey: screen.imageStorageKey,
      components: JSON.parse(screen.componentsJson) as string[],
    }));
  }

  private toDetail(
    entity: PrototypeGenerationEntity,
  ): PrototypeGenerationDetail {
    return {
      id: entity.id,
      plannerConfigurationId: entity.plannerConfigurationId ?? null,
      imageConfigurationId: entity.imageConfigurationId ?? null,
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
