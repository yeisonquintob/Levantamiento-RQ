// Vista «Por proveedor» de Proveedores de IA: tres columnas (IA · Modelos ·
// Detalle), filtros en la barra de pestañas y pestañas sin marcos.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as ReactAll from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as unknown as { React: unknown }).React = ReactAll;

import type { AiProviderConfigurationSummary } from "@levantamiento-rq/shared-contracts";

import {
  ProviderColumnsView,
  isOpenAiImageModel,
  isOpenAiTextModel,
  COMFYUI_DEFAULT_FOLDER,
  comfyUiCommands,
  ollamaCommands,
  ollamaServeCommand,
} from "../../apps/web/src/app/workspace/settings/ai-providers/provider-columns-view";

const DIR = "apps/web/src/app/workspace/settings/ai-providers/";

function provider(
  overrides: Partial<AiProviderConfigurationSummary>,
): AiProviderConfigurationSummary {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Proveedor",
    purpose: "TEXT",
    providerType: "OLLAMA",
    model: "qwen3.5:9b",
    baseUrl: "http://127.0.0.1:11434",
    timeoutMs: 600000,
    maxInputTokens: 131072,
    maxOutputTokens: 12000,
    maxAttempts: 3,
    isEnabled: true,
    isDefault: false,
    requiresCredential: false,
    credentialConfigured: false,
    lastConnectionTestStatus: "SUCCEEDED",
    lastConnectionTestAt: null,
    ...overrides,
  } as AiProviderConfigurationSummary;
}

test("la vista tiene tres columnas: IA (Ollama, ChatGPT, Claude) · Modelos · Detalle", () => {
  const items = [
    provider({ id: "a", name: "Local Ollama qwen3.5:9b" }),
    provider({
      id: "b",
      name: "OpenAI Levantamiento",
      providerType: "OPENAI",
      model: "gpt-5.4",
      baseUrl: "https://api.openai.com/v1",
      requiresCredential: true,
      credentialConfigured: true,
    }),
  ];
  const markup = renderToStaticMarkup(
    createElement(ProviderColumnsView, {
      allItems: items,
      gatewayUrl: "http://gateway",
      onEdit: () => undefined,
    }),
  );
  assert.match(markup, /aria-label="IA por proveedor"/u);
  assert.match(markup, /aria-label="Modelos"/u);
  assert.match(markup, /aria-label="Detalle del modelo"/u);
  for (const name of [
    "Ollama",
    "ChatGPT \\(OpenAI\\)",
    "Claude \\(Anthropic\\)",
    "ComfyUI",
  ]) {
    assert.match(markup, new RegExp(`<strong>${name}</strong>`, "u"));
  }
  // Ollama y ChatGPT: Texto e Imágenes; Compatible OpenAI, Claude, Gemini, Groq y Cerebras:
  // Texto; ComfyUI: Imágenes.
  assert.equal((markup.match(/rq-ai-cat__choice/gu) ?? []).length, 10);
  // Seleccionada por defecto: Ollama · Texto, con su registro y su etiqueta.
  assert.match(markup, /Ollama · Texto/u);
  assert.match(markup, /qwen3\.5:9b/u);
  assert.match(markup, /✓ En uso/u);
  assert.match(
    markup,
    /Elige un modelo para ver sus datos, su registro y si está en uso\./u,
  );
});

test("la etiqueta distingue en uso, registrado deshabilitado y disponible sin registrar", async () => {
  const view = await readFile(`${DIR}provider-columns-view.tsx`, "utf8");
  assert.match(view, /"✓ En uso/u);
  assert.match(view, /Registrado · deshabilitado/u);
  assert.match(view, /Disponible · sin registrar/u);
  // Lo que ya tienes va primero y lo disponible después.
  assert.match(
    view,
    /STATE_ORDER = \{ IN_USE: 0, REGISTERED: 1, AVAILABLE: 2 \}/u,
  );
  // Un modelo registrado que el proveedor ya no reporta se avisa.
  assert.match(view, /ya no aparece en su catálogo/u);
});

test("Claude, Gemini, Groq y Cerebras muestran un catálogo recomendado y ComfyUI solo lo registrado", async () => {
  const view = await readFile(`${DIR}provider-columns-view.tsx`, "utf8");
  assert.match(view, /Recomendado · sin registrar/u);
  assert.match(view, /\{ family: "CLAUDE", label: "Claude \(Anthropic\)"/u);
  assert.match(view, /\{ family: "GEMINI"/u);
  assert.match(view, /ComfyUI no ofrece un catálogo/u);
});

test("solo se separan los modelos de texto y de imágenes de OpenAI", () => {
  for (const id of [
    "gpt-5.4",
    "gpt-5-mini",
    "o3",
    "o4-mini",
    "chatgpt-4o-latest",
  ]) {
    assert.equal(isOpenAiTextModel(id), true, id);
    assert.equal(isOpenAiImageModel(id), false, id);
  }
  for (const id of ["gpt-image-1", "dall-e-3", "chatgpt-image-latest"]) {
    assert.equal(isOpenAiImageModel(id), true, id);
    assert.equal(isOpenAiTextModel(id), false, id);
  }
  for (const id of [
    "gpt-4o-audio-preview",
    "gpt-4o-realtime-preview",
    "gpt-4o-mini-tts",
    "gpt-4o-transcribe",
    "text-embedding-3-large",
    "omni-moderation-latest",
    "whisper-1",
  ]) {
    assert.equal(isOpenAiTextModel(id), false, id);
  }
});

test("al elegir una IA se consulta su catálogo una vez y «Actualizar» lo repite", async () => {
  const [view, workspace] = await Promise.all([
    readFile(`${DIR}provider-columns-view.tsx`, "utf8"),
    readFile(`${DIR}ai-providers-workspace.tsx`, "utf8"),
  ]);
  assert.match(
    view,
    /ai-providers\/\$\{compatible \? "openai-compatible" : "ollama"\}\/models\?baseUrl=/u,
  );
  assert.match(view, /http:\/\/127\.0\.0\.1:11435/u);
  assert.match(
    view,
    /ai-providers\/\$\{encodeURIComponent\(source\.id\)\}\/openai\/models/u,
  );
  assert.match(view, /requested\.current\.has\(key\)/u);
  assert.match(view, /reinícialos para activarla/u);
  // Los endpoints Ollama consultados salen de los proveedores registrados.
  assert.match(view, /item\.baseUrl/u);
  assert.match(workspace, /<ProviderColumnsView/u);
  assert.match(workspace, /Por proveedor/u);
});

test("los filtros de proveedor, estado y credencial están en la misma fila que las pestañas, sin marcos", async () => {
  const [workspace, css] = await Promise.all([
    readFile(`${DIR}ai-providers-workspace.tsx`, "utf8"),
    readFile("apps/web/src/app/auth.css", "utf8"),
  ]);
  const bar =
    workspace
      .split('className="rq-ai-tabbar"')[1]
      ?.split("<ProviderColumnsView")[0] ?? "";
  assert.match(bar, /className="rq-ai-tabs"/u);
  // Estándar plano de Proyectos: filtros como form.rq-projects-filters.
  assert.match(bar, /className="rq-projects-filters"/u);
  for (const label of ["Proveedor", "Estado", "Credencial"]) {
    assert.match(bar, new RegExp(`<span>${label}:</span>`, "u"));
  }
  for (const option of [
    "Ollama",
    "ChatGPT \\(OpenAI\\)",
    "ComfyUI",
    "Habilitado",
    "Deshabilitado",
    "Protegida",
    "Ausente",
    "No requerida",
  ]) {
    assert.match(bar, new RegExp(`>${option}</option>`, "u"), option);
  }
  // Los filtros llegan a la vista por proveedor y a las tablas.
  assert.match(workspace, /providerFilter=\{providerFilter\}/u);
  assert.match(workspace, /statusFilter=\{statusFilter\}/u);
  assert.match(workspace, /credentialFilter=\{credentialFilter\}/u);
  assert.match(
    workspace,
    /filteredItems\.filter\(\(item\) => item\.purpose === tab\)/u,
  );
  // Sin marcos: pestañas planas y columnas separadas por líneas finas.
  const tabs = css.match(/\.rq-ai-tabs > button \{[^}]*\}/u)?.[0] ?? "";
  assert.match(tabs, /border: 0;/u);
  assert.match(tabs, /background: transparent;/u);
  assert.match(css, /\.rq-ai-cat > \* \+ \* \{[^}]*border-left/u);
  assert.doesNotMatch(
    css.match(/\.rq-ai-cat > \* \{[^}]*\}/u)?.[0] ?? "",
    /border:|border-radius/u,
  );
});

test("el detalle conserva solo los datos del modelo y un resumen del registro, sin interruptor", async () => {
  const [view, workspace, css] = await Promise.all([
    readFile(`${DIR}provider-columns-view.tsx`, "utf8"),
    readFile(`${DIR}ai-providers-workspace.tsx`, "utf8"),
    readFile("apps/web/src/app/auth.css", "utf8"),
  ]);
  for (const label of [
    "Datos del modelo",
    "Uso en el sistema",
    "Parámetros",
    "Cuantización",
    "Tamaño en disco",
    "Contexto máximo",
    "Capacidades",
  ]) {
    assert.match(view, new RegExp(`>\\s*${label}\\s*<`, "u"), label);
  }
  // Se quitó la información extra del registro y el botón de habilitar.
  for (const removed of [
    "<dt>Tiempo máximo</dt>",
    "<dt>Última prueba</dt>",
    "<dt>Registrado</dt>",
    "<dt>Límites</dt>",
    'role="switch"',
    "onToggleEnabled",
    "no inicia ni detiene el servicio de Ollama",
  ]) {
    assert.doesNotMatch(view, new RegExp(removed, "u"), removed);
  }
  assert.doesNotMatch(workspace, /onToggleEnabled=/u);
  assert.doesNotMatch(css, /rq-ai-switch/u);
  assert.match(view, /<RqActionButton[\s\S]*?tone="consult"/u);
  assert.match(view, /<RqActionButton[\s\S]*?tone="operation"/u);
});

test("las IA locales muestran los comandos de terminal para instalar y ejecutar", () => {
  assert.deepEqual(ollamaCommands("gemma4:12b", "http://127.0.0.1:11434"), {
    install: "ollama pull gemma4:12b",
    run: "ollama run gemma4:12b",
    serve: "ollama serve",
    host: null,
    remote: false,
  });
  // Servidor remoto (Mac Studio) o puerto distinto: el CLI actúa sobre ese servidor.
  assert.deepEqual(ollamaCommands("gemma4:31b", "http://192.168.1.50:11434"), {
    install: "OLLAMA_HOST=192.168.1.50:11434 ollama pull gemma4:31b",
    run: "OLLAMA_HOST=192.168.1.50:11434 ollama run gemma4:31b",
    serve: "OLLAMA_HOST=0.0.0.0:11434 ollama serve",
    host: "192.168.1.50:11434",
    remote: true,
  });
  // El servidor de imágenes (puerto 11435) es un segundo servidor que hay que iniciar.
  assert.equal(
    ollamaServeCommand("http://127.0.0.1:11435"),
    "OLLAMA_HOST=127.0.0.1:11435 ollama serve",
  );
  assert.equal(ollamaServeCommand("http://127.0.0.1:11434"), "ollama serve");
  assert.equal(ollamaServeCommand(null), "ollama serve");
  assert.equal(
    ollamaCommands("x/z-image-turbo:latest", "http://127.0.0.1:11435")?.install,
    "OLLAMA_HOST=127.0.0.1:11435 ollama pull x/z-image-turbo:latest",
  );
  // Nunca se sugiere pegar nombres con caracteres de shell.
  for (const hostile of [
    "gemma; rm -rf ~",
    "a b",
    "$(whoami)",
    "model`id`",
    "m|cat",
    "",
    "-rf",
  ]) {
    assert.equal(
      ollamaCommands(hostile, "http://127.0.0.1:11434"),
      null,
      hostile,
    );
  }
});

test("el detalle de un modelo Ollama incluye los bloques Instalar y Ejecutar con Copiar y se puede instalar otro", async () => {
  const [view, css] = await Promise.all([
    readFile(`${DIR}provider-columns-view.tsx`, "utf8"),
    readFile("apps/web/src/app/auth.css", "utf8"),
  ]);
  assert.match(
    view,
    /<h4 className="rq-ai-cat__section">\s*Terminal\s*<\/h4>/u,
  );
  assert.match(view, /label="Instalar"/u);
  assert.match(view, /label="Ejecutar"/u);
  assert.match(view, /navigator\.clipboard\.writeText\(command\)/u);
  assert.match(view, /selection\.family === "OLLAMA" && commands/u);
  assert.match(view, /Instalar otro modelo/u);
  assert.match(view, /El nombre solo puede tener letras, números/u);
  assert.match(css, /\.rq-ai-cmd__row > code[\s\S]*?monospace/u);
});

test("ComfyUI muestra los comandos de terminal para iniciar el servidor e instalar", async () => {
  assert.equal(COMFYUI_DEFAULT_FOLDER, "~/AI/ComfyUI");
  const commands = comfyUiCommands(
    "/Users/navitransmac/AI/ComfyUI",
    "http://127.0.0.1:8188",
  );
  assert.equal(
    commands?.serve,
    "cd /Users/navitransmac/AI/ComfyUI && source .venv/bin/activate && python3 main.py",
  );
  assert.match(
    commands?.install ?? "",
    /^git clone https:\/\/github\.com\/comfyanonymous\/ComfyUI\.git \/Users\/navitransmac\/AI\/ComfyUI && cd \/Users\/navitransmac\/AI\/ComfyUI && python3\.12 -m venv \.venv && source \.venv\/bin\/activate && pip install -r requirements\.txt$/u,
  );
  // El puerto sale del endpoint registrado.
  assert.match(
    comfyUiCommands("~/AI/ComfyUI", "http://127.0.0.1:8190")?.serve ?? "",
    /python3 main\.py --port 8190$/u,
  );
  // Carpetas con espacios o caracteres de shell no generan comandos.
  for (const hostile of [
    "~/AI/Comfy UI",
    "x; rm -rf ~",
    "$(whoami)",
    "a|b",
    "-rf",
    "",
  ]) {
    assert.equal(comfyUiCommands(hostile, null), null, hostile);
  }
  const view = await readFile(`${DIR}provider-columns-view.tsx`, "utf8");
  assert.match(
    view,
    /selection\.family === "COMFYUI" \? \(\s*<ComfyUiTerminal/u,
  );
  assert.match(view, /Carpeta de ComfyUI/u);
});
