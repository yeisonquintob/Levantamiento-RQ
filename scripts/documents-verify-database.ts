import dataSource from "../apps/documents-service/src/database/data-source";

interface CountRow {
  countValue: number | string;
}

async function count(sql: string): Promise<number> {
  const rows = (await dataSource.query(sql)) as CountRow[];
  return Number(rows[0]?.countValue ?? 0);
}

async function main(): Promise<void> {
  await dataSource.initialize();

  try {
    const templatesTable = await count(`
      SELECT COUNT(1) AS countValue
      FROM sys.tables
      WHERE name = 'DocumentTemplates'
        AND schema_id = SCHEMA_ID('dbo')
    `);
    const migration = await count(`
      SELECT COUNT(1) AS countValue
      FROM dbo.migrations
      WHERE name = 'CreateDocumentTemplateCatalog1785974400000'
    `);
    const publishedTemplates = await count(`
      SELECT COUNT(1) AS countValue
      FROM dbo.DocumentTemplates
      WHERE Status = 'PUBLISHED'
    `);
    const canonicalDefinitions = await count(`
      SELECT COUNT(1) AS countValue
      FROM dbo.DocumentTemplates
      WHERE ISJSON(DefinitionJson) = 1
        AND JSON_VALUE(DefinitionJson, '$.standard')
          = 'ISO_IEC_IEEE_29148_2018'
        AND JSON_QUERY(DefinitionJson, '$.sections') IS NOT NULL
    `);
    const uniqueIndex = await count(`
      SELECT COUNT(1) AS countValue
      FROM sys.indexes
      WHERE object_id = OBJECT_ID('dbo.DocumentTemplates')
        AND name = 'UQ_DocumentTemplates_Code_Version'
        AND is_unique = 1
    `);
    const domainMigration = await count(`
      SELECT COUNT(1) AS countValue
      FROM dbo.migrations
      WHERE name = 'CreateRequirementDocumentsDomain1786233600000'
    `);
    const domainTables = await count(`
      SELECT COUNT(1) AS countValue
      FROM sys.tables
      WHERE schema_id = SCHEMA_ID('dbo')
        AND name IN (
          'AppliedDocumentTemplates',
          'RequirementDocuments',
          'DocumentVersions',
          'DocumentSections',
          'DocumentFields',
          'DocumentRequirements',
          'AcceptanceCriteria',
          'DocumentEvidence',
          'DocumentHistory'
        )
    `);
    const versionUniqueIndex = await count(`
      SELECT COUNT(1) AS countValue
      FROM sys.indexes
      WHERE object_id = OBJECT_ID('dbo.DocumentVersions')
        AND name = 'UQ_DocumentVersions_DocumentId_Number'
        AND is_unique = 1
    `);
    const aiApplicationMigration = await count(`
      SELECT COUNT(1) AS countValue
      FROM dbo.migrations
      WHERE name = 'AddAppliedAiAnalysisResults1786665600000'
    `);
    const aiApplicationTable = await count(`
      SELECT COUNT(1) AS countValue
      FROM sys.tables
      WHERE name = 'AppliedAiAnalysisResults'
        AND schema_id = SCHEMA_ID('dbo')
    `);
    const aiResultUniqueIndex = await count(`
      SELECT COUNT(1) AS countValue
      FROM sys.indexes
      WHERE object_id = OBJECT_ID('dbo.AppliedAiAnalysisResults')
        AND name = 'UQ_AppliedAiAnalysisResults_Result'
        AND is_unique = 1
    `);
    const aiApplicationForeignKeys = await count(`
      SELECT COUNT(1) AS countValue
      FROM sys.foreign_keys
      WHERE parent_object_id = OBJECT_ID('dbo.AppliedAiAnalysisResults')
        AND name IN (
          'FK_AppliedAiAnalysisResults_Document',
          'FK_AppliedAiAnalysisResults_Version'
        )
    `);
    const scalarJsonMigration = await count(`
      SELECT COUNT(1) AS countValue
      FROM dbo.migrations
      WHERE name = 'AllowJsonScalarDocumentValues1786838400000'
    `);
    const scalarJsonConstraints = await count(`
      SELECT COUNT(1) AS countValue
      FROM sys.check_constraints
      WHERE name IN (
        'CK_DocumentSections_ContentJson',
        'CK_DocumentFields_ValueJson'
      )
        AND definition LIKE '%CONCAT%'
    `);
    const scrumSectionMigration = await count(`
      SELECT COUNT(1) AS countValue
      FROM dbo.migrations
      WHERE name = 'AllowScrumPlanDocumentSection1786924800000'
    `);
    const scrumSectionConstraint = await count(`
      SELECT COUNT(1) AS countValue
      FROM sys.check_constraints
      WHERE parent_object_id = OBJECT_ID('dbo.DocumentSections')
        AND name = 'CK_DocumentSections_Order'
        AND CHARINDEX('>=(1)', definition) > 0
        AND CHARINDEX('<=(15)', definition) > 0
    `);
    const requestedChangesMigration = await count(`
      SELECT COUNT(1) AS countValue
      FROM dbo.migrations
      WHERE name = 'AllowRequestedChangesDocumentStatus1787007600000'
    `);
    const requestedChangesConstraints = await count(`
      SELECT COUNT(1) AS countValue
      FROM sys.check_constraints
      WHERE name IN (
        'CK_RequirementDocuments_Status',
        'CK_DocumentVersions_Status'
      )
        AND definition LIKE '%CHANGES_REQUESTED%'
    `);
    const currentTemplatesMigration = await count(`
      SELECT COUNT(1) AS countValue
      FROM dbo.migrations
      WHERE name = 'PublishCurrentDocumentTemplateVersions1787007601000'
    `);
    const currentPublishedTemplates = await count(`
      SELECT COUNT(1) AS countValue
      FROM dbo.DocumentTemplates
      WHERE Code IN ('RQ-SMALL', 'RQ-MEDIUM', 'RQ-LARGE', 'ERP-FDD')
        AND Version = '1.3.0'
        AND Status = 'PUBLISHED'
        AND DefinitionJson LIKE '%Presentar en dos grupos%'
        AND DefinitionJson LIKE '%Organizar el backlog canónico%'
        AND DefinitionJson LIKE '%solutionProposal%'
    `);
    const requirementsBacklogMigration = await count(`
      SELECT COUNT(1) AS countValue
      FROM dbo.migrations
      WHERE name = 'PublishRequirementsBacklogTemplateVersions1787875203000'
    `);
    const solutionProposalMigration = await count(`
      SELECT COUNT(1) AS countValue
      FROM dbo.migrations
      WHERE name = 'AddSolutionProposalSection1788470400000'
    `);
    const templateLogosMigration = await count(`
      SELECT COUNT(1) AS countValue
      FROM dbo.migrations
      WHERE name = 'AddDocumentTemplateLogos1787007602000'
    `);
    const templateLogoColumns = await count(`
      SELECT COUNT(1) AS countValue
      FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.DocumentTemplates')
        AND name IN (
          'LogoFileName',
          'LogoMediaType',
          'LogoSizeBytes',
          'LogoData',
          'LogoUpdatedAt',
          'LogoUpdatedByUserId'
        )
    `);
    const templateLogoConstraint = await count(`
      SELECT COUNT(1) AS countValue
      FROM sys.check_constraints
      WHERE parent_object_id = OBJECT_ID('dbo.DocumentTemplates')
        AND name = 'CK_DocumentTemplates_Logo'
        AND definition LIKE '%524288%'
        AND definition LIKE '%image/png%'
        AND definition LIKE '%image/jpeg%'
    `);
    const crossDatabaseForeignKeys = await count(`
      SELECT COUNT(1) AS countValue
      FROM sys.foreign_keys
      WHERE name LIKE 'FK_%Projects%'
         OR name LIKE 'FK_%Sources%'
    `);

    const checks: Readonly<Record<string, readonly [number, number]>> = {
      templatesTable: [templatesTable, 1],
      migration: [migration, 1],
      publishedTemplatesMinimum: [Math.min(publishedTemplates, 4), 4],
      canonicalDefinitionsMinimum: [Math.min(canonicalDefinitions, 4), 4],
      uniqueIndex: [uniqueIndex, 1],
      domainMigration: [domainMigration, 1],
      domainTables: [domainTables, 9],
      versionUniqueIndex: [versionUniqueIndex, 1],
      aiApplicationMigration: [aiApplicationMigration, 1],
      aiApplicationTable: [aiApplicationTable, 1],
      aiResultUniqueIndex: [aiResultUniqueIndex, 1],
      aiApplicationForeignKeys: [aiApplicationForeignKeys, 2],
      scalarJsonMigration: [scalarJsonMigration, 1],
      scalarJsonConstraints: [scalarJsonConstraints, 2],
      scrumSectionMigration: [scrumSectionMigration, 1],
      scrumSectionConstraint: [scrumSectionConstraint, 1],
      requestedChangesMigration: [requestedChangesMigration, 1],
      requestedChangesConstraints: [requestedChangesConstraints, 2],
      currentTemplatesMigration: [currentTemplatesMigration, 1],
      currentPublishedTemplates: [currentPublishedTemplates, 4],
      requirementsBacklogMigration: [requirementsBacklogMigration, 1],
      solutionProposalMigration: [solutionProposalMigration, 1],
      templateLogosMigration: [templateLogosMigration, 1],
      templateLogoColumns: [templateLogoColumns, 6],
      templateLogoConstraint: [templateLogoConstraint, 1],
      crossDatabaseForeignKeys: [crossDatabaseForeignKeys, 0],
    };
    const failedChecks = Object.entries(checks).filter(
      ([, [actual, expected]]) => actual !== expected,
    );

    if (failedChecks.length > 0) {
      throw new Error(
        `RqDocumentsDb no contiene el dominio documental y la aplicación IA completos: ${failedChecks
          .map(
            ([name, [actual, expected]]) =>
              `${name}=${actual} (esperado ${expected})`,
          )
          .join(", ")}.`,
      );
    }

    console.log("RqDocumentsDb verificada correctamente.");
    console.log("Tabla confirmada: dbo.DocumentTemplates");
    console.log("Plantillas publicadas confirmadas: 4");
    console.log("Definiciones canónicas JSON confirmadas.");
    console.log("Índice único confirmado: UQ_DocumentTemplates_Code_Version");
    console.log(
      "Migración confirmada: CreateDocumentTemplateCatalog1785974400000",
    );
    console.log("Tablas del dominio documental confirmadas: 9");
    console.log(
      "Migración confirmada: CreateRequirementDocumentsDomain1786233600000",
    );
    console.log(
      "Aplicación idempotente de resultados IA confirmada: tabla, índice único y 2 claves internas.",
    );
    console.log(
      "Migración confirmada: AddAppliedAiAnalysisResults1786665600000",
    );
    console.log(
      "Valores JSON escalares confirmados en secciones y campos documentales.",
    );
    console.log(
      "Migración confirmada: AllowJsonScalarDocumentValues1786838400000",
    );
    console.log(
      "Plan Scrum confirmado como sección documental opcional número 15.",
    );
    console.log(
      "Migración confirmada: AllowScrumPlanDocumentSection1786924800000",
    );
    console.log(
      "Estado CHANGES_REQUESTED confirmado en documentos y versiones.",
    );
    console.log(
      "Migración confirmada: AllowRequestedChangesDocumentStatus1787007600000",
    );
    console.log(
      "Plantillas 1.3.0 publicadas con solución propuesta y puntos normalizados: 4",
    );
    console.log(
      "Migración confirmada: PublishCurrentDocumentTemplateVersions1787007601000",
    );
    console.log(
      "Migración confirmada: PublishRequirementsBacklogTemplateVersions1787875203000",
    );
    console.log(
      "Migración confirmada: AddSolutionProposalSection1788470400000",
    );
    console.log(
      "Logos de plantilla confirmados: 6 columnas, formato y límite de 512 KB.",
    );
    console.log("Migración confirmada: AddDocumentTemplateLogos1787007602000");
    console.log("Versionado único y autonomía de base de datos confirmados.");
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`No se pudo verificar RqDocumentsDb: ${message}`);
  process.exitCode = 1;
});
