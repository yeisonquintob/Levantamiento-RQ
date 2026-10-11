import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import type { PrototypeImageProvider } from "../../apps/prototypes-service/src/images/prototype-image.provider";
import { PrototypeImageProviderError } from "../../apps/prototypes-service/src/images/prototype-image.provider";
import { OpenAiPrototypeImageProvider } from "../../apps/prototypes-service/src/images/openai-prototype-image.provider";
import { PrototypeImageSizeMapper } from "../../apps/prototypes-service/src/images/prototype-image-size.mapper";
import { loadPrototypeImageConfig } from "../../apps/prototypes-service/src/images/prototype-image.config";
import { validatePrototypePng } from "../../apps/prototypes-service/src/images/prototype-png-validation";
import { PrototypeImageGenerationService } from "../../apps/prototypes-service/src/images/prototype-image-generation.service";
import { PrototypeVisualSpecificationBuilder } from "../../apps/prototypes-service/src/visual/prototype-visual-specification.builder";
import { PrototypeImagePromptBuilder } from "../../apps/prototypes-service/src/visual/prototype-image-prompt.builder";
import type { PrototypeScreenDetail } from "../../libs/shared/contracts/src/lib/prototypes";

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==";
const owner = "22222222-2222-4222-8222-222222222222";
function screen(index: number): PrototypeScreenDetail {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    generationId: "11111111-1111-4111-8111-111111111111",
    order: index,
    code: `screen-${index}`,
    name: `Pantalla ${index}`,
    objective: "Consultar datos",
    origin: "EXPLICIT",
    route: null,
    components: ["table", "filter"],
    device: "RESPONSIVE",
    status: "PLANNED",
    imageStorageKey: null,
  };
}
function harness(
  count: number,
  target: "WEB" | "MOBILE" | "RESPONSIVE" = "WEB",
  provider?: PrototypeImageProvider,
) {
  const generation: any = {
    id: screen(1).generationId,
    projectId: null,
    sourceFileName: "RQ.md",
    sourceMarkdown: "# RQ",
    sourceSha256: "a".repeat(64),
    sourceSizeBytes: "4",
    targetDevice: target,
    status: "VISUAL_SPEC_READY",
    plannerProvider: "OPENAI",
    plannerModel: "gpt-test",
    applicationName: "Portal",
    summary: "Resumen",
    imageProvider: null,
    totalScreens: count,
    generatedScreens: 0,
    totalVisualSpecifications: target === "RESPONSIVE" ? count * 2 : count,
    totalImages: 0,
    completedImages: 0,
    failedImages: 0,
    errorCode: null,
    errorMessage: null,
    requestedByUserId: owner,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const screens = Array.from({ length: count }, (_, index) =>
    screen(index + 1),
  );
  const visualBuilder = new PrototypeVisualSpecificationBuilder();
  const specifications: any[] = screens
    .flatMap((item) => visualBuilder.build(item, target))
    .map((item, index) => ({
      ...item,
      id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      specificationJson: JSON.stringify(item),
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
  const images: any[] = [];
  const jobs: any[] = [];
  const uploads: any[] = [];
  const generationRepo = {
    findOne: async ({ where }: any) =>
      where.requestedByUserId && where.requestedByUserId !== owner
        ? null
        : generation,
    // El servicio relee la generación por id para detectar cancelaciones.
    findOneBy: async (where: any) =>
      where.id === undefined || where.id === generation.id ? generation : null,
    save: async (value: any) => value,
  };
  const imageRepo = {
    create: (value: any) => value,
    save: async (value: any) => {
      for (const item of Array.isArray(value) ? value : [value])
        if (!images.includes(item)) images.push(item);
      return value;
    },
    find: async ({ where }: any = {}) =>
      images.filter(
        (item) =>
          (where?.generationId === undefined ||
            item.generationId === where.generationId) &&
          (where?.status === undefined || item.status === where.status),
      ),
    findOne: async ({ where }: any) =>
      images.find((item) =>
        where.visualSpecificationId
          ? item.visualSpecificationId === where.visualSpecificationId
          : item.id === where.id,
      ) ?? null,
    update: async (where: any, partial: any) => {
      const image = images.find(
        (item) =>
          item.id === where.id &&
          (where.status === undefined || item.status === where.status),
      );
      if (!image) return { affected: 0 };
      for (const [key, value] of Object.entries(partial)) {
        image[key] =
          typeof value === "function" ? Number(image[key] ?? 1) + 1 : value;
      }
      return { affected: 1 };
    },
  };
  const specificationRepo = {
    find: async () => specifications,
    findOne: async ({ where }: any) =>
      specifications.find((item) => item.id === where.id) ?? null,
  };
  const screenRepo = {
    find: async () => screens,
    findByIds: async (ids: string[]) =>
      screens.filter((item) => ids.includes(item.id)),
    findOne: async ({ where }: any) =>
      screens.find((item) => item.id === where.id) ?? null,
  };
  const queue = {
    // La cola simulada no pierde trabajos, así que no hay nada que recuperar.
    ensurePendingJobs: async () => 0,
    enqueue: async (data: any, attemptNumber?: number) => {
      jobs.push({ ...data, attemptNumber });
      return data;
    },
  };
  const imageProvider = provider ?? {
    generate: async () => ({
      provider: "OPENAI_IMAGES" as const,
      model: "gpt-image-test",
      mediaType: "image/png" as const,
      imageBase64: PNG,
      executionId: "exec-1",
    }),
  };
  const storage = {
    upload: async (key: string, binary: Buffer) => {
      uploads.push({ key, binary });
    },
    download: async () => Buffer.from(PNG, "base64"),
  };
  const service = new PrototypeImageGenerationService(
    generationRepo as never,
    imageRepo as never,
    specificationRepo as never,
    screenRepo as never,
    queue as never,
    imageProvider,
    new PrototypeImagePromptBuilder(),
    new PrototypeImageSizeMapper(),
    storage as never,
    { maxImageBytes: 1_000_000 } as never,
  );
  return { service, generation, specifications, images, jobs, uploads };
}

test("PrototypeImageProvider está desacoplado y OpenAI lo implementa", async () => {
  const provider: PrototypeImageProvider = new OpenAiPrototypeImageProvider({
    generate: async () => ({
      provider: "OPENAI_IMAGES",
      model: "image-test",
      mediaType: "image/png",
      imageBase64: PNG,
      executionId: "e",
    }),
  } as never);
  assert.equal(
    (
      await provider.generate({
        prompt: "p",
        device: "WEB",
        requestedSize: "1536x1024",
        correlationId: "c",
      })
    ).provider,
    "OPENAI_IMAGES",
  );
});
test("mapper usa paisaje para WEB y retrato para MOBILE", () => {
  const mapper = new PrototypeImageSizeMapper();
  assert.equal(mapper.forDevice("WEB"), "1536x1024");
  assert.equal(mapper.forDevice("MOBILE"), "1024x1536");
});
test("valida PNG, MIME, tamaño, base64 e imagen decodificable", () => {
  assert.deepEqual(
    { ...validatePrototypePng(PNG, "image/png", 1024), buffer: undefined },
    { buffer: undefined, width: 1, height: 1 },
  );
  assert.throws(() => validatePrototypePng(PNG, "image/jpeg", 1024));
  assert.throws(() => validatePrototypePng("%%%", "image/png", 1024));
  assert.throws(() => validatePrototypePng(PNG, "image/png", 10));
  assert.throws(() =>
    validatePrototypePng(
      Buffer.from("not-png").toString("base64"),
      "image/png",
      1024,
    ),
  );
});
test("configura cola dedicada, retry exponencial y concurrencia conservadora", async () => {
  const config = loadPrototypeImageConfig({
    AZURE_STORAGE_CONNECTION_STRING: "UseDevelopmentStorage=true",
  });
  assert.equal(config.queueName, "prototype-image-generation");
  assert.equal(config.attempts, 3);
  assert.equal(config.concurrency, 1);
  const source = await readFile(
    join(
      process.cwd(),
      "apps/prototypes-service/src/images/prototype-image-generation.queue.ts",
    ),
    "utf8",
  );
  assert.match(source, /type:\s*"exponential"/);
});
test("WEB y MOBILE crean una imagen por visual spec", async () => {
  for (const device of ["WEB", "MOBILE"] as const) {
    const value = harness(3, device);
    const result = await value.service.start(value.generation.id, owner);
    assert.equal(result.images.length, 3);
    assert.equal(value.jobs.length, 3);
  }
});
test("RESPONSIVE con 12 pantallas crea 24 imágenes simuladas", async () => {
  const value = harness(12, "RESPONSIVE");
  const result = await value.service.start(value.generation.id, owner);
  assert.equal(result.progress.totalImages, 24);
  assert.equal(result.progress.web.total, 12);
  assert.equal(result.progress.mobile.total, 12);
  for (const job of value.jobs) await value.service.process(job, 1, 3);
  assert.equal(
    value.images.filter((image) => image.status === "COMPLETED").length,
    24,
  );
  assert.equal(value.uploads.length, 24);
  assert.equal(value.generation.status, "COMPLETED");
});
test("doble inicio y job repetido son idempotentes", async () => {
  const value = harness(2, "WEB");
  await value.service.start(value.generation.id, owner);
  await value.service.start(value.generation.id, owner);
  assert.equal(value.images.length, 2);
  await value.service.process(value.jobs[0], 1, 3);
  await value.service.process(value.jobs[0], 1, 3);
  assert.equal(value.uploads.length, 1);
});
test("worker usa PromptBuilder, guarda PNG fuera de SQL y completa metadata", async () => {
  let receivedPrompt = "";
  const value = harness(1, "WEB", {
    generate: async (input) => {
      receivedPrompt = input.prompt;
      return {
        provider: "OPENAI_IMAGES",
        model: "gpt-image-test",
        mediaType: "image/png",
        imageBase64: PNG,
        executionId: "exec",
      };
    },
  });
  await value.service.start(value.generation.id, owner);
  await value.service.process(value.jobs[0], 1, 3);
  assert.match(receivedPrompt, /Screen: Pantalla 1/);
  assert.equal(value.images[0].status, "COMPLETED");
  assert.equal(value.images[0].mediaType, "image/png");
  assert.match(
    value.images[0].storageKey,
    /^prototypes\/.*\/web\/001-screen-1\.png$/,
  );
  assert.equal(
    value.uploads[0].binary.equals(Buffer.from(PNG, "base64")),
    true,
  );
  assert.equal((value.images[0] as any).imageBase64, undefined);
});
test("respuesta inválida termina FAILED sin guardar binario", async () => {
  const value = harness(1, "WEB", {
    generate: async () => ({
      provider: "OPENAI_IMAGES",
      model: "test",
      mediaType: "image/png",
      imageBase64: "bad!",
      executionId: "e",
    }),
  });
  await value.service.start(value.generation.id, owner);
  await value.service.process(value.jobs[0], 1, 3);
  assert.equal(value.images[0].status, "FAILED");
  assert.equal(value.uploads.length, 0);
});
test("error temporal reintenta y error permanente no entra en loop", async () => {
  const temporary = harness(1, "WEB", {
    generate: async () => {
      throw new PrototypeImageProviderError(
        "OPENAI_IMAGE_HTTP_429",
        "Temporal",
        true,
      );
    },
  });
  await temporary.service.start(temporary.generation.id, owner);
  await assert.rejects(temporary.service.process(temporary.jobs[0], 1, 3));
  assert.equal(temporary.images[0].status, "PENDING");
  await temporary.service.process(temporary.jobs[0], 3, 3);
  assert.equal(temporary.images[0].status, "FAILED");
  const permanent = harness(1, "WEB", {
    generate: async () => {
      throw new PrototypeImageProviderError(
        "OPENAI_IMAGE_PROVIDER_NOT_CONFIGURED",
        "No configurado",
        false,
      );
    },
  });
  await permanent.service.start(permanent.generation.id, owner);
  await permanent.service.process(permanent.jobs[0], 1, 3);
  assert.equal(permanent.images[0].status, "FAILED");
});
test("error parcial conserva imágenes buenas y consolida contadores", async () => {
  let calls = 0;
  const value = harness(2, "WEB", {
    generate: async () =>
      ++calls === 1
        ? {
            provider: "OPENAI_IMAGES",
            model: "test",
            mediaType: "image/png",
            imageBase64: PNG,
            executionId: "ok",
          }
        : Promise.reject(
            new PrototypeImageProviderError(
              "PROMPT_INVALID",
              "Inválido",
              false,
            ),
          ),
  });
  await value.service.start(value.generation.id, owner);
  await value.service.process(value.jobs[0], 1, 3);
  await value.service.process(value.jobs[1], 1, 3);
  assert.equal(value.generation.status, "PARTIALLY_COMPLETED");
  assert.equal(value.generation.completedImages, 1);
  assert.equal(value.generation.failedImages, 1);
  assert.equal(value.uploads.length, 1);
});
test("no expone secretos ni reutiliza prompts documentales", async () => {
  const paths = [
    "apps/prototypes-service/src/images/ai-analysis-image-generation.client.ts",
    "apps/ai-analysis-service/src/internal/internal-image-generation.service.ts",
    "apps/prototypes-service/src/images/prototype-image-generation.queue.ts",
  ];
  const source = (
    await Promise.all(
      paths.map((path) => readFile(join(process.cwd(), path), "utf8")),
    )
  ).join("\n");
  assert.doesNotMatch(
    source,
    /secretReference|AI_SECRET_VAULT|document.*prompt/i,
  );
  assert.doesNotMatch(source, /apiKey.*return|imageBase64.*JobData/i);
});
test("endpoint de contenido conserva autorización y el endpoint OpenAI es interno", async () => {
  const publicController = await readFile(
    join(
      process.cwd(),
      "apps/prototypes-service/src/images/prototype-images.controller.ts",
    ),
    "utf8",
  );
  const internalController = await readFile(
    join(
      process.cwd(),
      "apps/ai-analysis-service/src/internal/internal-image-generation.controller.ts",
    ),
    "utf8",
  );
  assert.match(publicController, /UseGuards\(PrototypesAccessTokenGuard\)/);
  assert.match(internalController, /serviceIdentity !== "prototypes-service"/);
  assert.match(
    internalController,
    /Controller\("internal\/image-generations"\)/,
  );
});
test("worker no modifica PrototypePlan ni PrototypeVisualSpecification", async () => {
  const value = harness(1);
  const before = JSON.stringify(value.specifications);
  await value.service.start(value.generation.id, owner);
  await value.service.process(value.jobs[0], 1, 3);
  assert.equal(JSON.stringify(value.specifications), before);
});

test("retry acepta FAILED, rechaza COMPLETED y no duplica un segundo retry", async () => {
  const value = harness(2, "WEB");
  await value.service.start(value.generation.id, owner);
  value.images[0].status = "FAILED";
  value.images[0].attemptNumber = 1;
  value.jobs.length = 0;
  const retried = await value.service.retry(value.images[0].id, owner);
  assert.equal(retried.image.status, "PENDING");
  assert.equal(retried.image.attemptNumber, 2);
  assert.equal(value.jobs.length, 1);
  await value.service.retry(value.images[0].id, owner);
  assert.equal(value.jobs.length, 1);
  value.images[1].status = "COMPLETED";
  await assert.rejects(value.service.retry(value.images[1].id, owner));
});

test("retry-failed encola exclusivamente fallidas y conserva completadas", async () => {
  const value = harness(3, "WEB");
  await value.service.start(value.generation.id, owner);
  Object.assign(value.images[0], { status: "COMPLETED", attemptNumber: 1 });
  Object.assign(value.images[1], { status: "FAILED", attemptNumber: 1 });
  Object.assign(value.images[2], { status: "FAILED", attemptNumber: 1 });
  value.jobs.length = 0;
  const result = await value.service.retryFailed(value.generation.id, owner);
  assert.equal(value.jobs.length, 2);
  assert.equal(
    result.images.find((item) => item.id === value.images[0].id)?.status,
    "COMPLETED",
  );
  assert.equal(result.progress.pendingImages, 2);
  assert.equal(result.progress.failedImages, 0);
});

test("regeneración selectiva incrementa intento y conserva metadata anterior", async () => {
  const value = harness(1, "WEB");
  await value.service.start(value.generation.id, owner);
  await value.service.process(value.jobs[0], 1, 3);
  const previousStorageKey = value.images[0].storageKey;
  value.jobs.length = 0;
  const action = await value.service.regenerate(value.images[0].id, owner);
  assert.equal(action.image.attemptNumber, 2);
  assert.equal(value.images[0].previousProvider, "OPENAI_IMAGES");
  assert.equal(value.images[0].previousModel, "gpt-image-test");
  assert.equal(value.images[0].previousStatus, "COMPLETED");
  assert.equal(value.images[0].previousStorageKey, previousStorageKey);
  await value.service.process(value.jobs[0], 1, 3);
  assert.match(value.images[0].storageKey, /-v2\.png$/);
});

test("GET images respeta screen order y progreso vuelve a activo tras retry", async () => {
  const value = harness(3, "WEB");
  await value.service.start(value.generation.id, owner);
  value.images.reverse();
  const listed = await value.service.list(value.generation.id, owner);
  assert.deepEqual(
    listed.map((item) => item.screenOrder),
    [1, 2, 3],
  );
  value.images[0].status = "FAILED";
  value.images[0].attemptNumber = 1;
  await value.service.retry(value.images[0].id, owner);
  const progress = await value.service.progress(value.generation.id, owner);
  assert.equal(progress.status, "IMAGE_GENERATING");
  assert.ok(progress.pendingImages >= 1);
});

test("usuario ajeno no consulta contenido y Blob continúa privado", async () => {
  const value = harness(1, "WEB");
  await value.service.start(value.generation.id, owner);
  await value.service.process(value.jobs[0], 1, 3);
  await assert.rejects(
    value.service.content(
      value.images[0].id,
      "99999999-9999-4999-8999-999999999999",
    ),
  );
  const source = await readFile(
    join(
      process.cwd(),
      "apps/prototypes-service/src/images/prototype-image-blob.storage.ts",
    ),
    "utf8",
  );
  assert.match(source, /blobPublicAccess/);
  assert.doesNotMatch(source, /setAccessPolicy|publicAccess:\s*["']container/i);
});

test("exporta un prompt por pantalla y formato con el nombre de archivo que se importará", async () => {
  const value = harness(2, "RESPONSIVE");
  const exported = await value.service.exportPrompts(value.generation.id, owner);
  assert.equal(exported.items.length, 4);
  assert.equal(exported.applicationName, "Portal");
  assert.equal(exported.applicationSummary, "Resumen");
  assert.deepEqual(exported.screens.map((item) => item.screenCode), ["screen-1", "screen-2"]);
  assert.equal(exported.designSystem.code, "CORPORATE_DEFAULT_V1");
  assert.deepEqual(
    exported.items.map((item) => item.fileName),
    ["01-screen-1-mobile.png", "01-screen-1-web.png", "02-screen-2-mobile.png", "02-screen-2-web.png"],
  );
  assert.ok(exported.items.every((item) => item.prompt.includes("Professional neutral enterprise application UI.")));
  assert.deepEqual(
    exported.items.filter((item) => item.device === "WEB").map((item) => [item.width, item.height]),
    [[1536, 1024], [1536, 1024]],
  );
});

test("importa una imagen externa por nombre, la deja completada y la reemplaza al repetirla", async () => {
  const value = harness(2, "WEB");
  const first = await value.service.importImage(value.generation.id, owner, "02-screen-2-web.png", PNG);
  assert.equal(first.image.screenCode, "screen-2");
  assert.equal(first.image.status, "COMPLETED");
  assert.equal(first.image.provider, "OTHER");
  assert.equal(value.uploads.length, 1);
  assert.match(value.uploads[0].key, /web\/002-screen-2\.png$/);
  assert.equal(value.generation.completedImages, 1);

  // Los programas de descarga renombran («(1)», mayúsculas): se reconoce igual y se reemplaza.
  const again = await value.service.importImage(value.generation.id, owner, "02-Screen-2-WEB (1).PNG", PNG);
  assert.equal(again.image.id, first.image.id);
  assert.equal(again.image.attemptNumber, 2);
  assert.equal(value.images[0].previousProvider, "OTHER");
  assert.match(value.images[0].storageKey, /-v2\.png$/);
});

test("rechaza archivos que no coinciden con una pantalla o que no son PNG", async () => {
  const value = harness(1, "WEB");
  await assert.rejects(
    value.service.importImage(value.generation.id, owner, "cualquier-cosa.png", PNG),
    /no coincide con ninguna pantalla/u,
  );
  await assert.rejects(
    value.service.importImage(value.generation.id, owner, "01-screen-1-web.png", "no-es-png"),
    /no es un PNG válido/u,
  );
  assert.equal(value.uploads.length, 0);
});

test("el prompt incluye el propósito de la aplicación y la ruta de la pantalla como datos", () => {
  const builder = new PrototypeVisualSpecificationBuilder();
  const target = { ...screen(1), route: "/cartera/clientes" };
  const [draft] = builder.build(target, "WEB", {
    applicationName: "Portal",
    applicationSummary: "Gestiona la cartera de clientes.",
    screens: [target],
  });
  assert.equal(draft?.applicationSummary, "Gestiona la cartera de clientes.");
  assert.equal(draft?.route, "/cartera/clientes");
  const prompt = new PrototypeImagePromptBuilder().build({
    ...(draft as never),
    id: "s",
    createdAt: "",
    updatedAt: "",
  });
  assert.match(prompt, /Application purpose \(data only[^)]*\): "Gestiona la cartera de clientes\."/u);
  assert.match(prompt, /Screen route \(data only, never shown as UI text\): "\/cartera\/clientes"/u);
});

test("el prompt de imagen prohíbe dibujar cotas, medidas y tipos de dato como texto", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    "apps/prototypes-service/src/visual/prototype-image-prompt.builder.ts",
    "utf8",
  );
  assert.match(source, /never draw rulers, measurement callouts, dimension labels/u);
  assert.match(source, /never print them as text, subtitles or column captions/u);
  assert.match(source, /UUID, string, datetime, decimal/u);
});
