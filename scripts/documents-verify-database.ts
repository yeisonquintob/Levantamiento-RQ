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
    const crossDatabaseForeignKeys = await count(`
      SELECT COUNT(1) AS countValue
      FROM sys.foreign_keys
      WHERE name LIKE 'FK_%Projects%'
         OR name LIKE 'FK_%Sources%'
    `);

    if (
      templatesTable !== 1 ||
      migration !== 1 ||
      publishedTemplates < 4 ||
      canonicalDefinitions < 4 ||
      uniqueIndex !== 1 ||
      domainMigration !== 1 ||
      domainTables !== 9 ||
      versionUniqueIndex !== 1 ||
      crossDatabaseForeignKeys !== 0
    ) {
      throw new Error(
        "RqDocumentsDb no contiene el catálogo completo del Paso 14.",
      );
    }

    console.log("RqDocumentsDb verificada correctamente.");
    console.log("Tabla confirmada: dbo.DocumentTemplates");
    console.log("Plantillas publicadas confirmadas: 4");
    console.log("Definiciones canónicas JSON confirmadas.");
    console.log(
      "Índice único confirmado: UQ_DocumentTemplates_Code_Version",
    );
    console.log(
      "Migración confirmada: CreateDocumentTemplateCatalog1785974400000",
    );
    console.log("Tablas del dominio documental confirmadas: 9");
    console.log(
      "Migración confirmada: CreateRequirementDocumentsDomain1786233600000",
    );
    console.log("Versionado único y autonomía de base de datos confirmados.");
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : String(error);

  console.error(`No se pudo verificar RqDocumentsDb: ${message}`);
  process.exitCode = 1;
});
