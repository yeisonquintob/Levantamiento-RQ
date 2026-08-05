import { join, resolve } from "node:path";

import { loadEnvironmentFiles } from "@levantamiento-rq/shared-config";
import {
  createSqlServerDataSource,
  loadSqlServerDatabaseConfig,
} from "@levantamiento-rq/shared-persistence";

loadEnvironmentFiles({
  paths: [".env", "apps/identity-service/.env"],
});

const currentDirectory = resolve(
  process.cwd(),
  "apps/identity-service/src/database",
);

const config = loadSqlServerDatabaseConfig({
  serviceName: "identity-service",
  defaultDatabaseName: "RqIdentityDb",
});

export default createSqlServerDataSource(config, {
  entities: [join(currentDirectory, "../**/*.entity.{ts,js}")],
  migrations: [join(currentDirectory, "migrations/*.{ts,js}")],
});
