import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { exportJWK, generateKeyPair } from "jose";

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
import { applySignInUrlPolicy } from "../../apps/web/src/app/sign-in/sign-in-url-policy";

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
      lastUsedAt: null,
    });
    return Promise.resolve();
  }

  findRefreshSession(sessionId: string): Promise<RefreshSessionRecord | null> {
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
      lastUsedAt: null,
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

  revokeRefreshFamily(familyId: string, userId: string, instant: Date): Promise<void> {
    for (const [sessionId, session] of this.sessions) {
      if (session.familyId === familyId && session.userId === userId) {
        this.sessions.set(sessionId, { ...session, revokedAt: instant });
      }
    }
    const user = this.users.get(userId);
    if (user) this.users.set(userId, { ...user, sessionVersion: user.sessionVersion + 1 });
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

const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value), "utf8").toString("base64");

async function createAuthConfig(): Promise<AuthConfig> {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  const accessKeyId = "identity-test-ed25519-1";
  return {
    enabled: true,
    issuer: "levantamiento-rq-test",
    audience: "levantamiento-rq-test",
    accessPrivateJwk: encode({
      ...(await exportJWK(privateKey)),
      kid: accessKeyId,
      alg: "EdDSA",
      use: "sig",
    }),
    accessPublicJwks: encode({
      keys: [
        {
          ...(await exportJWK(publicKey)),
          kid: accessKeyId,
          alg: "EdDSA",
          use: "sig",
          principal: "identity",
        },
      ],
    }),
    accessKeyId,
    refreshSecret: "b".repeat(64),
    accessTtlSeconds: 300,
    refreshTtlSeconds: 3600,
    inactivityTtlSeconds: 1800,
  };
}

async function createFixture(active = true) {
  const config = await createAuthConfig();
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

test("Argon2id genera hashes con sal y verifica la contraseña", async () => {
  const hasher = new PasswordHasher();
  const first = await hasher.hash("Password123!");
  const second = await hasher.hash("Password123!");

  assert.notEqual(first, second);
  assert.match(first, /^\$argon2id\$/);
  assert.equal(await hasher.verify("Password123!", first), true);
  assert.equal(await hasher.verify("incorrecta", first), false);
});

test("verifica scrypt legado y exige rehash automático a Argon2id", async () => {
  const password = "Password123!";
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  const legacy = [
    "scrypt", "v=1", "N=16384", "r=8", "p=1",
    salt.toString("base64url"), derived.toString("base64url"),
  ].join("$");
  const hasher = new PasswordHasher();
  assert.equal(await hasher.verify(password, legacy), true);
  assert.equal(hasher.needsRehash(legacy), true);
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
    /Sesión de renovación inválida|La sesión ya fue utilizada|reutilización/,
  );
  await assert.rejects(
    () => fixture.auth.authenticateAccessToken(signedIn.accessToken),
    /cuenta no está disponible/i,
  );

  await fixture.auth.signOut(refreshed.refreshToken);

  await assert.rejects(
    () => fixture.auth.refresh(refreshed.refreshToken),
    /Sesión de renovación inválida|reutilización/,
  );
});

test("la familia de refresh acepta la representación UUID de SQL Server sin depender del casing", async () => {
  const fixture = await createFixture();
  const signedIn = await fixture.auth.signIn({
    email: fixture.user.email,
    password: fixture.password,
  });

  const stored = [...fixture.store.sessions.values()][0];
  assert.ok(stored);

  fixture.store.sessions.set(stored.id, {
    ...stored,
    familyId: stored.familyId.toUpperCase(),
  });

  const refreshed = await fixture.auth.refresh(
    signedIn.refreshToken,
  );

  assert.notEqual(
    refreshed.refreshToken,
    signedIn.refreshToken,
  );

  const active = [...fixture.store.sessions.values()].find(
    (session) => !session.revokedAt,
  );

  assert.ok(active);
  assert.equal(
    active.familyId,
    active.familyId.toLowerCase(),
  );
});

test("la renovación rechaza y revoca sesiones con 30 minutos de inactividad", async () => {
  const fixture = await createFixture();
  const signedIn = await fixture.auth.signIn({
    email: fixture.user.email,
    password: fixture.password,
  });
  const stored = [...fixture.store.sessions.values()][0];

  assert.ok(stored);
  fixture.store.sessions.set(stored.id, {
    ...stored,
    createdAt: new Date(Date.now() - 31 * 60 * 1000),
  });

  await assert.rejects(
    () => fixture.auth.refresh(signedIn.refreshToken),
    /30 minutos de inactividad/,
  );
  assert.ok(fixture.store.sessions.get(stored.id)?.revokedAt);
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

  const changed = await fixture.auth.changePassword(signedIn.user, {
    currentPassword: fixture.password,
    newPassword: "NuevaPasswordSegura123!",
  });

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

test("el Workspace renueva solo con actividad y avisa la expiración", async () => {
  const manager = await readFile(
    "apps/web/src/app/session-activity-manager.tsx",
    "utf8",
  );
  const signIn = await readFile(
    "apps/web/src/app/sign-in/sign-in-form.tsx",
    "utf8",
  );

  assert.match(manager, /SESSION_INACTIVITY_TIMEOUT_SECONDS/);
  assert.match(manager, /ACTIVITY_WINDOW_MS/);
  assert.match(manager, /api\/v1\/auth\/refresh/);
  assert.match(manager, /api\/v1\/auth\/sign-out/);
  assert.match(manager, /redirectToSignIn\(\s*"inactivity"/);
  assert.match(signIn, /Inactivo por <strong>30 minutos<\/strong>/);

  /*
   * La renovación debe coordinar pestañas sin guardar
   * tokens ni sesión en localStorage/sessionStorage.
   */
  assert.match(manager, /navigator\.locks/);
  assert.match(manager, /BroadcastChannel/);
  assert.match(manager, /ifAvailable:\s*true/);
  assert.match(manager, /visibilitychange/);

  /*
   * Un error temporal de Gateway/Redis no debe
   * interpretarse como credencial vencida.
   */
  assert.match(
    manager,
    /response\.status === 401[\s\S]*response\.status === 403/,
  );
  assert.doesNotMatch(
    manager,
    /if \(!response\.ok\) \{\s*redirectToSignIn/,
  );

  assert.doesNotMatch(manager, /localStorage|sessionStorage/);
});

test("el acceso elimina credenciales y parámetros no permitidos de la URL", async () => {
  const unsafe = applySignInUrlPolicy(
    "?email=user%40example.com&password=secret&reason=expired&token=value",
  );
  assert.deepEqual(unsafe, {
    changed: true,
    reason: "expired",
    safeSearch: "?reason=expired",
  });

  const safe = applySignInUrlPolicy("?reason=inactivity");
  assert.deepEqual(safe, {
    changed: false,
    reason: "inactivity",
    safeSearch: "?reason=inactivity",
  });

  const [proxy, form, nextConfig] = await Promise.all([
    readFile("apps/web/src/proxy.ts", "utf8"),
    readFile("apps/web/src/app/sign-in/sign-in-form.tsx", "utf8"),
    readFile("apps/web/next.config.js", "utf8"),
  ]);
  assert.match(proxy, /source: "\/\(\(\?!api\|_next\/static/);
  assert.match(proxy, /'nonce-\$\{nonce\}' 'strict-dynamic'/);
  assert.doesNotMatch(proxy, /script-src[^\n]*unsafe-inline/);
  assert.match(proxy, /Referrer-Policy", "no-referrer"/);
  assert.match(form, /history\.replaceState/);
  assert.match(nextConfig, /RQ_ALLOWED_DEV_ORIGINS/);
  assert.match(nextConfig, /const allowedDevOrigins = resolveAllowedDevOrigins/);
  assert.match(proxy, /request\.nextUrl\.hostname/);
  assert.match(nextConfig, /logging: \{ incomingRequests: false \}/);
  assert.match(nextConfig, /Referrer-Policy", value: "no-referrer"/);
});

test("la detección de IP LAN local usa node:os.networkInterfaces, deduplica y propaga a ambas listas de orígenes", async () => {
  const script = await readFile("scripts/local-auth-up.sh", "utf8");

  assert.match(script, /require\("node:os"\)/);
  assert.match(script, /networkInterfaces\(\)/);
  assert.match(script, /is_private_ipv4 "\$ip"/);

  assert.match(script, /awk 'NF && !seen\[\$0\]\+\+'/);

  assert.match(
    script,
    /WEB_ORIGINS_RUNTIME="\$\{WEB_ORIGINS_RUNTIME\},http:\/\/\$\{ip\}:4200"/,
  );
  assert.match(
    script,
    /RQ_ALLOWED_DEV_ORIGINS_RUNTIME="\$\{RQ_ALLOWED_DEV_ORIGINS_RUNTIME\},\$\{ip\}"/,
  );

  assert.match(script, /127\.0\.0\.1,localhost/);
  assert.match(script, /http:\/\/127\.0\.0\.1:4200,http:\/\/localhost:4200/);
});

test("el aviso de inactividad es contextual y se cierra desde el correo", async () => {
  const [form, styles] = await Promise.all([
    readFile("apps/web/src/app/sign-in/sign-in-form.tsx", "utf8"),
    readFile("apps/web/src/app/auth.css", "utf8"),
  ]);

  assert.match(form, /setInactivityNotice\(true\)/);
  assert.doesNotMatch(form, /setMessage\("Inactivo por 30 minutos\."\)/);
  assert.doesNotMatch(form, /addEventListener\("pointerdown"/);
  // El aviso es una pastilla flotante con reloj y botón para cerrarla, fuera del formulario.
  assert.match(
    form,
    /\{inactivityNotice \? \(\s*<div className="rq-auth-inactivity-notice" role="status">[\s\S]*?Inactivo por <strong>30 minutos<\/strong>[\s\S]*?aria-label="Cerrar aviso"[\s\S]*?onClick=\{dismissInactivityNotice\}/,
  );
  assert.doesNotMatch(
    form,
    /rq-auth-intro">Continúa con tu cuenta activa\.<\/p>\s*\{inactivityNotice/,
  );
  assert.match(form, /url\.searchParams\.delete\("reason"\)/);
  assert.match(form, /id="email"[\s\S]*?onClick=\{dismissInactivityNotice\}[\s\S]*?onFocus=\{dismissInactivityNotice\}/);
  const notice = styles.match(/\.rq-auth-inactivity-notice\s*\{[^}]*\}/)?.[0] ?? "";
  assert.match(notice, /position: fixed;/);
  assert.match(notice, /var\(--rq-color-surface\)/);
  assert.match(notice, /border-radius: 999px;/);
  assert.match(form, /data-session-expired=\{message === SESSION_EXPIRED_MESSAGE \|\| undefined\}/);
  assert.match(
    styles,
    /\.rq-auth-message\[data-session-expired="true"\]\s*\{\s*position: fixed;/,
  );
});
