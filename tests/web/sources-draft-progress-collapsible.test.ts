import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readStyles } from "../support/read-styles";

const SOURCE = "apps/web/src/app/workspace/sources/sources-workspace.tsx";

test("el detalle de Borrador por puntos se revela desde la pestaña Mostrar", async () => {
  const source = await readFile(SOURCE, "utf8");
  // Solo visible con la pestaña «Mostrar» activa; General inicia activa.
  assert.match(source, /draftProgressExpanded = consumptionTab === "show"/u);
  assert.match(source, /useState<ConsumptionTab>\("general"\)/u);
  assert.match(
    source,
    /aria-controls="rq-local-draft-block-progress-details"|id="rq-local-draft-block-progress-details"/u,
  );
  assert.match(source, /hidden=\{!draftProgressExpanded\}/u);
  // La lista completa se renderiza dentro del tabpanel Mostrar.
  assert.doesNotMatch(source, /draftProgress=\{/u);
  assert.ok(
    source.indexOf('id="rq-consumption-panel-show"') <
      source.indexOf("renderDraftNode()", source.indexOf("const consumptionNode")),
  );
  // La cabecera ya no tiene botones duplicados, pero conserva título y conteo.
  assert.doesNotMatch(source, /rq-local-draft-block-progress__toggle/u);
  assert.ok(
    source.indexOf("Borrador por puntos</strong>") <
      source.indexOf('id="rq-local-draft-block-progress-details"'),
  );
});

test("el selector de proyecto de los filtros tiene más ancho que los demás campos", async () => {
  const css = await readStyles();
  const rule =
    /\.rq-filter-bar > \.rq-field\.rq-project-picker \{[^}]*flex: 1 1 (\d+)px;/u.exec(
      css,
    );
  assert.ok(rule, "falta la regla del selector de proyecto");
  assert.ok(Number(rule[1]) > 180, "debe superar el ancho base de 180px");
  // Debe declararse después del bloque que fija 180px, o no tendría efecto.
  assert.ok(
    css.indexOf(".rq-filter-bar > .rq-field.rq-project-picker {") >
      css.indexOf("flex: 0 1 180px;"),
  );
});

test("el desglose de tokens usa su propia clase y no la del CSS antiguo en cuadrícula", async () => {
  const [css, source] = await Promise.all([
    readStyles(),
    readFile(SOURCE, "utf8"),
  ]);
  assert.match(source, /className="rq-source-token-summary"/u);
  assert.doesNotMatch(source, /rq-source-token-meter__breakdown/u);
  assert.match(css, /\.rq-sources-workspace \.rq-source-token-summary \{/u);
});

test("Mostrar lista los puntos existentes (también híbrido) con recuadro propio y lista compacta", async () => {
  const [css, source] = await Promise.all([
    readStyles(),
    readFile(SOURCE, "utf8"),
  ]);
  const visibility = /const showLocalDraftProgress =([^;]*);/u.exec(source);
  assert.ok(visibility, "falta showLocalDraftProgress");
  assert.match(visibility[1], /localDraftBlocks\.length > 0/u);
  assert.doesNotMatch(visibility[1], /generationUsesCloud/u);
  assert.match(source, /Aún no hay borrador por puntos para mostrar\./u);
  const item =
    /\.rq-source-consumption-tabs__panel\s+\.rq-local-draft-block-progress__list\s+> li \{([^}]*)\}/u.exec(
      css,
    );
  assert.ok(item, "falta el recuadro por punto en Mostrar");
  assert.match(item[1], /border: 1px solid/u);
  const list =
    /\.rq-source-consumption-tabs__panel\s+\.rq-local-draft-block-progress__list \{([^}]*)\}/u.exec(
      css,
    );
  assert.ok(list, "falta la lista compacta en Mostrar");
  // Lista compacta de una columna: el scroll lo gestiona la pestaña, no la lista.
  assert.match(list[1], /grid-template-columns: minmax\(0, 1fr\)/u);
  assert.match(list[1], /overflow: visible/u);
  assert.match(css, /\.rq-source-consumption-tabs__panel \{[^}]*overflow: auto;/u);
});

test("la ejecución completada sin checkpoints deriva los puntos de las secciones del documento", async () => {
  const source = await readFile(SOURCE, "utf8");
  assert.match(source, /function localDraftBlocksFromDocumentSections\(/u);
  const start = source.indexOf("async function discoverCurrentGeneration(");
  const body = source.slice(start, source.indexOf("export function SourcesWorkspace"));
  assert.match(body, /detail\.status !== "COMPLETED"/u);
  assert.match(body, /processing\?\.localDraftBlocks\?\.length \?\? 0\) > 0/u);
  assert.match(body, /fallbackBlocks\.length === 0/u);
  assert.match(body, /currentVersionDetail\.sections/u);
});
