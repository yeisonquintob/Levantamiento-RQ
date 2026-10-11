import assert from "node:assert/strict";
import test from "node:test";

import {
  aiGenerationModeDescription,
  aiGenerationModeExecutedLabel,
  aiGenerationModeLabel,
  generationStageIndex,
  generationStageSequence,
  humanizeTechnicalStagePath,
  localDraftOperationLabel,
  resolveAiGenerationMode,
  resolveTrackedGenerationMode,
} from "../../apps/web/src/app/workspace/ai-generation-mode.js";
import { aiGenerationLabel } from "../../apps/web/src/app/workspace/ai-generation-label.js";

test("resuelve LOCAL_ONLY con únicamente el motor LOCAL", () => {
  assert.equal(resolveAiGenerationMode(["LOCAL"]), "LOCAL_ONLY");
});

test("resuelve LOCAL_CLOUD con LOCAL y CLOUD juntos", () => {
  assert.equal(resolveAiGenerationMode(["LOCAL", "CLOUD"]), "LOCAL_CLOUD");
  assert.equal(resolveAiGenerationMode(["CLOUD", "LOCAL"]), "LOCAL_CLOUD");
});

test("resuelve CLOUD_ONLY con únicamente el motor CLOUD", () => {
  assert.equal(resolveAiGenerationMode(["CLOUD"]), "CLOUD_ONLY");
});

test("sin motores no resuelve ningún modo", () => {
  assert.equal(resolveAiGenerationMode([]), null);
  assert.equal(resolveAiGenerationMode(undefined), null);
});

test("una solicitud ya iniciada usa sus motores persistidos aunque el selector actual cambie", () => {
  const tracked = {
    processing: { engines: ["LOCAL"] as const },
    engines: ["LOCAL", "CLOUD"] as const,
  };
  // El selector actual dice "solo nube", pero la solicitud ya inició en
  // modo local: el modo mostrado debe seguir siendo el de la solicitud.
  assert.equal(resolveTrackedGenerationMode(tracked, ["CLOUD"]), "LOCAL_ONLY");
});

test("prioriza processing.engines sobre engines del resumen", () => {
  const tracked = {
    processing: { engines: ["CLOUD"] as const },
    engines: ["LOCAL", "CLOUD"] as const,
  };
  assert.equal(resolveTrackedGenerationMode(tracked, []), "CLOUD_ONLY");
});

test("cae a engines del resumen cuando processing.engines no existe", () => {
  const tracked = { engines: ["LOCAL", "CLOUD"] as const };
  assert.equal(resolveTrackedGenerationMode(tracked, []), "LOCAL_CLOUD");
});

test("una solicitud terminal (completada/fallida/cancelada) también usa sus motores persistidos, nunca el selector", () => {
  for (const status of ["COMPLETED", "FAILED", "CANCELLED"] as const) {
    const tracked = {
      processing: { engines: ["LOCAL"] as const },
      engines: ["LOCAL"] as const,
    };
    assert.equal(
      resolveTrackedGenerationMode(tracked, ["CLOUD"]),
      "LOCAL_ONLY",
      `status ${status} no debería usar el selector actual`,
    );
  }
});

test("sin solicitud seguida, usa el selector actual", () => {
  assert.equal(resolveTrackedGenerationMode(null, ["LOCAL"]), "LOCAL_ONLY");
  assert.equal(
    resolveTrackedGenerationMode(undefined, ["LOCAL", "CLOUD"]),
    "LOCAL_CLOUD",
  );
});

test("las etiquetas usan los tres nombres canónicos exactos", () => {
  assert.equal(aiGenerationModeLabel("LOCAL_ONLY"), "IA local");
  assert.equal(aiGenerationModeLabel("LOCAL_CLOUD"), "Híbrido");
  assert.equal(aiGenerationModeLabel("CLOUD_ONLY"), "IA nube");
  assert.equal(aiGenerationModeLabel(null), "IA no registrada");
});

test("el híbrido se etiqueta explícitamente como Híbrido y conserva la descripción secundaria", () => {
  assert.equal(aiGenerationModeLabel("LOCAL_CLOUD"), "Híbrido");
  assert.equal(
    aiGenerationModeDescription("LOCAL_CLOUD"),
    "IA local + IA nube",
  );
  assert.equal(aiGenerationModeDescription("LOCAL_ONLY"), null);
  assert.equal(aiGenerationModeDescription("CLOUD_ONLY"), null);
});

test("el texto final de modo ejecutado no usa encendida/apagada", () => {
  assert.equal(
    aiGenerationModeExecutedLabel("LOCAL_ONLY"),
    "Modo ejecutado: IA local",
  );
  assert.equal(
    aiGenerationModeExecutedLabel("LOCAL_CLOUD"),
    "Modo ejecutado: Híbrido · IA local + IA nube",
  );
  assert.equal(
    aiGenerationModeExecutedLabel("CLOUD_ONLY"),
    "Modo ejecutado: IA nube",
  );
  for (const mode of ["LOCAL_ONLY", "LOCAL_CLOUD", "CLOUD_ONLY"] as const) {
    assert.doesNotMatch(
      aiGenerationModeExecutedLabel(mode),
      /encendida|apagada/u,
    );
  }
});

test("las etapas por modo nunca mezclan pasos de otro modo", () => {
  assert.deepEqual(generationStageSequence("LOCAL_ONLY"), [
    "Preparación",
    "Análisis local",
    "Consolidación",
    "Borrador por puntos",
    "Validación y aplicación",
  ]);
  assert.deepEqual(generationStageSequence("LOCAL_CLOUD"), [
    "Preparación",
    "Análisis local",
    "Consolidación",
    "Generación en nube",
    "Validación y aplicación",
  ]);
  assert.deepEqual(generationStageSequence("CLOUD_ONLY"), [
    "Preparación",
    "Generación en nube",
    "Validación y aplicación",
  ]);

  // Nunca "Borrador por puntos" en híbrido/nube; nunca "Generación en nube"
  // en modo local exclusivo.
  assert.ok(
    !generationStageSequence("LOCAL_CLOUD").includes("Borrador por puntos"),
  );
  assert.ok(!generationStageSequence("CLOUD_ONLY").includes("Análisis local"));
  assert.ok(
    !generationStageSequence("LOCAL_ONLY").includes("Generación en nube"),
  );
});

test("generationStageIndex mapea cada etapa técnica a su posición del modo correspondiente", () => {
  assert.equal(generationStageIndex("LOCAL_ONLY", "LOCAL_AI_ANALYSIS", 20), 1);
  assert.equal(
    generationStageIndex("LOCAL_ONLY", "LOCAL_AI_CONSOLIDATION", 38),
    2,
  );
  assert.equal(
    generationStageIndex("LOCAL_ONLY", "LOCAL_AI_GENERATION", 60),
    3,
  );
  assert.equal(generationStageIndex("LOCAL_ONLY", "OUTPUT_VALIDATION", 95), 4);
  assert.equal(
    generationStageIndex("LOCAL_CLOUD", "CLOUD_AI_GENERATION", 50),
    3,
  );
  assert.equal(
    generationStageIndex("CLOUD_ONLY", "CLOUD_AI_GENERATION", 30),
    1,
  );
});

test("humaniza rutas técnicas de esquema y códigos de artefacto de diagrama", () => {
  assert.equal(
    humanizeTechnicalStagePath("structuredAnalysis.processFlows.asIs"),
    "Flujo AS-IS",
  );
  assert.equal(
    humanizeTechnicalStagePath("structuredAnalysis.processFlows.toBe"),
    "Flujo TO-BE",
  );
  assert.equal(
    humanizeTechnicalStagePath("structuredAnalysis.entityRelationship"),
    "Modelo entidad-relación",
  );
  assert.equal(humanizeTechnicalStagePath("AS_IS"), "Flujo AS-IS");
  assert.equal(humanizeTechnicalStagePath("TO_BE"), "Flujo TO-BE");
  assert.equal(
    humanizeTechnicalStagePath("ENTITY_RELATIONSHIP"),
    "Modelo entidad-relación",
  );
  assert.equal(humanizeTechnicalStagePath(null), null);
  assert.equal(humanizeTechnicalStagePath(""), null);

  // Una ruta desconocida no se muestra cruda: se deriva un texto legible.
  const unknown = humanizeTechnicalStagePath(
    "structuredAnalysis.objectivesQuantitative",
  );
  assert.ok(unknown);
  assert.doesNotMatch(unknown!, /structuredAnalysis\./u);
});

test("la operación de un punto local se traduce a Generando/Reparando", () => {
  assert.equal(localDraftOperationLabel("GENERATING"), "Generando");
  assert.equal(localDraftOperationLabel("REPAIRING"), "Reparando");
  assert.equal(localDraftOperationLabel(null), "Generando");
  assert.equal(localDraftOperationLabel(undefined), "Generando");
});

test("la tabla de proyectos muestra correctamente los tres modos con su modelo", () => {
  assert.equal(
    aiGenerationLabel({
      engines: ["LOCAL"],
      models: { LOCAL: "qwen3.5:9b" },
      model: null,
    }),
    "IA local · qwen3.5:9b",
  );
  assert.equal(
    aiGenerationLabel({
      engines: ["LOCAL", "CLOUD"],
      models: { LOCAL: "qwen3.5:9b", CLOUD: "gpt-5.4" },
      model: null,
    }),
    "Híbrido · qwen3.5:9b + gpt-5.4",
  );
  assert.equal(
    aiGenerationLabel({
      engines: ["CLOUD"],
      models: { CLOUD: "gpt-5.4" },
      model: null,
    }),
    "IA nube · gpt-5.4",
  );

  // Nunca el patrón "IA local · modelo + IA nube · modelo" para híbrido.
  const hybridLabel = aiGenerationLabel({
    engines: ["LOCAL", "CLOUD"],
    models: { LOCAL: "qwen3.5:9b", CLOUD: "gpt-5.4" },
    model: null,
  });
  assert.doesNotMatch(hybridLabel, /IA local · .* \+ IA nube ·/u);
});

test("sin motores registrados, cae al modelo genérico o al mensaje neutro", () => {
  assert.equal(
    aiGenerationLabel({ engines: [], models: {}, model: "gpt-5.4" }),
    "IA · gpt-5.4",
  );
  assert.equal(
    aiGenerationLabel({ engines: [], models: {}, model: null }),
    "IA no registrada",
  );
});
