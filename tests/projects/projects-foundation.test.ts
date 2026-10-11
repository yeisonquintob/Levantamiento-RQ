import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PROJECT_PARTICIPANT_ROLES,
  PROJECT_STATUSES,
} from "../../libs/shared/contracts/src/lib/projects.js";
import {
  defaultSidebarConfiguration,
  parseSidebarConfiguration,
  SIDEBAR_MENU_DEFINITIONS,
} from "../../apps/web/src/app/sidebar-navigation.js";
import {
  parseAddParticipant,
  parseCreateProject,
  parseProjectListQuery,
  parseUpdateProject,
} from "../../apps/projects-service/src/projects/projects-input.js";

test("el contrato publica los estados y roles controlados", () => {
  assert.deepEqual(PROJECT_STATUSES, [
    "DRAFT",
    "DISCUSSION",
    "SOURCES",
    "DOCUMENT_GENERATED",
    "VALIDATION",
    "APPROVED",
    "EXECUTION",
    "COMPLETED",
    "ARCHIVED",
  ]);

  assert.deepEqual(PROJECT_PARTICIPANT_ROLES, [
    "OWNER",
    "EDITOR",
    "REVIEWER",
    "VIEWER",
  ]);
});

test("la creación normaliza campos obligatorios", () => {
  assert.deepEqual(
    parseCreateProject({
      title: "  Automatización comercial  ",
      requestingArea: "  Ventas  ",
      description: "  Consolidar fuentes  ",
      templateId: "14000000-0000-4000-8000-000000000001",
    }),
    {
      title: "Automatización comercial",
      requestingArea: "Ventas",
      description: "Consolidar fuentes",
      templateId: "14000000-0000-4000-8000-000000000001",
    },
  );
});

test("la actualización exige al menos un campo", () => {
  assert.throws(() => parseUpdateProject({}), /al menos un campo/i);
});

test("los filtros aplican paginación controlada", () => {
  assert.deepEqual(
    parseProjectListQuery({
      search: "  RQ-2026  ",
      status: "DRAFT",
      page: "2",
      pageSize: "25",
    }),
    {
      search: "RQ-2026",
      area: "",
      status: "DRAFT",
      activityState: null,
      page: 2,
      pageSize: 25,
    },
  );
});

test("la situación del proyecto se valida al listar y al actualizar", () => {
  assert.equal(parseProjectListQuery({}).activityState, null);
  assert.equal(
    parseProjectListQuery({ activityState: "DELETED" }).activityState,
    "DELETED",
  );
  assert.equal(
    parseProjectListQuery({ activityState: "ALL" }).activityState,
    "ALL",
  );
  assert.throws(() => parseProjectListQuery({ activityState: "OTRO" }));
  assert.deepEqual(parseUpdateProject({ activityState: "PAUSED" }), {
    activityState: "PAUSED",
  });
  assert.throws(() => parseUpdateProject({ activityState: "BORRADO" }));
});

test("eliminar solo cambia la situación: la migración agrega la columna con restricción y sin borrar datos", async () => {
  const migration = await readFile(
    "apps/projects-service/src/database/migrations/1789614000000-AddProjectActivityState.ts",
    "utf8",
  );
  assert.match(migration, /ADD ActivityState NVARCHAR\(10\) NOT NULL/u);
  assert.match(
    migration,
    /ActivityState IN \('ACTIVE', 'PAUSED', 'DELETED'\)/u,
  );
  assert.doesNotMatch(migration, /DELETE FROM|TRUNCATE/u);
  const service = await readFile(
    "apps/projects-service/src/projects/projects.service.ts",
    "utf8",
  );
  assert.match(service, /project\.activityState <> 'DELETED'/u);
  assert.match(
    service,
    /request\.activityState === "DELETED"\) \{\s*this\.requireOwnerAccess/u,
  );
});

test("el propietario no puede agregarse como rol manual", () => {
  assert.throws(
    () =>
      parseAddParticipant({
        userId: "11111111-1111-4111-8111-111111111111",
        role: "OWNER",
      }),
    /EDITOR, REVIEWER o VIEWER/,
  );
});

test("la migración no crea relaciones con RqIdentityDb", async () => {
  const migration = await readFile(
    "apps/projects-service/src/database/migrations/1785715200000-CreateProjectsFoundation.ts",
    "utf8",
  );

  assert.match(migration, /CREATE TABLE dbo\.Projects/);
  assert.match(migration, /CREATE TABLE dbo\.ProjectParticipants/);
  assert.doesNotMatch(migration, /RqIdentityDb/i);
  assert.doesNotMatch(migration, /IdentityUsers/i);
});

test("el proyecto conserva la versión publicada exacta de la plantilla", async () => {
  const migration = await readFile(
    "apps/projects-service/src/database/migrations/1786060800000-AddProjectTemplateSelection.ts",
    "utf8",
  );
  const service = await readFile(
    "apps/projects-service/src/projects/projects.service.ts",
    "utf8",
  );
  const client = await readFile(
    "apps/projects-service/src/projects/document-templates-access.client.ts",
    "utf8",
  );

  assert.match(migration, /TemplateId uniqueidentifier/);
  assert.match(migration, /TemplateVersion nvarchar/);
  assert.doesNotMatch(migration, /FOREIGN KEY/i);
  assert.match(service, /requirePublished/);
  assert.match(service, /templateVersion: template\.version/);
  assert.match(service, /INSERT INTO dbo\.Projects/);
  assert.match(service, /INSERT INTO dbo\.ProjectParticipants/);
  assert.match(service, /randomUUID/);
  assert.match(service, /ServiceUnavailableException/);
  assert.match(service, /function normalizeUuid/);
  assert.match(service, /function sameUuid/);
  assert.match(service, /id: normalizeUuid\(project\.id\)/);
  assert.match(service, /sameUuid\(participant\.userId, actor\.id\)/);
  assert.doesNotMatch(service, /projectRepository\.save\(project\)/);
  assert.match(client, /template\.status !== "PUBLISHED"/);
});

test("Inicio y Proyectos son vistas independientes", async () => {
  const home = await readFile("apps/web/src/app/workspace/page.tsx", "utf8");
  const homeWorkspace = await readFile(
    "apps/web/src/app/workspace/home-workspace.tsx",
    "utf8",
  );
  const projectsPage = await readFile(
    "apps/web/src/app/workspace/projects/page.tsx",
    "utf8",
  );
  const projectsWorkspace = await readFile(
    "apps/web/src/app/workspace/projects-workspace.tsx",
    "utf8",
  );
  const shell = await readFile("apps/web/src/app/app-shell.tsx", "utf8");
  const nextConfig = await readFile("apps/web/next.config.js", "utf8");

  assert.match(home, /HomeWorkspace/);
  assert.match(homeWorkspace, /Etapas del levantamiento/);
  assert.match(homeWorkspace, /Cargar datos y fuentes/);
  assert.match(homeWorkspace, /Etapa actual: crear proyecto y encabezado/);
  assert.match(homeWorkspace, /"locked"/);
  assert.match(homeWorkspace, /Avance general/);
  assert.match(homeWorkspace, /projectStageLabel/);
  assert.match(homeWorkspace, /loadProjectProgress/);
  assert.match(homeWorkspace, /sources\?page=1&pageSize=50&status=ACTIVE/);
  assert.match(homeWorkspace, /aria-current/);
  assert.match(homeWorkspace, /setSelectedProjectId/);
  assert.match(homeWorkspace, /className="rq-home-project-state__list"/);
  assert.match(homeWorkspace, /data-selected=\{isSelected/);
  assert.doesNotMatch(homeWorkspace, /Acceso rápido/);
  assert.match(projectsPage, /\/api\/v1\/projects/);
  assert.match(projectsPage, /ProjectsWorkspace/);
  assert.match(projectsPage, /status=PUBLISHED/);
  assert.match(projectsWorkspace, /Nuevo proyecto/);
  assert.match(projectsWorkspace, /Plantilla publicada/);
  assert.match(projectsWorkspace, /templateId/);
  assert.match(projectsWorkspace, /rq-module-commandbar/);
  assert.doesNotMatch(projectsWorkspace, /RqPageHero/);
  assert.match(projectsWorkspace, /credentials: "include"/);
  // La navegación ya no está escrita en app-shell.tsx: el shell la obtiene de
  // las definiciones y de la configuración del menú lateral. Se verifica ese
  // contrato real y que el shell lo consume.
  assert.match(shell, /SIDEBAR_MENU_DEFINITIONS/);
  const definitions = new Map(
    SIDEBAR_MENU_DEFINITIONS.map((menu) => [menu.id, menu.href]),
  );
  assert.equal(definitions.get("home"), "/workspace");
  assert.equal(definitions.get("projects"), "/workspace/projects");
  assert.notEqual(
    definitions.get("home"),
    definitions.get("projects"),
    "Inicio y Proyectos deben ser destinos distintos",
  );
  const defaults = defaultSidebarConfiguration();
  for (const id of ["home", "projects"] as const) {
    const menu = defaults.menus.find((item) => item.id === id);
    assert.ok(menu, `${id} debe existir en la configuración por defecto`);
    assert.equal(menu.visible, true);
  }
  // Una configuración guardada incompleta no hace desaparecer Inicio ni Proyectos.
  const reparsed = parseSidebarConfiguration({ sections: [], menus: [] });
  assert.ok(reparsed.menus.some((menu) => menu.id === "home"));
  assert.ok(reparsed.menus.some((menu) => menu.id === "projects"));
  assert.match(shell, /resolvePageContext/);
  assert.match(shell, /rq-topbar__page/);
  assert.doesNotMatch(shell, /rq-sidebar__brand/);
  assert.doesNotMatch(shell, /workspace#proyectos/);
  assert.match(nextConfig, /devIndicators:\s*false/);
  assert.doesNotMatch(projectsWorkspace, /127\.0\.0\.1:3002/);

  const smoke = await readFile("scripts/projects-smoke-test.ts", "utf8");

  assert.match(smoke, /3004\/api\/v1\/templates/);
  assert.match(smoke, /3002\/api\/v1\/projects/);
  assert.match(smoke, /3000\/api\/v1\/projects/);
  assert.match(smoke, /Etapa fallida/);
  assert.match(smoke, /function sameUuid/);
  assert.match(smoke, /listar los proyectos creados/);
  assert.match(smoke, /identificador diferente/);
});

test("la eliminación del proyecto coordina todos los dominios antes del registro raíz", async () => {
  const [gateway, service, controller, workspace] = await Promise.all([
    readFile(
      "apps/gateway/src/projects/projects-gateway.controller.ts",
      "utf8",
    ),
    readFile("apps/projects-service/src/projects/projects.service.ts", "utf8"),
    readFile(
      "apps/projects-service/src/projects/projects.controller.ts",
      "utf8",
    ),
    readFile("apps/web/src/app/workspace/projects-workspace.tsx", "utf8"),
  ]);

  const ordered = [
    "this.analysis.purgeProject",
    "this.workflow.purgeProject",
    "this.operations.purgeProject",
    "this.documents.purgeProject",
    "this.sources.purgeProject",
    "this.projects.deleteProject",
  ];
  for (let index = 1; index < ordered.length; index += 1) {
    assert.ok(
      gateway.indexOf(ordered[index - 1]!) < gateway.indexOf(ordered[index]!),
    );
  }
  assert.match(controller, /@Delete\(":projectId"\)/);
  assert.match(service, /requireOwnerAccess\(actor, project\)/);
  // La pantalla ya no borra: «Eliminar» marca la situación como eliminada (reversible). El
  // borrado coordinado de los dominios sigue disponible en el gateway y el servicio.
  assert.match(workspace, /activityState: "DELETED"/);
  assert.doesNotMatch(workspace, /method: "DELETE"/);
});

test("el catálogo de áreas filtra proyectos, solo lo modifica un administrador y se siembra en la migración", async () => {
  const [service, input, migration, controller] = await Promise.all([
    readFile(
      "apps/projects-service/src/projects/project-areas.service.ts",
      "utf8",
    ),
    readFile("apps/projects-service/src/projects/projects-input.ts", "utf8"),
    readFile(
      "apps/projects-service/src/database/migrations/1789700000000-CreateProjectAreas.ts",
      "utf8",
    ),
    readFile(
      "apps/projects-service/src/projects/project-areas.controller.ts",
      "utf8",
    ),
  ]);
  assert.equal(parseProjectListQuery({ area: "  Cartera " }).area, "Cartera");
  assert.equal(parseProjectListQuery({}).area, "");
  assert.match(input, /area,\s*status/u);
  assert.match(service, /requireAdministrator\(actor\)/u);
  assert.match(migration, /SELECT DISTINCT LTRIM\(RTRIM\(RequestingArea\)\)/u);
  assert.match(controller, /@Controller\("project-areas"\)/u);
});
