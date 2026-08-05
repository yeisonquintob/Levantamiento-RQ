import assert from "node:assert/strict";
import { test } from "node:test";

import type { AuthenticatedUser } from "@levantamiento-rq/shared-contracts";

import type { AuthConfig } from "../../apps/identity-service/src/auth/auth-config";
import { AuthService } from "../../apps/identity-service/src/auth/auth-service";
import type {
  IdentityStore,
  IdentityUserRecord,
  NewRefreshSession,
  RefreshSessionRecord,
} from "../../apps/identity-service/src/auth/identity-store";
import { PasswordHasher } from "../../apps/identity-service/src/auth/password-hasher";
import { TokenService } from "../../apps/identity-service/src/auth/token-service";

class FakeIdentityStore implements IdentityStore {
  readonly users = new Map<string, IdentityUserRecord>();
  readonly sessions = new Map<string, RefreshSessionRecord>();

  findUserByEmailNormalized(
    emailNormalized: string,
  ): Promise<IdentityUserRecord | null> {
    return Promise.resolve(
      [...this.users.values()].find(
        (user) => user.emailNormalized === emailNormalized,
      ) ?? null,
    );
  }

  findUserById(userId: string): Promise<IdentityUserRecord | null> {
    return Promise.resolve(this.users.get(userId) ?? null);
  }

  updateLastLogin(): Promise<void> {
    return Promise.resolve();
  }

  createRefreshSession(session: NewRefreshSession): Promise<void> {
    this.sessions.set(session.id, {
      ...session,
      revokedAt: null,
      replacedBySessionId: null,
    });
    return Promise.resolve();
  }

  findRefreshSession(
    sessionId: string,
  ): Promise<RefreshSessionRecord | null> {
    return Promise.resolve(this.sessions.get(sessionId) ?? null);
  }

  rotateRefreshSession(
    currentSessionId: string,
    nextSession: NewRefreshSession,
    instant: Date,
  ): Promise<boolean> {
    const current = this.sessions.get(currentSessionId);

    if (!current || current.revokedAt) {
      return Promise.resolve(false);
    }

    this.sessions.set(currentSessionId, {
      ...current,
      revokedAt: instant,
      replacedBySessionId: nextSession.id,
    });
    this.sessions.set(nextSession.id, {
      ...nextSession,
      revokedAt: null,
      replacedBySessionId: null,
    });

    return Promise.resolve(true);
  }

  revokeRefreshSession(sessionId: string, instant: Date): Promise<void> {
    const current = this.sessions.get(sessionId);

    if (current) {
      this.sessions.set(sessionId, {
        ...current,
        revokedAt: instant,
      });
    }

    return Promise.resolve();
  }

  changePassword(
    userId: string,
    passwordHash: string,
    instant: Date,
  ): Promise<boolean> {
    const user = this.users.get(userId);

    if (!user || !user.isActive) return Promise.resolve(false);

    this.users.set(userId, {
      ...user,
      passwordHash,
      mustChangePassword: false,
      sessionVersion: user.sessionVersion + 1,
    });

    for (const [sessionId, session] of this.sessions) {
      if (session.userId === userId && !session.revokedAt) {
        this.sessions.set(sessionId, { ...session, revokedAt: instant });
      }
    }

    return Promise.resolve(true);
  }
}

const config: AuthConfig = {
  enabled: true,
  issuer: "levantamiento-rq-test",
  audience: "levantamiento-rq-test",
  accessSecret: "a".repeat(64),
  refreshSecret: "b".repeat(64),
  accessTtlSeconds: 300,
  refreshTtlSeconds: 3600,
};

async function createFixture(active = true) {
  const store = new FakeIdentityStore();
  const hasher = new PasswordHasher();
  const tokenService = new TokenService(config);
  const auth = new AuthService(config, store, hasher, tokenService);
  const password = "CorrectHorseBattery123!";
  const user: IdentityUserRecord = {
    id: "11111111-1111-4111-8111-111111111111",
    email: "analista@example.com",
    emailNormalized: "analista@example.com",
    displayName: "Analista de Requerimientos",
    passwordHash: await hasher.hash(password),
    isActive: active,
    mustChangePassword: false,
    sessionVersion: 1,
    roles: ["ANALYST"],
    permissions: ["requirements.read", "requirements.write"],
  };

  store.users.set(user.id, user);

  return { store, hasher, tokenService, auth, user, password };
}

test("scrypt genera hashes con sal y verifica la contraseña", async () => {
  const hasher = new PasswordHasher();
  const first = await hasher.hash("Password123!");
  const second = await hasher.hash("Password123!");

  assert.notEqual(first, second);
  assert.equal(await hasher.verify("Password123!", first), true);
  assert.equal(await hasher.verify("incorrecta", first), false);
});

test("inicio, consulta, renovación y cierre de sesión", async () => {
  const fixture = await createFixture();

  const signedIn = await fixture.auth.signIn({
    email: "ANALISTA@EXAMPLE.COM",
    password: fixture.password,
  });

  assert.equal(signedIn.user.id, fixture.user.id);
  assert.deepEqual(signedIn.user.roles, ["ANALYST"]);
  assert.equal("passwordHash" in signedIn.user, false);

  const principal: AuthenticatedUser =
    await fixture.auth.authenticateAccessToken(signedIn.accessToken);

  assert.equal(principal.email, fixture.user.email);
  assert.deepEqual(principal.permissions, [
    "requirements.read",
    "requirements.write",
  ]);

  const refreshed = await fixture.auth.refresh(signedIn.refreshToken);
  assert.notEqual(refreshed.refreshToken, signedIn.refreshToken);

  await assert.rejects(
    () => fixture.auth.refresh(signedIn.refreshToken),
    /Sesión de renovación inválida|La sesión ya fue utilizada/,
  );

  await fixture.auth.signOut(refreshed.refreshToken);

  await assert.rejects(
    () => fixture.auth.refresh(refreshed.refreshToken),
    /Sesión de renovación inválida/,
  );
});

test("la contraseña temporal obliga cambio, revoca sesiones y no se filtra", async () => {
  const fixture = await createFixture();
  fixture.store.users.set(fixture.user.id, {
    ...fixture.user,
    mustChangePassword: true,
  });
  const signedIn = await fixture.auth.signIn({
    email: fixture.user.email,
    password: fixture.password,
  });

  assert.equal(signedIn.user.mustChangePassword, true);
  assert.equal("passwordHash" in signedIn.user, false);

  const changed = await fixture.auth.changePassword(
    signedIn.user,
    {
      currentPassword: fixture.password,
      newPassword: "NuevaPasswordSegura123!",
    },
  );

  assert.equal(changed.user.mustChangePassword, false);
  await assert.rejects(
    () => fixture.auth.authenticateAccessToken(signedIn.accessToken),
    /cuenta no está disponible/i,
  );
  await assert.rejects(
    () =>
      fixture.auth.signIn({
        email: fixture.user.email,
        password: fixture.password,
      }),
    /Credenciales inválidas/,
  );

  const next = await fixture.auth.signIn({
    email: fixture.user.email,
    password: "NuevaPasswordSegura123!",
  });
  assert.equal(next.user.mustChangePassword, false);
});

test("credenciales erróneas y usuarios inactivos son rechazados", async () => {
  const active = await createFixture();

  await assert.rejects(
    () =>
      active.auth.signIn({
        email: active.user.email,
        password: "PasswordIncorrecta!",
      }),
    /Credenciales inválidas/,
  );

  const inactive = await createFixture(false);

  await assert.rejects(
    () =>
      inactive.auth.signIn({
        email: inactive.user.email,
        password: inactive.password,
      }),
    /Credenciales inválidas/,
  );
});
