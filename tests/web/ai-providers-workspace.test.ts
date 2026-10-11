// Groq y Cerebras: proveedores cloud de texto con endpoint fijo y API key.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as ReactAll from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as unknown as { React: unknown }).React = ReactAll;

import type { AiProviderConfigurationSummary } from "@levantamiento-rq/shared-contracts";

import { ProviderColumnsView } from "../../apps/web/src/app/workspace/settings/ai-providers/provider-columns-view";

const DIR = "apps/web/src/app/workspace/settings/ai-providers/";

function provider(
  providerType: "GROQ" | "CEREBRAS",
  baseUrl: string,
): AiProviderConfigurationSummary {
  return {
    id: "00000000-0000-4000-8000-000000000009",
    name: `Cuenta ${providerType}`,
    purpose: "TEXT",
    providerType,
    model: "modelo-prueba",
    baseUrl,
    timeoutMs: 60000,
    maxInputTokens: 120000,
    maxOutputTokens: 12000,
    maxAttempts: 3,
    isEnabled: true,
    isDefault: false,
    requiresCredential: true,
    credentialConfigured: true,
    lastConnectionTestStatus: "SUCCEEDED",
    lastConnectionTestAt: null,
  } as AiProviderConfigurationSummary;
}

test("la vista por proveedor lista Groq y Cerebras como familias de texto", () => {
  const markup = renderToStaticMarkup(
    createElement(ProviderColumnsView, {
      allItems: [
        provider("GROQ", "https://api.groq.com/openai/v1"),
        provider("CEREBRAS", "https://api.cerebras.ai/v1"),
      ],
      gatewayUrl: "http://gateway",
      onEdit: () => undefined,
    }),
  );
  assert.match(markup, /<strong>Groq<\/strong>/u);
  assert.match(markup, /<strong>Cerebras<\/strong>/u);
});

test("el formulario fija los endpoints oficiales de Groq y Cerebras y exige API key", async () => {
  const workspace = await readFile(`${DIR}ai-providers-workspace.tsx`, "utf8");
  assert.match(workspace, /"use client"/u);
  assert.match(workspace, /https:\/\/api\.groq\.com\/openai\/v1/u);
  assert.match(workspace, /https:\/\/api\.cerebras\.ai\/v1/u);
  assert.match(workspace, /<option value="GROQ">Groq<\/option>/u);
  assert.match(workspace, /<option value="CEREBRAS">Cerebras<\/option>/u);
  assert.match(
    workspace,
    /kind === "GROQ" \|\|\s+kind === "CEREBRAS"/u,
    "ambos usan API key protegida y endpoint de solo lectura",
  );
});

function renderFamily(family: "CLAUDE" | "GEMINI" | "GROQ" | "CEREBRAS") {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => {
    calls += 1;
    throw new Error("sin red");
  }) as typeof fetch;
  try {
    const markup = renderToStaticMarkup(
      createElement(ProviderColumnsView, {
        allItems: [],
        gatewayUrl: "http://gateway",
        onEdit: () => undefined,
        providerFilter: family,
      }),
    );
    return { markup, calls };
  } finally {
    globalThis.fetch = original;
  }
}

test("Claude, Gemini, Groq y Cerebras muestran recomendaciones con cero registros y sin fetch", () => {
  const expected = {
    CLAUDE: ["claude-haiku-4-5-20251001", "claude-sonnet-5-5", "claude-opus-5-5"],
    GEMINI: ["gemini-3-flash-preview", "gemini-3.1-pro-preview"],
    GROQ: ["openai/gpt-oss-20b", "openai/gpt-oss-120b"],
    CEREBRAS: ["llama3.1-8b", "gpt-oss-120b", "zai-glm-4.7"],
  } as const;
  for (const [family, ids] of Object.entries(expected)) {
    const { markup, calls } = renderFamily(
      family as keyof typeof expected,
    );
    assert.equal(calls, 0, `${family} no debe llamar a fetch`);
    for (const id of ids) assert.ok(markup.includes(id), `${family}: ${id}`);
    assert.match(markup, /Recomendado · sin registrar/u);
    assert.match(markup, /catálogo recomendado de referencia/iu);
    assert.match(markup, /2026-10-04/u);
    assert.doesNotMatch(markup, /Sin modelos para mostrar/u);
  }
  assert.match(renderFamily("CLAUDE").markup, /Pago por uso/u);
  assert.match(renderFamily("GEMINI").markup, /Gratis con límites/u);
});

test("el catálogo cloud usa solo enlaces HTTPS oficiales, sin precios ni cuotas", async () => {
  const { CLOUD_MODEL_CATALOG } = await import(
    "../../apps/web/src/app/workspace/settings/ai-providers/cloud-model-catalog"
  );
  for (const models of Object.values(CLOUD_MODEL_CATALOG)) {
    for (const model of models) {
      assert.match(model.pricingUrl, /^https:\/\//u);
      assert.equal(model.verifiedAt, "2026-10-04");
      assert.ok(["FREE_LIMITED", "PAID"].includes(model.cost));
      const text = `${model.costLabel} ${model.costNotice} ${model.usage}`;
      assert.doesNotMatch(text, /\$|USD|\d+\s*(RPM|TPM|req)/iu);
    }
  }
  const view = await readFile(`${DIR}provider-columns-view.tsx`, "utf8");
  assert.match(view, /Ver condiciones del proveedor/u);
  assert.match(view, /rel="noreferrer"/u);
  assert.match(view, /target="_blank"/u);
});
