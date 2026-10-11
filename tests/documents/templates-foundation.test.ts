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
  parseUpdateDocumentTemplateLogo,
} from "../../apps/documents-service/src/templates/document-templates-input.js";
import {
  defaultSidebarConfiguration,
  SIDEBAR_MENU_DEFINITIONS,
} from "../../apps/web/src/app/sidebar-navigation.js";

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
      sections: undefined,
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

test("las plantillas Scrum incorporan el punto 15 de planificación", async () => {
  const service = await readFile(
    "apps/documents-service/src/templates/document-templates.service.ts",
    "utf8",
  );
  assert.match(service, /DOCUMENT_SCRUM_SECTION_DEFINITION/);
  assert.match(service, /15 días calendario/i);
  assert.match(service, /synchronizeScrumPlanSection/);
});

test("las cuatro plantillas publican una versión actualizada con el estándar vigente", async () => {
  const migration = await readFile(
    "apps/documents-service/src/database/migrations/1787007601000-PublishCurrentDocumentTemplateVersions.ts",
    "utf8",
  );

  for (const code of ["RQ-SMALL", "RQ-MEDIUM", "RQ-LARGE", "ERP-FDD"]) {
    assert.match(migration, new RegExp(code));
  }
  assert.match(migration, /N'1\.1\.0'/);
  assert.match(
    migration,
    /objetivos específicos cualitativos y cuantitativos/i,
  );
  assert.match(migration, /exactamente tres KPI/i);
  assert.match(migration, /quién elabora, quién revisa, quién aprueba/i);
  assert.match(migration, /SET Status = N'RETIRED'/);
});

test("la versión 1.3 agrega solución y mueve Scrum al punto 15", async () => {
  const migration = await readFile(
    "apps/documents-service/src/database/migrations/1788470400000-AddSolutionProposalSection.ts",
    "utf8",
  );

  assert.match(migration, /Version = N'1\.3\.0'/u);
  assert.match(migration, /solutionProposal/u);
  assert.match(migration, /Solución propuesta del profesional de soluciones/u);
  assert.match(migration, /OrderIndex BETWEEN 1 AND 15/u);
  assert.match(
    migration,
    /responsables se registran exclusivamente en Aprobaciones/u,
  );
  assert.match(
    migration,
    /un único control de cambio solo cuando la versión sea aprobada/u,
  );
});

test("la actualización exige al menos un campo", () => {
  assert.throws(() => parseUpdateDocumentTemplate({}), /al menos un campo/i);
});

test("el logo de plantilla valida formato, firma y límite antes de persistir", async () => {
  assert.deepEqual(
    parseUpdateDocumentTemplateLogo({
      fileName: " marca.png ",
      mediaType: "image/png",
      dataBase64: "iVBORw0KGgo=",
    }),
    {
      fileName: "marca.png",
      mediaType: "image/png",
      dataBase64: "iVBORw0KGgo=",
    },
  );
  assert.throws(
    () =>
      parseUpdateDocumentTemplateLogo({
        fileName: "marca.jpg",
        mediaType: "image/jpeg",
        dataBase64: "iVBORw0KGgo=",
      }),
    /no coincide/i,
  );

  const migration = await readFile(
    "apps/documents-service/src/database/migrations/1787007602000-AddDocumentTemplateLogos.ts",
    "utf8",
  );
  assert.match(migration, /LogoData varbinary\(max\)/);
  assert.match(migration, /524288/);
});

test("los puntos se pueden editar, agregar, eliminar y reordenar", () => {
  assert.deepEqual(
    parseUpdateDocumentTemplate({
      sections: [
        {
          key: "header",
          order: 9,
          title: " Encabezado ajustado ",
          required: true,
          guidance: " Registrar X, Y y Z. ",
        },
        {
          key: "customSectionOne",
          order: 4,
          title: " Punto adicional ",
          required: false,
          guidance: " Analizar una nueva regla de negocio. ",
        },
      ],
    }),
    {
      sections: [
        {
          key: "header",
          order: 1,
          title: "Encabezado ajustado",
          required: true,
          guidance: "Registrar X, Y y Z.",
        },
        {
          key: "customSectionOne",
          order: 2,
          title: "Punto adicional",
          required: false,
          guidance: "Analizar una nueva regla de negocio.",
        },
      ],
    },
  );

  assert.throws(
    () =>
      parseUpdateDocumentTemplate({
        sections: [
          {
            key: "repeatedKey",
            title: "Uno",
            required: true,
            guidance: "Guía uno",
          },
          {
            key: "repeatedKey",
            title: "Dos",
            required: true,
            guidance: "Guía dos",
          },
        ],
      }),
    /repetida/i,
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
      sections: undefined,
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

test("las plantillas iniciales parten de trece puntos y los borradores son flexibles", async () => {
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
  assert.match(service, /MAX_TEMPLATE_SECTIONS = 50/);
  assert.match(service, /withSections/);
  assert.match(service, /getManyAndCount/);
  assert.match(service, /requiredIso/);
  assert.equal(
    (migration.match(/"standard":"ISO_IEC_IEEE_29148_2018"/g) ?? []).length,
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

test("Gateway y Configuración exponen Plantillas sin duplicar su lógica", async () => {
  const gatewayModule = await readFile(
    "apps/gateway/src/app/app.module.ts",
    "utf8",
  );
  const gatewayController = await readFile(
    "apps/gateway/src/templates/document-templates-gateway.controller.ts",
    "utf8",
  );
  const documentsController = await readFile(
    "apps/documents-service/src/templates/document-templates.controller.ts",
    "utf8",
  );
  const documentsService = await readFile(
    "apps/documents-service/src/templates/document-templates.service.ts",
    "utf8",
  );
  const page = await readFile(
    "apps/web/src/app/workspace/settings/templates/page.tsx",
    "utf8",
  );
  const workspace = await readFile(
    "apps/web/src/app/workspace/templates/templates-workspace.tsx",
    "utf8",
  );
  const shell = await readFile("apps/web/src/app/app-shell.tsx", "utf8");

  assert.match(gatewayModule, /DocumentTemplatesGatewayController/);
  assert.match(gatewayController, /@Controller\("templates"\)/);
  assert.match(gatewayController, /@Get\(":templateId\/logo"\)/);
  assert.match(gatewayController, /@Put\(":templateId\/logo"\)/);
  assert.match(documentsController, /@Put\(":templateId\/logo"\)/);
  assert.match(documentsService, /async updateLogo/);
  assert.match(page, /DocumentTemplateListResponse/);
  assert.match(workspace, /Nueva plantilla/);
  assert.match(workspace, /Nueva versión/);
  assert.match(workspace, /Epic, Feature, historia de usuario/);
  assert.match(workspace, /Contexto para análisis con IA/);
  assert.match(workspace, /Las fuentes se tratan como datos/);
  assert.match(workspace, /Puntos de la plantilla/);
  assert.match(workspace, /Agregar punto/);
  assert.match(workspace, /moveSection/);
  assert.match(workspace, /removeSection/);
  assert.match(workspace, /payload\.detail/);
  assert.match(workspace, /Editar logo de plantilla/);
  assert.match(workspace, /Guardar logo/);
  assert.match(workspace, /credentials: "include"/);
  assert.doesNotMatch(shell, /href="\/workspace\/templates"/);
  assert.match(shell, /Catálogo de plantillas/);
  // El menú ya no está escrito en app-shell.tsx: Configuración (que contiene
  // Plantillas) es un menú definido y colocado en la sección Administración,
  // después de Validación, en la configuración del menú lateral.
  assert.match(shell, /SIDEBAR_MENU_DEFINITIONS/);
  const definitions = new Map(
    SIDEBAR_MENU_DEFINITIONS.map((menu) => [menu.id, menu.href]),
  );
  assert.equal(definitions.get("settings"), "/workspace/settings");
  assert.ok(
    ![...definitions.values()].includes("/workspace/templates"),
    "Plantillas no debe ser un menú propio del sidebar",
  );
  const configuration = defaultSidebarConfiguration();
  const sectionOrder = configuration.sections.map((section) => section.id);
  const sectionOf = (id: string) =>
    configuration.menus.find((menu) => menu.id === id)?.sectionId ?? "";
  assert.equal(sectionOf("settings"), "administration");
  assert.ok(
    sectionOrder.indexOf(sectionOf("validation")) <
      sectionOrder.indexOf("administration"),
  );
});
