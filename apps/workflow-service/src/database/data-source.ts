import { join, resolve } from "node:path";

import { loadEnvironmentFiles } from "@levantamiento-rq/shared-config";
import {
  createSqlServerDataSource,
  loadSqlServerDatabaseConfig,
} from "@levantamiento-rq/shared-persistence";

loadEnvironmentFiles({
  paths: [".env", "apps/workflow-service/.env"],
});

const currentDirectory = resolve(
  process.cwd(),
  "apps/workflow-service/src/database",
);

const config = loadSqlServerDatabaseConfig({
  serviceName: "workflow-service",
  defaultDatabaseName: "RqWorkflowDb",
});

export default createSqlServerDataSource(config, {
  entities: [join(currentDirectory, "../**/*.entity.{ts,js}")],
  migrations: [join(currentDirectory, "migrations/*.{ts,js}")],
});
