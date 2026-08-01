import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvironmentFiles } from "@levantamiento-rq/shared-config";
import {
  createSqlServerDataSource,
  loadSqlServerDatabaseConfig,
} from "@levantamiento-rq/shared-persistence";

loadEnvironmentFiles({
  paths: [".env", "apps/identity-service/.env"],
});

const currentDirectory = dirname(fileURLToPath(import.meta.url));

const config = loadSqlServerDatabaseConfig({
  serviceName: "identity-service",
  defaultDatabaseName: "RqIdentityDb",
});

export default createSqlServerDataSource(config, {
  entities: [join(currentDirectory, "../**/*.entity.{ts,js}")],
  migrations: [join(currentDirectory, "migrations/*.{ts,js}")],
});
