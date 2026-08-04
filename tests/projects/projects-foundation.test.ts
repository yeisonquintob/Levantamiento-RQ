import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PROJECT_PARTICIPANT_ROLES,
  PROJECT_STATUSES,
} from "../../libs/shared/contracts/src/lib/projects.js";
import {
  parseAddParticipant,
  parseCreateProject,
  parseProjectListQuery,
  parseUpdateProject,
} from "../../apps/projects-service/src/projects/projects-input.js";

test("el contrato publica los estados y roles controlados", () => {
  assert.deepEqual(PROJECT_STATUSES, [
    "DRAFT",
    "IN_PROGRESS",
    "VALIDATION",
    "APPROVED",
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
    }),
    {
      title: "Automatización comercial",
      requestingArea: "Ventas",
      description: "Consolidar fuentes",
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
      status: "DRAFT",
      page: 2,
      pageSize: 25,
    },
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
  assert.match(homeWorkspace, /Estado del proyecto/);
  assert.match(homeWorkspace, /projectStageLabel/);
  assert.doesNotMatch(homeWorkspace, /Acceso rápido/);
  assert.match(projectsPage, /\/api\/v1\/projects/);
  assert.match(projectsPage, /ProjectsWorkspace/);
  assert.match(projectsWorkspace, /Nuevo proyecto/);
  assert.match(projectsWorkspace, /rq-module-commandbar/);
  assert.doesNotMatch(projectsWorkspace, /RqPageHero/);
  assert.match(projectsWorkspace, /credentials: "include"/);
  assert.match(shell, /href="\/workspace"/);
  assert.match(shell, /href="\/workspace\/projects"/);
  assert.match(shell, /resolvePageContext/);
  assert.match(shell, /rq-topbar__page/);
  assert.doesNotMatch(shell, /rq-sidebar__brand/);
  assert.doesNotMatch(shell, /workspace#proyectos/);
  assert.match(nextConfig, /devIndicators:\s*false/);
  assert.doesNotMatch(projectsWorkspace, /127\.0\.0\.1:3002/);
});
