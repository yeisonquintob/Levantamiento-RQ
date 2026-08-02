import { randomUUID } from "node:crypto";

import { loadEnvironmentFiles } from "../libs/shared/config/src/index.js";

import { PasswordHasher } from "../apps/identity-service/src/auth/password-hasher";
import dataSource from "../apps/identity-service/src/database/data-source";
import { UserEntity } from "../apps/identity-service/src/identity/entities";

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

async function main(): Promise<void> {
  const email = required("IDENTITY_USER_EMAIL", 3).toLowerCase();
  const displayName = required("IDENTITY_USER_NAME", 2);
  const password = required("IDENTITY_USER_PASSWORD", 12);

  await dataSource.initialize();

  try {
    const users = dataSource.getRepository(UserEntity);
    const existing = await users.findOne({
      where: { emailNormalized: email },
    });

    if (existing) {
      throw new Error("Ya existe un usuario con ese correo.");
    }

    const hasher = new PasswordHasher();
    const passwordHash = await hasher.hash(password);
    const now = new Date();

    await users.insert({
      id: randomUUID(),
      email,
      emailNormalized: email,
      displayName,
      passwordHash,
      isActive: true,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    });

    console.log(`Usuario creado: ${email}`);
    console.log("La contraseña no fue registrada en logs.");
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : String(error);
  console.error(`No se pudo crear el usuario: ${message}`);
  process.exitCode = 1;
});
