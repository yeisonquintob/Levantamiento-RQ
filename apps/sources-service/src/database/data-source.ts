import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvironmentFiles } from "@levantamiento-rq/shared-config";
import {
  createSqlServerDataSource,
  loadSqlServerDatabaseConfig,
} from "@levantamiento-rq/shared-persistence";

loadEnvironmentFiles({
  paths: [".env", "apps/sources-service/.env"],
});

const currentDirectory = dirname(fileURLToPath(import.meta.url));

const config = loadSqlServerDatabaseConfig({
  serviceName: "sources-service",
  defaultDatabaseName: "RqSourcesDb",
});

export default createSqlServerDataSource(config, {
  entities: [join(currentDirectory, "../**/*.entity.{ts,js}")],
  migrations: [join(currentDirectory, "migrations/*.{ts,js}")],
});
