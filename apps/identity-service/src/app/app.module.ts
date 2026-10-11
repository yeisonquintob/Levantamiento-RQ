import { Module, type Provider } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import {
  loadSqlServerDatabaseConfig,
  PersistenceModule,
} from "@levantamiento-rq/shared-persistence";

import { AccessTokenGuard } from "../auth/access-token.guard";
import { AUTH_CONFIG, loadAuthConfig } from "../auth/auth-config";
import { AuthController } from "../auth/auth-controller";
import { AuthService } from "../auth/auth-service";
import {
  loadMicrosoftAuthConfig,
  MICROSOFT_AUTH_CONFIG,
} from "../auth/microsoft-auth-config";
import { MicrosoftAuthController } from "../auth/microsoft-auth.controller";
import { MicrosoftAuthService } from "../auth/microsoft-auth.service";
import { RegistrationController } from "../auth/registration-controller";
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
    ...(databaseConfig.enabled ? [TypeOrmModule.forFeature(entities)] : []),
  ],
  controllers: [
    AppController,
    AuthController,
    MicrosoftAuthController,
    ...(databaseConfig.enabled
      ? [RegistrationController, UsersController]
      : []),
  ],
  providers: [
    AppService,
    {
      provide: AUTH_CONFIG,
      useFactory: loadAuthConfig,
    },
    {
      provide: MICROSOFT_AUTH_CONFIG,
      useFactory: loadMicrosoftAuthConfig,
    },
    PasswordHasher,
    TokenService,
    AuthService,
    MicrosoftAuthService,
    AccessTokenGuard,
    PermissionsGuard,
    ...(databaseConfig.enabled ? [UsersService] : []),
    ...storeProviders,
  ],
})
export class AppModule {}
