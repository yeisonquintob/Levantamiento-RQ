import type { Page, Route } from "@playwright/test";

/**
 * API de prototipos simulada para pruebas de navegador deterministas: cada prueba describe el
 * estado de la generación y la simulación responde, y registra las llamadas que no son lecturas.
 */
export const GENERATION_ID = "11111111-1111-4111-8111-111111111111";
export const PLANNER_ID = "66666666-6666-4666-8666-666666666661";
export const OLLAMA_ID = "66666666-6666-4666-8666-666666666662";
export const COMFY_ID = "66666666-6666-4666-8666-666666666663";
const NOW = "2026-10-11T21:00:00.000Z";

// PNG de 1×1 píxel.
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==",
  "base64",
);

export interface RecordedCall {
  method: string;
  path: string;
  body: string | null;
}

export interface UiScenario {
  generation?: Record<string, unknown>;
  screenCount?: number;
  images?: Array<Record<string, unknown>>;
  progress?: Record<string, unknown>;
  /** Límite de importación que publica el servidor (por defecto 20 MB). */
  importMaxBytes?: number;
}

const CODES = ["login", "dashboard", "clientes", "aprobaciones", "usuarios"];

export function baseGeneration(extra: Record<string, unknown> = {}) {
  return {
    id: GENERATION_ID,
    projectId: null,
    sourceFileName: "requerimiento.md",
    sourceSizeBytes: 1000,
    sourceSha256: "a".repeat(64),
    targetDevice: "RESPONSIVE",
    status: "FAILED",
    plannerProvider: "OLLAMA",
    plannerModel: "qwen3.5:9b",
    applicationName: "Portal de Cartera",
    summary: "Gestiona la cartera de clientes.",
    imageProvider: "OLLAMA_IMAGES",
    totalScreens: 5,
    generatedScreens: 0,
    totalVisualSpecifications: 10,
    totalImages: 10,
    completedImages: 0,
    failedImages: 10,
    errorCode: null,
    errorMessage: null,
    plannerConfigurationId: PLANNER_ID,
    imageConfigurationId: OLLAMA_ID,
    requestedByUserId: "44444444-4444-4444-8444-444444444444",
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

export function screens(count = 5) {
  return CODES.slice(0, count).map((code, index) => ({
    id: `22222222-2222-4222-8222-22222222222${index}`,
    generationId: GENERATION_ID,
    code,
    name: `Pantalla ${code}`,
    objective: `Objetivo de ${code}`,
    origin: "EXPLICIT",
    route: `/${code}`,
    components: ["Tabla", "Filtros"],
    order: index + 1,
    device: "RESPONSIVE",
    status: "PLANNED",
    imageStorageKey: null,
  }));
}

export function completedImages(count = 3) {
  return CODES.slice(0, count).flatMap((code, index) =>
    (["WEB", "MOBILE"] as const).map((device) => ({
      id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa${index}${device === "WEB" ? 1 : 2}00`,
      generationId: GENERATION_ID,
      visualSpecificationId: "55555555-5555-4555-8555-555555555555",
      screenId: `22222222-2222-4222-8222-22222222222${index}`,
      screenCode: code,
      screenName: code,
      screenOrder: index + 1,
      screenObjective: "x",
      screenOrigin: "EXPLICIT",
      device,
      provider: "COMFYUI",
      model: "m",
      status: "COMPLETED",
      mediaType: "image/png",
      storageKey: "k",
      width: 1,
      height: 1,
      attemptNumber: 1,
      errorCode: null,
      errorMessage: null,
      createdAt: NOW,
      updatedAt: NOW,
    })),
  );
}

export function progressFor(
  generation: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  return {
    generationId: GENERATION_ID,
    status: generation.status,
    totalImages: generation.totalImages,
    completedImages: generation.completedImages,
    failedImages: generation.failedImages,
    pendingImages: 0,
    generatingImages: 0,
    web: { total: 0, completed: 0, failed: 0 },
    mobile: { total: 0, completed: 0, failed: 0 },
    current: null,
    ...extra,
  };
}

const option = (id: string, name: string, provider: string) => ({
  id,
  name,
  model: "modelo",
  provider,
  available: true,
  isDefault: false,
  message: "Disponible",
});

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });

export async function mockPrototypeUi(
  page: Page,
  scenario: UiScenario = {},
): Promise<{ calls: RecordedCall[] }> {
  const generation = baseGeneration(scenario.generation);
  const images = scenario.images ?? [];
  const calls: RecordedCall[] = [];

  await page.route(/\/api\/v1\/projects\?/u, (route) =>
    json(route, {
      items: [],
      page: 1,
      pageSize: 50,
      totalItems: 0,
      totalPages: 0,
    }),
  );
  await page.route(/\/api\/v1\/prototypes\//u, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(
      "/api/v1/prototypes/",
      "",
    );
    if (request.method() !== "GET")
      calls.push({ method: request.method(), path, body: request.postData() });

    if (path === "generations/providers") {
      return json(route, {
        planning: [option(PLANNER_ID, "Local Ollama qwen3.5:9b", "OLLAMA")],
        images: [
          option(OLLAMA_ID, "Ollama Local - Z-Image Turbo", "OLLAMA_IMAGES"),
          option(COMFY_ID, "ComfyUI Local - Z-Image Turbo", "COMFYUI"),
        ],
      });
    }
    if (path === "generations/limits")
      return json(route, {
        importImageMaxBytes: scenario.importMaxBytes ?? 20 * 1024 * 1024,
      });
    if (path === "generations") return json(route, [generation]);
    if (path === `generations/${GENERATION_ID}`) return json(route, generation);
    if (path === `generations/${GENERATION_ID}/screens`)
      return json(route, screens(scenario.screenCount ?? 5));
    if (path === `generations/${GENERATION_ID}/visual-specifications`)
      return json(route, []);
    if (path === `generations/${GENERATION_ID}/images`)
      return json(route, images);
    if (path === `generations/${GENERATION_ID}/image-progress`)
      return json(route, scenario.progress ?? progressFor(generation));
    if (path === `generations/${GENERATION_ID}/image-provider`) {
      const body = JSON.parse(request.postData() ?? "{}") as {
        imageConfigurationId?: string;
      };
      return json(route, {
        ...generation,
        imageConfigurationId: body.imageConfigurationId,
      });
    }
    if (path === `generations/${GENERATION_ID}/images/retry-failed`) {
      const running = {
        ...generation,
        status: "IMAGE_GENERATING",
        failedImages: 0,
      };
      return json(route, {
        generation: running,
        images: [],
        progress: progressFor(running, { pendingImages: 10, failedImages: 0 }),
      });
    }
    if (
      path === `generations/${GENERATION_ID}/images/import` &&
      request.method() === "POST"
    ) {
      const body = JSON.parse(request.postData() ?? "{}") as {
        fileName?: string;
      };
      const image = {
        ...completedImages(1)[0],
        provider: "OTHER",
        model: "Importada manualmente",
        fileName: body.fileName,
      };
      const done = {
        ...generation,
        status: "PARTIALLY_COMPLETED",
        completedImages: 1,
        failedImages: 9,
      };
      return json(route, {
        generation: done,
        image,
        progress: progressFor(done),
      });
    }
    if (path.startsWith("images/") && path.endsWith("/content")) {
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        body: PNG,
      });
    }
    return json(
      route,
      { message: `Sin simulación para ${request.method()} ${path}` },
      404,
    );
  });
  return { calls };
}
