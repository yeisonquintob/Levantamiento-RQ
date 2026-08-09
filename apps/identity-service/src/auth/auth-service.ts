import { randomUUID } from "node:crypto";

import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";

import type {
  AuthSessionResponse,
  AuthenticatedUser,
  ChangePasswordRequest,
  SignInRequest,
} from "@levantamiento-rq/shared-contracts";

import { AUTH_CONFIG, type AuthConfig } from "./auth-config";
import {
  IDENTITY_STORE,
  type IdentityStore,
  type NewRefreshSession,
} from "./identity-store";
import { PasswordHasher } from "./password-hasher";
import { TokenService } from "./token-service";

const DUMMY_PASSWORD_HASH =
  "scrypt$v=1$N=16384$r=8$p=1$" +
  "bGV2YW50YW1pZW50by1ycS1kdW1teS1zYWx0$" +
  "zfY5YJs3u8uKvq9ZCmwB3sbjXL8JiaVgJtBYBwudAtwGp5V0u04_nKltnXOXtjugSgiYuPmhG6f5bwST6xd54A";

export interface SessionContext {
  userAgent?: string;
  ipAddress?: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH_CONFIG)
    private readonly config: AuthConfig,
    @Inject(IDENTITY_STORE)
    private readonly store: IdentityStore,
    private readonly passwordHasher: PasswordHasher,
    private readonly tokenService: TokenService,
  ) {}

  async signIn(
    request: SignInRequest,
    context: SessionContext = {},
  ): Promise<AuthSessionResponse> {
    this.ensureEnabled();

    const emailNormalized = normalizeEmail(request.email);
    const user = await this.store.findUserByEmailNormalized(emailNormalized);
    const passwordHash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const passwordValid = await this.passwordHasher.verify(
      request.password,
      passwordHash,
    );

    if (!user || !passwordValid || !user.isActive) {
      throw new UnauthorizedException("Credenciales inválidas.");
    }

    const sessionId = randomUUID();
    const session = await this.tokenService.issueSession(user, sessionId);
    const now = new Date();

    await this.store.createRefreshSession(
      this.toNewSession(sessionId, user.id, session.refreshToken, now, context),
    );
    await this.store.updateLastLogin(user.id, now);

    return session;
  }

  async refresh(
    refreshToken: string,
    context: SessionContext = {},
  ): Promise<AuthSessionResponse> {
    this.ensureEnabled();

    const claims = await this.tokenService.verifyRefreshToken(refreshToken);
    const stored = await this.store.findRefreshSession(claims.sessionId);
    const tokenHash = this.tokenService.hashToken(refreshToken);
    const now = new Date();

    if (
      !stored ||
      stored.userId !== claims.userId ||
      stored.tokenHash !== tokenHash ||
      stored.revokedAt ||
      stored.expiresAt.getTime() <= now.getTime()
    ) {
      throw new UnauthorizedException("Sesión de renovación inválida.");
    }

    const lastActivityAt = stored.lastUsedAt ?? stored.createdAt;

    if (
      lastActivityAt.getTime() + this.config.inactivityTtlSeconds * 1000 <=
      now.getTime()
    ) {
      await this.store.revokeRefreshSession(stored.id, now);
      throw new UnauthorizedException(
        "La sesión expiró por 30 minutos de inactividad.",
      );
    }

    const user = await this.store.findUserById(claims.userId);

    if (
      !user ||
      !user.isActive ||
      user.sessionVersion !== claims.sessionVersion
    ) {
      throw new UnauthorizedException("La cuenta no está disponible.");
    }

    const nextSessionId = randomUUID();
    const next = await this.tokenService.issueSession(user, nextSessionId);
    const rotated = await this.store.rotateRefreshSession(
      stored.id,
      this.toNewSession(
        nextSessionId,
        user.id,
        next.refreshToken,
        now,
        context,
      ),
      now,
    );

    if (!rotated) {
      throw new UnauthorizedException("La sesión ya fue utilizada.");
    }

    return next;
  }

  async signOut(refreshToken: string): Promise<void> {
    this.ensureEnabled();

    const claims = await this.tokenService.verifyRefreshToken(refreshToken);
    const stored = await this.store.findRefreshSession(claims.sessionId);

    if (
      !stored ||
      stored.userId !== claims.userId ||
      stored.tokenHash !== this.tokenService.hashToken(refreshToken)
    ) {
      throw new UnauthorizedException("Sesión de renovación inválida.");
    }

    await this.store.revokeRefreshSession(stored.id, new Date());
  }

  async authenticateAccessToken(
    accessToken: string,
  ): Promise<AuthenticatedUser> {
    this.ensureEnabled();
    const principal = await this.tokenService.verifyAccessToken(accessToken);
    const user = await this.store.findUserById(principal.user.id);

    if (
      !user ||
      !user.isActive ||
      user.sessionVersion !== principal.sessionVersion
    ) {
      throw new UnauthorizedException("La cuenta no está disponible.");
    }

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles,
      permissions: user.permissions,
      mustChangePassword: user.mustChangePassword,
    };
  }

  async changePassword(
    actor: AuthenticatedUser,
    request: ChangePasswordRequest,
    context: SessionContext = {},
  ): Promise<AuthSessionResponse> {
    this.ensureEnabled();
    const user = await this.store.findUserById(actor.id);

    if (
      !user ||
      !user.isActive ||
      !(await this.passwordHasher.verify(
        request.currentPassword,
        user.passwordHash,
      ))
    ) {
      throw new UnauthorizedException("La contraseña actual no es válida.");
    }

    if (request.currentPassword === request.newPassword) {
      throw new UnauthorizedException(
        "La nueva contraseña debe ser diferente.",
      );
    }

    const now = new Date();
    const changed = await this.store.changePassword(
      user.id,
      await this.passwordHasher.hash(request.newPassword),
      now,
    );
    const updated = changed ? await this.store.findUserById(user.id) : null;

    if (!updated) {
      throw new UnauthorizedException("La cuenta no está disponible.");
    }

    const sessionId = randomUUID();
    const session = await this.tokenService.issueSession(updated, sessionId);
    await this.store.createRefreshSession(
      this.toNewSession(
        sessionId,
        updated.id,
        session.refreshToken,
        now,
        context,
      ),
    );

    return session;
  }

  private ensureEnabled(): void {
    if (!this.config.enabled) {
      throw new ServiceUnavailableException(
        "La autenticación está deshabilitada hasta configurar RqIdentityDb y los secretos JWT.",
      );
    }
  }

  private toNewSession(
    id: string,
    userId: string,
    refreshToken: string,
    now: Date,
    context: SessionContext,
  ): NewRefreshSession {
    return {
      id,
      userId,
      tokenHash: this.tokenService.hashToken(refreshToken),
      expiresAt: new Date(now.getTime() + this.config.refreshTtlSeconds * 1000),
      createdAt: now,
      userAgent: context.userAgent?.slice(0, 512) || null,
      ipAddress: context.ipAddress?.slice(0, 64) || null,
    };
  }
}
