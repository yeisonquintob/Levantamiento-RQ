import assert from "node:assert/strict";
import test from "node:test";
import {
  InternalImageGenerationService,
  buildCheckpointPrompt,
  buildComfyUiWorkflow,
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
