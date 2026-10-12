import assert from "node:assert/strict";
import test from "node:test";
import {
  InternalImageGenerationService,
  buildCheckpointPrompt,
  buildComfyUiWorkflow,
  resolveCheckpointProfile,
  parsePrototypeImageGenerationInternalRequest,
} from "../../apps/ai-analysis-service/src/internal/internal-image-generation.service";
import { loadPrototypeImageGenerationConfig } from "../../apps/ai-analysis-service/src/internal/prototype-image-generation.config";

test("acepta únicamente el propósito y tamaño interno de WEB", () => {
  assert.equal(
    parsePrototypeImageGenerationInternalRequest({
      purpose: "PROTOTYPE_IMAGE_GENERATION",
      prompt: "Interfaz",
      device: "WEB",
      requestedSize: "1536x1024",
    }).purpose,
    "PROTOTYPE_IMAGE_GENERATION",
  );
  assert.throws(() =>
    parsePrototypeImageGenerationInternalRequest({
      purpose: "ARBITRARY",
      prompt: "x",
      device: "WEB",
      requestedSize: "1536x1024",
    }),
  );
  assert.throws(() =>
    parsePrototypeImageGenerationInternalRequest({
      purpose: "PROTOTYPE_IMAGE_GENERATION",
      prompt: "x",
      device: "WEB",
      requestedSize: "1024x1536",
    }),
  );
});
test("modelo de imágenes tiene configuración separada del modelo de texto", () => {
  const config = loadPrototypeImageGenerationConfig({
    PROTOTYPE_IMAGE_MODEL: "image-model-test",
  });
  assert.equal(config.model, "image-model-test");
});

test("ComfyUI ejecuta workflow, sondea history y recupera PNG", async () => {
  const originalFetch = globalThis.fetch;
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==";
  let workflowBody: Record<string, unknown> | null = null;

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    if (url.endsWith("/object_info/CheckpointLoaderSimple")) {
      return new Response(
        JSON.stringify({
          CheckpointLoaderSimple: {
            input: {
              required: { ckpt_name: [["checkpoint-test.safetensors"], {}] },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.endsWith("/prompt")) {
      workflowBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ prompt_id: "prompt-test" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith("/history/prompt-test")) {
      return new Response(
        JSON.stringify({
          "prompt-test": {
            status: { completed: true, status_str: "success" },
            outputs: {
              "9": {
                images: [{ filename: "rq.png", subfolder: "", type: "output" }],
              },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("/view?")) {
      return new Response(Uint8Array.from(Buffer.from(png, "base64")), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }
    throw new Error(`URL inesperada: ${url}`);
  }) as typeof fetch;

  try {
    const configuration = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      providerType: "COMFYUI",
      purpose: "IMAGE",
      model: "workflow-pendiente",
      baseUrl: "http://127.0.0.1:8188",
      timeoutMs: 5_000,
    };
    // El servicio primero resuelve la configuración (para detectar
    // OLLAMA_IMAGES) y después el proveedor con su credencial.
    const providers = {
      resolveImageProviderConfiguration: async () => configuration,
      resolveImageProvider: async () => ({ configuration, apiKey: null }),
    };
    const audits = {
      create: (value: unknown) => value,
      save: async (value: unknown) => value,
    };
    const service = new InternalImageGenerationService(
      providers as never,
      audits as never,
      {
        model: "openai-unused",
        quality: "medium",
        timeoutMs: 5_000,
        maxBase64Chars: 1_000_000,
      },
    );

    const result = await service.generate(
      {
        purpose: "PROTOTYPE_IMAGE_GENERATION",
        providerConfigurationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        prompt: "Pantalla corporativa limpia",
        device: "WEB",
        requestedSize: "1536x1024",
      },
      "corr-comfyui",
    );

    assert.equal(result.provider, "COMFYUI");
    assert.equal(result.model, "checkpoint-test.safetensors");
    assert.equal(result.imageBase64, png);
    const prompt = workflowBody?.prompt as
      | Record<
          string,
          { class_type?: string; inputs?: Record<string, unknown> }
        >
      | undefined;
    assert.equal(prompt?.["4"]?.class_type, "CheckpointLoaderSimple");
    assert.equal(prompt?.["3"]?.class_type, "KSampler");
    assert.equal(prompt?.["5"]?.inputs?.width, 1536);
    assert.equal(prompt?.["5"]?.inputs?.height, 1024);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Ollama Images indica cómo instalar el modelo cuando no existe", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ error: "model 'x/z-image-turbo:latest' not found" }),
      {
        status: 404,
        headers: { "content-type": "application/json" },
      },
    )) as typeof fetch;

  try {
    const configuration = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      providerType: "OLLAMA_IMAGES",
      purpose: "IMAGE",
      model: "x/z-image-turbo:latest",
      baseUrl: "http://127.0.0.1:11434",
      timeoutMs: 5_000,
    };
    const providers = {
      resolveImageProviderConfiguration: async () => configuration,
      resolveImageProvider: async () => ({ configuration, apiKey: null }),
    };
    const audits = {
      create: (value: unknown) => value,
      save: async (value: unknown) => value,
    };
    const service = new InternalImageGenerationService(
      providers as never,
      audits as never,
      {
        model: "openai-unused",
        quality: "medium",
        timeoutMs: 5_000,
        maxBase64Chars: 1_000_000,
      },
    );

    await assert.rejects(
      () =>
        service.generate(
          {
            purpose: "PROTOTYPE_IMAGE_GENERATION",
            providerConfigurationId: configuration.id,
            prompt: "Pantalla corporativa limpia",
            device: "WEB",
            requestedSize: "1536x1024",
          },
          "corr-ollama-404",
        ),
      (error: unknown) => {
        const response = (
          error as { getResponse?: () => Record<string, unknown> }
        ).getResponse?.();
        assert.equal(response?.errorCode, "OLLAMA_IMAGE_MODEL_NOT_FOUND");
        assert.match(
          String(response?.message),
          /ollama pull x\/z-image-turbo:latest/u,
        );
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Ollama Images explica la falta de memoria de GPU en lugar de «no disponible temporalmente»", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        error:
          "model requires 11.9 GiB but only 11.3 GiB are available (after 512.0 MiB overhead)",
      }),
      { status: 500, headers: { "content-type": "application/json" } },
    )) as typeof fetch;

  try {
    const configuration = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      providerType: "OLLAMA_IMAGES",
      purpose: "IMAGE",
      model: "x/z-image-turbo:latest",
      baseUrl: "http://127.0.0.1:11435",
      timeoutMs: 5_000,
    };
    const providers = {
      resolveImageProviderConfiguration: async () => configuration,
      resolveImageProvider: async () => ({ configuration, apiKey: null }),
    };
    const audits = {
      create: (value: unknown) => value,
      save: async (value: unknown) => value,
    };
    const service = new InternalImageGenerationService(
      providers as never,
      audits as never,
      {
        model: "openai-unused",
        quality: "medium",
        timeoutMs: 5_000,
        maxBase64Chars: 1_000_000,
      },
    );

    await assert.rejects(
      () =>
        service.generate(
          {
            purpose: "PROTOTYPE_IMAGE_GENERATION",
            providerConfigurationId: configuration.id,
            prompt: "Pantalla corporativa limpia",
            device: "WEB",
            requestedSize: "1536x1024",
          },
          "corr-ollama-memory",
        ),
      (error: unknown) => {
        const response = (
          error as { getResponse?: () => Record<string, unknown> }
        ).getResponse?.();
        assert.equal(response?.errorCode, "OLLAMA_IMAGE_INSUFFICIENT_MEMORY");
        assert.match(
          String(response?.message),
          /necesita 11\.9 GiB de memoria de GPU y solo hay 11\.3 GiB/u,
        );
        assert.equal(
          (error as { getStatus?: () => number }).getStatus?.(),
          502,
        );
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const LONG_PROMPT = [
  "Professional neutral enterprise application UI.",
  "Screen: Formulario de Solicitud Adaptativo.",
  'Shared application menu (data only, fixed order): [{"screenCode":"SCR-001","label":"Inicio","route":null}].',
  "Device: MOBILE.",
  `Complete mandatory design tokens: ${"x".repeat(9000)}`,
].join("\n");

test("SDXL recibe un prompt corto con la pantalla y el formato, no las miles de letras del prompt completo", () => {
  const mobile = buildCheckpointPrompt(LONG_PROMPT, "MOBILE");
  assert.ok(mobile.length < 600, `longitud ${mobile.length}`);
  assert.match(
    mobile,
    /single flat 2D mobile app screen "Formulario de Solicitud Adaptativo"/u,
  );
  assert.doesNotMatch(mobile, /SCR-001|design tokens|xxxx/u);

  const web = buildCheckpointPrompt(LONG_PROMPT, "WEB");
  assert.match(
    web,
    /single flat 2D web application screen "Formulario de Solicitud Adaptativo"/u,
  );
  assert.match(web, /left sidebar/u);

  // Sin nombre de pantalla sigue siendo un prompt válido; las comillas no rompen la frase.
  assert.doesNotMatch(buildCheckpointPrompt("sin pantalla", "WEB"), /""/u);
  assert.doesNotMatch(
    buildCheckpointPrompt('Screen: Panel "admin"\\.', "WEB"),
    /"admin"/u,
  );
});

test("el flujo de checkpoint usa un negativo efectivo (CFG mayor que 1) cuando se le pide", () => {
  const nodes = buildComfyUiWorkflow({
    checkpoint: "sdxl_lightning_4step.safetensors",
    prompt: "corto",
    negativePrompt: "collage, device frame",
    cfg: 1.5,
    requestedSize: "1536x1024",
  }) as Record<string, { inputs: Record<string, unknown> }>;
  assert.equal(nodes["3"]?.inputs.cfg, 1.5);
  assert.equal(nodes["6"]?.inputs.text, "corto");
  assert.equal(nodes["7"]?.inputs.text, "collage, device frame");

  // Sin parámetros conserva el comportamiento anterior (CFG 1 y negativo genérico).
  const legacy = buildComfyUiWorkflow({
    checkpoint: "x.safetensors",
    prompt: "p",
    requestedSize: "1024x1536",
  }) as Record<string, { inputs: Record<string, unknown> }>;
  assert.equal(legacy["3"]?.inputs.cfg, 1);
  assert.match(String(legacy["7"]?.inputs.text), /low quality/u);
});

test("el perfil del checkpoint depende de su familia (destilado, SDXL base o desconocido)", () => {
  const fast = {
    steps: 4,
    cfg: 1.5,
    samplerName: "euler",
    scheduler: "sgm_uniform",
  };
  assert.deepEqual(
    resolveCheckpointProfile("sdxl_lightning_4step.safetensors"),
    fast,
  );
  assert.deepEqual(resolveCheckpointProfile("TURBO"), fast);
  assert.deepEqual(resolveCheckpointProfile("my-lcm-lora.safetensors"), fast);
  assert.deepEqual(resolveCheckpointProfile("flux-schnell"), fast);

  const sdxl = {
    steps: 28,
    cfg: 6.5,
    samplerName: "dpmpp_2m",
    scheduler: "karras",
  };
  assert.deepEqual(
    resolveCheckpointProfile("sd_xl_base_1.0.safetensors"),
    sdxl,
  );
  assert.deepEqual(resolveCheckpointProfile("juggernautXL.safetensors"), sdxl);
  assert.deepEqual(resolveCheckpointProfile("SDXL-base"), sdxl);

  assert.deepEqual(resolveCheckpointProfile("dreamshaper_8.safetensors"), {
    steps: 25,
    cfg: 7,
    samplerName: "euler",
    scheduler: "normal",
  });
});

test("el flujo de checkpoint aplica el perfil y conserva el comportamiento por defecto", () => {
  type Nodes = Record<string, { inputs: Record<string, unknown> }>;
  const sdxl = buildComfyUiWorkflow({
    checkpoint: "sd_xl_base_1.0.safetensors",
    prompt: "p",
    profile: resolveCheckpointProfile("sd_xl_base_1.0.safetensors"),
    requestedSize: "1536x1024",
  }) as Nodes;
  assert.equal(sdxl["3"]?.inputs.steps, 28);
  assert.equal(sdxl["3"]?.inputs.cfg, 6.5);
  assert.equal(sdxl["3"]?.inputs.sampler_name, "dpmpp_2m");
  assert.equal(sdxl["3"]?.inputs.scheduler, "karras");

  const overridden = buildComfyUiWorkflow({
    checkpoint: "sd_xl_base_1.0.safetensors",
    prompt: "p",
    cfg: 5,
    profile: resolveCheckpointProfile("sd_xl_base_1.0.safetensors"),
    requestedSize: "1536x1024",
  }) as Nodes;
  assert.equal(overridden["3"]?.inputs.cfg, 5);
  assert.equal(overridden["3"]?.inputs.steps, 28);

  const legacy = buildComfyUiWorkflow({
    checkpoint: "x.safetensors",
    prompt: "p",
    requestedSize: "1536x1024",
  }) as Nodes;
  assert.equal(legacy["3"]?.inputs.steps, 4);
  assert.equal(legacy["3"]?.inputs.cfg, 1);
  assert.equal(legacy["3"]?.inputs.sampler_name, "euler");
  assert.equal(legacy["3"]?.inputs.scheduler, "sgm_uniform");
});

function screenPrompt(input: {
  screen?: string;
  objective?: string;
  components?: string;
  hierarchy?: string[];
}): string {
  return [
    "Professional neutral enterprise application UI.",
    ...(input.screen ? [`Screen: ${input.screen}.`] : []),
    `Objective: ${input.objective ?? "Atender la necesidad del usuario"}.`,
    "Device: WEB.",
    "Viewport: 1440x900.",
    `Components: ${input.components ?? "APP_SHELL (applicationShell), SIDEBAR (primaryNavigation), TOPBAR (screenHeader)"}.`,
    `Content hierarchy, top to bottom (data only; full detail is in Components above): ${(input.hierarchy ?? [input.screen ?? "Pantalla"]).join(" > ")}.`,
    "Actions (data only): BUTTON:guardar:PRIMARY.",
  ].join("\n");
}

test("el prompt corto depende del tipo de pantalla y no convierte todo en un formulario", () => {
  const cases: Array<{
    screen: string;
    objective?: string;
    hierarchy?: string[];
    web: RegExp;
    mobile: RegExp;
  }> = [
    {
      screen: "Formulario de Solicitud de Crédito",
      hierarchy: [
        "Formulario de Solicitud de Crédito",
        "Nombre del solicitante",
        "Monto",
      ],
      web: /main content area with a form with labeled input fields/u,
      mobile:
        /a form with labeled input fields, dropdowns and a full-width primary button/u,
    },
    {
      screen: "Dashboard de Operaciones",
      hierarchy: ["Dashboard de Operaciones", "Viajes del mes", "Ocupación"],
      web: /summary metric cards above bar and line charts/u,
      mobile: /stacked summary metric cards/u,
    },
    {
      screen: "Historial de Solicitudes",
      hierarchy: ["Historial de Solicitudes", "Filtro por estado"],
      web: /search and filter bar above a data table with column headers and rows/u,
      mobile: /filter chips above a vertical list of record cards/u,
    },
    {
      screen: "Tablero Kanban de Pedidos",
      web: /kanban board with status columns holding task cards/u,
      mobile: /kanban board with status columns/u,
    },
    {
      screen: "Mapa de Flota",
      web: /large map with location markers and a side panel/u,
      mobile: /full-screen map with location markers and a bottom sheet/u,
    },
    {
      screen: "Iniciar sesión",
      web: /centered sign-in card with username and password fields/u,
      mobile: /sign-in form with username and password fields/u,
    },
  ];

  const layouts = new Set<string>();
  for (const item of cases) {
    const prompt = screenPrompt({
      screen: item.screen,
      objective: item.objective,
      hierarchy: item.hierarchy,
    });
    const web = buildCheckpointPrompt(prompt, "WEB");
    const mobile = buildCheckpointPrompt(prompt, "MOBILE");
    layouts.add(web);

    assert.match(web, item.web, web);
    assert.match(mobile, item.mobile, mobile);
    assert.match(
      web,
      new RegExp(`single flat 2D web application screen "${item.screen}"`, "u"),
    );
    assert.match(
      mobile,
      new RegExp(`single flat 2D mobile app screen "${item.screen}"`, "u"),
    );
    assert.match(web, /narrow left sidebar with menu icons, top header bar/u);
    assert.match(mobile, /top app header.*bottom tab bar/u);
    assert.doesNotMatch(mobile, /sidebar/u);
    assert.match(web, /muted corporate accent color/u);
    for (const text of [web, mobile]) {
      assert.ok(text.length < 700, `longitud ${text.length}`);
      assert.doesNotMatch(
        text,
        /[{}[\]]|\bpx\b|\d+px|APP_SHELL|SIDEBAR|TOPBAR|MOBILE_HEADER|KPI/u,
      );
    }
  }
  assert.equal(layouts.size, cases.length);
  const form = buildCheckpointPrompt(
    screenPrompt({ screen: "Dashboard de Operaciones" }),
    "WEB",
  );
  assert.doesNotMatch(form, /labeled input fields/u);
});

test("el tipo de pantalla se infiere del objetivo y de los componentes cuando el nombre no lo indica", () => {
  const byObjective = buildCheckpointPrompt(
    screenPrompt({
      screen: "Vista principal",
      objective: "Consultar el listado de despachos y filtrar por fecha",
    }),
    "WEB",
  );
  assert.match(byObjective, /data table with column headers/u);

  const byComponents = buildCheckpointPrompt(
    screenPrompt({
      screen: "Vista principal",
      components:
        "APP_SHELL (applicationShell), KPI (Total de viajes), TABLE (Viajes recientes)",
    }),
    "WEB",
  );
  assert.match(byComponents, /summary metric cards/u);

  const generic = buildCheckpointPrompt(
    screenPrompt({ screen: "Vista principal" }),
    "MOBILE",
  );
  assert.match(generic, /a page title, section headings and content cards/u);
  assert.doesNotMatch(generic, /form|input fields|table/u);
});

test("el prompt corto incluye los elementos principales saneados y sigue siendo válido sin nombre de pantalla", () => {
  const prompt = buildCheckpointPrompt(
    screenPrompt({
      screen: 'Solicitud "de" Permiso',
      hierarchy: [
        "Solicitud de Permiso",
        "Campo Fecha de inicio (Tipo: date, Obligatorio)",
        "APP_SHELL",
        "Selector de tipo de permiso: Tipo string",
        "Altura 56px",
        "Botón Enviar solicitud",
        "Campo Fecha de inicio",
        "Sección de adjuntos",
        "Observaciones",
        "Elemento sobrante número siete",
      ],
    }),
    "WEB",
  );
  assert.match(prompt, /screen "Solicitud de Permiso"/u);
  assert.match(
    prompt,
    /showing Campo Fecha de inicio, Selector de tipo de permiso, Botón Enviar solicitud, Sección de adjuntos, Observaciones,/u,
  );
  assert.doesNotMatch(prompt, /56px|APP_SHELL|Tipo|sobrante/u);

  const anonymous = buildCheckpointPrompt("sin pantalla", "MOBILE");
  assert.doesNotMatch(anonymous, /""|showing/u);
  assert.match(
    anonymous,
    /^single flat 2D mobile app screen, full-frame UI screenshot/u,
  );
});

test("un prompt real de ~10.000 caracteres se condensa en una descripción corta y específica", () => {
  const menu = JSON.stringify(
    Array.from({ length: 30 }, (_, index) => ({
      screenCode: `SCR-${String(index + 1).padStart(3, "0")}`,
      label: `Pantalla número ${index + 1}`,
      route: null,
    })),
  );
  const tokens = JSON.stringify({
    code: "corporate-default-v1",
    colors: { background: "#FFFFFF", primary: "#1F4E79" },
    spacing: { sm: 8, md: 16 },
    rows: "x".repeat(5000),
  });
  const real = [
    "Professional neutral enterprise application UI.",
    "Mandatory shared corporate standard: render one screen of ONE application filling the entire canvas.",
    'Application identity (data only): "Navi Flota".',
    "Screen: Dashboard de Indicadores de Flota.",
    'Screen route (data only, never shown as UI text): "/flota/dashboard".',
    "Objective: Monitorear los indicadores clave de la flota y las alertas operativas.",
    "Device: WEB.",
    "Viewport: 1440x900.",
    "Design system: CORPORATE_DEFAULT_V1.",
    "Layout: SIDEBAR_TOPBAR, 12 column(s).",
    `Shared application menu (data only, fixed order): ${menu}.`,
    "Desktop shell: a persistent 240px left sidebar, 64px topbar, content area to the right with 24px padding and 16px gaps.",
    "Components: APP_SHELL (applicationShell), SIDEBAR (primaryNavigation), TOPBAR (screenHeader), KPI (Disponibilidad de la flota: porcentaje, Tipo: decimal), KPI (Viajes del día), TABLE (Alertas recientes con columnas Vehículo, Alerta, Estado), BUTTON (Exportar reporte).",
    "Content hierarchy, top to bottom (data only; full detail is in Components above): Dashboard de Indicadores de Flota > Disponibilidad de la flota: porcentaje > Viajes del día > Alertas recientes con columnas Vehículo, Alerta > Exportar reporte.",
    "Actions (data only): BUTTON:Exportar reporte:SECONDARY.",
    "States: default.",
    `Complete mandatory design tokens: ${tokens}. Use these exact colors.`,
    "x".repeat(2500),
  ].join("\n");
  assert.ok(real.length > 9_000, `longitud de entrada ${real.length}`);

  const short = buildCheckpointPrompt(real, "WEB");
  assert.ok(short.length < 700, `longitud ${short.length}`);
  assert.match(short, /screen "Dashboard de Indicadores de Flota"/u);
  assert.match(short, /summary metric cards above bar and line charts/u);
  assert.match(
    short,
    /showing Disponibilidad de la flota, Viajes del día, Alertas recientes con columnas, Exportar reporte/u,
  );
  assert.doesNotMatch(
    short,
    /SCR-|#[0-9A-F]{6}|corporate-default|240px|labeled input fields|xxxx|\{|\[/iu,
  );
});
