import dataSource from "../apps/sources-service/src/database/data-source";

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
    const sourcesTable = await count(`
      SELECT COUNT(1) AS countValue
      FROM sys.tables
      WHERE name = 'Sources' AND schema_id = SCHEMA_ID('dbo')
    `);
    const projectIndex = await count(`
      SELECT COUNT(1) AS countValue
      FROM sys.indexes
      WHERE name = 'IX_Sources_ProjectId_Status_UpdatedAt'
    `);
    const typeIndex = await count(`
      SELECT COUNT(1) AS countValue
      FROM sys.indexes
      WHERE name = 'IX_Sources_ProjectId_SourceType'
    `);
    const processingIndex = await count(`
      SELECT COUNT(1) AS countValue
      FROM sys.indexes
      WHERE name = 'IX_Sources_ProjectId_ProcessingStatus'
    `);
    const duplicateIndex = await count(`
      SELECT COUNT(1) AS countValue
      FROM sys.indexes
      WHERE name = 'UX_Sources_ProjectId_Sha256_ActiveFile'
    `);
    const newColumns = await count(`
      SELECT COUNT(1) AS countValue
      FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.Sources')
        AND name IN (
          'ProcessingMessage',
          'ProcessedAt',
          'FileExtension',
          'PageCount',
          'SheetCount'
        )
    `);
    const foundationMigration = await count(`
      SELECT COUNT(1) AS countValue
      FROM dbo.migrations
      WHERE name = 'CreateSourcesFoundation1785801600000'
    `);
    const filesMigration = await count(`
      SELECT COUNT(1) AS countValue
      FROM dbo.migrations
      WHERE name = 'AddSourceFilesAndExtraction1785888000000'
    `);
    const metadataMigration = await count(`
      SELECT COUNT(1) AS countValue
      FROM dbo.migrations
      WHERE name = 'AddSourceClassificationAndDescription1786060801000'
    `);
    const metadataColumns = await count(`
      SELECT COUNT(1) AS countValue
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'Sources'
        AND COLUMN_NAME IN ('Description', 'Classification')
    `);
    const classificationIndex = await count(`
      SELECT COUNT(1) AS countValue
      FROM sys.indexes
      WHERE name = 'IX_Sources_ProjectId_Classification'
        AND object_id = OBJECT_ID('dbo.Sources')
    `);

    if (
      sourcesTable !== 1 ||
      projectIndex !== 1 ||
      typeIndex !== 1 ||
      processingIndex !== 1 ||
      duplicateIndex !== 1 ||
      newColumns !== 5 ||
      foundationMigration !== 1 ||
      filesMigration !== 1 ||
      metadataMigration !== 1 ||
      metadataColumns !== 2 ||
      classificationIndex !== 1
    ) {
      throw new Error(
        "RqSourcesDb no contiene la estructura completa del Paso 13.",
      );
    }

    console.log("RqSourcesDb verificada correctamente.");
    console.log("Tabla confirmada: dbo.Sources");
    console.log("Columnas de archivo y extracción confirmadas: 5");
    console.log("Índice confirmado: IX_Sources_ProjectId_Status_UpdatedAt");
    console.log("Índice confirmado: IX_Sources_ProjectId_SourceType");
    console.log("Índice confirmado: IX_Sources_ProjectId_ProcessingStatus");
    console.log("Índice único confirmado: UX_Sources_ProjectId_Sha256_ActiveFile");
    console.log("Migración confirmada: CreateSourcesFoundation1785801600000");
    console.log("Migración confirmada: AddSourceFilesAndExtraction1785888000000");
    console.log(
      "Migración confirmada: AddSourceClassificationAndDescription1786060801000",
    );
    console.log("Clasificación y descripción de archivos confirmadas.");
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`No se pudo verificar RqSourcesDb: ${message}`);
  process.exitCode = 1;
});
