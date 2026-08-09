import { DataSource } from "typeorm";

import { loadSqlServerDatabaseConfig } from "../libs/shared/persistence/src/index.js";

async function main(): Promise<void> {
  const config = loadSqlServerDatabaseConfig({
    serviceName: "operations-service",
    defaultDatabaseName: "RqOperationsDb",
  });
  if (!config.enabled) throw new Error("DATABASE_ENABLED debe ser true.");
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
    pool: { min: 0, max: Math.max(1, config.poolMax) },
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
    if (process.env.OPERATIONS_CREATE_DATABASE?.toLowerCase() !== "true") {
      throw new Error(
        `La base ${config.databaseName} no existe y su creación no fue autorizada.`,
      );
    }
    await master.query(`CREATE DATABASE [${config.databaseName}]`);
    console.log(`Base creada: ${config.databaseName}`);
  } finally {
    await master.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(
    `No se pudo confirmar RqOperationsDb: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
