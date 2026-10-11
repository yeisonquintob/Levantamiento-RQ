import { join, resolve } from "node:path";
import { loadEnvironmentFiles } from "@levantamiento-rq/shared-config";
import {
  createSqlServerDataSource,
  loadSqlServerDatabaseConfig,
} from "@levantamiento-rq/shared-persistence";
loadEnvironmentFiles({
  paths: [".env", "infrastructure/docker/.env", "apps/prototypes-service/.env"],
});
const directory = resolve(
  process.cwd(),
  "apps/prototypes-service/src/database",
);
export default createSqlServerDataSource(
  loadSqlServerDatabaseConfig({
    serviceName: "prototypes-service",
    defaultDatabaseName: "RqPrototypesDb",
  }),
  {
    entities: [join(directory, "../**/*.entity.{ts,js}")],
    migrations: [join(directory, "migrations/*.{ts,js}")],
  },
);
