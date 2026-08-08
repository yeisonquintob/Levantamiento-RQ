import { DataSource } from "typeorm";

import { loadEnvironmentFiles } from "../libs/shared/config/src/index.js";
import { loadSqlServerDatabaseConfig } from "../libs/shared/persistence/src/index.js";

loadEnvironmentFiles({
  paths: [".env", "apps/workflow-service/.env"],
});

function options(
  database: string,
): ConstructorParameters<typeof DataSource>[0] {
  const config = loadSqlServerDatabaseConfig({
    serviceName: "workflow-service",
    defaultDatabaseName: "RqWorkflowDb",
  });

  if (!config.enabled) {
    throw new Error("DATABASE_ENABLED debe ser true.");
  }

  return {
    type: "mssql",
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
    database,
    synchronize: false,
    dropSchema: false,
    migrationsRun: false,
    logging: false,
    entities: [],
    migrations: [],
    connectionTimeout: config.connectionTimeoutMs,
    requestTimeout: config.requestTimeoutMs,
    pool: { min: 0, max: Math.max(1, config.poolMax) },
    options: {
      encrypt: config.encrypt,
      trustServerCertificate: config.trustServerCertificate,
    },
  };
}

async function main(): Promise<void> {
  const config = loadSqlServerDatabaseConfig({
    serviceName: "workflow-service",
    defaultDatabaseName: "RqWorkflowDb",
  });
  const master = new DataSource(options("master"));
  await master.initialize();

  let databaseExists = false;

  try {
    const rows = (await master.query("SELECT DB_ID(@0) AS databaseId", [
      config.databaseName,
    ])) as Array<{ databaseId: number | null }>;
    databaseExists = Boolean(rows[0]?.databaseId);
  } finally {
    await master.destroy();
  }

  let migrationExists = false;

  if (databaseExists) {
    const workflowDatabase = new DataSource(options(config.databaseName));
    await workflowDatabase.initialize();

    try {
      const rows = (await workflowDatabase.query(`
        IF OBJECT_ID('dbo.migrations', 'U') IS NULL
          SELECT CAST(0 AS int) AS migrationCount;
        ELSE
          SELECT COUNT(1) AS migrationCount
          FROM dbo.migrations
          WHERE name = 'CreateWorkflowFoundation1786406400000';
      `)) as Array<{ migrationCount: number | string }>;
      migrationExists = Number(rows[0]?.migrationCount ?? 0) > 0;
    } finally {
      await workflowDatabase.destroy();
    }
  }

  console.log(JSON.stringify({ databaseExists, migrationExists }));
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`No se pudo consultar el estado de RqWorkflowDb: ${message}`);
  process.exitCode = 1;
});
