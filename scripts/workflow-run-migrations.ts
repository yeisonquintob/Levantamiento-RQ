import dataSource from "../apps/workflow-service/src/database/data-source";

async function main(): Promise<void> {
  await dataSource.initialize();

  try {
    const migrations = await dataSource.runMigrations({
      transaction: "all",
    });

    console.log(`Migraciones de Workflow aplicadas: ${migrations.length}`);
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(
    `No se pudieron aplicar las migraciones de Workflow: ${message}`,
  );
  process.exitCode = 1;
});
