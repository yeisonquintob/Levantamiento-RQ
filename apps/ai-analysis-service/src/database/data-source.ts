import { join, resolve } from "node:path";

import { loadEnvironmentFiles } from "@levantamiento-rq/shared-config";
import {
  createSqlServerDataSource,
  loadSqlServerDatabaseConfig,
} from "@levantamiento-rq/shared-persistence";

loadEnvironmentFiles({
  paths: [".env", "apps/ai-analysis-service/.env"],
});

const currentDirectory = resolve(
  process.cwd(),
  "apps/ai-analysis-service/src/database",
);

const config = loadSqlServerDatabaseConfig({
  serviceName: "ai-analysis-service",
  defaultDatabaseName: "RqAiDb",
});

export default createSqlServerDataSource(config, {
  entities: [join(currentDirectory, "../**/*.entity.{ts,js}")],
  migrations: [join(currentDirectory, "migrations/*.{ts,js}")],
});
