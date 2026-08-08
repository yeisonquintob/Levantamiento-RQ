import dataSource from "../apps/workflow-service/src/database/data-source";

async function main(): Promise<void> {
  await dataSource.initialize();

  try {
    await dataSource.undoLastMigration({ transaction: "all" });
    console.log("Última migración de Workflow revertida.");
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`No se pudo revertir la migración de Workflow: ${message}`);
  process.exitCode = 1;
});
