// Proyectos: indicadores con icono, menú ☰, filtros con etiqueta dentro, situación del proyecto
// (activo, pausado, eliminado) y colores por situación.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const WORKSPACE = "apps/web/src/app/workspace/projects-workspace.tsx";

test("tres indicadores con icono: proyectos activos/eliminados, borradores y avance", async () => {
  const source = await readFile(WORKSPACE, "utf8");
  assert.match(
    source,
    /title="Proyectos"[\s\S]*?\$\{metrics\.active\} \/ \$\{metrics\.deleted\}/u,
  );
  assert.match(source, /title="Borradores"/u);
  assert.match(
    source,
    /title="Avance"[\s\S]*?\$\{metrics\.inProgress\} \/ \$\{metrics\.completed\}/u,
  );
  assert.doesNotMatch(source, /title="En curso"|title="Completados"/u);
  assert.equal((source.match(/<WorkspaceKpiIcon /gu) ?? []).length, 3);
});

test("«Nuevo proyecto» va primero y el menú ☰ después, con Discusión, Fuentes y Eliminar", async () => {
  const source = await readFile(WORKSPACE, "utf8");
  const actions = source.slice(
    source.indexOf('className="rq-module-commandbar__actions"'),
    source.indexOf("rq-projects-filters"),
  );
  assert.ok(
    actions.indexOf("Nuevo proyecto") <
      actions.indexOf('className="rq-projects-menu"'),
    "el botón principal debe ir antes del menú",
  );
  const menu = actions.slice(actions.indexOf('className="rq-projects-menu"'));
  for (const label of ["Discusión", "Fuentes", "Eliminar"]) {
    assert.match(menu, new RegExp(`>\\s*${label}\\s*<`, "u"));
  }
  assert.equal((actions.match(/<RqActionButton/gu) ?? []).length, 1);
});

test("la ventana de proyecto es plana: situación segmentada, cierre y pie fijo", async () => {
  const [source, css] = await Promise.all([
    readFile(WORKSPACE, "utf8"),
    readFile("libs/shared/ui/src/styles.css", "utf8"),
  ]);
  assert.match(source, /rq-project-modal rq-project-modal--form/u);
  assert.match(source, /className="rq-project-segmented"/u);
  assert.match(source, /aria-label="Cerrar"/u);
  assert.match(css, /\.rq-project-modal--form \{[^}]*overflow: hidden/u);
  assert.match(
    css,
    /\.rq-project-modal--form \.rq-project-form__body \{[^}]*overflow-y: auto/u,
  );
});

test("los filtros llevan la etiqueta dentro del control y el estado inicial es «Activos»", async () => {
  const source = await readFile(WORKSPACE, "utf8");
  assert.match(source, /<span>Buscar proyecto:<\/span>/u);
  assert.match(source, /placeholder="Código, título"/u);
  assert.match(source, /<span>Estado:<\/span>/u);
  assert.match(source, /<span>Área:<\/span>/u);
  assert.match(source, /<option value="">Todas<\/option>/u);
  assert.match(source, /\/api\/v1\/project-areas/u);
  assert.match(source, /<span>Ordenar:<\/span>/u);
  // El estado inicial sigue siendo «Activos»; ahora vive en la URL (?estado=…).
  assert.match(source, /useQueryState<ProjectFilter>\(\s*"estado",\s*"ACTIVE"/u);
  assert.match(source, /useQueryState<ProjectSort>\(\s*"orden",\s*"CREATED_DESC"/u);
  assert.match(source, /value: "DELETED", label: "Eliminados"/u);
});

test("eliminar no borra: cambia la situación y se reactiva desde Ver / editar", async () => {
  const source = await readFile(WORKSPACE, "utf8");
  assert.match(source, /activityState: "DELETED"/u);
  assert.doesNotMatch(source, /method: "DELETE"/u);
  assert.match(source, /Situación del proyecto/u);
  assert.match(source, /ACTIVITY_LABEL/u);
});

test("la insignia usa naranja en curso, verde aprobado, rojo eliminado y gris pausado", async () => {
  const source = await readFile(WORKSPACE, "utf8");
  assert.match(source, /tone: "danger", label: "Eliminado"/u);
  assert.match(source, /tone: "inactive", label: "Pausado"/u);
  assert.match(
    source,
    /\["APPROVED", "EXECUTION", "COMPLETED"\]\.includes\(project\.status\)[\s\S]*?tone: "success", label: "Aprobado"/u,
  );
  assert.match(
    source,
    /return \{ tone: "pending", label: statusLabel\(project\.status\) \}/u,
  );
});

test("Configuración → Parámetros reúne Barra lateral y Área; la ruta antigua redirige", async () => {
  const [nav, workspace, sidebarPage, areas] = await Promise.all([
    readFile(
      "apps/web/src/app/workspace/settings/settings-navigation.tsx",
      "utf8",
    ),
    readFile(
      "apps/web/src/app/workspace/settings/parameters/parameters-workspace.tsx",
      "utf8",
    ),
    readFile("apps/web/src/app/workspace/settings/sidebar/page.tsx", "utf8"),
    readFile(
      "apps/web/src/app/workspace/settings/parameters/areas-settings.tsx",
      "utf8",
    ),
  ]);
  assert.match(
    nav,
    /href: "\/workspace\/settings\/parameters",\s*label: "Parámetros"/u,
  );
  assert.doesNotMatch(nav, /label: "Barra lateral"/u);
  assert.match(workspace, /label: "Barra lateral"/u);
  assert.match(workspace, /label: "Área"/u);
  assert.match(sidebarPage, /redirect\("\/workspace\/settings\/parameters"\)/u);
  assert.match(areas, /Agregar área/u);
  assert.match(areas, />\s*Editar\s*</u);
  assert.match(areas, /AreaIconPicker/u);
});

test("los filtros de Proyectos no llevan borde ni aro de enfoque", async () => {
  const css = await readFile("libs/shared/ui/src/styles.css", "utf8");
  const filter = css.match(/\.rq-projects-filter \{([^}]*)\}/u)?.[1] ?? "";
  assert.match(filter, /border: 0;/u);
  assert.match(
    css,
    /\.rq-projects-filter input:focus-visible,[\s\S]*?outline: none;/u,
  );
});

test("Discusión: indicadores por respuesta, procesado y viabilidad; filtros planos; columna de útiles; botón verde", async () => {
  const [list, cells] = await Promise.all([
    readFile(
      "apps/web/src/app/workspace/discussion/discussion-project-list.tsx",
      "utf8",
    ),
    readFile(
      "apps/web/src/app/workspace/discussion/discussion-project-metrics-cells.tsx",
      "utf8",
    ),
  ]);
  assert.match(
    list,
    /title="Total"[\s\S]*?\$\{metrics\.withResponse\}\/\$\{metrics\.withoutResponse\}/u,
  );
  assert.match(
    list,
    /title="Procesados"[\s\S]*?\$\{metrics\.manual\}\/\$\{metrics\.local\}\/\$\{metrics\.cloud\}/u,
  );
  assert.match(
    list,
    /title="Viable para desarrollo"[\s\S]*?\$\{metrics\.viable\}\/\$\{metrics\.total\}/u,
  );
  assert.match(
    list,
    /data-rq-tone="affirmative"[\s\S]*?Administrar proyectos/u,
  );
  assert.match(list, /<span>Buscar proyecto:<\/span>/u);
  assert.match(list, /<span>Área:<\/span>/u);
  assert.match(
    list,
    /<th scope="col">Viabilidad<\/th>\s*<th scope="col">Respuestas útiles<\/th>/u,
  );
  assert.match(cells, /rq-discussion-index__useful/u);
  // Viabilidad y «útiles / por revisar» van en celdas separadas.
  assert.match(
    cells,
    /rq-discussion-index__viability[\s\S]*?<\/td>[\s\S]*?rq-discussion-index__useful/u,
  );
});

test("Discusión: la pregunta de prototipo va arriba de «Notas, reunión o transcripción»", async () => {
  const source = await readFile(
    "apps/web/src/app/workspace/projects/[projectId]/discussion/requirement-discussion-workspace.tsx",
    "utf8",
  );
  const aside = source.slice(
    source.indexOf('<aside className="rq-discussion-conversation">'),
  );
  assert.ok(
    aside.indexOf("rq-discussion-prototype-request") <
      aside.indexOf("Notas, reunión o transcripción"),
  );
  assert.match(aside, /updatePrototypeRequirement\(/u);
  // Ya no queda como sección desplegable dentro del cuestionario.
  assert.doesNotMatch(source, /openQuestionSectionId === "solution-type"/u);
});
