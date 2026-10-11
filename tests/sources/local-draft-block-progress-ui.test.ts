import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  localDraftBlockProgressCounter,
  localDraftBlockStatusLabel,
  localDraftBlockStatusSymbol,
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

type Status = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";

const block = (
  blockNumber: number,
  blockTotal: number,
  status: Status,
  blockLabel = `Bloque ${blockNumber}`,
) => ({
  blockNumber,
  blockTotal,
  blockKey: `block-${blockNumber}`,
  blockLabel,
  status,
});

test("la interfaz traduce los cinco estados requeridos", () => {
  assert.deepEqual(
    (
      ["PENDING", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED"] as const
    ).map((status) => [
      localDraftBlockStatusLabel(status),
      localDraftBlockStatusSymbol(status),
    ]),
    [
      ["Pendiente", "○"],
      ["Procesando…", "●"],
      ["Completado", "✓"],
      ["Error", "×"],
      ["Cancelado", "−"],
    ],
  );
});

test("el contador usa el total real de la plantilla y no fija quince", () => {
  const blocks14 = Array.from({ length: 14 }, (_, index) =>
    block(index + 1, 14, index < 4 ? "COMPLETED" : "PENDING"),
  );
  const current14 = block(8, 14, "PROCESSING", "Esquema");

  assert.equal(localDraftBlockProgressCounter(blocks14, current14), "8 / 14");
  assert.equal(localDraftBlockProgressCounter(blocks14, null), "4 / 14");

  const blocks3 = [
    block(1, 3, "COMPLETED"),
    block(2, 3, "PROCESSING"),
    block(3, 3, "PENDING"),
  ];
  assert.equal(localDraftBlockProgressCounter(blocks3, blocks3[1]), "2 / 3");
});

test("Fuentes muestra X/N y bloque actual solo para borrador local", async () => {
  const source = await readSourcesScreen();

  assert.match(source, /PASO_4_INTERFAZ_PROGRESO_BLOQUES_V1/u);
  assert.match(source, /PASO_9_VISTA_COMPACTA_TRES_MODOS_V2/u);
  assert.match(source, /processing\?\.localDraftBlocks/u);
  assert.match(source, /processing\?\.currentLocalDraftBlock/u);
  assert.match(source, /const showLocalDraftProgress =/u);
  assert.match(source, /Borrador por puntos/u);
  assert.match(source, /completedLocalDraftBlocks/u);
  assert.match(source, /localDraftBlockTotal/u);
  assert.match(
    source,
    /Punto \$\{currentLocalDraftBlock\.blockNumber\} de \$\{currentLocalDraftBlock\.blockTotal\}/u,
  );
  assert.match(source, /localDraftBlocks\.map\(\(block, blockIndex\) =>/u);
  assert.match(source, /data-rq-block-status=\{block\.status\}/u);
  assert.match(source, /const isCurrent = block\.status === "PROCESSING";/u);
  assert.match(source, /aria-current=\{isCurrent \? "step" : undefined\}/u);
});

test("la vista diferencia local, local+nube y nube sin repetir tarjetas de proveedor", async () => {
  const source = await readSourcesScreen();

  assert.match(source, /generationUsesLocal/u);
  assert.match(source, /generationUsesCloud/u);
  assert.match(source, /resolveGenerationPipelineEngines/u);
  assert.match(source, /localTotalSources/u);
  // Los tres modos canónicos se resuelven una sola vez en ai-generation-mode.ts
  // y se reutilizan aquí; la vista ya no concatena "IA local + nube" a mano.
  assert.match(source, /resolveTrackedGenerationMode/u);
  assert.match(source, /aiGenerationModeLabel\(displayedGenerationMode\)/u);
  assert.match(source, /Generación · \{generationModeLabel\}/u);
  assert.match(source, /"Consumo de la ejecución"/u);
  assert.doesNotMatch(source, /<strong>IA local · Ollama<\/strong>/u);
  assert.doesNotMatch(source, /<dt>Proveedor<\/dt>/u);
});

test("el monitor mantiene consecutivos y detalle inferior sin mover el motivo de falla", async () => {
  const [source, styles] = await Promise.all([
    readSourcesScreen(),
    readFile("libs/shared/ui/src/styles.css", "utf8"),
  ]);

  assert.match(source, /PASO_12_MONITOR_PROCESAMIENTO_COMPACTO_V2/u);
  assert.match(
    source,
    /className="rq-gen__step-number"[\s\S]*?\{index \+ 1\}/u,
  );
  assert.doesNotMatch(
    source,
    /state === "completed"[\s\S]*?\? "✓"[\s\S]*?state === "failed"[\s\S]*?\? "×"/u,
  );
  assert.match(
    source,
    /className="rq-gen__detail"[\s\S]*?<span>Detalle de la etapa<\/span>[\s\S]*?generationProcessingDetail\(presentedGeneration\)/u,
  );

  // Estilos consolidados: una sola familia `.rq-gen`, sin las capas antiguas.
  assert.match(styles, /\.rq-gen__pipeline \{/u);
  assert.match(styles, /\.rq-gen__detail \{/u);
  assert.doesNotMatch(styles, /\.rq-source-generation-pipeline/u);
  assert.doesNotMatch(styles, /\.rq-source-generation-failure/u);
});

test("el monitor compacto reemplaza Procesando por el reloj y contiene el resumen en su columna", async () => {
  const [source, styles] = await Promise.all([
    readSourcesScreen(),
    readFile("libs/shared/ui/src/styles.css", "utf8"),
  ]);

  // El reloj vive en su propio componente: Fuentes ya no se renderiza cada segundo.
  assert.match(
    source,
    /elapsedSince=\{\s*trackedGenerationActive \? \(latestExecution\?\.startedAt \?\? null\) : null\s*\}/u,
  );
  assert.match(source, /Tiempo transcurrido:[\s\S]*?<ElapsedClock startedAt=\{elapsedSince\}/u);
  assert.doesNotMatch(source, /rq-source-generation-activity/u);
  assert.doesNotMatch(source, />\s*Procesando\s*</u);
  assert.equal((source.match(/Tiempo transcurrido/gu) ?? []).length, 1);
  assert.match(
    styles,
    /\.rq-sources-workspace \.rq-gen \{[\s\S]*?minmax\(0, 1fr\)/u,
  );
  assert.doesNotMatch(styles, /width: 400px| min-height: 200px/u);
});

test("los estilos se limitan al monitor de Fuentes y diferencian estados", async () => {
  const styles = await readFile("libs/shared/ui/src/styles.css", "utf8");

  assert.match(styles, /PASO_4_INTERFAZ_PROGRESO_BLOQUES_V1/u);
  assert.match(styles, /PASO_9_VISTA_COMPACTA_TRES_MODOS_V2/u);
  assert.match(
    styles,
    /\.rq-sources-workspace \.rq-local-draft-block-progress/u,
  );
  assert.match(styles, /flex-wrap: wrap/u);
  assert.match(styles, /data-rq-block-status="PROCESSING"/u);
  assert.match(styles, /data-rq-block-status="COMPLETED"/u);
  assert.match(styles, /data-rq-block-status="FAILED"/u);
  assert.match(styles, /data-rq-block-status="CANCELLED"/u);
});
