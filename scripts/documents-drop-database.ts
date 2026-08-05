import { DataSource } from "typeorm";

import { loadEnvironmentFiles } from "../libs/shared/config/src/index.js";
import { loadSqlServerDatabaseConfig } from "../libs/shared/persistence/src/index.js";

loadEnvironmentFiles({
  paths: [".env", "apps/documents-service/.env"],
});

async function main(): Promise<void> {
  if (process.env.DOCUMENTS_DROP_DATABASE !== "CONFIRM_DROP_RQDOCUMENTSDB") {
    throw new Error("La eliminación de RqDocumentsDb no fue autorizada.");
  }

  const config = loadSqlServerDatabaseConfig({
    serviceName: "documents-service",
    defaultDatabaseName: "RqDocumentsDb",
  });

  if (!config.enabled) {
    throw new Error("DATABASE_ENABLED debe ser true.");
  }

  if (config.databaseName !== "RqDocumentsDb") {
    throw new Error("Solo se permite eliminar RqDocumentsDb.");
  }

  const master = new DataSource({
    type: "mssql",
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
    database: "master",
    synchronize: false,
    dropSchema: false,
    migrationsRun: false,
    logging: false,
    entities: [],
    migrations: [],
    connectionTimeout: config.connectionTimeoutMs,
    requestTimeout: config.requestTimeoutMs,
    pool: {
      min: 0,
      max: Math.max(1, config.poolMax),
    },
    options: {
      encrypt: config.encrypt,
      trustServerCertificate: config.trustServerCertificate,
    },
  });

  await master.initialize();

  try {
    const rows = (await master.query("SELECT DB_ID(@0) AS databaseId", [
      config.databaseName,
    ])) as Array<{ databaseId: number | null }>;

    if (!rows[0]?.databaseId) {
      console.log("RqDocumentsDb no existe; no fue necesario eliminarla.");
      return;
    }

    await master.query(`
      ALTER DATABASE [RqDocumentsDb] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
      DROP DATABASE [RqDocumentsDb];
    `);

    console.log("RqDocumentsDb eliminada durante la reversión controlada.");
  } finally {
    await master.destroy();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`No se pudo eliminar RqDocumentsDb: ${message}`);
  process.exitCode = 1;
});
