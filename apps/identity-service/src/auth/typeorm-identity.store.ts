import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";

import {
  RefreshSessionEntity,
  UserEntity,
} from "../identity/entities";
import type {
  IdentityStore,
  IdentityUserRecord,
  NewRefreshSession,
  RefreshSessionRecord,
} from "./identity-store";

function mapUser(user: UserEntity): IdentityUserRecord {
  const activeRoles = (user.userRoles ?? [])
    .map((userRole) => userRole.role)
    .filter((role) => role?.isActive);
  const roles = [...new Set(activeRoles.map((role) => role.code))].sort();
  const permissions = [
    ...new Set(
      activeRoles.flatMap((role) =>
        (role.rolePermissions ?? [])
          .map((item) => item.permission?.code)
          .filter((code): code is string => Boolean(code)),
      ),
    ),
  ].sort();

  return {
    id: user.id,
    email: user.email,
    emailNormalized: user.emailNormalized,
    displayName: user.displayName,
    passwordHash: user.passwordHash,
    isActive: user.isActive,
    roles,
    permissions,
  };
}

function mapSession(
  session: RefreshSessionEntity,
): RefreshSessionRecord {
  return {
    id: session.id,
    userId: session.userId,
    tokenHash: session.tokenHash,
    expiresAt: session.expiresAt,
    revokedAt: session.revokedAt,
    replacedBySessionId: session.replacedBySessionId,
  };
}

@Injectable()
export class TypeOrmIdentityStore implements IdentityStore {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(RefreshSessionEntity)
    private readonly sessions: Repository<RefreshSessionEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async findUserByEmailNormalized(
    emailNormalized: string,
  ): Promise<IdentityUserRecord | null> {
    const user = await this.userQuery()
      .where("identityUser.EmailNormalized = :emailNormalized", {
        emailNormalized,
      })
      .getOne();

    return user ? mapUser(user) : null;
  }

  async findUserById(
    userId: string,
  ): Promise<IdentityUserRecord | null> {
    const user = await this.userQuery()
      .where("identityUser.Id = :userId", { userId })
      .getOne();

    return user ? mapUser(user) : null;
  }

  async updateLastLogin(userId: string, instant: Date): Promise<void> {
    await this.users.update(
      { id: userId },
      { lastLoginAt: instant, updatedAt: instant },
    );
  }

  async createRefreshSession(
    session: NewRefreshSession,
  ): Promise<void> {
    await this.sessions.insert({
      ...session,
      revokedAt: null,
      replacedBySessionId: null,
      createdAt: new Date(),
      lastUsedAt: null,
    });
  }

  async findRefreshSession(
    sessionId: string,
  ): Promise<RefreshSessionRecord | null> {
    const session = await this.sessions.findOne({
      where: { id: sessionId },
    });

    return session ? mapSession(session) : null;
  }

  async rotateRefreshSession(
    currentSessionId: string,
    nextSession: NewRefreshSession,
    instant: Date,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(RefreshSessionEntity);
      const current = await repository.findOne({
        where: { id: currentSessionId },
        lock: { mode: "pessimistic_write" },
      });

      if (!current || current.revokedAt) {
        return false;
      }

      current.revokedAt = instant;
      current.lastUsedAt = instant;
      current.replacedBySessionId = nextSession.id;

      await repository.save(current);
      await repository.insert({
        ...nextSession,
        revokedAt: null,
        replacedBySessionId: null,
        createdAt: instant,
        lastUsedAt: null,
      });

      return true;
    });
  }

  async revokeRefreshSession(
    sessionId: string,
    instant: Date,
  ): Promise<void> {
    await this.sessions
      .createQueryBuilder()
      .update(RefreshSessionEntity)
      .set({ revokedAt: instant, lastUsedAt: instant })
      .where("Id = :sessionId", { sessionId })
      .andWhere("RevokedAt IS NULL")
      .execute();
  }

  private userQuery() {
    return this.users
      .createQueryBuilder("identityUser")
      .leftJoinAndSelect("identityUser.userRoles", "userRole")
      .leftJoinAndSelect("userRole.role", "role")
      .leftJoinAndSelect("role.rolePermissions", "rolePermission")
      .leftJoinAndSelect("rolePermission.permission", "permission");
  }
}
