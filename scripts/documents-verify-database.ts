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

    if (
      templatesTable !== 1 ||
      migration !== 1 ||
      publishedTemplates < 4 ||
      canonicalDefinitions < 4 ||
      uniqueIndex !== 1
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
