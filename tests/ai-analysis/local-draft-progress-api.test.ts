import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type {
  AiAnalysisLocalDraftBlockProgress,
  AiAnalysisProcessingDetail,
} from "../../libs/shared/contracts/src/index.js";
import {
  cloudGenerationProgress,
  localDraftGenerationProgress,
  localSourceAnalysisProgress,
} from "../../apps/ai-analysis-service/src/analysis/ai-analysis-real-progress.js";

test("Punto 3 calcula LOCAL_ONLY solo con checkpoints completados", () => {
  const blocks = Array.from({ length: 10 }, (_, index) => ({
    blockNumber: index + 1,
    blockTotal: 10,
    blockKey: `block-${index + 1}`,
    blockLabel: `Punto ${index + 1}`,
    status:
      index < 4
        ? ("COMPLETED" as const)
        : index === 4
          ? ("PROCESSING" as const)
          : ("PENDING" as const),
  }));

  assert.equal(localDraftGenerationProgress(blocks), 64);
  assert.equal(
    localDraftGenerationProgress(blocks.map((block) => ({ ...block }))),
    64,
  );
  assert.equal(
    localDraftGenerationProgress(
      blocks.map((block) => ({ ...block, status: "COMPLETED" as const })),
    ),
    92,
  );
});

test("Punto 3 combina puntos completados con unidades completadas del punto en curso", () => {
  const blocks = Array.from({ length: 10 }, (_, index) => ({
    blockNumber: index + 1,
    blockTotal: 10,
    blockKey: `block-${index + 1}`,
    blockLabel: `Punto ${index + 1}`,
    status:
      index < 4
        ? ("COMPLETED" as const)
        : index === 4
          ? ("PROCESSING" as const)
          : ("PENDING" as const),
    // El punto en curso ya completó 2 de 3 subunidades: no debe quedarse
    // clavado en el mismo valor que un punto recién iniciado.
    completedUnits: index === 4 ? 2 : undefined,
    totalUnits: index === 4 ? 3 : undefined,
  }));

  const withUnitProgress = localDraftGenerationProgress(blocks);
  const withoutUnitProgress = localDraftGenerationProgress(
    blocks.map((block) => ({
      ...block,
      completedUnits: undefined,
      totalUnits: undefined,
    })),
  );
  assert.ok(withUnitProgress > withoutUnitProgress);
});

test("Punto 3 distingue nube híbrida de nube directa sin progreso ficticio", () => {
  assert.equal(cloudGenerationProgress(true), 40);
  assert.equal(cloudGenerationProgress(false), 5);
});

test("una sola fuente con varios segmentos avanza dentro de 5-35% usando el segmento en curso", () => {
  // 0 fuentes completadas, 2 de 5 segmentos de la única fuente en curso.
  const value = localSourceAnalysisProgress(0, 1, 2, 5);
  assert.ok(value >= 5 && value <= 35);
  assert.ok(value > 5, "el segmento en curso debe mover el valor inicial");
});

test("un único segmento en curso no finge avance parcial verificable", () => {
  // Con un solo segmento no hay fracción demostrable dentro de la fuente:
  // el valor se queda en el arranque del rango de la fuente actual.
  const oneSegment = localSourceAnalysisProgress(0, 3, 0, 1);
  const noSegmentData = localSourceAnalysisProgress(0, 3, null, null);
  assert.equal(oneSegment, noSegmentData);
});

test("varias fuentes combinan fuentes completadas y el segmento de la fuente actual", () => {
  const twoOfFive = localSourceAnalysisProgress(2, 5, 3, 4);
  const twoOfFiveNoSegment = localSourceAnalysisProgress(2, 5, 0, 0);
  assert.ok(
    twoOfFive > twoOfFiveNoSegment,
    "el progreso del segmento actual debe sumar al de fuentes completadas",
  );
  assert.ok(twoOfFive <= 35);
});

test("el progreso de análisis de fuentes nunca retrocede al avanzar segmentos o fuentes", () => {
  const steps = [
    localSourceAnalysisProgress(0, 4, 0, 4),
    localSourceAnalysisProgress(0, 4, 1, 4),
    localSourceAnalysisProgress(0, 4, 2, 4),
    localSourceAnalysisProgress(0, 4, 4, 4),
    localSourceAnalysisProgress(1, 4, 0, 4),
    localSourceAnalysisProgress(2, 4, 0, 4),
    localSourceAnalysisProgress(4, 4, 0, 4),
  ];
  for (let index = 1; index < steps.length; index += 1) {
    assert.ok(
      steps[index]! >= steps[index - 1]!,
      `el paso ${index} (${steps[index]}) no puede ser menor que el anterior (${steps[index - 1]})`,
    );
  }
});

test("una reparación no reinicia el progreso: completedUnits del punto en curso solo puede crecer", () => {
  const blockBeforeRepair: AiAnalysisLocalDraftBlockProgress = {
    blockNumber: 6,
    blockTotal: 15,
    blockKey: "processFlow",
    blockLabel: "Diagrama de flujo",
    status: "PROCESSING",
    completedUnits: 1,
    totalUnits: 3,
  };
  const blockDuringRepair: AiAnalysisLocalDraftBlockProgress = {
    ...blockBeforeRepair,
    operation: "REPAIRING",
    repairAttempt: 1,
    // La reparación de la subunidad 2 no borra la 1 ya completada.
    completedUnits: 1,
  };

  const before = localDraftGenerationProgress([blockBeforeRepair]);
  const duringRepair = localDraftGenerationProgress([blockDuringRepair]);
  assert.equal(before, duringRepair);

  const afterRepairSucceeds = localDraftGenerationProgress([
    { ...blockBeforeRepair, completedUnits: 2 },
  ]);
  assert.ok(afterRepairSucceeds > before);
});

test("el contrato público representa el progreso dinámico de los bloques", () => {
  const active: AiAnalysisLocalDraftBlockProgress = {
    blockNumber: 7,
    blockTotal: 15,
    blockKey: "milestones",
    blockLabel: "Requerimientos",
    status: "PROCESSING",
  };

  const processing: AiAnalysisProcessingDetail = {
    stage: "LOCAL_AI_GENERATION",
    label: "Generando borrador con IA local.",
    progress: 70,
    engines: ["LOCAL"],
    localCompletedSources: 2,
    localTotalSources: 2,
    localCacheAvailable: 0,
    localSnapshotReady: true,
    localDraftBlocks: [active],
    currentLocalDraftBlock: active,
  };

  assert.equal(processing.currentLocalDraftBlock?.blockNumber, 7);
  assert.equal(processing.currentLocalDraftBlock?.blockTotal, 15);
  assert.equal(processing.currentLocalDraftBlock?.blockLabel, "Requerimientos");
  assert.equal(processing.currentLocalDraftBlock?.status, "PROCESSING");
});

test("AiAnalysisService agrega el progreso transitorio del Paso 2 al GET existente", async () => {
  const service = await readFile(
    "apps/ai-analysis-service/src/analysis/ai-analysis.service.ts",
    "utf8",
  );

  assert.match(service, /PASO_3_API_PROGRESO_BLOQUES_V1/u);
  assert.match(
    service,
    /getLocalDraftBlockProgress\(\s*analysisRequestId\s*,?\s*\)/u,
  );
  assert.match(service, /localDraftBlocks/u);
  assert.match(service, /currentLocalDraftBlock/u);
  assert.match(service, /block\.status === "PROCESSING"/u);
  assert.match(service, /block\.status === "FAILED"/u);
  assert.match(service, /block\.status === "CANCELLED"/u);
  assert.match(service, /PASO_3_PROGRESO_REAL_POR_ESTADO_V1/u);
  assert.match(service, /localDraftGenerationProgress\(localDraftBlocks\)/u);
  assert.match(service, /cloudGenerationProgress\(usesLocalKnowledge\)/u);
  assert.doesNotMatch(service, /generationElapsed/u);
  assert.doesNotMatch(service, /elapsed\s*\/\s*20_000/u);
});

test("Gateway ya transporta el detalle enriquecido sin crear una ruta duplicada", async () => {
  const [client, controller] = await Promise.all([
    readFile("apps/gateway/src/analysis/ai-analysis-client.service.ts", "utf8"),
    readFile(
      "apps/gateway/src/analysis/ai-analysis-gateway.controller.ts",
      "utf8",
    ),
  ]);

  assert.match(
    client,
    /getById\([\s\S]*?\): Promise<AiAnalysisRequestDetail> \{[\s\S]*?analysis-requests\/\$\{encodeURIComponent\(analysisRequestId\)\}/u,
  );
  assert.match(controller, /@Get\(":analysisRequestId"\)/u);
  assert.match(
    controller,
    /return this\.analysis\.getById\([\s\S]*?analysisRequestId/u,
  );

  assert.doesNotMatch(controller, /local-draft-progress/u);
});

test("Paso 3 no agrega persistencia ni altera la cancelación de Ollama", async () => {
  const [execution, provider] = await Promise.all([
    readFile(
      "apps/ai-analysis-service/src/execution/ai-analysis-execution.service.ts",
      "utf8",
    ),
    readFile(
      "apps/ai-analysis-service/src/execution/ollama-draft.provider.ts",
      "utf8",
    ),
  ]);

  assert.match(execution, /PASO_2_BACKEND_BLOQUE_ACTUAL_V1/u);
  assert.match(execution, /getLocalDraftBlockProgress/u);
  assert.match(provider, /LOCAL_DRAFT_ACTIVE_ABORT_V1/u);
});
