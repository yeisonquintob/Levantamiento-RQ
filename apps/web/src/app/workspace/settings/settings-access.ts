export interface SettingsAccessUser {
  roles: readonly string[];
  permissions: readonly string[];
}

export function canManageTemplates(user: SettingsAccessUser): boolean {
  return (
    user.roles.some((role) => role.toUpperCase() === "ADMIN") ||
    user.permissions.includes("system.admin") ||
    user.permissions.includes("documents.templates.manage")
  );
}

export function canManageSystem(user: SettingsAccessUser): boolean {
  return user.permissions.includes("system.admin");
}
