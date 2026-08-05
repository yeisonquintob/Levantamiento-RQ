import { randomUUID } from "node:crypto";

import { loadEnvironmentFiles } from "../libs/shared/config/src/index.js";

import { PasswordHasher } from "../apps/identity-service/src/auth/password-hasher";
import dataSource from "../apps/identity-service/src/database/data-source";
import {
  PermissionEntity,
  RoleEntity,
  RolePermissionEntity,
  UserEntity,
  UserRoleEntity,
} from "../apps/identity-service/src/identity/entities";

loadEnvironmentFiles({
  paths: [".env", "apps/identity-service/.env"],
});

function required(name: string, minimum: number): string {
  const value = process.env[name]?.trim() ?? "";

  if (value.length < minimum) {
    throw new Error(`${name} debe tener mínimo ${minimum} caracteres.`);
  }

  return value;
}

function booleanValue(name: string): boolean {
  return process.env[name]?.trim().toLowerCase() === "true";
}

async function main(): Promise<void> {
  const email = required("IDENTITY_ADMIN_EMAIL", 3).toLowerCase();
  const displayName = required("IDENTITY_ADMIN_NAME", 2);
  const password = required("IDENTITY_ADMIN_PASSWORD", 12);
  const allowPasswordReset = booleanValue("IDENTITY_ADMIN_RESET_PASSWORD");
  const allowReactivation = booleanValue("IDENTITY_ADMIN_REACTIVATE");

  const hasher = new PasswordHasher();
  await dataSource.initialize();

  try {
    const result = await dataSource.transaction(async (manager) => {
      const users = manager.getRepository(UserEntity);
      const roles = manager.getRepository(RoleEntity);
      const permissions = manager.getRepository(PermissionEntity);
      const userRoles = manager.getRepository(UserRoleEntity);
      const rolePermissions = manager.getRepository(RolePermissionEntity);

      const now = new Date();
      let user = await users.findOne({
        where: { emailNormalized: email },
      });
      let userResult = "existente";

      if (!user) {
        user = users.create({
          id: randomUUID(),
          email,
          emailNormalized: email,
          displayName,
          passwordHash: await hasher.hash(password),
          isActive: true,
          mustChangePassword: false,
          sessionVersion: 1,
          lastLoginAt: null,
          createdAt: now,
          updatedAt: now,
        });

        await users.save(user);
        userResult = "creado";
      } else {
        const passwordMatches = await hasher.verify(
          password,
          user.passwordHash,
        );

        if (!passwordMatches && !allowPasswordReset) {
          throw new Error(
            "El usuario ya existe, pero la contraseña no coincide. " +
              "No se autorizó restablecerla.",
          );
        }

        if (!user.isActive && !allowReactivation) {
          throw new Error(
            "El usuario existe, pero está inactivo. " +
              "No se autorizó reactivarlo.",
          );
        }

        user.email = email;
        user.emailNormalized = email;
        user.displayName = displayName;
        user.updatedAt = now;

        if (!passwordMatches) {
          user.passwordHash = await hasher.hash(password);
          user.mustChangePassword = false;
          user.sessionVersion += 1;
          userResult = "actualizado";
        }

        if (!user.isActive) {
          user.isActive = true;
          userResult = "reactivado";
        }

        await users.save(user);
      }

      let role = await roles.findOne({
        where: { code: "ADMIN" },
      });

      if (!role) {
        role = roles.create({
          id: randomUUID(),
          code: "ADMIN",
          name: "Administrador",
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
        await roles.save(role);
      } else if (!role.isActive) {
        role.isActive = true;
        role.updatedAt = now;
        await roles.save(role);
      }

      let permission = await permissions.findOne({
        where: { code: "system.admin" },
      });

      if (!permission) {
        permission = permissions.create({
          id: randomUUID(),
          code: "system.admin",
          name: "Administración del sistema",
          description:
            "Permiso base para la administración controlada de Levantamiento RQ.",
          createdAt: now,
          updatedAt: now,
        });
        await permissions.save(permission);
      }

      const userRole = await userRoles.findOne({
        where: {
          userId: user.id,
          roleId: role.id,
        },
      });

      if (!userRole) {
        await userRoles.insert({
          userId: user.id,
          roleId: role.id,
          createdAt: now,
        });
      }

      const rolePermission = await rolePermissions.findOne({
        where: {
          roleId: role.id,
          permissionId: permission.id,
        },
      });

      if (!rolePermission) {
        await rolePermissions.insert({
          roleId: role.id,
          permissionId: permission.id,
          createdAt: now,
        });
      }

      return {
        email: user.email,
        userResult,
      };
    });

    console.log(`Administrador ${result.userResult}: ${result.email}`);
    console.log("Rol asignado: ADMIN");
    console.log("Permiso asignado: system.admin");
    console.log("La contraseña no fue registrada en logs.");
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`No se pudo preparar el administrador: ${message}`);
  process.exitCode = 1;
});
