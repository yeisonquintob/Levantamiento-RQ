import dataSource from "../apps/operations-service/src/database/data-source.js";

async function main(): Promise<void> {
  if (process.env.OPERATIONS_ALLOW_MIGRATION_REVERT?.toLowerCase() !== "true") {
    throw new Error(
      "OPERATIONS_ALLOW_MIGRATION_REVERT=true es obligatorio para revertir.",
    );
  }
  await dataSource.initialize();
  try {
    await dataSource.undoLastMigration({ transaction: "all" });
    console.log("Última migración de Operations revertida.");
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(
    `No se pudo revertir Operations: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
