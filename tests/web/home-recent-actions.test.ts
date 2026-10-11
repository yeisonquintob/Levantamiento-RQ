import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readStyles } from "../support/read-styles";

test("Inicio reemplaza proyectos recientes por un diagrama secuencial compacto", async () => {
  const [workspace, styles] = await Promise.all([
    readFile("apps/web/src/app/workspace/home-workspace.tsx", "utf8"),
    readStyles(),
  ]);

  for (const stage of [
    "Crear proyecto y encabezado",
    "Discusión",
    "Cargar datos y fuentes",
    "Generar documento",
    "Validación, corrección y aprobación",
    "Ejecución",
  ]) {
    assert.ok(workspace.includes(stage), `Falta la etapa: ${stage}`);
  }
  assert.doesNotMatch(workspace, /Proyectos recientes/u);
  assert.doesNotMatch(workspace, /rq-home-recent-table/u);
  assert.match(workspace, /className="rq-home-stage-chart"/u);
  // El avance se calcula con evidencia real: viene de `loadProjectProgress`
  // (fuentes, documento y versiones del proyecto), no de una etapa supuesta.
  assert.match(workspace, /loadProjectProgress/u);
  assert.match(workspace, /--rq-stage-progress/u);
  assert.match(workspace, /progress\?\.stagePercentages/u);
  assert.doesNotMatch(
    workspace,
    /if \(index < currentStageIndex\) return 100/u,
  );
  assert.doesNotMatch(workspace, /hasDocument \? 100/u);
  assert.match(workspace, /percentage === 100/u);
  assert.match(styles, /\.rq-home-stage-chart__plot\s*\{/u);
  assert.match(styles, /height: 160px/u);
  assert.match(styles, /grid-template-columns: repeat\(6/u);
});

test("Inicio: secciones sin marco exterior y listado de proyectos sin scroll interno", async () => {
  const styles = await readStyles();
  const marker = "RQ INICIO - SECCIONES SIN MARCO EXTERIOR Y LISTADO CONTINUO V1 INICIO";
  const block = styles.slice(styles.lastIndexOf(marker));

  assert.ok(styles.includes(marker), "Falta la corrección final de Inicio");
  const frame = block.match(
    /\.rq-home-workspace \.rq-home-flow,\s*\.rq-home-workspace \.rq-home-project-state\s*\{([^}]*)\}/u,
  );
  assert.ok(frame, "Falta la regla de marcos acotada a Inicio");
  assert.match(frame[1], /overflow:\s*visible/u);
  assert.match(frame[1], /border:\s*0/u);
  assert.match(frame[1], /border-radius:\s*0/u);
  assert.match(frame[1], /background:\s*transparent/u);
  assert.match(frame[1], /box-shadow:\s*none/u);

  const list = block.match(
    /\.rq-home-workspace \.rq-home-project-state__list\s*\{([^}]*)\}/u,
  );
  assert.ok(list, "Falta la regla de lista continua");
  assert.match(list[1], /max-height:\s*none/u);
  assert.match(list[1], /overflow-y:\s*visible/u);
});
