import { join, resolve } from "node:path";

import { loadEnvironmentFiles } from "@levantamiento-rq/shared-config";
import {
  createSqlServerDataSource,
  loadSqlServerDatabaseConfig,
} from "@levantamiento-rq/shared-persistence";

loadEnvironmentFiles({
  paths: [".env", "apps/documents-service/.env"],
});

const currentDirectory = resolve(
  process.cwd(),
  "apps/documents-service/src/database",
);

const config = loadSqlServerDatabaseConfig({
  serviceName: "documents-service",
  defaultDatabaseName: "RqDocumentsDb",
});

export default createSqlServerDataSource(config, {
  entities: [join(currentDirectory, "../**/*.entity.{ts,js}")],
  migrations: [join(currentDirectory, "migrations/*.{ts,js}")],
});
