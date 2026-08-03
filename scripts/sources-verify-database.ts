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
    const migration = await count(`
      SELECT COUNT(1) AS countValue
      FROM dbo.migrations
      WHERE name = 'CreateSourcesFoundation1785801600000'
    `);

    if (
      sourcesTable !== 1 ||
      projectIndex !== 1 ||
      typeIndex !== 1 ||
      migration !== 1
    ) {
      throw new Error(
        "RqSourcesDb no contiene la estructura completa del Paso 13.1.",
      );
    }

    console.log("RqSourcesDb verificada correctamente.");
    console.log("Tabla confirmada: dbo.Sources");
    console.log("Índice confirmado: IX_Sources_ProjectId_Status_UpdatedAt");
    console.log("Índice confirmado: IX_Sources_ProjectId_SourceType");
    console.log("Migración confirmada: CreateSourcesFoundation1785801600000");
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`No se pudo verificar RqSourcesDb: ${message}`);
  process.exitCode = 1;
});
