import { randomUUID } from "node:crypto";

import { loadEnvironmentFiles } from "../libs/shared/config/src/index.js";
import dataSource from "../apps/identity-service/src/database/data-source";
import {
  RoleEntity,
  SecurityAuditEntity,
  UserEntity,
} from "../apps/identity-service/src/identity/entities";

loadEnvironmentFiles({
  paths: [".env", "apps/identity-service/.env"],
});

const GATEWAY = "http://127.0.0.1:3000/api/v1";
const IDENTITY = "http://127.0.0.1:3001/api/v1";
const WEB = "http://127.0.0.1:4200";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} no está configurado.`);
  return value;
}

function cookie(response: Response, name: string): {
  pair: string;
  serialized: string;
} {
  const serialized = response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${name}=`));

  if (!serialized) throw new Error(`No se recibió la cookie ${name}.`);
  return { pair: serialized.split(";", 1)[0] ?? "", serialized };
}

async function jsonRequest(
  url: string,
  options: RequestInit = {},
): Promise<{ response: Response; payload: unknown }> {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(15000),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  return { response, payload };
}

function object(payload: unknown): Readonly<Record<string, unknown>> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("La API no devolvió un objeto JSON válido.");
  }
  return payload as Readonly<Record<string, unknown>>;
}

async function cleanup(emailNormalized: string, roleId: string): Promise<void> {
  const users = dataSource.getRepository(UserEntity);
  const user = await users.findOne({ where: { emailNormalized } });

  if (user) {
    await dataSource.getRepository(SecurityAuditEntity).delete([
      { targetUserId: user.id },
      { actorUserId: user.id },
    ]);
    await users.delete({ id: user.id });
  }

  await dataSource.getRepository(RoleEntity).delete({ id: roleId });
}

async function main(): Promise<void> {
  const adminEmail = requiredEnvironment("IDENTITY_SMOKE_ADMIN_EMAIL");
  const adminPassword = requiredEnvironment("IDENTITY_SMOKE_ADMIN_PASSWORD");
  const suffix = randomUUID().slice(0, 8);
  const email = `smoke-users-${suffix}@local.invalid`;
  const temporaryPassword = `Temp!${randomUUID()}9a`;
  const nextPassword = `Next!${randomUUID()}9a`;
  const finalPassword = `Final!${randomUUID()}9a`;
  const roleId = randomUUID();
  const roleCode = `SMOKE_${suffix.toUpperCase()}`;
  let userId: string | null = null;
  let adminSessionCookie: string | null = null;

  await dataSource.initialize();

  try {
    await cleanup(email, roleId);
    const now = new Date();
    await dataSource.getRepository(RoleEntity).insert({
      id: roleId,
      code: roleCode,
      name: "Rol temporal de smoke",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const adminSignIn = await jsonRequest(`${GATEWAY}/auth/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });
    if (!adminSignIn.response.ok) {
      throw new Error(
        `El administrador no inició sesión: ${adminSignIn.response.status} ${JSON.stringify(adminSignIn.payload)}.`,
      );
    }
    const adminAccess = cookie(adminSignIn.response, "rq_access");
    const adminRefresh = cookie(adminSignIn.response, "rq_refresh");
    const adminCookie = adminAccess.pair;
    adminSessionCookie = `${adminAccess.pair}; ${adminRefresh.pair}`;

    if (
      !/HttpOnly/i.test(adminAccess.serialized) ||
      !/SameSite=Lax/i.test(adminAccess.serialized)
    ) {
      throw new Error("La cookie administrativa no conserva atributos seguros.");
    }

    const identityList = await fetch(`${IDENTITY}/users?page=1&pageSize=5`, {
      headers: { authorization: `Bearer ${adminCookie.split("=").slice(1).join("=")}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!identityList.ok) {
      throw new Error(
        `Identity rechazó al administrador: ${identityList.status} ${await identityList.text()}.`,
      );
    }

    const create = await jsonRequest(`${GATEWAY}/users`, {
      method: "POST",
      headers: {
        cookie: adminCookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        displayName: "Usuario temporal Smoke",
        email,
        roleCodes: [roleCode],
        temporaryPassword,
      }),
    });
    if (create.response.status !== 201) {
      throw new Error(
        `No se creó el usuario: ${create.response.status} ${JSON.stringify(create.payload)}.`,
      );
    }
    const created = object(create.payload);
    const createdUser = object(created.user);
    userId = String(createdUser.id);

    if (
      created.temporaryPassword !== temporaryPassword ||
      JSON.stringify(createdUser).includes("passwordHash") ||
      JSON.stringify(createdUser).includes(temporaryPassword)
    ) {
      throw new Error("La respuesta de creación expuso credenciales indebidamente.");
    }

    const duplicate = await jsonRequest(`${GATEWAY}/users`, {
      method: "POST",
      headers: {
        cookie: adminCookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        displayName: "Usuario duplicado Smoke",
        email,
        roleCodes: [roleCode],
        temporaryPassword: `Duplicate!${randomUUID()}9a`,
      }),
    });
    if (duplicate.response.status !== 409) {
      throw new Error("El correo duplicado no fue rechazado con 409.");
    }

    const storedRows = (await dataSource.query(
      `SELECT PasswordHash, MustChangePassword
       FROM dbo.IdentityUsers WHERE Id = @0`,
      [userId],
    )) as Array<{ PasswordHash: string; MustChangePassword: boolean | number }>;
    const stored = storedRows[0];

    if (
      !stored ||
      stored.PasswordHash === temporaryPassword ||
      !stored.PasswordHash.startsWith("scrypt$") ||
      !stored.MustChangePassword
    ) {
      throw new Error("SQL Server no conservó hash y cambio obligatorio.");
    }

    const temporarySignIn = await jsonRequest(`${GATEWAY}/auth/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: temporaryPassword }),
    });
    if (!temporarySignIn.response.ok) {
      throw new Error("La contraseña temporal no permitió el primer inicio.");
    }
    const tempPayload = object(temporarySignIn.payload);
    const tempUser = object(tempPayload.user);
    const tempAccess = cookie(temporarySignIn.response, "rq_access");

    if (
      tempUser.mustChangePassword !== true ||
      !/Path=\/api\/v1\/auth/i.test(tempAccess.serialized)
    ) {
      throw new Error("La sesión temporal no quedó restringida a autenticación.");
    }

    const changePage = await fetch(`${WEB}/change-password`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!changePage.ok) throw new Error("La vista Cambiar contraseña no respondió.");

    const change = await jsonRequest(`${GATEWAY}/auth/change-password`, {
      method: "POST",
      headers: {
        cookie: tempAccess.pair,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        currentPassword: temporaryPassword,
        newPassword: nextPassword,
      }),
    });
    if (!change.response.ok) {
      throw new Error(
        `No se completó el cambio obligatorio: ${change.response.status} ${JSON.stringify(change.payload)}.`,
      );
    }
    const changedAccess = cookie(change.response, "rq_access");

    if (!/Path=\//i.test(changedAccess.serialized)) {
      throw new Error("La sesión definitiva no obtuvo alcance normal.");
    }

    const oldPassword = await jsonRequest(`${GATEWAY}/auth/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: temporaryPassword }),
    });
    if (oldPassword.response.status !== 401) {
      throw new Error("La contraseña temporal siguió siendo válida.");
    }

    const noPermission = await fetch(`${GATEWAY}/users?page=1&pageSize=5`, {
      headers: { cookie: changedAccess.pair },
      signal: AbortSignal.timeout(15000),
    });
    if (noPermission.status !== 403) {
      throw new Error(`Un usuario sin permiso recibió ${noPermission.status}, no 403.`);
    }

    const unknownRole = await fetch(`${GATEWAY}/users/${userId}/roles`, {
      method: "PUT",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ roleCodes: ["ROLE_THAT_DOES_NOT_EXIST"] }),
      signal: AbortSignal.timeout(15000),
    });
    if (unknownRole.status !== 400) {
      throw new Error("Un rol inexistente no fue rechazado con 400.");
    }

    const addAdminRole = await fetch(`${GATEWAY}/users/${userId}/roles`, {
      method: "PUT",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ roleCodes: [roleCode, "ADMIN"] }),
      signal: AbortSignal.timeout(15000),
    });
    if (!addAdminRole.ok) throw new Error("No se pudo asignar un rol global.");

    const removeAdminRole = await fetch(`${GATEWAY}/users/${userId}/roles`, {
      method: "PUT",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ roleCodes: [roleCode] }),
      signal: AbortSignal.timeout(15000),
    });
    if (!removeAdminRole.ok) throw new Error("No se pudo retirar un rol global.");

    const reset = await jsonRequest(`${GATEWAY}/users/${userId}/reset-password`, {
      method: "POST",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!reset.response.ok) throw new Error("No se restableció la contraseña.");
    const resetPassword = String(object(reset.payload).temporaryPassword ?? "");
    if (resetPassword.length < 12) throw new Error("No se generó contraseña temporal.");

    const preResetPassword = await jsonRequest(`${GATEWAY}/auth/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: nextPassword }),
    });
    if (preResetPassword.response.status !== 401) {
      throw new Error("La contraseña previa al restablecimiento siguió válida.");
    }

    const resetSignIn = await jsonRequest(`${GATEWAY}/auth/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: resetPassword }),
    });
    if (!resetSignIn.response.ok) throw new Error("La credencial restablecida falló.");
    const resetAccess = cookie(resetSignIn.response, "rq_access");

    const finalChange = await jsonRequest(`${GATEWAY}/auth/change-password`, {
      method: "POST",
      headers: { cookie: resetAccess.pair, "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: resetPassword, newPassword: finalPassword }),
    });
    if (!finalChange.response.ok) throw new Error("El segundo cambio obligatorio falló.");

    const finalSignIn = await jsonRequest(`${GATEWAY}/auth/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: finalPassword }),
    });
    if (!finalSignIn.response.ok) throw new Error("La contraseña final no inició sesión.");
    const finalAccess = cookie(finalSignIn.response, "rq_access");

    const revoke = await fetch(`${GATEWAY}/users/${userId}/revoke-sessions`, {
      method: "POST",
      headers: { cookie: adminCookie },
      signal: AbortSignal.timeout(15000),
    });
    if (!revoke.ok) throw new Error("No se revocaron las sesiones.");

    const revokedMe = await fetch(`${GATEWAY}/auth/me`, {
      headers: { cookie: finalAccess.pair },
      signal: AbortSignal.timeout(15000),
    });
    if (revokedMe.status !== 401) throw new Error("El access token revocado siguió válido.");

    const deactivate = await fetch(`${GATEWAY}/users/${userId}/deactivate`, {
      method: "POST",
      headers: { cookie: adminCookie },
      signal: AbortSignal.timeout(15000),
    });
    if (!deactivate.ok) throw new Error("No se desactivó la cuenta.");

    const blocked = await jsonRequest(`${GATEWAY}/auth/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: finalPassword }),
    });
    if (blocked.response.status !== 401) throw new Error("La cuenta inactiva inició sesión.");

    const activate = await fetch(`${GATEWAY}/users/${userId}/activate`, {
      method: "POST",
      headers: { cookie: adminCookie },
      signal: AbortSignal.timeout(15000),
    });
    if (!activate.ok) throw new Error("No se reactivó la cuenta.");

    const reactivatedSignIn = await jsonRequest(`${GATEWAY}/auth/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: finalPassword }),
    });
    if (!reactivatedSignIn.response.ok) {
      throw new Error("La cuenta reactivada no pudo iniciar sesión.");
    }

    const workspace = await fetch(`${WEB}/workspace/settings/users`, {
      headers: { cookie: adminCookie },
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
    if (!workspace.ok) throw new Error("La vista Configuración > Usuarios no respondió.");

    const auditRows = (await dataSource.query(
      `SELECT EventType, Detail FROM dbo.IdentitySecurityAudit
       WHERE TargetUserId = @0`,
      [userId],
    )) as Array<{ EventType: string; Detail: string | null }>;
    const eventTypes = new Set(auditRows.map((row) => row.EventType));
    const requiredEvents = [
      "USER_CREATED",
      "ROLE_ASSIGNED",
      "ROLE_REMOVED",
      "PASSWORD_RESET",
      "PASSWORD_CHANGED",
      "SESSIONS_REVOKED",
      "USER_DEACTIVATED",
      "USER_ACTIVATED",
    ];

    if (requiredEvents.some((event) => !eventTypes.has(event))) {
      throw new Error("La auditoría mínima no contiene todos los eventos.");
    }

    const auditText = JSON.stringify(auditRows);
    if (
      [temporaryPassword, nextPassword, resetPassword, finalPassword].some(
        (password) => auditText.includes(password),
      )
    ) {
      throw new Error("La auditoría contiene una contraseña.");
    }

    console.log("✓ Identity, Gateway, frontend, SQL, cookies y sesiones verificados.");
    console.log("✓ Creación, cambio obligatorio, roles, reset, revocación y estado correctos.");
    console.log("✓ Respuestas y auditoría no exponen hash, token ni contraseña.");
  } finally {
    if (adminSessionCookie) {
      await fetch(`${GATEWAY}/auth/sign-out`, {
        method: "POST",
        headers: { cookie: adminSessionCookie },
        signal: AbortSignal.timeout(15000),
      }).catch(() => undefined);
    }
    await cleanup(email, roleId);
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Smoke de administración de usuarios fallido: ${message}`);
  process.exitCode = 1;
});
