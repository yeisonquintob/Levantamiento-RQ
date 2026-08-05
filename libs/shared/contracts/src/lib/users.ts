export type IdentityUserStatus = "ACTIVE" | "INACTIVE";

export interface IdentityRoleSummary {
  id: string;
  code: string;
  name: string;
}

export interface IdentityUserSummary {
  id: string;
  displayName: string;
  email: string;
  status: IdentityUserStatus;
  roles: readonly IdentityRoleSummary[];
  mustChangePassword: boolean;
  activeSessionCount: number;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type IdentityUserDetail = IdentityUserSummary;

export interface IdentityUserListResponse {
  items: readonly IdentityUserSummary[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface IdentityUserMetrics {
  total: number;
  active: number;
  inactive: number;
  administrators: number;
}

export interface CreateIdentityUserRequest {
  displayName: string;
  email: string;
  roleCodes: readonly string[];
  temporaryPassword?: string;
}

export interface CreateIdentityUserResponse {
  user: IdentityUserDetail;
  temporaryPassword: string;
}

export interface UpdateIdentityUserRequest {
  displayName?: string;
  email?: string;
}

export interface UpdateIdentityUserRolesRequest {
  roleCodes: readonly string[];
}

export interface ResetIdentityUserPasswordRequest {
  temporaryPassword?: string;
}

export interface ResetIdentityUserPasswordResponse {
  user: IdentityUserDetail;
  temporaryPassword: string;
}

export interface RevokeIdentityUserSessionsResponse {
  revokedSessions: number;
}
