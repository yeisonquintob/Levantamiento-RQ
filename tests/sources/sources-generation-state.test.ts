import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  analysisGenerationPercentage,
  analysisGenerationStage,
  formatGenerationElapsed,
  generationPipelineState,
  generationPipelineSteps,
  generationProcessingDetail,
  isActiveAnalysisForVersion,
  localAnalysisPercentage,
  safeGenerationFailureMessage,
  sourceProcessingDisplay,
  sourceProcessingPercentage,
} from "../../apps/web/src/app/workspace/sources/sources-workspace.js";

// Pantalla de Fuentes: el espacio de trabajo y sus componentes de presentación.
async function readSourcesScreen(): Promise<string> {
  const dir = "apps/web/src/app/workspace/sources/";
  const parts = await Promise.all(
    [
      "sources-workspace.tsx",
      "sources-generation-panel.tsx",
      "sources-generation-summary.ts",
    ].map((file) => readFile(dir + file, "utf8")),
  );
  return parts.join("\n");
}

const DOCUMENT_ID = "11111111-1111-4111-8111-111111111111";
const CURRENT_VERSION_ID = "22222222-2222-4222-8222-222222222222";
const HISTORICAL_VERSION_ID = "33333333-3333-4333-8333-333333333333";

test("el porcentaje representa el procesamiento real de la fuente", () => {
  assert.equal(
    sourceProcessingPercentage({
      processingStatus: "PENDING",
      processingProgress: 87,
    }),
    0,
  );
  assert.equal(
    sourceProcessingPercentage({
      processingStatus: "PROCESSING",
      processingProgress: 46.6,
    }),
    47,
  );
  assert.equal(
    sourceProcessingPercentage({
      processingStatus: "READY",
      processingProgress: 0,
    }),
    100,
  );
});

test("solo bloquea una solicitud activa de la versión protegida", () => {
  const request = (
    status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED",
    documentVersionId = CURRENT_VERSION_ID,
  ) => ({
    documentId: DOCUMENT_ID,
    documentVersionId,
    status,
  });

  assert.equal(
    isActiveAnalysisForVersion(
      request("PENDING"),
      DOCUMENT_ID,
      CURRENT_VERSION_ID,
    ),
    true,
  );
  assert.equal(
    isActiveAnalysisForVersion(
      request("PROCESSING"),
      DOCUMENT_ID,
      CURRENT_VERSION_ID,
    ),
    true,
  );
  assert.equal(
    isActiveAnalysisForVersion(
      request("COMPLETED"),
      DOCUMENT_ID,
      CURRENT_VERSION_ID,
    ),
    false,
  );
  assert.equal(
    isActiveAnalysisForVersion(
      request("FAILED"),
      DOCUMENT_ID,
      CURRENT_VERSION_ID,
    ),
    false,
  );
  assert.equal(
    isActiveAnalysisForVersion(
      request("PROCESSING", HISTORICAL_VERSION_ID),
      DOCUMENT_ID,
      CURRENT_VERSION_ID,
    ),
    false,
  );
});

test("READY se reutiliza y la generación expone etapas independientes", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readSourcesScreen(),
  );

  assert.match(
    source,
    /source\.sourceType === "FILE" && source\.processingStatus !== "READY"/,
  );
  assert.match(source, /Fuentes listas\./);
  assert.match(source, /Preparando documento DRAFT/);
  assert.match(source, /Enviando solicitud a IA/);
  assert.match(source, /Solicitud de IA en cola/);
  assert.match(source, /Generando borrador con IA/);
  assert.match(source, /Aplicando resultado al documento/);
  assert.match(source, /Completado\./);
});

test("el pipeline visual conserva los tres modos reales", () => {
  const cloud = {
    processing: { engines: ["CLOUD"], localTotalSources: 0 },
  } as Parameters<typeof generationPipelineSteps>[0];
  const hybrid = {
    processing: { engines: ["LOCAL", "CLOUD"], localTotalSources: 2 },
  } as Parameters<typeof generationPipelineSteps>[0];

  assert.deepEqual(generationPipelineSteps(cloud), [
    "Preparación",
    "Generación en nube",
    "Validación y aplicación",
  ]);
  assert.deepEqual(generationPipelineSteps(hybrid), [
    "Preparación",
    "Análisis local",
    "Consolidación",
    "Generación en nube",
    "Validación y aplicación",
  ]);
});

test("el flujo local no muestra una etapa de nube", () => {
  const request = {
    processing: {
      engines: ["LOCAL"],
      localTotalSources: 2,
    },
  } as Parameters<typeof generationPipelineSteps>[0];

  assert.deepEqual(generationPipelineSteps(request), [
    "Preparación",
    "Análisis local",
    "Consolidación",
    "Borrador por puntos",
    "Validación y aplicación",
  ]);
});

test("la etapa persistida distingue cola, reintento, aplicación y cierre", () => {
  const detail = (
    status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED",
    options: { readonly attempt?: number; readonly hasResult?: boolean } = {},
  ) =>
    ({
      status,
      result: options.hasResult ? {} : null,
      executions: options.attempt ? [{ attempt: options.attempt }] : [],
    }) as Parameters<typeof analysisGenerationStage>[0];

  assert.equal(
    analysisGenerationStage(detail("PENDING")),
    "Solicitud de IA en cola…",
  );
  assert.equal(
    analysisGenerationStage(detail("PROCESSING", { attempt: 3 })),
    "Generando borrador con IA · intento 3…",
  );
  assert.equal(
    analysisGenerationStage(
      detail("PROCESSING", { attempt: 3, hasResult: true }),
    ),
    "Aplicando resultado al documento…",
  );
  assert.equal(
    analysisGenerationStage(detail("COMPLETED")),
    "Borrador generado y aplicado",
  );
  assert.equal(analysisGenerationStage(detail("FAILED")), "Generación fallida");
});

test("el porcentaje utiliza el avance real y reserva 100 para completado", () => {
  const withoutMeasuredProgress = {
    status: "PROCESSING",
    result: null,
    executions: [
      {
        attempt: 2,
        startedAt: "2026-08-13T17:00:00.000Z",
      },
    ],
  } as Parameters<typeof analysisGenerationPercentage>[0];
  const withMeasuredProgress = {
    ...withoutMeasuredProgress,
    processing: { progress: 63 },
  } as Parameters<typeof analysisGenerationPercentage>[0];
  const completed = {
    ...withoutMeasuredProgress,
    status: "COMPLETED",
  } as Parameters<typeof analysisGenerationPercentage>[0];

  assert.equal(analysisGenerationPercentage(withoutMeasuredProgress), 0);
  assert.equal(
    analysisGenerationPercentage(
      withoutMeasuredProgress,
      Date.parse("2026-08-13T19:00:00.000Z"),
    ),
    0,
  );
  assert.equal(analysisGenerationPercentage(withMeasuredProgress), 63);
  assert.equal(analysisGenerationPercentage(completed), 100);
});

test("Punto 6 mantiene el porcentaje local exactamente en el valor medido por backend", () => {
  const startedAt = "2026-09-01T12:00:00.000Z";
  const request = {
    status: "PROCESSING",
    result: null,
    executions: [],
    processing: {
      stage: "LOCAL_AI_ANALYSIS",
      progress: 10,
      localCompletedSources: 0,
      localTotalSources: 1,
      currentLocalSourceStartedAt: startedAt,
    },
  } as Parameters<typeof analysisGenerationPercentage>[0];

  assert.equal(
    analysisGenerationPercentage(request, Date.parse(startedAt)),
    10,
  );
  assert.equal(
    analysisGenerationPercentage(request, Date.parse(startedAt) + 60_000),
    10,
  );
  assert.equal(
    analysisGenerationPercentage(request, Date.parse(startedAt) + 30 * 60_000),
    10,
    "El tiempo no puede fabricar avance que el backend no haya medido.",
  );
});

test("Punto 6 mantiene validación en 95 hasta que backend confirme otro estado", () => {
  const finishedAt = "2026-09-01T12:00:00.000Z";
  const request = {
    status: "PROCESSING",
    result: {},
    executions: [{ finishedAt }],
    processing: {
      stage: "OUTPUT_VALIDATION",
      progress: 95,
      localCompletedSources: 1,
      localTotalSources: 1,
    },
  } as Parameters<typeof analysisGenerationPercentage>[0];

  assert.equal(
    analysisGenerationPercentage(request, Date.parse(finishedAt) + 8_000),
    95,
  );
  assert.equal(
    analysisGenerationPercentage(request, Date.parse(finishedAt) + 60_000),
    95,
  );
});

test("Punto 6 elimina interpolaciones temporales del porcentaje visual", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readSourcesScreen(),
  );

  assert.match(source, /PASO_6_UI_PROGRESO_REAL_BACKEND_V1/u);
  assert.doesNotMatch(source, /Math\.log1p\(elapsedSeconds\)/u);
  assert.doesNotMatch(source, /95 \+ Math\.floor\(elapsed \/ 2_000\)/u);
  assert.match(source, /Math\.round\(request\.processing\.progress\)/u);
});

test("Procesamiento refleja el resultado IA de la fuente utilizada", () => {
  const source = {
    id: "44444444-4444-4444-8444-444444444444",
    processingStatus: "READY" as const,
    processingProgress: 100,
    processingMessage: null,
  };
  const generation = {
    status: "FAILED" as const,
    errorMessage: "OpenAI excedió el tiempo límite.",
    sources: [
      {
        sourceId: source.id,
      },
    ],
  } as Parameters<typeof sourceProcessingDisplay>[1];

  assert.deepEqual(sourceProcessingDisplay(source, generation, 85), {
    label: "Fallida",
    state: "FAILED",
    percentage: 85,
    message: "OpenAI excedió el tiempo límite.",
  });
  assert.deepEqual(sourceProcessingDisplay(source, null, 0), {
    label: "Sin procesar",
    state: "PENDING",
    percentage: 0,
    message:
      "La fuente está lista, pero todavía no se ha incluido en una generación de IA.",
  });
});

test("el flujo visible se adapta a nube sola o a IA local más nube", () => {
  const cloudOnly = {
    processing: { localTotalSources: 0 },
  } as Parameters<typeof generationPipelineSteps>[0];
  const hybrid = {
    processing: { localTotalSources: 3 },
  } as Parameters<typeof generationPipelineSteps>[0];

  assert.deepEqual(generationPipelineSteps(cloudOnly), [
    "Preparación",
    "Generación en nube",
    "Validación y aplicación",
  ]);
  assert.deepEqual(generationPipelineSteps(hybrid), [
    "Preparación",
    "Análisis local",
    "Consolidación",
    "Generación en nube",
    "Validación y aplicación",
  ]);

  const queued = {
    status: "PENDING",
    processing: {
      stage: "QUEUED",
      progress: 5,
      localCompletedSources: 0,
      localTotalSources: 0,
    },
  } as Parameters<typeof generationPipelineState>[0];
  assert.equal(generationPipelineState(queued, 0), "active");
  assert.equal(generationPipelineState(queued, 1), "pending");
});

test("Ollama muestra 4 de 6 como 67% derivado exclusivamente del conteo", () => {
  const detail = {
    processing: {
      localCompletedSources: 4,
      localTotalSources: 6,
    },
  } as Parameters<typeof localAnalysisPercentage>[0];

  assert.equal(localAnalysisPercentage(detail), 67);
});

test("Ollama 6 de 6 cierra IA local incluso antes del cambio de etapa", () => {
  const detail = {
    status: "PROCESSING",
    processing: {
      stage: "LOCAL_AI_ANALYSIS",
      progress: 55,
      localCompletedSources: 6,
      localTotalSources: 6,
    },
  } as Parameters<typeof generationPipelineState>[0];

  assert.equal(generationPipelineState(detail, 0), "completed");
  assert.equal(generationPipelineState(detail, 1), "completed");
  assert.equal(generationPipelineState(detail, 2), "pending");
});

test("un fallo en OpenAI conserva lo anterior y deja validación pendiente", () => {
  const detail = {
    status: "FAILED",
    processing: {
      stage: "FAILED",
      progress: 80,
      localCompletedSources: 6,
      localTotalSources: 6,
    },
  } as Parameters<typeof generationPipelineState>[0];

  assert.deepEqual(
    generationPipelineSteps(detail).map((_, index) =>
      generationPipelineState(detail, index),
    ),
    ["completed", "completed", "completed", "failed", "pending"],
  );
});

test("una generación completada cierra todo el pipeline y llega a 100%", () => {
  const detail = {
    status: "COMPLETED",
    result: {},
    executions: [],
    processing: {
      stage: "COMPLETED",
      progress: 100,
      localCompletedSources: 0,
      localTotalSources: 0,
    },
  } as Parameters<typeof generationPipelineState>[0] &
    Parameters<typeof analysisGenerationPercentage>[0];

  assert.deepEqual(
    generationPipelineSteps(detail).map((_, index) =>
      generationPipelineState(detail, index),
    ),
    ["completed", "completed", "completed"],
  );
  assert.equal(analysisGenerationPercentage(detail), 100);
});

test("cada fila conserva el estado local real aunque la generación falle después", () => {
  const source = {
    id: "44444444-4444-4444-8444-444444444444",
    processingStatus: "READY" as const,
    processingProgress: 100,
    processingMessage: null,
  };
  const generation = {
    status: "FAILED" as const,
    errorMessage: "Presupuesto local insuficiente.",
    sources: [{ sourceId: source.id }],
    processing: {
      stage: "FAILED",
      localTotalSources: 1,
      localCompletedSourceIds: [source.id],
      localProcessingSourceIds: [],
    },
  } as Parameters<typeof sourceProcessingDisplay>[1];

  assert.deepEqual(sourceProcessingDisplay(source, generation, 55), {
    label: "Analizada",
    state: "READY",
    percentage: 100,
    message: "Análisis local completado para esta fuente.",
  });
});

test("el backend de progreso filtra la versión local y expone la fuente activa", async () => {
  const service = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      "apps/ai-analysis-service/src/analysis/ai-analysis.service.ts",
      "utf8",
    ),
  );

  assert.match(service, /LOCAL_AI_PROGRESS_REAL_V4_5/u);
  assert.match(
    service,
    /promptVersion\.startsWith\(LOCAL_AI_PROMPT_VERSION\)/u,
  );
  assert.match(service, /currentPromptVersion/u);
  assert.match(service, /currentLocalSourceTitle/u);
  assert.match(service, /localProcessingSourceIds/u);
});

test("la extracción local muestra fuente y segmento reales en curso", () => {
  const detail = {
    processing: {
      stage: "LOCAL_AI_ANALYSIS",
      localCompletedSources: 0,
      localTotalSources: 1,
      currentLocalSourceTitle: "Preguntas de análisis",
      currentLocalSourceStartedAt: "2026-08-23T22:00:00.000Z",
      localCompletedSegments: 2,
      currentLocalSegment: 3,
      localTotalSegments: 5,
    },
    executions: [],
  } as Parameters<typeof generationProcessingDetail>[0];

  assert.equal(
    generationProcessingDetail(detail),
    "0 de 1 fuentes completadas · procesando: Preguntas de análisis · segmento 3/5 · 2/5 segmentos completados",
  );
});

test("la preparación local identifica la fuente antes de iniciar Ollama", () => {
  const detail = {
    processing: {
      stage: "LOCAL_AI_ANALYSIS",
      engines: ["LOCAL"],
      localCompletedSources: 0,
      localTotalSources: 1,
      currentLocalSourceTitle: "Preguntas de análisis · RQ-2026-000309",
      currentLocalSourceStartedAt: null,
    },
    executions: [],
  } as Parameters<typeof generationProcessingDetail>[0];

  assert.equal(
    generationProcessingDetail(detail),
    "0 de 1 fuentes completadas · preparando: Preguntas de análisis · RQ-2026-000309",
  );
});

test("la cola local anticipa cuál fuente será procesada", () => {
  const detail = {
    processing: {
      stage: "QUEUED",
      engines: ["LOCAL"],
      localCompletedSources: 0,
      localTotalSources: 1,
      currentLocalSourceTitle: "Preguntas de análisis",
    },
    executions: [],
  } as Parameters<typeof generationProcessingDetail>[0];

  assert.equal(
    generationProcessingDetail(detail),
    "En cola para análisis, consolidación y generación local · siguiente fuente: Preguntas de análisis",
  );
});

test("la nube informa proveedor, modelo e intento sin duplicar el reloj general", () => {
  const detail = {
    processing: {
      stage: "CLOUD_AI_GENERATION",
      localTotalSources: 0,
    },
    executions: [
      {
        provider: "OPENAI",
        model: "gpt-5-mini",
        attempt: 2,
        startedAt: "2026-08-23T22:00:00.000Z",
      },
    ],
  } as Parameters<typeof generationProcessingDetail>[0];

  assert.equal(
    generationProcessingDetail(detail),
    "Generando respuesta · gpt-5-mini · intento 2",
  );
  assert.equal(
    formatGenerationElapsed(
      "2026-08-23T22:00:00.000Z",
      Date.parse("2026-08-23T23:02:03.000Z"),
    ),
    "01:02:03",
  );
});

test("el monitor expone retry sin identificadores internos ni trazas", () => {
  assert.equal(
    safeGenerationFailureMessage(
      "OpenAI falló responseId: resp_123\n    at provider.ts:10",
    ),
    "OpenAI falló",
  );
  assert.equal(
    safeGenerationFailureMessage(
      "Falló 11111111-1111-4111-8111-111111111111 durante la respuesta",
    ),
    "Falló durante la respuesta",
  );
  assert.match(
    safeGenerationFailureMessage(
      "Ocurrió un error inesperado.",
      "AI_AUTO_APPLY_UNAVAILABLE",
      true,
    ) ?? "",
    /IA terminó correctamente.*quedó guardado.*sin volver a consumir OpenAI/u,
  );
});

test("el monitor conserva accesibilidad, retry, reloj local y estados específicos", async () => {
  const [source, styles] = await Promise.all([
    readSourcesScreen(),
    import("node:fs/promises").then(({ readFile }) =>
      readFile("libs/shared/ui/src/styles.css", "utf8"),
    ),
  ]);

  assert.match(source, /aria-live="polite"/u);
  assert.match(source, /role="status"/u);
  assert.match(source, /aria-current=\{state === "active" \? "step"/u);
  assert.match(source, /Generación · \{generationModeLabel\}/u);
  assert.match(source, /"Consumo de la ejecución"/u);
  // La tarjeta de tokens depende del modo (local, híbrido, nube).
  assert.match(source, /tokenCardMode/u);
  assert.match(source, /tokenEstimateSourceIdsKey/u);
  assert.doesNotMatch(source, /<strong>IA local · Ollama<\/strong>/u);
  assert.doesNotMatch(source, /<dt>Proveedor<\/dt>/u);
  // El reloj de cada segundo está aislado en live-clock.tsx, no en el componente grande.
  const clock = await readFile(
    "apps/web/src/app/workspace/sources/live-clock.tsx",
    "utf8",
  );
  assert.match(clock, /setInterval\(\(\) => setNow\(Date\.now\(\)\), intervalMs\)/u);
  assert.doesNotMatch(source, /setVisualNow/u);
  assert.match(source, /setInterval\(refresh, 1500\)/u);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.doesNotMatch(source, /rq-source-generation-indeterminate/u);
  assert.doesNotMatch(
    source,
    /Avance progresivo de la consolidación|Avance progresivo de la generación con OpenAI|Avance progresivo de la validación/u,
  );
  assert.doesNotMatch(styles, /rq-source-generation-stage-card > progress/u);
  assert.doesNotMatch(styles, /rq-ai-progress-travel/u);
  assert.match(styles, /animation: none !important/u);
  assert.match(styles, /\.rq-gen__side \.rq-source-token-meter \{/u);
});

test("una ejecución ya iniciada (activa o terminal) nunca cae al mensaje de estimación vacía", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readSourcesScreen(),
  );

  // Una ejecución iniciada muestra siempre sus cifras (estimadas o reales); el
  // mensaje de selección vacía solo aplica sin fuentes ni solicitud.
  assert.match(source, /Selecciona fuentes para estimar el consumo\./u);
  assert.match(source, /Entrada real: \{actualInputTokens\.toLocaleString/u);
});

test("el indicador indeterminado de nube aparece solo durante CLOUD_AI_GENERATION", async () => {
  const [source, styles] = await Promise.all([
    readSourcesScreen(),
    import("node:fs/promises").then(({ readFile }) =>
      readFile("libs/shared/ui/src/styles.css", "utf8"),
    ),
  ]);

  assert.match(
    source,
    /currentGenerationStage === "CLOUD_AI_GENERATION" \? \(/u,
  );
  assert.match(source, /rq-source-cloud-indeterminate/u);
  assert.match(styles, /rq-source-cloud-indeterminate::after/u);
  assert.match(styles, /animation: rq-cloud-indeterminate-sweep/u);
});

test("las rutas técnicas de puntos locales se muestran con etiqueta humana, no crudas", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readSourcesScreen(),
  );

  assert.match(source, /humanizeTechnicalStagePath\(/u);
  assert.match(source, /Punto \$\{block\.blockNumber\}/u);
  assert.match(source, /block\.blockLabel/u);
});

test("la pantalla redescubre y consulta la generación activa al volver", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readSourcesScreen(),
  );

  assert.match(source, /discoverCurrentGeneration\(projectId\)/);
  assert.match(source, /initialAnalysisRequestId/);
  assert.match(source, /requestedAnalysisId/);
  assert.match(source, /setInterval\(refresh, 1500\)/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /data-rq-generation-status/);
  assert.match(source, /Generación · \{generationModeLabel\}/u);
});

test("la generación local muestra el punto y la subunidad sin duplicar el reloj general", () => {
  const block = {
    blockNumber: 9,
    blockTotal: 15,
    blockKey: "v2:abc",
    blockLabel: "Pruebas",
    status: "PROCESSING",
    completedUnits: 2,
    totalUnits: 9,
  };
  const detail = {
    processing: {
      stage: "LOCAL_AI_GENERATION",
      localDraftBlocks: [
        {
          ...block,
          blockNumber: 1,
          blockLabel: "Encabezado",
          status: "COMPLETED",
        },
        block,
      ],
      currentLocalDraftBlock: block,
    },
    executions: [{ startedAt: "2026-09-30T01:10:37.000Z" }],
  } as unknown as Parameters<typeof generationProcessingDetail>[0];

  assert.equal(
    generationProcessingDetail(detail),
    "1/15 completados · procesando 9/15: Pruebas · subunidad 3/9",
  );
});
