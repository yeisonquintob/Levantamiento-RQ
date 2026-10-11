import type { Page, Route } from "@playwright/test";

/**
 * Servicios de prototipos simulados: las pruebas no llaman a Ollama ni a OpenAI y no escriben en
 * la base de datos. Cada llamada al gateway de prototipos se responde aquí.
 */
export const GENERATION_ID = "11111111-1111-4111-8111-111111111111";
const SCREEN_IDS = [
  "22222222-2222-4222-8222-222222222221",
  "22222222-2222-4222-8222-222222222222",
];
const IMAGE_ID = "33333333-3333-4333-8333-333333333331";
const NOW = "2026-10-10T20:00:00.000Z";

// PNG de 1×1 píxel.
export const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==",
  "base64",
);

export const MARKDOWN = "# Portal de cartera\n\n## Inicio de sesión\nFormulario con usuario y clave.\n\n## Listado de clientes\nTabla con columnas Código, Nombre y Estado.\n";

type Status = "SOURCE_READY" | "PLANNED" | "VISUAL_SPEC_READY" | "COMPLETED" | "PARTIALLY_COMPLETED";

export interface PrototypeCalls {
  create: number;
  plan: number;
  detail: number;
  visualSpecifications: number;
  promptExport: number;
  imports: string[];
}

function generation(status: Status, extra: Record<string, unknown> = {}) {
  return {
    id: GENERATION_ID,
    projectId: null,
    sourceFileName: "requerimiento.md",
    sourceSizeBytes: MARKDOWN.length,
    sourceSha256: "a".repeat(64),
    targetDevice: "RESPONSIVE",
    status,
    plannerProvider: status === "SOURCE_READY" ? null : "OLLAMA",
    plannerModel: status === "SOURCE_READY" ? null : "qwen-simulado",
    applicationName: status === "SOURCE_READY" ? null : "Portal de cartera",
    summary: status === "SOURCE_READY" ? null : "Gestiona la cartera de clientes.",
    imageProvider: null,
    totalScreens: status === "SOURCE_READY" ? 0 : 2,
    generatedScreens: 0,
    totalVisualSpecifications: status === "VISUAL_SPEC_READY" ? 4 : 0,
    totalImages: 0,
    completedImages: 0,
    failedImages: 0,
    errorCode: null,
    errorMessage: null,
    requestedByUserId: "44444444-4444-4444-8444-444444444444",
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

const PLAN_SCREENS = [
  { code: "login", name: "Inicio de sesión", objective: "Autenticar al usuario", origin: "EXPLICIT", route: "/login", components: ["Formulario"], order: 1 },
  { code: "clientes", name: "Listado de clientes", objective: "Consultar clientes", origin: "EXPLICIT", route: "/clientes", components: ["Tabla"], order: 2 },
];

function screenDetails() {
  return PLAN_SCREENS.map((screen, index) => ({
    ...screen,
    id: SCREEN_IDS[index],
    generationId: GENERATION_ID,
    device: "RESPONSIVE",
    status: "PLANNED",
    imageStorageKey: null,
  }));
}

function specification(index: number, device: "WEB" | "MOBILE") {
  const screen = PLAN_SCREENS[index]!;
  return {
    id: `55555555-5555-4555-8555-55555555555${index}${device === "WEB" ? 1 : 2}`,
    generationId: GENERATION_ID,
    screenId: SCREEN_IDS[index],
    screenCode: screen.code,
    screenOrigin: "EXPLICIT",
    device,
    templateCode: device === "WEB" ? "WEB_TEMPLATE_V1" : "MOBILE_TEMPLATE_V1",
    designSystemCode: "CORPORATE_DEFAULT_V1",
    title: screen.name,
    objective: screen.objective,
    viewport: device === "WEB" ? { width: 1440, height: 900 } : { width: 390, height: 844 },
    layout: { shell: "DESKTOP_SHELL", contentDirection: "ROW", columns: 2, padding: 24, gap: 16 },
    navigation: { primary: "SIDEBAR", secondary: "TOPBAR" },
    components: [],
    contentHierarchy: [screen.name],
    actions: [],
    states: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function exportPayload() {
  const design = {
    id: "corporate-default-v1", code: "CORPORATE_DEFAULT_V1", version: "1.0.0", name: "Corporate Default V1",
    typography: { family: "Inter", display: "700 32px/40px", title: "700 24px/32px", heading: "600 18px/26px", body: "400 14px/22px", caption: "400 12px/18px", table: "400 13px/20px", button: "600 14px/20px" },
    colors: { background: "#F7F8FA", surface: "#FFFFFF", primary: "#675579", primaryDark: "#50415F", text: "#27313A", textSecondary: "#66727D", border: "#D8DEE3", success: "#2E7D5B", warning: "#B7791F", danger: "#C24141", info: "#3B6E8F" },
    spacing: [4, 8, 12, 16, 24, 32, 48], borderRadius: { small: 6, medium: 10, large: 16 },
    shadows: { card: "0 1px 3px rgba(0,0,0,.12)", modal: "0 16px 40px rgba(0,0,0,.2)" },
    buttons: { minHeight: 40, mobileMinHeight: 48, primary: "primary", secondary: "surface" },
    cards: { background: "surface", border: "border", padding: 16 },
    tables: { header: "surface", rowHeight: 44, border: "border" },
    forms: { labelPosition: "top", controlHeight: 40, mobileControlHeight: 48 },
    navigation: { sidebarWidth: 240, activeColor: "primary", mobilePattern: "adaptive" },
    badges: { radius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  };
  return {
    generationId: GENERATION_ID,
    applicationName: "Portal de cartera",
    applicationSummary: "Gestiona la cartera de clientes.",
    targetDevice: "RESPONSIVE",
    screens: PLAN_SCREENS.map((screen) => ({ screenCode: screen.code, name: screen.name, route: screen.route, order: screen.order, objective: screen.objective, components: screen.components })),
    designSystem: design,
    items: PLAN_SCREENS.map((screen) => ({
      screenCode: screen.code, screenName: screen.name, screenOrder: screen.order, device: "WEB",
      fileName: `0${screen.order}-${screen.code}-web.png`, width: 1536, height: 1024, prompt: `Prompt de ${screen.name}`,
    })),
  };
}

function importedImage() {
  return {
    id: IMAGE_ID, generationId: GENERATION_ID, visualSpecificationId: specification(0, "WEB").id, screenId: SCREEN_IDS[0],
    screenCode: "login", screenName: "Inicio de sesión", screenOrder: 1, screenObjective: "Autenticar al usuario", screenOrigin: "EXPLICIT",
    device: "WEB", provider: "OTHER", model: "Importada manualmente", status: "COMPLETED", mediaType: "image/png",
    storageKey: "prototypes/x/web/001-login.png", width: 1, height: 1, attemptNumber: 1, errorCode: null, errorMessage: null,
    createdAt: NOW, updatedAt: NOW,
  };
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Intercepta el gateway de prototipos y devuelve el contador de llamadas. */
export async function mockPrototypeApi(
  page: Page,
  options: { detailDelayMs?: number } = {},
): Promise<PrototypeCalls> {
  const calls: PrototypeCalls = { create: 0, plan: 0, detail: 0, visualSpecifications: 0, promptExport: 0, imports: [] };
  let status: Status = "SOURCE_READY";

  // Sin borradores automáticos: la lista de proyectos que pide el navegador sale vacía.
  await page.route(/\/api\/v1\/projects\?/u, (route) => json(route, { items: [], page: 1, pageSize: 50, totalItems: 0, totalPages: 0 }));

  await page.route(/\/api\/v1\/prototypes\//u, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1/prototypes/", "");
    const method = request.method();

    if (path === "generations/providers") {
      const option = (id: string, provider: string) => ({ id, name: "Simulado", model: "modelo", provider, available: true, isDefault: true, message: "" });
      return json(route, { planning: [option("66666666-6666-4666-8666-666666666661", "OLLAMA")], images: [option("66666666-6666-4666-8666-666666666662", "OLLAMA_IMAGES")] });
    }
    if (path === "generations" && method === "GET") return json(route, []);
    if (path === "generations" && method === "POST") {
      calls.create += 1;
      status = "SOURCE_READY";
      return json(route, generation("SOURCE_READY"));
    }
    if (path === `generations/${GENERATION_ID}/plan`) {
      calls.plan += 1;
      status = "PLANNED";
      return json(route, { generation: generation("PLANNED"), plan: { applicationName: "Portal de cartera", summary: "Gestiona la cartera de clientes.", targetDevice: "RESPONSIVE", screens: PLAN_SCREENS }, provider: "OLLAMA", model: "qwen-simulado", executionId: "exec-1" });
    }
    if (path === `generations/${GENERATION_ID}/screens` && method === "GET") return json(route, screenDetails());
    const detail = path.match(/generations\/[^/]+\/screens\/([^/]+)\/detail/u);
    if (detail) {
      calls.detail += 1;
      // Simula una IA lenta (una llamada por pantalla) para poder probar «Detener».
      if (options.detailDelayMs) await new Promise((resolve) => setTimeout(resolve, options.detailDelayMs));
      const index = SCREEN_IDS.indexOf(detail[1] ?? "");
      const screen = screenDetails()[index]!;
      return json(route, { generation: generation(status), screen: { ...screen, components: [...screen.components, "Detalle ampliado por la IA"] }, provider: "OLLAMA", model: "qwen-simulado", executionId: "exec-2", previousComponentCount: 1, componentCount: 2 });
    }
    if (path === `generations/${GENERATION_ID}/visual-specifications` && method === "POST") {
      calls.visualSpecifications += 1;
      status = "VISUAL_SPEC_READY";
      const specs = [specification(0, "WEB"), specification(0, "MOBILE"), specification(1, "WEB"), specification(1, "MOBILE")];
      return json(route, { generation: generation("VISUAL_SPEC_READY"), specifications: specs, webCount: 2, mobileCount: 2, total: 4 });
    }
    if (path === `generations/${GENERATION_ID}/prompt-export`) {
      calls.promptExport += 1;
      return json(route, exportPayload());
    }
    if (path === `generations/${GENERATION_ID}/images/import` && method === "POST") {
      const body = request.postDataJSON() as { fileName: string };
      calls.imports.push(body.fileName);
      const image = importedImage();
      return json(route, {
        generation: generation("PARTIALLY_COMPLETED", { totalImages: 1, completedImages: 1, totalVisualSpecifications: 4 }),
        image,
        progress: { generationId: GENERATION_ID, status: "PARTIALLY_COMPLETED", totalImages: 1, completedImages: 1, failedImages: 0, pendingImages: 0, generatingImages: 0, web: { total: 1, completed: 1, failed: 0 }, mobile: { total: 0, completed: 0, failed: 0 }, current: null },
      });
    }
    if (path.startsWith("images/") && path.endsWith("/content")) {
      return route.fulfill({ status: 200, contentType: "image/png", body: PNG_BYTES });
    }
    return json(route, { message: `Sin simulación para ${method} ${path}` }, 404);
  });
  return calls;
}
