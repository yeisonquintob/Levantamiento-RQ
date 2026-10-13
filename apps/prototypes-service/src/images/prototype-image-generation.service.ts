import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, type Repository } from "typeorm";
import type {
  PrototypeGeneratedImage,
  PrototypeImageActionResult,
  PrototypeImageGenerationResult,
  PrototypeImageProgress,
  PrototypePromptExport,
  PrototypeVisualSpecification,
} from "@levantamiento-rq/shared-contracts";
import { PrototypeGenerationEntity } from "../prototypes/prototype-generation.entity";
import { PrototypeScreenEntity } from "../prototypes/prototype-screen.entity";
import { PrototypeVisualSpecificationEntity } from "../visual/prototype-visual-specification.entity";
import { PrototypeImagePromptBuilder } from "../visual/prototype-image-prompt.builder";
import { CORPORATE_DEFAULT_V1 } from "../visual/prototype-design-system";
import { PrototypeGeneratedImageEntity } from "./prototype-generated-image.entity";
import {
  PrototypeImageGenerationQueue,
  type PrototypeImageGenerationJobData,
} from "./prototype-image-generation.queue";
import {
  PROTOTYPE_IMAGE_PROVIDER,
  PrototypeImageProviderError,
  type PrototypeImageProvider,
} from "./prototype-image.provider";
import { PrototypeImageSizeMapper } from "./prototype-image-size.mapper";
import {
  PrototypeImageBlobNotFoundError,
  PrototypeImageBlobStorage,
} from "./prototype-image-blob.storage";
import {
  PROTOTYPE_IMAGE_CONFIG,
  type PrototypeImageConfig,
} from "./prototype-image.config";
import {
  PrototypeImageValidationError,
  validatePrototypePng,
} from "./prototype-png-validation";

@Injectable()
export class PrototypeImageGenerationService {
  private readonly logger = new Logger(PrototypeImageGenerationService.name);
  constructor(
    @InjectRepository(PrototypeGenerationEntity)
    private readonly generations: Repository<PrototypeGenerationEntity>,
    @InjectRepository(PrototypeGeneratedImageEntity)
    private readonly images: Repository<PrototypeGeneratedImageEntity>,
    @InjectRepository(PrototypeVisualSpecificationEntity)
    private readonly specifications: Repository<PrototypeVisualSpecificationEntity>,
    @InjectRepository(PrototypeScreenEntity)
    private readonly screens: Repository<PrototypeScreenEntity>,
    private readonly queue: PrototypeImageGenerationQueue,
    @Inject(PROTOTYPE_IMAGE_PROVIDER)
    private readonly provider: PrototypeImageProvider,
    private readonly promptBuilder: PrototypeImagePromptBuilder,
    private readonly sizeMapper: PrototypeImageSizeMapper,
    private readonly storage: PrototypeImageBlobStorage,
    @Inject(PROTOTYPE_IMAGE_CONFIG)
    private readonly config: PrototypeImageConfig,
  ) {}

  /** Límites efectivos que la web necesita conocer (se configuran en el servidor). */
  limits(): { importImageMaxBytes: number } {
    return { importImageMaxBytes: this.config.maxImageBytes };
  }

  async start(
    generationId: string,
    actorId: string,
  ): Promise<PrototypeImageGenerationResult> {
    const generation = await this.requireGeneration(generationId, actorId);
    if (
      ![
        "VISUAL_SPEC_READY",
        "IMAGE_GENERATING",
        "COMPLETED",
        "PARTIALLY_COMPLETED",
      ].includes(generation.status)
    )
      throw new ConflictException(
        "La generación debe tener especificaciones visuales listas.",
      );
    const specifications = await this.specifications.find({
      where: { generationId },
      order: { device: "ASC", createdAt: "ASC" },
    });
    if (!specifications.length)
      throw new ConflictException(
        "No hay especificaciones visuales para generar.",
      );
    let existing = await this.images.find({ where: { generationId } });
    const bySpecification = new Map(
      existing.map((image) => [image.visualSpecificationId, image]),
    );
    const now = new Date();
    let created = specifications
      .filter((specification) => !bySpecification.has(specification.id))
      .map((specification) =>
        this.images.create({
          id: randomUUID(),
          generationId,
          visualSpecificationId: specification.id,
          screenId: specification.screenId,
          device: specification.device,
          provider: "OPENAI_IMAGES",
          model: null,
          status: "PENDING",
          mediaType: null,
          storageKey: null,
          width: null,
          height: null,
          attemptNumber: 1,
          previousProvider: null,
          previousModel: null,
          previousStatus: null,
          previousStorageKey: null,
          previousCompletedAt: null,
          errorCode: null,
          errorMessage: null,
          correlationId: null,
          startedAt: null,
          completedAt: null,
          createdAt: now,
          updatedAt: now,
        }),
      );
    if (created.length) {
      try {
        await this.images.save(created);
      } catch (error) {
        if (!this.isUniqueViolation(error)) throw error;
        existing = await this.images.find({ where: { generationId } });
        created = [];
      }
    }
    const all = [...existing, ...created];
    Object.assign(generation, {
      imageProvider: "OPENAI_IMAGES",
      totalImages: all.length,
      completedImages: all.filter((item) => item.status === "COMPLETED").length,
      failedImages: all.filter((item) => item.status === "FAILED").length,
      status: all.some(
        (item) => item.status === "PENDING" || item.status === "GENERATING",
      )
        ? "IMAGE_GENERATING"
        : generation.status,
      updatedAt: now,
    });
    await this.generations.save(generation);
    for (const image of all.filter((item) => item.status === "PENDING"))
      await this.queue.enqueue(
        {
          generationId,
          visualSpecificationId: image.visualSpecificationId,
          imageRecordId: image.id,
        },
        image.attemptNumber,
      );
    return this.result(generation, all);
  }

  async list(
    generationId: string,
    actorId: string,
  ): Promise<PrototypeGeneratedImage[]> {
    await this.requireGeneration(generationId, actorId);
    return this.details(
      await this.images.find({
        where: { generationId },
        order: { device: "ASC", createdAt: "ASC" },
      }),
    );
  }
  async progress(
    generationId: string,
    actorId: string,
  ): Promise<PrototypeImageProgress> {
    let generation = await this.requireGeneration(generationId, actorId);
    let images = await this.images.find({ where: { generationId } });

    // Imágenes en GENERATING que nadie actualiza (worker caído): se reabren como un intento nuevo.
    if (generation.status === "IMAGE_GENERATING") {
      const reopened = await this.recoverStale(generationId, images);
      if (reopened > 0)
        images = await this.images.find({ where: { generationId } });
    }

    // RQ_PROTOTYPE_PENDING_DB_RECOVERY_V1
    // La cantidad es dinámica: 1, 22, 50 o N imágenes.
    // Cada PENDING debe conservar un trabajo ejecutable en BullMQ.
    if (generation.status === "IMAGE_GENERATING") {
      const pending = images.filter((item) => item.status === "PENDING");
      const recovered = await this.queue.ensurePendingJobs(
        pending.map((image) => ({
          data: {
            generationId,
            visualSpecificationId: image.visualSpecificationId,
            imageRecordId: image.id,
          },
          attemptNumber: image.attemptNumber,
        })),
      );

      if (recovered > 0) {
        this.logger.warn(
          JSON.stringify({
            generationId,
            event: "PENDING_IMAGE_JOBS_RECOVERED",
            recovered,
            pending: pending.length,
          }),
        );
      }
    }

    // Defensa ante contadores/estado inconsistentes (p. ej. una consolidación antigua que llegó tarde):
    // si el estado de la generación no coincide con el de sus imágenes, se vuelve a consolidar.
    const hasActive = images.some(
      (item) => item.status === "PENDING" || item.status === "GENERATING",
    );
    const consolidated = [
      "IMAGE_GENERATING",
      "COMPLETED",
      "PARTIALLY_COMPLETED",
      "FAILED",
    ].includes(generation.status);
    if (
      images.length > 0 &&
      consolidated &&
      hasActive !== (generation.status === "IMAGE_GENERATING")
    ) {
      await this.consolidate(generationId);
      generation = await this.requireGeneration(generationId, actorId);
    }

    const progress = this.progressOf(generation, images);
    const active = images.find((item) => item.status === "GENERATING");
    if (active) {
      const screen = await this.screens.findOne({
        where: { id: active.screenId, generationId },
      });
      if (screen)
        progress.current = { screenName: screen.name, device: active.device };
    }
    return progress;
  }
  /**
   * Recuperación explícita de imágenes abandonadas en GENERATING. Ningún worker reclama por su cuenta
   * un trabajo ya iniciado; pasado el vencimiento (`staleGeneratingMs`) se abre un intento nuevo (otro
   * número de intento y, por tanto, otra clave de archivo) y se vuelve a encolar. Si el worker original
   * seguía vivo, ya no es el dueño del intento y descarta su propio archivo.
   */
  private async recoverStale(
    generationId: string,
    images: PrototypeGeneratedImageEntity[],
  ): Promise<number> {
    const cutoff = Date.now() - this.config.staleGeneratingMs;
    let reopened = 0;
    for (const image of images) {
      if (
        image.status !== "GENERATING" ||
        new Date(image.updatedAt).getTime() > cutoff
      )
        continue;
      const reset = await this.images.update(
        {
          id: image.id,
          attemptNumber: image.attemptNumber,
          status: "GENERATING",
          ...(image.correlationId
            ? { correlationId: image.correlationId }
            : {}),
        },
        {
          status: "PENDING",
          attemptNumber: () => "AttemptNumber + 1",
          correlationId: null,
          startedAt: null,
          errorCode: "PROTOTYPE_IMAGE_STALE_RECOVERED",
          errorMessage: "La generación se reanudó tras quedar sin actividad.",
          updatedAt: new Date(),
        },
      );
      if (!reset.affected) continue;
      const fresh = await this.images.findOne({ where: { id: image.id } });
      if (!fresh) continue;
      await this.queue.enqueue(
        {
          generationId,
          visualSpecificationId: fresh.visualSpecificationId,
          imageRecordId: fresh.id,
        },
        fresh.attemptNumber,
      );
      reopened += 1;
      this.logger.warn(
        JSON.stringify({
          event: "PROTOTYPE_STALE_GENERATING_RECOVERED",
          generationId,
          imageId: image.id,
          previousAttempt: image.attemptNumber,
          attemptNumber: fresh.attemptNumber,
        }),
      );
    }
    return reopened;
  }
  /** Prompts de cada pantalla, listos para generarse en otra IA, con el nombre de archivo esperado. */
  async exportPrompts(
    generationId: string,
    actorId: string,
  ): Promise<PrototypePromptExport> {
    const generation = await this.requireGeneration(generationId, actorId);
    const { specifications, screens } = await this.sources(generationId);
    if (!specifications.length)
      throw new ConflictException(
        "Prepara las pantallas seleccionadas antes de exportar los prompts.",
      );
    return {
      generationId,
      applicationName: generation.applicationName,
      applicationSummary: generation.summary,
      targetDevice: generation.targetDevice,
      screens: [...screens.values()]
        .sort((left, right) => left.order - right.order)
        .map((screen) => ({
          screenCode: screen.code,
          name: screen.name,
          route: screen.route,
          order: screen.order,
          objective: screen.objective,
          components: this.componentList(screen.componentsJson),
        })),
      designSystem: CORPORATE_DEFAULT_V1,
      items: specifications
        .map((specification) => {
          const screen = screens.get(specification.screenId);
          const size = this.sizeMapper.forDevice(specification.device);
          const [width, height] = size.split("x").map(Number) as [
            number,
            number,
          ];
          return {
            screenCode: screen?.code ?? "screen",
            screenName: screen?.name ?? "Pantalla",
            screenOrder: screen?.order ?? 0,
            device: specification.device,
            fileName: this.exportFileName(
              screen?.order ?? 0,
              screen?.code ?? "screen",
              specification.device,
            ),
            width,
            height,
            prompt: this.promptBuilder.build(this.visualDetail(specification)),
          };
        })
        .sort(
          (left, right) =>
            left.screenOrder - right.screenOrder ||
            left.device.localeCompare(right.device),
        ),
    };
  }

  /**
   * Importa a la galería una imagen generada fuera del sistema. La pantalla y el formato se
   * reconocen por el nombre del archivo que entregó la exportación de prompts.
   */
  async importImage(
    generationId: string,
    actorId: string,
    fileName: string,
    imageBase64: string,
  ): Promise<PrototypeImageActionResult> {
    await this.requireGeneration(generationId, actorId);
    const { specifications, screens } = await this.sources(generationId);
    if (!specifications.length)
      throw new ConflictException(
        "Prepara las pantallas seleccionadas antes de importar imágenes.",
      );
    const stem = this.comparableName(fileName);
    const match = specifications
      .map((specification) => {
        const screen = screens.get(specification.screenId);
        return {
          specification,
          screen,
          key: this.comparableName(
            this.exportFileName(
              screen?.order ?? 0,
              screen?.code ?? "screen",
              specification.device,
            ),
          ),
        };
      })
      .filter(
        (candidate) =>
          candidate.screen &&
          (stem === candidate.key || stem.startsWith(`${candidate.key}-`)),
      )
      .sort((left, right) => right.key.length - left.key.length)[0];
    if (!match || !match.screen)
      throw new BadRequestException(
        `«${fileName}» no coincide con ninguna pantalla seleccionada. Conserva el nombre que trae el TXT exportado.`,
      );
    let png;
    try {
      png = validatePrototypePng(
        imageBase64,
        "image/png",
        this.config.maxImageBytes,
      );
    } catch (error) {
      throw new BadRequestException(
        error instanceof PrototypeImageValidationError &&
          error.code === "PROTOTYPE_IMAGE_TOO_LARGE"
          ? `«${fileName}» supera el tamaño permitido.`
          : `«${fileName}» no es un PNG válido.`,
      );
    }
    const existing = await this.images.findOne({
      where: { visualSpecificationId: match.specification.id },
    });
    if (existing && ["PENDING", "GENERATING"].includes(existing.status))
      throw new ConflictException(
        `La imagen de «${match.screen.name}» se está generando; espera a que termine.`,
      );
    const attemptNumber = existing ? existing.attemptNumber + 1 : 1;
    const storageKey = this.storageKey(
      generationId,
      match.specification.device,
      match.screen.order,
      match.screen.code,
      attemptNumber,
    );
    await this.storage.upload(storageKey, png.buffer);
    const now = new Date();
    // Solo se conservan la versión actual y la anterior: la que ya era «anterior» se retira.
    const olderStorageKey = existing?.previousStorageKey ?? null;
    const image =
      existing ?? this.images.create({ id: randomUUID(), createdAt: now });
    Object.assign(image, {
      generationId,
      visualSpecificationId: match.specification.id,
      screenId: match.specification.screenId,
      device: match.specification.device,
      provider: "OTHER",
      model: "Importada manualmente",
      status: "COMPLETED",
      mediaType: "image/png",
      storageKey,
      width: png.width,
      height: png.height,
      attemptNumber,
      previousProvider: existing?.provider ?? null,
      previousModel: existing?.model ?? null,
      previousStatus: existing?.status ?? null,
      previousStorageKey: existing?.storageKey ?? null,
      previousCompletedAt: existing?.completedAt ?? null,
      errorCode: null,
      errorMessage: null,
      correlationId: null,
      startedAt: now,
      completedAt: now,
      updatedAt: now,
    });
    let saved: PrototypeGeneratedImageEntity;
    try {
      saved = await this.images.save(image);
    } catch (error) {
      // El archivo ya se subió pero SQL no lo registró: se borra para no dejarlo huérfano.
      await this.discardBlob(storageKey);
      throw error;
    }
    await this.discardOlderVersion(olderStorageKey, [
      saved.storageKey,
      saved.previousStorageKey,
    ]);
    this.audit(saved, match.screen.code, "IMPORTED");
    await this.consolidate(generationId);
    const refreshed = await this.requireGeneration(generationId, actorId);
    return this.actionResult(refreshed, saved.id);
  }

  private async sources(generationId: string) {
    const [specifications, screens] = await Promise.all([
      this.specifications.find({
        where: { generationId },
        order: { device: "ASC", createdAt: "ASC" },
      }),
      this.screens.find({ where: { generationId } }),
    ]);
    return {
      specifications,
      screens: new Map(screens.map((screen) => [screen.id, screen])),
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
  private exportFileName(order: number, code: string, device: string) {
    return `${String(order).padStart(2, "0")}-${this.comparableName(code)}-${device.toLowerCase()}.png`;
  }
  /** Nombre comparable: sin extensión, minúsculas, sin acentos y con guiones simples. */
  private comparableName(value: string) {
    return value
      .replace(/\.(png|jpe?g|webp)$/i, "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  async content(imageId: string, actorId: string): Promise<Buffer> {
    const image = await this.images.findOne({ where: { id: imageId } });
    if (!image)
      throw new NotFoundException("La imagen de prototipo no existe.");
    await this.requireGeneration(image.generationId, actorId);
    if (!image.storageKey)
      throw new NotFoundException("La imagen todavía no está disponible.");
    try {
      return await this.storage.download(image.storageKey);
    } catch (error) {
      if (error instanceof PrototypeImageBlobNotFoundError)
        throw new NotFoundException("El contenido de la imagen no existe.");
      throw error;
    }
  }

  async retry(
    imageId: string,
    actorId: string,
  ): Promise<PrototypeImageActionResult> {
    return this.requeue(imageId, actorId, "FAILED", "RETRY");
  }

  async regenerate(
    imageId: string,
    actorId: string,
  ): Promise<PrototypeImageActionResult> {
    return this.requeue(imageId, actorId, "COMPLETED", "REGENERATE");
  }

  async retryFailed(
    generationId: string,
    actorId: string,
  ): Promise<PrototypeImageGenerationResult> {
    await this.requireGeneration(generationId, actorId);
    const failed = await this.images.find({
      where: { generationId, status: "FAILED" },
    });
    for (const image of failed)
      await this.requeue(image.id, actorId, "FAILED", "RETRY");
    const generation = await this.requireGeneration(generationId, actorId);
    return this.result(
      generation,
      await this.images.find({ where: { generationId } }),
    );
  }

  async stop(
    generationId: string,
    actorId: string,
  ): Promise<PrototypeImageGenerationResult> {
    const generation = await this.requireGeneration(generationId, actorId);
    await this.queue.cancelGeneration(generationId);
    const all = await this.images.find({ where: { generationId } });
    const now = new Date();
    for (const image of all.filter((item) =>
      ["PENDING", "GENERATING"].includes(item.status),
    )) {
      Object.assign(image, {
        status: "FAILED",
        errorCode: "PROTOTYPE_IMAGE_CANCELLED",
        errorMessage: "Generación detenida por el usuario.",
        completedAt: now,
        updatedAt: now,
      });
      await this.images.save(image);
    }
    Object.assign(generation, {
      status: "FAILED",
      failedImages: all.filter((item) => item.status === "FAILED").length,
      errorCode: "PROTOTYPE_GENERATION_CANCELLED",
      errorMessage: "Generación detenida por el usuario.",
      updatedAt: now,
    });
    await this.generations.save(generation);
    return this.result(generation, all);
  }

  /**
   * `previousStorageKey` guarda una sola versión anterior: al rotarla, la que ya era «anterior»
   * quedaría sin referencia (huérfana en Blob Storage), así que se borra. Un fallo al borrar no
   * detiene la operación; solo se registra.
   */
  private async discardOlderVersion(
    olderKey: string | null | undefined,
    keep: ReadonlyArray<string | null | undefined>,
  ): Promise<void> {
    if (!olderKey || keep.includes(olderKey)) return;
    try {
      await this.storage.delete(olderKey);
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: "PROTOTYPE_OLDER_IMAGE_VERSION_NOT_DELETED",
          storageKey: olderKey,
          reason: error instanceof Error ? error.name : "UNKNOWN",
        }),
      );
    }
  }

  async deleteGeneration(
    generationId: string,
    actorId: string,
  ): Promise<{ id: string; deleted: true }> {
    await this.requireGeneration(generationId, actorId);
    await this.queue.cancelGeneration(generationId);
    // Toda la metadata (hijos antes que la generación) se elimina en una sola transacción: si cualquier
    // borrado falla, no queda nada a medias y no se toca ningún archivo. Un archivo huérfano lo repara el
    // reconciliador; una fila viva cuyo archivo ya no existe no se puede reparar.
    const storageKeys = await this.generations.manager.transaction(
      async (manager) => {
        const generation = await manager
          .getRepository(PrototypeGenerationEntity)
          .findOne({
            where: { id: generationId, requestedByUserId: actorId },
            lock: { mode: "pessimistic_write" },
          });
        if (!generation)
          throw new NotFoundException("La generación de prototipo no existe.");
        const imageRepository = manager.getRepository(
          PrototypeGeneratedImageEntity,
        );
        const images = await imageRepository.find({ where: { generationId } });
        const keys = new Set(
          images.flatMap((image) =>
            [image.storageKey, image.previousStorageKey].filter(
              (key): key is string => Boolean(key),
            ),
          ),
        );
        await imageRepository.delete({ generationId });
        await manager
          .getRepository(PrototypeVisualSpecificationEntity)
          .delete({ generationId });
        await manager
          .getRepository(PrototypeScreenEntity)
          .delete({ generationId });
        await manager
          .getRepository(PrototypeGenerationEntity)
          .delete({ id: generationId, requestedByUserId: actorId });
        return keys;
      },
    );
    // Solo con la transacción confirmada se limpian los archivos, uno a uno y sin abortar por el fallo de otro.
    for (const key of storageKeys) await this.discardBlob(key);
    return { id: generationId, deleted: true };
  }

  async process(
    data: PrototypeImageGenerationJobData,
    attempt: number,
    maxAttempts: number,
  ): Promise<void> {
    const image = await this.images.findOne({
      where: {
        id: data.imageRecordId,
        generationId: data.generationId,
        visualSpecificationId: data.visualSpecificationId,
      },
    });
    if (!image || image.status === "COMPLETED") return;
    // Intento con el que nació este trabajo: si la imagen ya está en otro (reintento, importación,
    // detención), el trabajo es obsoleto. Los trabajos anteriores a este campo usan el actual.
    const epoch = data.attemptNumber ?? image.attemptNumber;
    if (image.attemptNumber !== epoch) return;
    const specification = await this.specifications.findOne({
      where: {
        id: data.visualSpecificationId,
        generationId: data.generationId,
      },
    });
    const screen = specification
      ? await this.screens.findOne({
          where: {
            id: specification.screenId,
            generationId: data.generationId,
          },
        })
      : null;
    if (!specification || !screen) {
      await this.failAttempt(
        image,
        epoch,
        "PROTOTYPE_IMAGE_SOURCE_NOT_FOUND",
        "No se encontró la especificación visual.",
      );
      return;
    }
    // El token de la reclamación (correlationId) identifica a ESTE worker: cada paso posterior exige
    // que la fila siga con su token, así que un worker que perdió la reclamación no puede completar,
    // reiniciar ni fallar el trabajo de otro.
    const correlationId = randomUUID();
    // Reclamación atómica y exclusiva: solo PENDING pasa a GENERATING. Una segunda entrega del mismo
    // trabajo (lock perdido, trabajo «stalled», dos réplicas) no encuentra la imagen en PENDING y termina
    // sin generar ni subir nada. Los GENERATING abandonados los recupera `recoverStale`, que abre un
    // intento nuevo; ningún worker se los queda por su cuenta.
    const claimed = await this.transition(image, epoch, ["PENDING"], {
      status: "GENERATING",
      correlationId,
      startedAt: image.startedAt ?? new Date(),
      errorCode: null,
      errorMessage: null,
      updatedAt: new Date(),
    });
    if (!claimed) return;
    await this.consolidate(data.generationId);
    try {
      const visual = this.visualDetail(specification);
      const generation = await this.generations.findOneBy({
        id: data.generationId,
      });
      if (!generation) throw new Error("PROTOTYPE_GENERATION_NOT_FOUND");
      const result = await this.provider.generate({
        providerConfigurationId: generation.imageConfigurationId ?? undefined,
        prompt: this.promptBuilder.build(visual),
        device: specification.device,
        requestedSize: this.sizeMapper.forDevice(specification.device),
        correlationId,
      });
      // La IA tarda: antes de subir nada se comprueba que este intento siga vigente.
      if (!(await this.ownsAttempt(image.id, epoch, correlationId))) return;
      const latestGeneration = await this.generations.findOneBy({
        id: data.generationId,
      });
      if (latestGeneration?.errorCode === "PROTOTYPE_GENERATION_CANCELLED")
        return;
      const png = validatePrototypePng(
        result.imageBase64,
        result.mediaType,
        this.config.maxImageBytes,
      );
      const storageKey = this.storageKey(
        data.generationId,
        specification.device,
        screen.order,
        screen.code,
        epoch,
      );
      await this.storage.upload(storageKey, png.buffer);
      let completed: boolean;
      try {
        completed = await this.transition(
          image,
          epoch,
          ["GENERATING"],
          {
            provider: result.provider,
            model: result.model,
            status: "COMPLETED",
            mediaType: "image/png",
            storageKey,
            width: png.width,
            height: png.height,
            errorCode: null,
            errorMessage: null,
            completedAt: new Date(),
            updatedAt: new Date(),
          },
          correlationId,
        );
      } catch (persistError) {
        // SQL falló tras subir el archivo: no se deja huérfano.
        await this.discardBlob(storageKey);
        throw persistError;
      }
      if (!completed) {
        // Mientras se subía, el intento fue detenido, reemplazado o eliminado: no deja huérfano.
        await this.discardBlob(storageKey);
        return;
      }
      if (generation.imageProvider !== result.provider)
        await this.generations.update(
          { id: generation.id },
          { imageProvider: result.provider, updatedAt: new Date() },
        );
      this.audit(image, screen.code, "COMPLETED", result.executionId);
    } catch (error) {
      const retryable =
        error instanceof PrototypeImageProviderError
          ? error.retryable
          : !(error instanceof PrototypeImageValidationError);
      if (retryable && attempt < maxAttempts) {
        const reset = await this.transition(
          image,
          epoch,
          ["GENERATING"],
          {
            status: "PENDING",
            correlationId: null,
            errorCode: "PROTOTYPE_IMAGE_TEMPORARY_FAILURE",
            errorMessage: "La generación se reintentará automáticamente.",
            updatedAt: new Date(),
          },
          correlationId,
        );
        if (reset) await this.consolidate(data.generationId);
        throw error;
      }
      const code =
        error instanceof PrototypeImageProviderError ||
        error instanceof PrototypeImageValidationError
          ? error.code
          : "PROTOTYPE_IMAGE_GENERATION_FAILED";
      const failed = await this.failAttempt(
        image,
        epoch,
        code,
        error instanceof PrototypeImageProviderError
          ? error.message
          : "No fue posible generar una imagen válida.",
        correlationId,
      );
      if (failed) this.audit(image, screen.code, "FAILED");
    }
    await this.consolidate(data.generationId);
  }

  /**
   * Actualización condicionada al intento y al estado de la imagen: si otra operación la cambió
   * (detener, reintentar, importar, eliminar) no afecta ninguna fila y el trabajo obsoleto no
   * sobrescribe nada ni recrea filas borradas (a diferencia de `save`).
   */
  private async transition(
    image: PrototypeGeneratedImageEntity,
    epoch: number,
    from: ReadonlyArray<PrototypeGeneratedImageEntity["status"]>,
    changes: Partial<PrototypeGeneratedImageEntity>,
    claimToken?: string,
  ): Promise<boolean> {
    const result = await this.images.update(
      {
        id: image.id,
        attemptNumber: epoch,
        status: In([...from]),
        // Con token, solo el worker que reclamó el intento puede cambiarlo.
        ...(claimToken ? { correlationId: claimToken } : {}),
      },
      changes,
    );
    if (!result.affected) return false;
    Object.assign(image, changes);
    return true;
  }

  private async ownsAttempt(
    imageId: string,
    epoch: number,
    claimToken: string,
  ): Promise<boolean> {
    const current = await this.images.findOne({ where: { id: imageId } });
    return (
      current?.attemptNumber === epoch &&
      current.status === "GENERATING" &&
      // `CorrelationId` es uniqueidentifier: SQL Server lo devuelve en mayúsculas y randomUUID() en minúsculas.
      current.correlationId?.toLowerCase() === claimToken.toLowerCase()
    );
  }

  private async discardBlob(storageKey: string): Promise<void> {
    try {
      await this.storage.delete(storageKey);
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: "PROTOTYPE_STALE_IMAGE_BLOB_NOT_DELETED",
          storageKey,
          reason: error instanceof Error ? error.name : "UNKNOWN",
        }),
      );
    }
  }

  /**
   * Marca el intento como fallido. Sin token es un fallo previo a la reclamación (la imagen sigue en
   * PENDING); con token, solo el worker que la reclamó puede fallarla.
   */
  private async failAttempt(
    image: PrototypeGeneratedImageEntity,
    epoch: number,
    code: string,
    message: string,
    claimToken?: string,
  ): Promise<boolean> {
    return this.transition(
      image,
      epoch,
      claimToken ? ["GENERATING"] : ["PENDING"],
      {
        status: "FAILED",
        errorCode: code.slice(0, 80),
        errorMessage: message.slice(0, 1000),
        completedAt: new Date(),
        updatedAt: new Date(),
      },
      claimToken,
    );
  }
  private async requeue(
    imageId: string,
    actorId: string,
    requiredStatus: "FAILED" | "COMPLETED",
    action: "RETRY" | "REGENERATE",
  ): Promise<PrototypeImageActionResult> {
    const current = await this.images.findOne({ where: { id: imageId } });
    if (!current)
      throw new NotFoundException("La imagen de prototipo no existe.");
    const generation = await this.requireGeneration(
      current.generationId,
      actorId,
    );
    if (current.status === "PENDING" || current.status === "GENERATING")
      return this.actionResult(generation, current.id);
    if (current.status !== requiredStatus)
      throw new ConflictException(
        requiredStatus === "FAILED"
          ? "Solo se pueden reintentar imágenes fallidas."
          : "Solo se pueden regenerar imágenes completadas.",
      );
    // Se leen antes del update: la entidad puede reflejar ya los valores nuevos.
    const olderStorageKey = current.previousStorageKey;
    const replacedStorageKey = current.storageKey;
    const update = await this.images.update(
      { id: current.id, status: requiredStatus },
      {
        status: "PENDING",
        attemptNumber: () => "AttemptNumber + 1",
        previousProvider: current.provider,
        previousModel: current.model,
        previousStatus: current.status,
        previousStorageKey: current.storageKey,
        previousCompletedAt: current.completedAt,
        errorCode: null,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
        updatedAt: new Date(),
      },
    );
    const image = await this.images.findOne({ where: { id: current.id } });
    if (!image)
      throw new NotFoundException("La imagen de prototipo no existe.");
    if (update.affected) {
      await this.discardOlderVersion(olderStorageKey, [replacedStorageKey]);
      Object.assign(generation, {
        status: "IMAGE_GENERATING",
        errorCode: null,
        errorMessage: null,
        updatedAt: new Date(),
      });
      await this.generations.save(generation);
      await this.queue.enqueue(
        {
          generationId: image.generationId,
          visualSpecificationId: image.visualSpecificationId,
          imageRecordId: image.id,
        },
        image.attemptNumber,
      );
      this.logger.log(
        JSON.stringify({
          generationId: image.generationId,
          imageId: image.id,
          action,
          attemptNumber: image.attemptNumber,
          previousProvider: image.previousProvider,
          previousModel: image.previousModel,
          previousCompletedAt: image.previousCompletedAt?.toISOString(),
          status: "PENDING",
        }),
      );
    }
    await this.consolidate(image.generationId);
    return this.actionResult(generation, image.id);
  }
  /**
   * Recalcula el estado y los contadores de la generación a partir de sus imágenes. Se hace dentro de
   * una transacción que bloquea la fila de la generación: dos consolidaciones concurrentes (concurrencia
   * 2 o varias réplicas) se ejecutan una detrás de otra y cada una lee las imágenes DESPUÉS de obtener
   * el bloqueo, así que una lectura antigua nunca pisa a una más reciente (p. ej. volver a
   * IMAGE_GENERATING una generación ya COMPLETED).
   */
  private async consolidate(generationId: string) {
    await this.generations.manager.transaction(async (manager) => {
      const generation = await manager
        .getRepository(PrototypeGenerationEntity)
        .findOne({
          where: { id: generationId },
          lock: { mode: "pessimistic_write" },
        });
      if (!generation) return;
      const images = await manager
        .getRepository(PrototypeGeneratedImageEntity)
        .find({ where: { generationId } });
      const completed = images.filter(
        (item) => item.status === "COMPLETED",
      ).length;
      const failed = images.filter((item) => item.status === "FAILED").length;
      const finished =
        images.length > 0 && completed + failed === images.length;
      const screens = new Map<string, PrototypeGeneratedImageEntity[]>();
      for (const image of images)
        screens.set(image.screenId, [
          ...(screens.get(image.screenId) ?? []),
          image,
        ]);
      const generatedScreens = [...screens.values()].filter((items) =>
        items.every((item) => item.status === "COMPLETED"),
      ).length;
      // Con importación manual puede haber menos imágenes que especificaciones: sigue siendo parcial.
      const missing = images.length < generation.totalVisualSpecifications;
      const status = finished
        ? completed === 0
          ? "FAILED"
          : failed || missing
            ? "PARTIALLY_COMPLETED"
            : "COMPLETED"
        : "IMAGE_GENERATING";
      await manager.getRepository(PrototypeGenerationEntity).update(
        { id: generationId },
        {
          totalImages: images.length,
          completedImages: completed,
          failedImages: failed,
          generatedScreens,
          status,
          errorCode: failed ? "PROTOTYPE_IMAGES_PARTIAL_FAILURE" : null,
          errorMessage: failed
            ? `${failed} imagen(es) no pudieron generarse.`
            : null,
          updatedAt: new Date(),
        },
      );
    });
  }
  private async requireGeneration(id: string, requestedByUserId: string) {
    const generation = await this.generations.findOne({
      where: { id, requestedByUserId },
    });
    if (!generation)
      throw new NotFoundException("La generación de prototipo no existe.");
    return generation;
  }
  private visualDetail(
    entity: PrototypeVisualSpecificationEntity,
  ): PrototypeVisualSpecification {
    const parsed = JSON.parse(entity.specificationJson) as Omit<
      PrototypeVisualSpecification,
      "id" | "createdAt" | "updatedAt"
    >;
    return {
      ...parsed,
      id: entity.id,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
  private storageKey(
    generationId: string,
    device: string,
    order: number,
    screenCode: string,
    attemptNumber: number,
  ) {
    const safeCode =
      screenCode
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80) || "screen";
    const version = attemptNumber > 1 ? `-v${attemptNumber}` : "";
    return `prototypes/${generationId}/${device.toLowerCase()}/${String(order).padStart(3, "0")}-${safeCode}${version}.png`;
  }
  private async details(
    entities: PrototypeGeneratedImageEntity[],
  ): Promise<PrototypeGeneratedImage[]> {
    const screenIds = [...new Set(entities.map((item) => item.screenId))];
    const screens = screenIds.length
      ? await this.screens.findByIds(screenIds)
      : [];
    const byId = new Map(screens.map((screen) => [screen.id, screen]));
    return entities
      .map((entity) => {
        const screen = byId.get(entity.screenId);
        return {
          id: entity.id,
          generationId: entity.generationId,
          visualSpecificationId: entity.visualSpecificationId,
          screenId: entity.screenId,
          screenCode: screen?.code ?? "unknown",
          screenName: screen?.name ?? "Pantalla",
          screenOrder: screen?.order ?? Number.MAX_SAFE_INTEGER,
          screenObjective: screen?.objective ?? "",
          screenOrigin: screen?.origin ?? "DERIVED",
          device: entity.device,
          provider: entity.provider,
          model: entity.model,
          status: entity.status,
          mediaType: entity.mediaType,
          storageKey: entity.storageKey,
          width: entity.width,
          height: entity.height,
          attemptNumber: entity.attemptNumber,
          errorCode: entity.errorCode,
          errorMessage: entity.errorMessage,
          createdAt: entity.createdAt.toISOString(),
          updatedAt: entity.updatedAt.toISOString(),
        };
      })
      .sort(
        (left, right) =>
          left.screenOrder - right.screenOrder ||
          left.device.localeCompare(right.device),
      );
  }
  private progressOf(
    generation: PrototypeGenerationEntity,
    images: PrototypeGeneratedImageEntity[],
  ): PrototypeImageProgress {
    const device = (name: "WEB" | "MOBILE") => {
      const items = images.filter((item) => item.device === name);
      return {
        total: items.length,
        completed: items.filter((item) => item.status === "COMPLETED").length,
        failed: items.filter((item) => item.status === "FAILED").length,
      };
    };
    const active = images.find((item) => item.status === "GENERATING");
    return {
      generationId: generation.id,
      status: generation.status,
      totalImages: images.length,
      completedImages: images.filter((item) => item.status === "COMPLETED")
        .length,
      failedImages: images.filter((item) => item.status === "FAILED").length,
      pendingImages: images.filter((item) => item.status === "PENDING").length,
      generatingImages: images.filter((item) => item.status === "GENERATING")
        .length,
      web: device("WEB"),
      mobile: device("MOBILE"),
      current: active
        ? { screenName: "Pantalla actual", device: active.device }
        : null,
    };
  }
  private async result(
    generation: PrototypeGenerationEntity,
    images: PrototypeGeneratedImageEntity[],
  ): Promise<PrototypeImageGenerationResult> {
    return {
      generation: {
        id: generation.id,
        projectId: generation.projectId,
        sourceFileName: generation.sourceFileName,
        sourceSizeBytes: Number(generation.sourceSizeBytes),
        sourceSha256: generation.sourceSha256,
        targetDevice: generation.targetDevice,
        status: generation.status,
        plannerProvider: generation.plannerProvider,
        plannerModel: generation.plannerModel,
        applicationName: generation.applicationName,
        summary: generation.summary,
        imageProvider: generation.imageProvider,
        totalScreens: generation.totalScreens,
        generatedScreens: generation.generatedScreens,
        totalVisualSpecifications: generation.totalVisualSpecifications,
        totalImages: generation.totalImages,
        completedImages: generation.completedImages,
        failedImages: generation.failedImages,
        errorCode: generation.errorCode,
        errorMessage: generation.errorMessage,
        requestedByUserId: generation.requestedByUserId,
        createdAt: generation.createdAt.toISOString(),
        updatedAt: generation.updatedAt.toISOString(),
      },
      images: await this.details(images),
      progress: this.progressOf(generation, images),
    };
  }
  private audit(
    image: PrototypeGeneratedImageEntity,
    screenCode: string,
    status: string,
    executionId?: string,
  ) {
    this.logger.log(
      JSON.stringify({
        generationId: image.generationId,
        imageId: image.id,
        provider: image.provider,
        model: image.model,
        device: image.device,
        screenCode,
        startedAt: image.startedAt?.toISOString(),
        completedAt: image.completedAt?.toISOString(),
        status,
        correlationId: image.correlationId,
        executionId,
        attemptNumber: image.attemptNumber,
      }),
    );
  }
  private isUniqueViolation(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const value = error as { number?: number; code?: string };
    return (
      value.number === 2601 || value.number === 2627 || value.code === "23505"
    );
  }
  private async actionResult(
    generation: PrototypeGenerationEntity,
    imageId: string,
  ): Promise<PrototypeImageActionResult> {
    const entities = await this.images.find({
      where: { generationId: generation.id },
    });
    const details = await this.details(entities);
    const image = details.find((item) => item.id === imageId);
    if (!image)
      throw new NotFoundException("La imagen de prototipo no existe.");
    return {
      generation: (await this.result(generation, entities)).generation,
      image,
      progress: this.progressOf(generation, entities),
    };
  }
}
