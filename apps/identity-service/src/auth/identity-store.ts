import type { AuthenticatedUser } from "@levantamiento-rq/shared-contracts";

export const IDENTITY_STORE = Symbol("IDENTITY_STORE");

export interface IdentityUserRecord extends AuthenticatedUser {
  emailNormalized: string;
  passwordHash: string;
  isActive: boolean;
  sessionVersion: number;
}

export interface RefreshSessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedBySessionId: string | null;
}

export interface NewRefreshSession {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
}

export interface IdentityStore {
  findUserByEmailNormalized(
    emailNormalized: string,
  ): Promise<IdentityUserRecord | null>;
  findUserById(userId: string): Promise<IdentityUserRecord | null>;
  updateLastLogin(userId: string, instant: Date): Promise<void>;
  createRefreshSession(session: NewRefreshSession): Promise<void>;
  findRefreshSession(sessionId: string): Promise<RefreshSessionRecord | null>;
  rotateRefreshSession(
    currentSessionId: string,
    nextSession: NewRefreshSession,
    instant: Date,
  ): Promise<boolean>;
  revokeRefreshSession(sessionId: string, instant: Date): Promise<void>;
  changePassword(
    userId: string,
    passwordHash: string,
    instant: Date,
  ): Promise<boolean>;
}
