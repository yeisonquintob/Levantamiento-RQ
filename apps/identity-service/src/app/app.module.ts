import { Module, type Provider } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import {
  loadSqlServerDatabaseConfig,
  PersistenceModule,
} from "@levantamiento-rq/shared-persistence";

import { AccessTokenGuard } from "../auth/access-token.guard";
import {
  AUTH_CONFIG,
  loadAuthConfig,
} from "../auth/auth-config";
import { AuthController } from "../auth/auth-controller";
import { AuthService } from "../auth/auth-service";
import { DisabledIdentityStore } from "../auth/disabled-identity.store";
import { IDENTITY_STORE } from "../auth/identity-store";
import { PasswordHasher } from "../auth/password-hasher";
import { PermissionsGuard } from "../auth/permissions.guard";
import { TokenService } from "../auth/token-service";
import { TypeOrmIdentityStore } from "../auth/typeorm-identity.store";
import {
  PermissionEntity,
  RefreshSessionEntity,
  RoleEntity,
  RolePermissionEntity,
  SecurityAuditEntity,
  UserEntity,
  UserRoleEntity,
} from "../identity/entities";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { UsersController } from "../users/users.controller";
import { UsersService } from "../users/users.service";

const databaseConfig = loadSqlServerDatabaseConfig({
  serviceName: "identity-service",
  defaultDatabaseName: "RqIdentityDb",
});

const entities = [
  UserEntity,
  RoleEntity,
  PermissionEntity,
  UserRoleEntity,
  RolePermissionEntity,
  RefreshSessionEntity,
  SecurityAuditEntity,
];

const storeProviders: Provider[] = databaseConfig.enabled
  ? [
      TypeOrmIdentityStore,
      {
        provide: IDENTITY_STORE,
        useExisting: TypeOrmIdentityStore,
      },
    ]
  : [
      DisabledIdentityStore,
      {
        provide: IDENTITY_STORE,
        useExisting: DisabledIdentityStore,
      },
    ];

@Module({
  imports: [
    PersistenceModule.register({
      serviceName: "identity-service",
      defaultDatabaseName: "RqIdentityDb",
    }),
    ...(databaseConfig.enabled
      ? [TypeOrmModule.forFeature(entities)]
      : []),
  ],
  controllers: [
    AppController,
    AuthController,
    ...(databaseConfig.enabled ? [UsersController] : []),
  ],
  providers: [
    AppService,
    {
      provide: AUTH_CONFIG,
      useFactory: loadAuthConfig,
    },
    PasswordHasher,
    TokenService,
    AuthService,
    AccessTokenGuard,
    PermissionsGuard,
    ...(databaseConfig.enabled ? [UsersService] : []),
    ...storeProviders,
  ],
})
export class AppModule {}
