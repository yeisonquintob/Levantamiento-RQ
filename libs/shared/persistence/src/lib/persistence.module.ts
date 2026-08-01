import { DynamicModule, Logger, Module } from "@nestjs/common";
import { TypeOrmModule, type TypeOrmModuleOptions } from "@nestjs/typeorm";

import {
  loadSqlServerDatabaseConfig,
  type SqlServerDatabaseConfigInput,
} from "./sql-server-config.js";
import { createSqlServerDataSourceOptions } from "./sql-server-options.js";

export const SQL_SERVER_DATABASE_CONFIG = Symbol("SQL_SERVER_DATABASE_CONFIG");

export type PersistenceModuleOptions = SqlServerDatabaseConfigInput;

@Module({})
export class PersistenceModule {
  static register(input: PersistenceModuleOptions): DynamicModule {
    const config = loadSqlServerDatabaseConfig(input);

    if (!config.enabled) {
      Logger.log(
        `Persistencia deshabilitada para ${input.serviceName}.`,
        "PersistenceModule",
      );

      return {
        module: PersistenceModule,
        providers: [
          {
            provide: SQL_SERVER_DATABASE_CONFIG,
            useValue: config,
          },
        ],
        exports: [SQL_SERVER_DATABASE_CONFIG],
      };
    }

    const typeOrmOptions = {
      ...createSqlServerDataSourceOptions(config),
      autoLoadEntities: true,
    } satisfies TypeOrmModuleOptions;

    return {
      module: PersistenceModule,
      imports: [TypeOrmModule.forRoot(typeOrmOptions)],
      providers: [
        {
          provide: SQL_SERVER_DATABASE_CONFIG,
          useValue: config,
        },
      ],
      exports: [SQL_SERVER_DATABASE_CONFIG, TypeOrmModule],
    };
  }
}
