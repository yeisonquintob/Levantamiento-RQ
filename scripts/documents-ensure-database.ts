import { DataSource } from "typeorm";

import { loadEnvironmentFiles } from "../libs/shared/config/src/index.js";
import { loadSqlServerDatabaseConfig } from "../libs/shared/persistence/src/index.js";

loadEnvironmentFiles({
  paths: [".env", "apps/documents-service/.env"],
});

function readBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

async function main(): Promise<void> {
  const config = loadSqlServerDatabaseConfig({
    serviceName: "documents-service",
    defaultDatabaseName: "RqDocumentsDb",
  });

  if (!config.enabled) {
    throw new Error("DATABASE_ENABLED debe ser true.");
  }

  if (!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(config.databaseName)) {
    throw new Error("DB_NAME contiene caracteres no permitidos.");
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

    if (rows[0]?.databaseId) {
      console.log(`Base confirmada: ${config.databaseName}`);
      return;
    }

    if (!readBoolean(process.env.DOCUMENTS_CREATE_DATABASE)) {
      throw new Error(
        `La base ${config.databaseName} no existe y su creación no fue autorizada.`,
      );
    }

    await master.query(`CREATE DATABASE [${config.databaseName}]`);

    for (let attempt = 1; attempt <= 30; attempt += 1) {
      const stateRows = (await master.query(
        `
          SELECT state_desc AS stateDescription
          FROM sys.databases
          WHERE name = @0
        `,
        [config.databaseName],
      )) as Array<{ stateDescription: string }>;

      if (stateRows[0]?.stateDescription === "ONLINE") {
        console.log(`Base creada y disponible: ${config.databaseName}`);
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error(
      `La base ${config.databaseName} fue creada, pero no quedó ONLINE a tiempo.`,
    );
  } finally {
    await master.destroy();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`No se pudo confirmar la base de documentos: ${message}`);
  process.exitCode = 1;
});

