import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SOURCE_PROCESSING_STATUSES,
  SOURCE_STATUSES,
  SOURCE_TYPES,
  TEXT_SOURCE_TYPES,
} from "../../libs/shared/contracts/src/lib/sources.js";
import {
  parseCreateTextSource,
  parseSourceListQuery,
  parseUpdateSource,
} from "../../apps/sources-service/src/sources/sources-input.js";

test("el contrato publica tipos y estados controlados", () => {
  assert.deepEqual(SOURCE_TYPES, [
    "FILE",
    "NOTE",
    "CONVERSATION",
    "TRANSCRIPT",
  ]);
  assert.deepEqual(TEXT_SOURCE_TYPES, [
    "NOTE",
    "CONVERSATION",
    "TRANSCRIPT",
  ]);
  assert.deepEqual(SOURCE_STATUSES, ["ACTIVE", "ARCHIVED"]);
  assert.deepEqual(SOURCE_PROCESSING_STATUSES, [
    "PENDING",
    "READY",
    "FAILED",
  ]);
});

test("la creación textual normaliza sus campos", () => {
  assert.deepEqual(
    parseCreateTextSource({
      sourceType: "NOTE",
      title: "  Entrevista inicial  ",
      content: "  El usuario requiere trazabilidad.  ",
    }),
    {
      sourceType: "NOTE",
      title: "Entrevista inicial",
      content: "El usuario requiere trazabilidad.",
    },
  );
});

test("la creación directa de FILE queda reservada para el Paso 13.2", () => {
  assert.throws(
    () =>
      parseCreateTextSource({
        sourceType: "FILE",
        title: "Documento",
        content: "Contenido",
      }),
    /NOTE, CONVERSATION o TRANSCRIPT/,
  );
});

test("la actualización exige al menos un campo", () => {
  assert.throws(() => parseUpdateSource({}), /al menos un campo/i);
});

test("los filtros aplican paginación y catálogos controlados", () => {
  assert.deepEqual(
    parseSourceListQuery({
      search: "  entrevista  ",
      sourceType: "CONVERSATION",
      status: "ACTIVE",
      page: "2",
      pageSize: "25",
    }),
    {
      search: "entrevista",
      sourceType: "CONVERSATION",
      status: "ACTIVE",
      page: 2,
      pageSize: 25,
    },
  );
});

test("la migración no crea relaciones entre bases", async () => {
  const migration = await readFile(
    "apps/sources-service/src/database/migrations/1785801600000-CreateSourcesFoundation.ts",
    "utf8",
  );

  assert.match(migration, /CREATE TABLE dbo\.Sources/);
  assert.match(migration, /ProjectId uniqueidentifier NOT NULL/);
  assert.doesNotMatch(migration, /FOREIGN KEY\s*\(ProjectId\)/i);
  assert.doesNotMatch(migration, /RqProjectsDb/i);
});

test("Sources valida el proyecto por API y no por repositorio externo", async () => {
  const client = await readFile(
    "apps/sources-service/src/sources/projects-access.client.ts",
    "utf8",
  );

  assert.match(client, /\/api\/v1\/projects\//);
  assert.match(client, /authorization: `Bearer \$\{accessToken\}`/);
  assert.doesNotMatch(client, /ProjectEntity/);
  assert.doesNotMatch(client, /InjectRepository\(Project/);
});

test("Gateway y frontend consumen Sources Service sin acceso directo", async () => {
  const gateway = await readFile(
    "apps/gateway/src/sources/sources-client.service.ts",
    "utf8",
  );
  const page = await readFile(
    "apps/web/src/app/workspace/sources/page.tsx",
    "utf8",
  );
  const client = await readFile(
    "apps/web/src/app/workspace/sources/sources-workspace.tsx",
    "utf8",
  );

  assert.match(gateway, /sourcesServiceUrl/);
  assert.match(page, /\/api\/v1\/projects/);
  assert.match(client, /credentials: "include"/);
  assert.doesNotMatch(client, /127\.0\.0\.1:3003/);
});

test("la navegación habilita Fuentes y conserva Proyectos", async () => {
  const shell = await readFile("apps/web/src/app/app-shell.tsx", "utf8");

  assert.match(shell, /href="\/workspace\/sources"/);
  assert.match(shell, /href="\/workspace#proyectos"/);
  assert.match(shell, /Paso 13\.1/);
});
