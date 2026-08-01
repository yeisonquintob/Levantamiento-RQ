import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvironmentFiles } from "@levantamiento-rq/shared-config";
import {
  createSqlServerDataSource,
  loadSqlServerDatabaseConfig,
} from "@levantamiento-rq/shared-persistence";

loadEnvironmentFiles({
  paths: [".env", "apps/documents-service/.env"],
});

const currentDirectory = dirname(fileURLToPath(import.meta.url));

const config = loadSqlServerDatabaseConfig({
  serviceName: "documents-service",
  defaultDatabaseName: "RqDocumentsDb",
});

export default createSqlServerDataSource(config, {
  entities: [join(currentDirectory, "../**/*.entity.{ts,js}")],
  migrations: [join(currentDirectory, "migrations/*.{ts,js}")],
});
