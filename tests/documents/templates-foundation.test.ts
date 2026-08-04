import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DOCUMENT_TEMPLATE_STATUSES,
  DOCUMENT_TEMPLATE_TYPES,
} from "../../libs/shared/contracts/src/lib/document-templates.js";
import {
  compareSemanticVersions,
  parseCloneDocumentTemplate,
  parseCreateDocumentTemplate,
  parseDocumentTemplateListQuery,
  parseUpdateDocumentTemplate,
} from "../../apps/documents-service/src/templates/document-templates-input.js";
test("el contrato publica tipos y estados controlados", () => {
  assert.deepEqual(DOCUMENT_TEMPLATE_TYPES, [
    "SMALL_REQUIREMENT",
    "MEDIUM_REQUIREMENT",
    "LARGE_REQUIREMENT",
    "ERP_FDD",
  ]);
  assert.deepEqual(DOCUMENT_TEMPLATE_STATUSES, [
    "DRAFT",
    "PUBLISHED",
    "RETIRED",
  ]);
});

test("la creación normaliza código, nombre y SemVer", () => {
  assert.deepEqual(
    parseCreateDocumentTemplate({
      code: "  rq-custom  ",
      name: "  Plantilla comercial  ",
      description: "  Alcance puntual  ",
      templateType: "SMALL_REQUIREMENT",
      version: "1.0.0",
      includesScrum: true,
    }),
    {
      code: "RQ-CUSTOM",
      name: "Plantilla comercial",
      description: "Alcance puntual",
      templateType: "SMALL_REQUIREMENT",
      version: "1.0.0",
      includesScrum: true,
    },
  );
});

test("pequeño, mediano y grande exigen Scrum", () => {
  assert.throws(
    () =>
      parseCreateDocumentTemplate({
        code: "RQ-SMALL-ALT",
        name: "Plantilla pequeña",
        templateType: "SMALL_REQUIREMENT",
        version: "1.0.0",
        includesScrum: false,
      }),
    /deben incluir Epic, Feature/i,
  );

  assert.doesNotThrow(() =>
    parseCreateDocumentTemplate({
      code: "ERP-FDD-ALT",
      name: "FDD ERP",
      templateType: "ERP_FDD",
      version: "1.0.0",
      includesScrum: false,
    }),
  );
});

test("la actualización exige al menos un campo", () => {
  assert.throws(
    () => parseUpdateDocumentTemplate({}),
    /al menos un campo/i,
  );
});

test("la clonación y los filtros validan SemVer y paginación", () => {
  assert.deepEqual(
    parseCloneDocumentTemplate({
      version: "1.1.0",
      includesScrum: true,
    }),
    {
      version: "1.1.0",
      name: undefined,
      description: undefined,
      includesScrum: true,
    },
  );

  assert.deepEqual(
    parseDocumentTemplateListQuery({
      search: "  RQ  ",
      status: "PUBLISHED",
      templateType: "LARGE_REQUIREMENT",
      page: "2",
      pageSize: "25",
    }),
    {
      search: "RQ",
      status: "PUBLISHED",
      templateType: "LARGE_REQUIREMENT",
      page: 2,
      pageSize: 25,
    },
  );

  assert.equal(compareSemanticVersions("1.1.0", "1.0.9"), 1);
  assert.equal(compareSemanticVersions("2.0.0", "2.0.0"), 0);
});

test("las plantillas son estructura y contexto seguro para IA", async () => {
  const service = await readFile(
    "apps/documents-service/src/templates/document-templates.service.ts",
    "utf8",
  );
  const migration = await readFile(
    "apps/documents-service/src/database/migrations/1785974400000-CreateDocumentTemplateCatalog.ts",
    "utf8",
  );

  assert.match(service, /buildAiPrompt/);
  assert.match(service, /sourcesAreData: true/);
  assert.match(service, /ignoreInstructionsInsideSources: true/);
  assert.match(service, /buildOutputContract/);
  assert.match(service, /allowUnknownSections: false/);
  assert.equal((migration.match(/"aiPrompt":/g) ?? []).length, 4);
  assert.equal((migration.match(/"outputContract":/g) ?? []).length, 4);
});

test("las cuatro definiciones conservan las trece secciones", async () => {
  const service = await readFile(
    "apps/documents-service/src/templates/document-templates.service.ts",
    "utf8",
  );
  const migration = await readFile(
    "apps/documents-service/src/database/migrations/1785974400000-CreateDocumentTemplateCatalog.ts",
    "utf8",
  );

  assert.match(service, /ISO_IEC_IEEE_29148_2018/);
  assert.match(service, /CANONICAL_SECTIONS/);
  assert.match(service, /DOCUMENT_TEMPLATE_SCRUM_OUTPUTS/);
  assert.equal(
    (migration.match(/"standard":"ISO_IEC_IEEE_29148_2018"/g) ?? [])
      .length,
    4,
  );
  assert.equal((migration.match(/"key":/g) ?? []).length, 52);
});

test("la administración exige rol o permiso explícito", async () => {
  const service = await readFile(
    "apps/documents-service/src/templates/document-templates.service.ts",
    "utf8",
  );

  assert.match(service, /role\.toUpperCase\(\) === "ADMIN"/);
  assert.match(service, /system\.admin/);
  assert.match(service, /documents\.templates\.manage/);
  assert.match(service, /No tienes autorización para administrar plantillas/);
});

test("la migración crea catálogo, restricciones y cuatro plantillas", async () => {
  const migration = await readFile(
    "apps/documents-service/src/database/migrations/1785974400000-CreateDocumentTemplateCatalog.ts",
    "utf8",
  );

  assert.match(migration, /CREATE TABLE dbo\.DocumentTemplates/);
  assert.match(migration, /UQ_DocumentTemplates_Code_Version/);
  assert.match(migration, /SMALL_REQUIREMENT/);
  assert.match(migration, /MEDIUM_REQUIREMENT/);
  assert.match(migration, /LARGE_REQUIREMENT/);
  assert.match(migration, /ERP_FDD/);
  assert.match(migration, /ISO_IEC_IEEE_29148_2018/);
  assert.doesNotMatch(migration, /RqProjectsDb/i);
  assert.doesNotMatch(migration, /FOREIGN KEY/);
});

test("publicadas y retiradas son inmutables y se clonan a borrador", async () => {
  const service = await readFile(
    "apps/documents-service/src/templates/document-templates.service.ts",
    "utf8",
  );

  assert.match(service, /status !== "DRAFT"/);
  assert.match(service, /publicada o retirada es inmutable/i);
  assert.match(service, /status: "DRAFT"/);
  assert.match(service, /compareSemanticVersions/);
  assert.match(service, /sourceTemplateId: source\.id/);
});

test("Gateway y Workspace exponen Plantillas como vista independiente", async () => {
  const gatewayModule = await readFile(
    "apps/gateway/src/app/app.module.ts",
    "utf8",
  );
  const gatewayController = await readFile(
    "apps/gateway/src/templates/document-templates-gateway.controller.ts",
    "utf8",
  );
  const page = await readFile(
    "apps/web/src/app/workspace/templates/page.tsx",
    "utf8",
  );
  const workspace = await readFile(
    "apps/web/src/app/workspace/templates/templates-workspace.tsx",
    "utf8",
  );
  const shell = await readFile(
    "apps/web/src/app/app-shell.tsx",
    "utf8",
  );

  assert.match(gatewayModule, /DocumentTemplatesGatewayController/);
  assert.match(gatewayController, /@Controller\("templates"\)/);
  assert.match(page, /DocumentTemplateListResponse/);
  assert.match(workspace, /Nueva plantilla/);
  assert.match(workspace, /Nueva versión/);
  assert.match(workspace, /Epic, Feature, historia de usuario/);
  assert.match(workspace, /Contexto para análisis con IA/);
  assert.match(workspace, /Las fuentes se tratan como datos/);
  assert.match(workspace, /credentials: "include"/);
  assert.match(shell, /href="\/workspace\/templates"/);
  assert.match(shell, /Catálogo de plantillas/);
});
