// Integración real de la generación de imágenes de prototipos: SQL Server, BullMQ/Redis y Azure Blob
// (Azurite) verdaderos. Solo el proveedor de IA es simulado, para poder retenerlo y liberarlo y así
// provocar las carreras (detener→reintentar, importar, eliminar durante la generación).
//
// Aislamiento: cola y contenedor de Blob propios y únicos por ejecución, y generaciones nuevas que se
// eliminan al terminar. Uso: pnpm test:integration:prototypes (con el stack levantado).
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

import { BlobServiceClient } from "@azure/storage-blob";
import { Queue } from "bullmq";
import { In } from "typeorm";

import { loadEnvironmentFiles } from "../libs/shared/config/src/index.js";
import dataSource from "../apps/prototypes-service/src/database/data-source.js";
import { loadPrototypeImageConfig } from "../apps/prototypes-service/src/images/prototype-image.config.js";
import { PrototypeGenerationEntity } from "../apps/prototypes-service/src/prototypes/prototype-generation.entity.js";
import { PrototypeScreenEntity } from "../apps/prototypes-service/src/prototypes/prototype-screen.entity.js";
import { PrototypeVisualSpecificationEntity } from "../apps/prototypes-service/src/visual/prototype-visual-specification.entity.js";
import { PrototypeGeneratedImageEntity } from "../apps/prototypes-service/src/images/prototype-generated-image.entity.js";
import { PrototypeGenerationService } from "../apps/prototypes-service/src/prototypes/prototype-generation.service.js";
import { PrototypeVisualSpecificationService } from "../apps/prototypes-service/src/visual/prototype-visual-specification.service.js";
import { PrototypeVisualSpecificationBuilder } from "../apps/prototypes-service/src/visual/prototype-visual-specification.builder.js";
import { PrototypeImagePromptBuilder } from "../apps/prototypes-service/src/visual/prototype-image-prompt.builder.js";
import { PrototypeImageSizeMapper } from "../apps/prototypes-service/src/images/prototype-image-size.mapper.js";
import { PrototypeImageGenerationQueue } from "../apps/prototypes-service/src/images/prototype-image-generation.queue.js";
import { PrototypeImageBlobStorage } from "../apps/prototypes-service/src/images/prototype-image-blob.storage.js";
import { PrototypeImageGenerationService } from "../apps/prototypes-service/src/images/prototype-image-generation.service.js";
import { PrototypeImageGenerationWorker } from "../apps/prototypes-service/src/images/prototype-image-generation.worker.js";
import { PrototypeImageBlobReconciler } from "../apps/prototypes-service/src/images/prototype-image-blob.reconciler.js";

loadEnvironmentFiles({
  paths: [".env", "infrastructure/docker/.env", "apps/prototypes-service/.env"],
});

const runId = randomBytes(4).toString("hex");
process.env.PROTOTYPE_IMAGE_QUEUE = `it-prototypes-${runId}`;
process.env.PROTOTYPE_IMAGES_STORAGE_CONTAINER = `it-prototypes-${runId}`;
process.env.PROTOTYPE_IMAGE_BACKOFF_MS = "100";

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==";

async function main(): Promise<void> {
  const config = loadPrototypeImageConfig(process.env);
  await dataSource.initialize();

  const generations = dataSource.getRepository(PrototypeGenerationEntity);
  const screens = dataSource.getRepository(PrototypeScreenEntity);
  const specifications = dataSource.getRepository(
    PrototypeVisualSpecificationEntity,
  );
  const images = dataSource.getRepository(PrototypeGeneratedImageEntity);

  // --- Proveedor de IA simulado: se puede retener la próxima llamada y liberarla a voluntad. ---
  const provider = {
    calls: 0,
    gates: [] as Array<() => void>,
    holdNext: false,
    async generate() {
      provider.calls += 1;
      if (provider.holdNext) {
        provider.holdNext = false;
        await new Promise<void>((resolve) => provider.gates.push(resolve));
      }
      return {
        provider: "OPENAI_IMAGES" as const,
        model: "integracion",
        mediaType: "image/png" as const,
        imageBase64: PNG,
        executionId: `exec-${provider.calls}`,
      };
    },
    releaseAll() {
      for (const release of provider.gates.splice(0)) release();
    },
  };

  const generationService = new PrototypeGenerationService(
    generations,
    screens,
  );
  const visualService = new PrototypeVisualSpecificationService(
    generations,
    screens,
    specifications,
    dataSource,
    new PrototypeVisualSpecificationBuilder(),
  );
  const queue = new PrototypeImageGenerationQueue(config);
  const storage = new PrototypeImageBlobStorage(config);
  const imageService = new PrototypeImageGenerationService(
    generations,
    images,
    specifications,
    screens,
    queue,
    provider,
    new PrototypeImagePromptBuilder(),
    new PrototypeImageSizeMapper(),
    storage,
    config,
  );
  const worker = new PrototypeImageGenerationWorker(config, imageService);
  worker.onModuleInit();

  const user = randomUUID();
  const createdGenerations: string[] = [];

  async function until<T>(
    description: string,
    probe: () => Promise<T | false | null | undefined>,
    timeoutMs = 30_000,
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await probe();
      if (value) return value;
      if (Date.now() > deadline)
        throw new Error(`Tiempo agotado esperando: ${description}`);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  /** Genera una generación lista para crear imágenes: fuente, plan, especificaciones visuales. */
  async function seed(screenCount: number) {
    const created = await generationService.createSource(
      {
        sourceFileName: `integracion-${runId}.md`,
        markdown: "# Portal\n\n## Pantallas\nContenido de integración.",
        targetDevice: "WEB",
      },
      user,
    );
    createdGenerations.push(created.id);
    await screens.save(
      Array.from({ length: screenCount }, (_, index) =>
        screens.create({
          generationId: created.id,
          order: index + 1,
          code: `pantalla-${index + 1}`,
          name: `Pantalla ${index + 1}`,
          objective: "Consultar datos",
          origin: "EXPLICIT",
          route: null,
          componentsJson: JSON.stringify(["Tabla", "Filtros"]),
          device: "WEB",
          status: "PLANNED",
          imageStorageKey: null,
        }),
      ),
    );
    await generations.update(
      { id: created.id },
      {
        status: "PLANNED",
        plannerProvider: "OPENAI",
        plannerModel: "integracion",
        applicationName: "Portal de integración",
        summary: "Prueba de integración.",
        totalScreens: screenCount,
      },
    );
    await visualService.buildForGeneration(created.id, user);
    return created.id;
  }

  const blobNames = async (generationId: string): Promise<string[]> => {
    const names: string[] = [];
    for await (const blob of storage.list())
      if (blob.name.startsWith(`prototypes/${generationId}/`))
        names.push(blob.name);
    return names.sort();
  };
  const rows = (generationId: string) =>
    images.find({ where: { generationId } });
  const passed: string[] = [];
  const ok = (name: string) => {
    passed.push(name);
    console.log(`✓ ${name}`);
  };

  try {
    // 1) Camino feliz: la cola real procesa las imágenes y cada una queda en Blob Storage.
    {
      const id = await seed(3);
      await imageService.start(id, user);
      await until(
        "las 3 imágenes completadas",
        async () =>
          (await generations.findOneBy({ id }))?.status === "COMPLETED",
      );
      const stored = await blobNames(id);
      assert.equal(stored.length, 3);
      const all = await rows(id);
      assert.deepEqual(
        all.map((image) => image.status),
        ["COMPLETED", "COMPLETED", "COMPLETED"],
      );
      for (const image of all)
        assert.ok(stored.includes(image.storageKey ?? ""));
      ok("generar: la cola real completa las imágenes y las guarda en Azurite");
    }

    // 2) Detener → reintentar mientras la IA trabaja: el trabajo antiguo no pisa el intento nuevo.
    {
      const id = await seed(1);
      provider.holdNext = true;
      const callsBefore = provider.calls;
      await imageService.start(id, user);
      await until(
        "la IA tiene el trabajo retenido",
        async () =>
          provider.calls === callsBefore + 1 &&
          (await rows(id))[0]?.status === "GENERATING",
      );
      await imageService.stop(id, user);
      assert.equal((await rows(id))[0]?.status, "FAILED");
      await imageService.retryFailed(id, user);
      assert.equal((await rows(id))[0]?.attemptNumber, 2);

      provider.releaseAll(); // el trabajo del intento 1 termina tarde
      await until(
        "el intento 2 completado",
        async () => (await rows(id))[0]?.status === "COMPLETED",
      );
      const [image] = await rows(id);
      assert.equal(image?.attemptNumber, 2);
      const stored = await blobNames(id);
      assert.equal(
        stored.length,
        1,
        `solo debe existir el archivo del intento 2: ${stored.join(", ")}`,
      );
      assert.match(stored[0] ?? "", /-v2\.png$/u);
      assert.equal(image?.storageKey, stored[0]);
      ok(
        "detener → reintentar: el trabajo antiguo no sobrescribe ni deja archivos",
      );
    }

    // 3) Detener → importar: el trabajo antiguo no reemplaza la imagen importada.
    {
      const id = await seed(1);
      provider.holdNext = true;
      const callsBefore = provider.calls;
      await imageService.start(id, user);
      await until(
        "la IA tiene el trabajo retenido",
        async () =>
          provider.calls === callsBefore + 1 &&
          (await rows(id))[0]?.status === "GENERATING",
      );
      await imageService.stop(id, user);
      await imageService.importImage(id, user, "01-pantalla-1-web.png", PNG);
      const imported = (await rows(id))[0];
      assert.equal(imported?.provider, "OTHER");
      provider.releaseAll();
      // El trabajo antiguo termina (el siguiente trabajo de la cola ya no tiene nada pendiente).
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const after = (await rows(id))[0];
      assert.equal(after?.provider, "OTHER");
      assert.equal(after?.storageKey, imported?.storageKey);
      assert.equal((await blobNames(id)).length, 1);
      ok("detener → importar: la imagen importada se conserva");
    }

    // 4) Eliminar durante la generación: no se recrean filas ni quedan archivos.
    {
      const id = await seed(1);
      provider.holdNext = true;
      const callsBefore = provider.calls;
      await imageService.start(id, user);
      await until(
        "la IA tiene el trabajo retenido",
        async () =>
          provider.calls === callsBefore + 1 &&
          (await rows(id))[0]?.status === "GENERATING",
      );
      await imageService.deleteGeneration(id, user);
      provider.releaseAll();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      assert.equal((await rows(id)).length, 0, "no se recrearon imágenes");
      assert.equal(
        await generations.findOneBy({ id }),
        null,
        "no se recreó la generación",
      );
      assert.deepEqual(await blobNames(id), [], "no quedaron archivos");
      ok(
        "eliminar durante la generación: sin filas recreadas ni archivos huérfanos",
      );
    }

    // 5) Reemplazar una imagen 4 veces: en Azurite solo quedan la versión actual y la anterior.
    {
      const id = await seed(1);
      for (let attempt = 1; attempt <= 4; attempt += 1)
        await imageService.importImage(id, user, "01-pantalla-1-web.png", PNG);
      const [image] = await rows(id);
      assert.equal(image?.attemptNumber, 4);
      const stored = await blobNames(id);
      assert.equal(
        stored.length,
        2,
        `versiones en Azurite: ${stored.join(", ")}`,
      );
      assert.deepEqual(
        stored,
        [image?.previousStorageKey, image?.storageKey].sort(),
      );
      ok("reemplazar 4 veces: Azurite conserva solo la actual y la anterior");
    }

    // 6) Reconciliador real: borra el huérfano y respeta lo referenciado.
    {
      const id = await seed(1);
      await imageService.importImage(id, user, "01-pantalla-1-web.png", PNG);
      const orphan = `prototypes/${id}/web/999-huerfano.png`;
      await storage.upload(orphan, Buffer.from(PNG, "base64"));
      const reconciler = new PrototypeImageBlobReconciler(storage, images, {
        ...config,
        blobReconcile: {
          mode: "DELETE",
          intervalMs: 3_600_000,
          graceMs: 3_600_000,
          maxDeletesPerRun: 50,
        },
      });
      // «Dentro de 2 horas»: el huérfano ya supera el margen de seguridad.
      const result = await reconciler.reconcile(
        new Date(Date.now() + 2 * 3_600_000),
      );
      assert.ok(result.deleted >= 1);
      const stored = await blobNames(id);
      assert.ok(!stored.includes(orphan), "el huérfano se borró");
      const [image] = await rows(id);
      assert.deepEqual(stored, [image?.storageKey]);
      // Con la hora actual (margen sin cumplir) no se borra nada reciente.
      const orphanRecent = `prototypes/${id}/web/998-reciente.png`;
      await storage.upload(orphanRecent, Buffer.from(PNG, "base64"));
      await reconciler.reconcile(new Date());
      assert.ok(
        (await blobNames(id)).includes(orphanRecent),
        "un archivo reciente no se borra",
      );
      ok(
        "reconciliador: borra huérfanos antiguos y respeta recientes y referenciados",
      );
    }

    console.log(
      `\nIntegración de imágenes de prototipos correcta (${passed.length} escenarios).`,
    );
  } finally {
    provider.releaseAll();
    await worker.onModuleDestroy();
    // Limpieza: filas de la ejecución, contenedor de Blob y cola propios.
    if (createdGenerations.length) {
      await images.delete({ generationId: In(createdGenerations) });
      await specifications.delete({ generationId: In(createdGenerations) });
      await screens.delete({ generationId: In(createdGenerations) });
      await generations.delete({ id: In(createdGenerations) });
    }
    await BlobServiceClient.fromConnectionString(config.storageConnectionString)
      .getContainerClient(config.storageContainer)
      .deleteIfExists()
      .catch(() => undefined);
    const cleanup = new Queue(config.queueName, {
      connection: config.connection,
    });
    await cleanup.obliterate({ force: true }).catch(() => undefined);
    await cleanup.close();
    await queue.onModuleDestroy();
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(
    `Falló la integración de imágenes de prototipos: ${
      error instanceof Error ? (error.stack ?? error.message) : String(error)
    }`,
  );
  process.exitCode = 1;
});
