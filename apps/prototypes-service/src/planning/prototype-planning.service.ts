import { randomUUID } from "node:crypto";
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, type Repository } from "typeorm";
import {
  parsePrototypeScreenDetail,
  type PrototypePlanningResult,
  type PrototypeScreenDetailResult,
} from "@levantamiento-rq/shared-contracts";
import { AiAnalysisStructuredExecutionClient } from "./ai-analysis-structured-execution.client";
import { PrototypeGenerationEntity } from "../prototypes/prototype-generation.entity";
import { PrototypeScreenEntity } from "../prototypes/prototype-screen.entity";
import { PrototypeVisualSpecificationEntity } from "../visual/prototype-visual-specification.entity";
import {
  PROTOTYPE_PLANNER_PROVIDER,
  type PrototypePlannerProvider,
  PrototypePlannerError,
} from "./prototype-planner.provider";

@Injectable()
export class PrototypePlanningService {
  private readonly logger = new Logger(PrototypePlanningService.name);
  constructor(
    @InjectRepository(PrototypeGenerationEntity)
    private readonly generations: Repository<PrototypeGenerationEntity>,
    private readonly dataSource: DataSource,
    @Inject(PROTOTYPE_PLANNER_PROVIDER)
    private readonly planner: PrototypePlannerProvider,
    @Optional()
    private readonly structured?: AiAnalysisStructuredExecutionClient,
  ) {}

  /**
   * Detalla UNA pantalla con la IA elegida: la pantalla es el foco y el Markdown completo es la
   * fuente, así el modelo no resume todo el documento a la vez. Si la IA falla, la pantalla
   * conserva su detalle anterior.
   */
  async detailScreen(
    id: string,
    screenId: string,
    requestedByUserId: string,
    correlationId: string = randomUUID(),
  ): Promise<PrototypeScreenDetailResult> {
    if (!this.structured)
      throw new ConflictException("El detalle de pantallas no está disponible.");
    const generation = await this.generations.findOne({
      where: { id, requestedByUserId },
    });
    if (!generation)
      throw new NotFoundException("La generación de prototipo no existe.");
    if (generation.status !== "PLANNED")
      throw new ConflictException(
        "Solo se puede detallar una pantalla mientras el plan está listo y antes de preparar el diseño.",
      );
    const screens = this.dataSource.getRepository(PrototypeScreenEntity);
    const [screen, all] = await Promise.all([
      screens.findOne({ where: { id: screenId, generationId: id } }),
      screens.find({ where: { generationId: id }, order: { order: "ASC" } }),
    ]);
    if (!screen) throw new NotFoundException("La pantalla no existe.");
    const previous = this.componentList(screen.componentsJson);
    const result = await this.structured.executeScreenDetail(
      {
        purpose: "PROTOTYPE_SCREEN_DETAIL",
        ...(generation.plannerConfigurationId
          ? { providerConfigurationId: generation.plannerConfigurationId }
          : {}),
        input: {
          markdown: generation.sourceMarkdown,
          applicationName: generation.applicationName ?? "Aplicación",
          summary: generation.summary ?? "",
          menu: all.map((item) => item.name),
          screen: {
            code: screen.code,
            name: screen.name,
            objective: screen.objective,
            route: screen.route,
            components: previous,
          },
        },
      },
      correlationId,
    );
    const detail = parsePrototypeScreenDetail(result.structuredResult);
    // Lo nuevo manda; lo anterior solo se conserva si el modelo no lo cubrió.
    const seen = new Set(detail.components.map((item) => item.toLowerCase()));
    const components = [
      ...detail.components,
      ...previous.filter((item) => !seen.has(item.toLowerCase())),
    ];
    screen.componentsJson = JSON.stringify(components);
    if (detail.objective.length >= screen.objective.length)
      screen.objective = detail.objective;
    await screens.save(screen);
    generation.updatedAt = new Date();
    await this.generations.save(generation);
    return {
      generation: this.detail(generation),
      screen: {
        id: screen.id,
        generationId: screen.generationId,
        order: screen.order,
        code: screen.code,
        name: screen.name,
        objective: screen.objective,
        origin: screen.origin,
        route: screen.route,
        components,
        device: screen.device,
        status: screen.status,
        imageStorageKey: screen.imageStorageKey,
      },
      provider: result.provider,
      model: result.model,
      executionId: result.executionId,
      previousComponentCount: previous.length,
      componentCount: components.length,
    };
  }
  private componentList(json: string): string[] {
    try {
      const parsed: unknown = JSON.parse(json);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      return [];
    }
  }
  async planGeneration(
    id: string,
    requestedByUserId: string,
    // `string` (no el tipo literal de randomUUID): el controlador pasa el valor
    // de la cabecera, que puede venir sin formato UUID.
    correlationId: string = randomUUID(),
  ): Promise<PrototypePlanningResult> {
    const generation = await this.generations.findOne({
      where: { id, requestedByUserId },
    });
    if (!generation)
      throw new NotFoundException("La generación de prototipo no existe.");
    if (!generation.sourceMarkdown.trim())
      throw new ConflictException(
        "El Markdown de la generación no está disponible.",
      );
    if (
      !(
        ["SOURCE_READY", "PLANNED", "VISUAL_SPEC_READY", "FAILED"] as string[]
      ).includes(generation.status)
    )
      throw new ConflictException("La generación ya está siendo planificada.");
    const startedAt = new Date();
    generation.status = "PLANNING";
    generation.errorCode = null;
    generation.errorMessage = null;
    generation.updatedAt = startedAt;
    await this.generations.save(generation);
    try {
      const result = await this.planner.plan({
        markdown: generation.sourceMarkdown,
        targetDevice: generation.targetDevice,
        correlationId,
        providerConfigurationId: generation.plannerConfigurationId ?? undefined,
      });
      const completedAt = new Date();
      await this.dataSource.transaction(async (manager) => {
        await manager.delete(PrototypeVisualSpecificationEntity, {
          generationId: generation.id,
        });
        await manager.delete(PrototypeScreenEntity, {
          generationId: generation.id,
        });
        await manager.save(
          PrototypeScreenEntity,
          result.plan.screens.map((screen) =>
            manager.create(PrototypeScreenEntity, {
              generationId: generation.id,
              order: screen.order,
              code: screen.code,
              name: screen.name,
              objective: screen.objective,
              origin: screen.origin,
              route: screen.route,
              componentsJson: JSON.stringify(screen.components),
              device: generation.targetDevice,
              status: "PLANNED",
              imageStorageKey: null,
            }),
          ),
        );
        Object.assign(generation, {
          status: "PLANNED",
          plannerProvider: result.provider,
          plannerModel: result.model,
          applicationName: result.plan.applicationName,
          summary: result.plan.summary,
          totalScreens: result.plan.screens.length,
          generatedScreens: 0,
          totalVisualSpecifications: 0,
          totalImages: 0,
          completedImages: 0,
          failedImages: 0,
          errorCode: null,
          errorMessage: null,
          updatedAt: completedAt,
        });
        await manager.save(PrototypeGenerationEntity, generation);
      });
      this.logger.log(
        JSON.stringify({
          generationId: id,
          provider: result.provider,
          model: result.model,
          executionId: result.executionId,
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          status: "PLANNED",
        }),
      );
      return {
        generation: this.detail(generation),
        plan: result.plan,
        provider: result.provider,
        model: result.model,
        executionId: result.executionId,
      };
    } catch (error) {
      const code =
        error instanceof PrototypePlannerError
          ? error.code
          : error instanceof Error && error.message === "PROTOTYPE_PLAN_EMPTY"
            ? "PROTOTYPE_PLAN_EMPTY"
            : "PROTOTYPE_PLANNING_FAILED";
      const message =
        code === "PROTOTYPE_PLAN_EMPTY"
          ? "No fue posible identificar pantallas suficientes para construir el prototipo."
          : error instanceof PrototypePlannerError ||
              error instanceof ConflictException
            ? error.message
            : "No fue posible planificar el prototipo.";
      Object.assign(generation, {
        status: "FAILED",
        errorCode: code,
        errorMessage: message,
        updatedAt: new Date(),
      });
      await this.generations.save(generation);
      this.logger.error(
        JSON.stringify({
          generationId: id,
          provider: "OPENAI",
          startedAt: startedAt.toISOString(),
          completedAt: generation.updatedAt.toISOString(),
          status: "FAILED",
          errorCode: code,
        }),
      );
      throw new ConflictException(message);
    }
  }
  private detail(entity: PrototypeGenerationEntity) {
    return {
      id: entity.id,
      projectId: entity.projectId,
      sourceFileName: entity.sourceFileName,
      sourceSizeBytes: Number(entity.sourceSizeBytes),
      sourceSha256: entity.sourceSha256,
      targetDevice: entity.targetDevice,
      status: entity.status,
      plannerProvider: entity.plannerProvider as "OPENAI" | "OLLAMA" | null,
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
