import dataSource from "../apps/projects-service/src/database/data-source";

async function main(): Promise<void> {
  await dataSource.initialize();

  try {
    const migrations = await dataSource.runMigrations({
      transaction: "all",
    });

    console.log(`Migraciones de proyectos aplicadas: ${migrations.length}`);
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`No se pudieron aplicar las migraciones: ${message}`);
  process.exitCode = 1;
});
