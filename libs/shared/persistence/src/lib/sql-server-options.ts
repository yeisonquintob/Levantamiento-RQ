import { DataSource, type DataSourceOptions } from "typeorm";

import type {
  EnabledSqlServerDatabaseConfig,
  SqlServerDatabaseConfig,
} from "./sql-server-config.js";

export interface SqlServerDataSourcePaths {
  entities?: readonly string[];
  migrations?: readonly string[];
}

function requireEnabledConfig(
  config: SqlServerDatabaseConfig,
): EnabledSqlServerDatabaseConfig {
  if (!config.enabled) {
    throw new Error(
      `La persistencia de ${config.serviceName} está deshabilitada. ` +
        "Define DATABASE_ENABLED=true para utilizar la conexión.",
    );
  }

  return config;
}

export function createSqlServerDataSourceOptions(
  config: SqlServerDatabaseConfig,
  paths: SqlServerDataSourcePaths = {},
): DataSourceOptions {
  const enabledConfig = requireEnabledConfig(config);

  return {
    type: "mssql",
    host: enabledConfig.host,
    port: enabledConfig.port,
    username: enabledConfig.username,
    password: enabledConfig.password,
    database: enabledConfig.databaseName,
    synchronize: false,
    dropSchema: false,
    migrationsRun: false,
    logging: enabledConfig.logging,
    entities: [...(paths.entities ?? [])],
    migrations: [...(paths.migrations ?? [])],
    connectionTimeout: enabledConfig.connectionTimeoutMs,
    requestTimeout: enabledConfig.requestTimeoutMs,
    pool: {
      min: enabledConfig.poolMin,
      max: enabledConfig.poolMax,
    },
    options: {
      encrypt: enabledConfig.encrypt,
      trustServerCertificate: enabledConfig.trustServerCertificate,
    },
  };
}

export function createSqlServerDataSource(
  config: SqlServerDatabaseConfig,
  paths: SqlServerDataSourcePaths = {},
): DataSource {
  return new DataSource(createSqlServerDataSourceOptions(config, paths));
}
