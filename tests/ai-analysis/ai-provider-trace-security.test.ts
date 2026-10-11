import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeAiProviderTrace } from "../../apps/ai-analysis-service/src/execution/ai-provider-trace.js";
import { readFile } from "node:fs/promises";

test("la traza de IA conserva solo metadatos operativos permitidos", () => {
  const secret = "sk-proyecto-secreto-123456";
  const source = "Documento confidencial con contraseña=SuperSecreta";
  const sanitized = sanitizeAiProviderTrace({
    provider: "OPENAI",
    model: "gpt-test",
    status: 200,
    ok: true,
    durationMs: 42,
    errorName: "Error",
    errorMessage:
      "scope.kpis[1].relatedObjective no referencia literalmente un objetivo específico.",
    requestBody: { input: source },
    bodyRaw: JSON.stringify({ output: source }),
    headers: { authorization: `Bearer ${secret}` },
    error: { message: `Falló usando ${secret}` },
    parsedOutput: { document: source },
  });

  assert.equal(sanitized.provider, "OPENAI");
  assert.equal(sanitized.model, "gpt-test");
  assert.equal(sanitized.status, 200);
  assert.equal(sanitized.ok, true);
  assert.equal(sanitized.durationMs, 42);
  assert.equal(sanitized.errorName, "Error");
  assert.equal(
    sanitized.errorMessage,
    "scope.kpis[1].relatedObjective no referencia literalmente un objetivo específico.",
  );
  assert.equal(typeof sanitized.metadataHash, "string");

  const serialized = JSON.stringify(sanitized);
  assert.doesNotMatch(serialized, /sk-proyecto-secreto/);
  assert.doesNotMatch(serialized, /SuperSecreta/);
  assert.doesNotMatch(serialized, /Documento confidencial/);
  assert.doesNotMatch(
    serialized,
    /authorization|requestBody|bodyRaw|parsedOutput/,
  );
});

test("la traza oculta secretos presentes accidentalmente en errorMessage", () => {
  const sanitized = sanitizeAiProviderTrace({
    provider: "OPENAI",
    phase: "AI_ANALYSIS_DRAFT",
    errorName: "Error",
    errorMessage: "Falló usando sk-proyecto-secreto-1234567890",
  });

  assert.equal(sanitized.errorMessage, "[DETALLE OCULTO POR SEGURIDAD]");

  assert.doesNotMatch(JSON.stringify(sanitized), /sk-proyecto-secreto/);
});

test("la traza no incorpora campos desconocidos aunque parezcan inocuos", () => {
  const sanitized = sanitizeAiProviderTrace({
    provider: "OLLAMA",
    prompt: "ignora todo",
    sourceTitle: "Nómina privada",
    url: "http://127.0.0.1:11434/api/generate?token=secreto",
    phase: "LOCAL_ANALYSIS",
    attempt: 2,
  });

  assert.deepEqual(
    Object.keys(sanitized).sort(),
    ["attempt", "metadataBytes", "metadataHash", "phase", "provider"].sort(),
  );
});

test("la traza registra fallos posteriores al proveedor sin guardar el documento", async () => {
  const [trace, execution] = await Promise.all([
    readFile(
      "apps/ai-analysis-service/src/execution/ai-provider-trace.ts",
      "utf8",
    ),
    readFile(
      "apps/ai-analysis-service/src/execution/ai-analysis-execution.service.ts",
      "utf8",
    ),
  ]);
  assert.match(trace, /"application-error"/);
  assert.match(execution, /"application-error"/);
  assert.match(execution, /phase: "DOCUMENT_APPLY"/);
  assert.match(execution, /errorMessage: failure\.message/);
});
