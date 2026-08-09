import { join, resolve } from "node:path";

import { loadEnvironmentFiles } from "@levantamiento-rq/shared-config";
import {
  createSqlServerDataSource,
  loadSqlServerDatabaseConfig,
} from "@levantamiento-rq/shared-persistence";

loadEnvironmentFiles({
  paths: [".env", "apps/operations-service/.env"],
});

const currentDirectory = resolve(
  process.cwd(),
  "apps/operations-service/src/database",
);

const config = loadSqlServerDatabaseConfig({
  serviceName: "operations-service",
  defaultDatabaseName: "RqOperationsDb",
});

export default createSqlServerDataSource(config, {
  entities: [join(currentDirectory, "../**/*.{entity,entities}.{ts,js}")],
  migrations: [join(currentDirectory, "migrations/*.{ts,js}")],
});
