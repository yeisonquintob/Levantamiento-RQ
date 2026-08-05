import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";

import type { AuthenticatedUser } from "@levantamiento-rq/shared-contracts";

import { PermissionsGuard } from "../../apps/identity-service/src/auth/permissions.guard";
import {
  generateTemporaryPassword,
  UsersService,
} from "../../apps/identity-service/src/users/users.service";
import type {
  RoleEntity,
  UserEntity,
} from "../../apps/identity-service/src/identity/entities";

const actor: AuthenticatedUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "admin@example.com",
  displayName: "Administrador",
  roles: ["ADMIN"],
  permissions: ["system.admin"],
  mustChangePassword: false,
};

function usersService(overrides: {
  users?: object;
  roles?: object;
  sessions?: object;
  dataSource?: object;
  passwordHasher?: object;
}): UsersService {
  return new UsersService(
    (overrides.users ?? {}) as never,
    (overrides.roles ?? {}) as never,
    (overrides.sessions ?? {}) as never,
    (overrides.dataSource ?? {}) as never,
    (overrides.passwordHasher ?? {}) as never,
  );
}

test("la administración rechaza correos duplicados antes de generar credenciales", async () => {
  let hashCalled = false;
  const service = usersService({
    users: { exists: () => Promise.resolve(true) },
    passwordHasher: {
      hash: () => {
        hashCalled = true;
        return Promise.resolve("no-debe-generarse");
      },
    },
  });

  await assert.rejects(
    () =>
      service.create(actor, {
        displayName: "Duplicado",
        email: "duplicado@example.com",
        roleCodes: ["ADMIN"],
      }),
    (error: unknown) => error instanceof ConflictException,
  );
  assert.equal(hashCalled, false);
});

test("la administración rechaza roles globales inexistentes", async () => {
  const service = usersService({
    users: { exists: () => Promise.resolve(false) },
    roles: { find: () => Promise.resolve([]) },
  });

  await assert.rejects(
    () =>
      service.create(actor, {
        displayName: "Sin rol",
        email: "sin-rol@example.com",
        roleCodes: ["INEXISTENTE"],
      }),
    (error: unknown) => error instanceof BadRequestException,
  );
});

test("el último administrador activo conserva el rol mínimo", async () => {
  const adminRole = {
    id: "22222222-2222-4222-8222-222222222222",
    code: "ADMIN",
    name: "Administrador",
    isActive: true,
  } as RoleEntity;
  const analystRole = {
    id: "33333333-3333-4333-8333-333333333333",
    code: "ANALYST",
    name: "Analista",
    isActive: true,
  } as RoleEntity;
  const admin = {
    id: actor.id,
    isActive: true,
    userRoles: [{ role: adminRole }],
  } as UserEntity;
  let queryCount = 0;
  const users = {
    createQueryBuilder: () => {
      queryCount += 1;
      const builder = {
        leftJoinAndSelect: () => builder,
        innerJoin: () => builder,
        where: () => builder,
        andWhere: () => builder,
        getOne: () => Promise.resolve(admin),
        getCount: () => Promise.resolve(1),
      };
      return builder;
    },
  };
  const service = usersService({
    users,
    roles: { find: () => Promise.resolve([analystRole]) },
  });

  await assert.rejects(
    () => service.setRoles(actor, actor.id, ["ANALYST"]),
    /último administrador activo/i,
  );
  assert.equal(queryCount, 2);
});

test("el guard exige system.admin y bloquea el acceso durante el cambio obligatorio", () => {
  const reflector = {
    getAllAndOverride: () => ["system.admin"],
  };
  const guard = new PermissionsGuard(reflector as never);
  const principal = { ...actor, permissions: [] as string[] };
  const context = {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({
      getRequest: () => ({ authPrincipal: principal }),
    }),
  };

  assert.throws(
    () => guard.canActivate(context as never),
    (error: unknown) => error instanceof ForbiddenException,
  );

  principal.permissions = ["system.admin"];
  assert.equal(guard.canActivate(context as never), true);

  Object.assign(principal, { mustChangePassword: true });
  assert.throws(
    () => guard.canActivate(context as never),
    /cambiar la contraseña temporal/i,
  );
});

test("las contraseñas temporales generadas son únicas y cumplen la longitud mínima", () => {
  const first = generateTemporaryPassword();
  const second = generateTemporaryPassword();

  assert.notEqual(first, second);
  assert.ok(first.length >= 12);
  assert.match(first, /^Rq![A-Za-z0-9_-]+9a$/u);
});
