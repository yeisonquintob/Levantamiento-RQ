import dataSource from "../apps/operations-service/src/database/data-source.js";

async function main(): Promise<void> {
  await dataSource.initialize();
  try {
    const rows = (await dataSource.query(`
      SELECT DB_NAME() AS databaseName,
        (SELECT COUNT(1) FROM sys.tables WHERE schema_id = SCHEMA_ID('dbo')) AS tableCount,
        (SELECT COUNT(1) FROM dbo.migrations) AS migrationCount
    `)) as Array<{
      databaseName: string;
      tableCount: number;
      migrationCount: number;
    }>;
    console.log(JSON.stringify(rows[0] ?? {}, null, 2));
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(
    `No se pudo consultar RqOperationsDb: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
