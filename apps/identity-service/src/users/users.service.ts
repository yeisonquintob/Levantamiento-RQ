import { randomBytes, randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  DataSource,
  In,
  IsNull,
  MoreThan,
  Repository,
} from "typeorm";

import type {
  AuthenticatedUser,
  CreateIdentityUserResponse,
  IdentityRoleSummary,
  IdentityUserDetail,
  IdentityUserListResponse,
  IdentityUserMetrics,
  IdentityUserStatus,
  ResetIdentityUserPasswordResponse,
  RevokeIdentityUserSessionsResponse,
} from "@levantamiento-rq/shared-contracts";

import { PasswordHasher } from "../auth/password-hasher";
import {
  RefreshSessionEntity,
  RoleEntity,
  SecurityAuditEntity,
  UserEntity,
  UserRoleEntity,
} from "../identity/entities";

export interface UserListQuery {
  page: number;
  pageSize: number;
  search?: string;
  status?: IdentityUserStatus;
  roleCode?: string;
}

export interface CreateUserInput {
  displayName: string;
  email: string;
  roleCodes: readonly string[];
  temporaryPassword?: string;
}

export interface UpdateUserInput {
  displayName?: string;
  email?: string;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function statusOf(user: UserEntity): IdentityUserStatus {
  return user.isActive ? "ACTIVE" : "INACTIVE";
}

function roleSummary(role: RoleEntity): IdentityRoleSummary {
  return { id: role.id, code: role.code, name: role.name };
}

export function generateTemporaryPassword(): string {
  return `Rq!${randomBytes(15).toString("base64url")}9a`;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(RoleEntity)
    private readonly roles: Repository<RoleEntity>,
    @InjectRepository(RefreshSessionEntity)
    private readonly sessions: Repository<RefreshSessionEntity>,
    private readonly dataSource: DataSource,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async list(query: UserListQuery): Promise<IdentityUserListResponse> {
    const builder = this.userQuery();

    if (query.search) {
      builder.andWhere(
        "(identityUser.DisplayName LIKE :search OR identityUser.Email LIKE :search)",
        { search: `%${query.search}%` },
      );
    }

    if (query.status) {
      builder.andWhere("identityUser.IsActive = :isActive", {
        isActive: query.status === "ACTIVE",
      });
    }

    if (query.roleCode) {
      builder.andWhere(
        `EXISTS (
          SELECT 1 FROM dbo.IdentityUserRoles filterUserRole
          INNER JOIN dbo.IdentityRoles filterRole
            ON filterRole.Id = filterUserRole.RoleId
          WHERE filterUserRole.UserId = identityUser.Id
            AND filterRole.Code = :roleCode
            AND filterRole.IsActive = 1
        )`,
        { roleCode: query.roleCode },
      );
    }

    const [items, totalItems] = await builder
      .orderBy("identityUser.updatedAt", "DESC")
      .addOrderBy("identityUser.displayName", "ASC")
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
      .getManyAndCount();

    return {
      items: await Promise.all(items.map((item) => this.toDetail(item))),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  async metrics(): Promise<IdentityUserMetrics> {
    const [total, active, administrators] = await Promise.all([
      this.users.count(),
      this.users.count({ where: { isActive: true } }),
      this.users
        .createQueryBuilder("identityUser")
        .innerJoin("identityUser.userRoles", "userRole")
        .innerJoin("userRole.role", "role")
        .where("identityUser.IsActive = 1")
        .andWhere("role.IsActive = 1")
        .andWhere("role.Code = :code", { code: "ADMIN" })
        .getCount(),
    ]);

    return { total, active, inactive: total - active, administrators };
  }

  async getById(userId: string): Promise<IdentityUserDetail> {
    return this.toDetail(await this.requireUser(userId));
  }

  async availableRoles(): Promise<readonly IdentityRoleSummary[]> {
    const roles = await this.roles.find({
      where: { isActive: true },
      order: { name: "ASC" },
    });

    return roles.map(roleSummary);
  }

  async create(
    actor: AuthenticatedUser,
    input: CreateUserInput,
  ): Promise<CreateIdentityUserResponse> {
    const emailNormalized = normalizeEmail(input.email);

    if (await this.users.exists({ where: { emailNormalized } })) {
      throw new ConflictException("Ya existe una cuenta con ese correo.");
    }

    const selectedRoles = await this.requireRoles(input.roleCodes);
    const temporaryPassword =
      input.temporaryPassword ?? generateTemporaryPassword();
    const passwordHash = await this.passwordHasher.hash(temporaryPassword);
    const now = new Date();
    const userId = await this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(UserEntity);
      const user = users.create({
        id: randomUUID(),
        email: input.email.trim(),
        emailNormalized,
        displayName: input.displayName.trim(),
        passwordHash,
        isActive: true,
        mustChangePassword: true,
        sessionVersion: 1,
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now,
      });
      const saved = await users.save(user);

      await manager.getRepository(UserRoleEntity).insert(
        selectedRoles.map((role) => ({
          userId: saved.id,
          roleId: role.id,
          createdAt: now,
        })),
      );
      await this.audit(
        manager,
        "USER_CREATED",
        actor.id,
        saved.id,
        { roles: selectedRoles.map((role) => role.code) },
        now,
      );

      return saved.id;
    });

    return {
      user: await this.getById(userId),
      temporaryPassword,
    };
  }

  async update(
    actor: AuthenticatedUser,
    userId: string,
    input: UpdateUserInput,
  ): Promise<IdentityUserDetail> {
    const user = await this.requireUser(userId);
    const changedFields: string[] = [];

    if (input.email !== undefined) {
      const normalized = normalizeEmail(input.email);
      const duplicate = await this.users.findOne({
        where: { emailNormalized: normalized },
      });

      if (duplicate && duplicate.id !== userId) {
        throw new ConflictException("Ya existe una cuenta con ese correo.");
      }

      user.email = input.email.trim();
      user.emailNormalized = normalized;
      changedFields.push("email");
    }

    if (input.displayName !== undefined) {
      user.displayName = input.displayName.trim();
      changedFields.push("displayName");
    }

    if (changedFields.length === 0) {
      throw new BadRequestException("Debes enviar al menos un cambio.");
    }

    const now = new Date();
    user.updatedAt = now;
    await this.users.save(user);
    await this.writeAudit("USER_UPDATED", actor.id, userId, {
      fields: changedFields,
    });

    return this.getById(userId);
  }

  async setRoles(
    actor: AuthenticatedUser,
    userId: string,
    roleCodes: readonly string[],
  ): Promise<IdentityUserDetail> {
    const user = await this.requireUser(userId);
    const selectedRoles = await this.requireRoles(roleCodes);
    const previousCodes = new Set(
      user.userRoles.map((item) => item.role.code),
    );
    const nextCodes = new Set(selectedRoles.map((role) => role.code));

    await this.protectLastAdministrator(
      user,
      user.isActive && nextCodes.has("ADMIN"),
    );

    const added = [...nextCodes].filter((code) => !previousCodes.has(code));
    const removed = [...previousCodes].filter((code) => !nextCodes.has(code));
    const now = new Date();

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(UserRoleEntity).delete({ userId });
      await manager.getRepository(UserRoleEntity).insert(
        selectedRoles.map((role) => ({
          userId,
          roleId: role.id,
          createdAt: now,
        })),
      );
      await manager.getRepository(UserEntity).increment(
        { id: userId },
        "sessionVersion",
        1,
      );
      await manager.getRepository(UserEntity).update(
        { id: userId },
        { updatedAt: now },
      );
      await this.revokeSessions(manager, userId, now);

      for (const code of added) {
        await this.audit(manager, "ROLE_ASSIGNED", actor.id, userId, { code }, now);
      }
      for (const code of removed) {
        await this.audit(manager, "ROLE_REMOVED", actor.id, userId, { code }, now);
      }
    });

    return this.getById(userId);
  }

  activate(actor: AuthenticatedUser, userId: string): Promise<IdentityUserDetail> {
    return this.setActive(actor, userId, true);
  }

  deactivate(actor: AuthenticatedUser, userId: string): Promise<IdentityUserDetail> {
    return this.setActive(actor, userId, false);
  }

  async resetPassword(
    actor: AuthenticatedUser,
    userId: string,
    requestedPassword?: string,
  ): Promise<ResetIdentityUserPasswordResponse> {
    await this.requireUser(userId);
    const temporaryPassword = requestedPassword ?? generateTemporaryPassword();
    const passwordHash = await this.passwordHasher.hash(temporaryPassword);
    const now = new Date();

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(UserEntity).increment(
        { id: userId },
        "sessionVersion",
        1,
      );
      await manager.getRepository(UserEntity).update(
        { id: userId },
        { passwordHash, mustChangePassword: true, updatedAt: now },
      );
      await this.revokeSessions(manager, userId, now);
      await this.audit(
        manager,
        "PASSWORD_RESET",
        actor.id,
        userId,
        null,
        now,
      );
    });

    return { user: await this.getById(userId), temporaryPassword };
  }

  async revokeAllSessions(
    actor: AuthenticatedUser,
    userId: string,
  ): Promise<RevokeIdentityUserSessionsResponse> {
    await this.requireUser(userId);
    const now = new Date();
    let revokedSessions = 0;

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(UserEntity).increment(
        { id: userId },
        "sessionVersion",
        1,
      );
      await manager.getRepository(UserEntity).update(
        { id: userId },
        { updatedAt: now },
      );
      revokedSessions = await this.revokeSessions(manager, userId, now);
      await this.audit(
        manager,
        "SESSIONS_REVOKED",
        actor.id,
        userId,
        { count: revokedSessions },
        now,
      );
    });

    return { revokedSessions };
  }

  private async setActive(
    actor: AuthenticatedUser,
    userId: string,
    isActive: boolean,
  ): Promise<IdentityUserDetail> {
    const user = await this.requireUser(userId);

    if (!isActive) {
      await this.protectLastAdministrator(user, false);
    }

    if (user.isActive === isActive) {
      return this.toDetail(user);
    }

    const now = new Date();
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(UserEntity).increment(
        { id: userId },
        "sessionVersion",
        1,
      );
      await manager.getRepository(UserEntity).update(
        { id: userId },
        { isActive, updatedAt: now },
      );
      await this.revokeSessions(manager, userId, now);
      await this.audit(
        manager,
        isActive ? "USER_ACTIVATED" : "USER_DEACTIVATED",
        actor.id,
        userId,
        null,
        now,
      );
    });

    return this.getById(userId);
  }

  private async protectLastAdministrator(
    user: UserEntity,
    remainsActiveAdministrator: boolean,
  ): Promise<void> {
    const isActiveAdministrator =
      user.isActive &&
      user.userRoles.some(
        (item) => item.role.isActive && item.role.code === "ADMIN",
      );

    if (!isActiveAdministrator || remainsActiveAdministrator) return;

    const activeAdministrators = await this.users
      .createQueryBuilder("identityUser")
      .innerJoin("identityUser.userRoles", "userRole")
      .innerJoin("userRole.role", "role")
      .where("identityUser.IsActive = 1")
      .andWhere("role.IsActive = 1")
      .andWhere("role.Code = :code", { code: "ADMIN" })
      .getCount();

    if (activeAdministrators <= 1) {
      throw new BadRequestException(
        "No puedes retirar o desactivar el último administrador activo.",
      );
    }
  }

  private async requireRoles(codes: readonly string[]): Promise<RoleEntity[]> {
    const normalized = [...new Set(codes.map((code) => code.toUpperCase()))];
    const roles = await this.roles.find({
      where: { code: In(normalized), isActive: true },
    });

    if (roles.length !== normalized.length) {
      throw new BadRequestException("Uno o más roles no existen o están inactivos.");
    }

    return roles;
  }

  private async requireUser(userId: string): Promise<UserEntity> {
    const user = await this.userQuery()
      .where("identityUser.id = :userId", { userId })
      .getOne();

    if (!user) throw new NotFoundException("El usuario no existe.");
    return user;
  }

  private userQuery() {
    return this.users
      .createQueryBuilder("identityUser")
      .leftJoinAndSelect("identityUser.userRoles", "userRole")
      .leftJoinAndSelect("userRole.role", "role");
  }

  private async toDetail(user: UserEntity): Promise<IdentityUserDetail> {
    const activeSessionCount = await this.sessions.count({
      where: {
        userId: user.id,
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
    });
    const roles = user.userRoles
      .map((item) => item.role)
      .filter((role) => role?.isActive)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(roleSummary);

    return {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      status: statusOf(user),
      roles,
      mustChangePassword: user.mustChangePassword,
      activeSessionCount,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  private async revokeSessions(
    manager: DataSource["manager"],
    userId: string,
    instant: Date,
  ): Promise<number> {
    const result = await manager
      .getRepository(RefreshSessionEntity)
      .createQueryBuilder()
      .update(RefreshSessionEntity)
      .set({ revokedAt: instant, lastUsedAt: instant })
      .where("UserId = :userId", { userId })
      .andWhere("RevokedAt IS NULL")
      .execute();

    return result.affected ?? 0;
  }

  private writeAudit(
    eventType: string,
    actorUserId: string,
    targetUserId: string,
    detail: Readonly<Record<string, unknown>> | null,
  ): Promise<void> {
    return this.audit(
      this.dataSource.manager,
      eventType,
      actorUserId,
      targetUserId,
      detail,
      new Date(),
    );
  }

  private async audit(
    manager: DataSource["manager"],
    eventType: string,
    actorUserId: string,
    targetUserId: string,
    detail: Readonly<Record<string, unknown>> | null,
    createdAt: Date,
  ): Promise<void> {
    await manager.getRepository(SecurityAuditEntity).insert({
      id: randomUUID(),
      eventType,
      actorUserId,
      targetUserId,
      detail: detail ? JSON.stringify(detail) : null,
      createdAt,
    });
  }
}
