// RQ_PROTOTYPES_LOCAL_V1
import dataSource from "../apps/prototypes-service/src/database/data-source.js";

async function main(): Promise<void> {
  await dataSource.initialize();

  try {
    const migrations = await dataSource.runMigrations({
      transaction: "all",
    });

    console.log(`Migraciones de Prototypes aplicadas: ${migrations.length}`);
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(
    `No se pudieron aplicar migraciones de RqPrototypesDb: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});
