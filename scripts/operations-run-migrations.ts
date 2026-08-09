import dataSource from "../apps/operations-service/src/database/data-source.js";

async function main(): Promise<void> {
  await dataSource.initialize();
  try {
    const migrations = await dataSource.runMigrations({ transaction: "all" });
    console.log(
      migrations.length
        ? `Migraciones aplicadas: ${migrations.map((item) => item.name).join(", ")}`
        : "RqOperationsDb ya estaba actualizada.",
    );
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(
    `No se pudieron aplicar migraciones de Operations: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
