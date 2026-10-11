import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { SIDEBAR_MENU_DEFINITIONS } from "../../apps/web/src/app/sidebar-navigation";

test("Proyectos presenta tarjetas compactas y acciones sobre el proyecto seleccionado", async () => {
  const [workspace, styles] = await Promise.all([
    readFile("apps/web/src/app/workspace/projects-workspace.tsx", "utf8"),
    readFile("libs/shared/ui/src/styles.css", "utf8"),
  ]);
  // Cada tarjeta ofrece «Ver / editar» y se puede seleccionar; Discusión,
  // Fuentes y Eliminar están en el menú ☰ y actúan sobre el proyecto
  // seleccionado (deshabilitadas sin selección).
  assert.match(workspace, />\s*Fuentes\s*</u);
  assert.match(workspace, /data-rq-project-action="view"[\s\S]*?>\s*Abrir\s*</u);
  assert.match(workspace, />\s*Discusión\s*</u);
  assert.match(workspace, />\s*Eliminar\s*</u);
  assert.match(
    workspace,
    /projects\/\$\{encodeURIComponent\(selectedProject\.id\)\}\/discussion/u,
  );
  assert.match(
    workspace,
    /sources\?projectId=\$\{encodeURIComponent\(selectedProject\.id\)\}/u,
  );
  assert.match(workspace, /disabled=\{!selectedProject\}/u);
  assert.match(workspace, /className="rq-project-card-grid"/u);
  assert.match(workspace, /className="rq-project-card"/u);
  assert.doesNotMatch(
    workspace,
    /<table className="rq-table rq-project-table"/u,
  );

  assert.match(workspace, /data-rq-project-action="view"/u);
  assert.match(workspace, /className="rq-projects-menu"/u);
  assert.match(workspace, /data-rq-danger="true"/u);
  assert.match(styles, /--rq-color-page: #ffffff/u);
  assert.match(styles, /--rq-action-primary: #1769aa/u);
  assert.match(
    styles,
    /\.rq-project-card__actions \[data-rq-project-action="view"\]/u,
  );
});

test("Discusión compara evidencia, IA local e IA nube antes de crear la fuente", async () => {
  const [workspace, engineSelection, styles] = await Promise.all([
    readFile(
      "apps/web/src/app/workspace/projects/[projectId]/discussion/requirement-discussion-workspace.tsx",
      "utf8",
    ),
    readFile("apps/web/src/app/workspace/ai-engine-selection.tsx", "utf8"),
    readFile("libs/shared/ui/src/styles.css", "utf8"),
  ]);
  for (const text of [
    "Mi levantamiento",
    "Procesado con IA",
    "Etapa y pregunta",
    "Respuesta editable y valoración",
    "Conversación completa",
    "Agregar a fuentes",
    "Generar borrador",
    "Respuesta IA local",
    "Respuesta IA nube",
    "Guardar selección en Fuentes",
    "Usar respuesta original",
    "Usar IA local",
    "Usar IA nube",
  ]) {
    assert.ok(workspace.includes(text), `Falta el control: ${text}`);
  }
  // El nivel de definición es una escala interactiva de 1 a 10 (antes un control deslizante).
  assert.match(workspace, /role="radiogroup"/u);
  assert.match(workspace, /Array\.from\(\{ length: 10 \}/u);
  assert.match(workspace, /rows=\{2\}/u);
  assert.match(styles, /\.rq-discussion-workspace \.rq-page-hero/u);
  assert.match(styles, /min-height: 54px/u);
  assert.match(workspace, /window\.localStorage/u);
  assert.match(workspace, /sourceType: "CONVERSATION"/u);
  assert.match(workspace, /hasDiscussionContent\(state\)/u);
  assert.match(workspace, /persistDiscussionSource\(state\)/u);
  assert.match(workspace, /RESPUESTAS SELECCIONADAS PARA EL LEVANTAMIENTO/u);
  assert.match(workspace, /analysis-requests\/discussion\/process/u);
  assert.match(engineSelection, /discussion\/capabilities/u);
  assert.match(workspace, /engine,/u);
  assert.match(workspace, /Promise\.allSettled/u);
  assert.match(workspace, /<AiProcessingMenu/u);
  const toolbarControls = workspace.slice(
    workspace.indexOf('rq-discussion-toolbar__control-area"'),
    workspace.indexOf('className="rq-discussion-context-row"'),
  );
  assert.match(toolbarControls, /togglePrototype=/u);
  assert.match(
    toolbarControls,
    /includePrototype=\{state\.needsPrototype === true\}/u,
  );
  // Las acciones secundarias van en un menú ☰ y solo queda «Generar borrador».
  assert.match(toolbarControls, /rq-projects-menu rq-discussion-more/u);
  assert.match(toolbarControls, /Generar borrador/u);
  assert.doesNotMatch(toolbarControls, /Reprocesar y generar borrador/u);
  assert.match(toolbarControls, /label="IA"/u);
  assert.match(
    toolbarControls,
    /processingAi \? stopProcessing : \(\) => void processWithAi\(\)/u,
  );
  assert.match(toolbarControls, /Cancelar procesamiento/u);
  assert.doesNotMatch(toolbarControls, /‹ Volver a discusiones/u);
  assert.doesNotMatch(toolbarControls, /Volver a proyectos/u);
  const processIndex = toolbarControls.indexOf("Cancelar procesamiento");
  const sourcesIndex = toolbarControls.indexOf("Agregar a fuentes");
  assert.ok(processIndex > -1 && sourcesIndex > -1);
  assert.ok(processIndex < sourcesIndex);
  assert.match(engineSelection, /IA local/u);
  assert.match(engineSelection, /IA nube/u);
  assert.match(engineSelection, /role="switch"/u);
  assert.match(engineSelection, /rq-ai-engine-selection-v1/u);
  assert.match(workspace, /type="checkbox"/u);
  assert.match(workspace, /selectedAnswers/u);
  assert.match(workspace, /includeConversation/u);
  assert.match(styles, /repeat\(3, minmax\(250px, 1fr\)\)/u);
  assert.match(styles, /\.rq-ai-engine-chip/u);
});

test("el menú lateral incluye Discusión y puede contraerse en escritorio", async () => {
  const [shell, styles, indexPage, projectList] = await Promise.all([
    readFile("apps/web/src/app/app-shell.tsx", "utf8"),
    readFile("libs/shared/ui/src/styles.css", "utf8"),
    readFile("apps/web/src/app/workspace/discussion/page.tsx", "utf8"),
    readFile(
      "apps/web/src/app/workspace/discussion/discussion-project-list.tsx",
      "utf8",
    ),
  ]);

  // El menú se define en sidebar-navigation.ts; el shell lo consume.
  assert.match(shell, /SIDEBAR_MENU_DEFINITIONS/u);
  const discussionMenu = SIDEBAR_MENU_DEFINITIONS.find(
    (menu) => menu.id === "discussion",
  );
  assert.equal(discussionMenu?.href, "/workspace/discussion");
  assert.equal(discussionMenu?.label, "Discusión");
  assert.match(shell, /data-sidebar-collapsed=\{sidebarCollapsed\}/u);
  assert.match(shell, /rq-sidebar-collapsed/u);
  assert.match(shell, /aria-expanded=\{!sidebarCollapsed\}/u);
  assert.match(styles, /rq-shell\[data-sidebar-collapsed="true"\]/u);
  assert.match(styles, /rq-sidebar\[data-collapsed="true"\]/u);
  // La página compone el listado, que ofrece «Abrir discusión» por proyecto.
  assert.match(indexPage, /DiscussionProjectList/u);
  assert.match(projectList, /aria-label="Abrir discusión"/u);
  assert.match(
    projectList,
    /\/workspace\/projects\/\$\{encodeURIComponent\(project\.id\)\}\/discussion/u,
  );
});
