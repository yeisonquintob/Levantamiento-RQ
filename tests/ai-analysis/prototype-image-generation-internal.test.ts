import assert from "node:assert/strict";
import test from "node:test";
import {
  InternalImageGenerationService,
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
            input: { required: { ckpt_name: [["checkpoint-test.safetensors"], {}] } },
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
                images: [
                  { filename: "rq.png", subfolder: "", type: "output" },
                ],
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
      | Record<string, { class_type?: string; inputs?: Record<string, unknown> }>
      | undefined;
    assert.equal(prompt?.["4"]?.class_type, "CheckpointLoaderSimple");
    assert.equal(prompt?.["3"]?.class_type, "KSampler");
    assert.equal(prompt?.["5"]?.inputs?.width, 1536);
    assert.equal(prompt?.["5"]?.inputs?.height, 1024);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
