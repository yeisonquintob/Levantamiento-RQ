export type AuditChangeValue =
  string | number | boolean | null | readonly string[];
export interface AuditFieldChange {
  field: string;
  before: AuditChangeValue;
  after: AuditChangeValue;
}
export interface AuditHistoryEvent {
  id: string;
  occurredAt: string;
  action: string;
  actorUserId: string | null;
  actorName: string | null;
  resourceId: string | null;
  resourceLabel: string;
  projectId: string | null;
  result: "SUCCEEDED" | "FAILED" | "DENIED";
  changes: readonly AuditFieldChange[];
  details: string | null;
}
export interface AuditHistoryResponse {
  items: readonly AuditHistoryEvent[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export function auditFieldChanges(
  before: Record<string, AuditChangeValue>,
  after: Record<string, AuditChangeValue>,
): AuditFieldChange[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(
    (field) => {
      const previous = before[field] ?? null,
        next = after[field] ?? null;
      return JSON.stringify(previous) === JSON.stringify(next)
        ? []
        : [{ field, before: previous, after: next }];
    },
  );
}

export function auditMetadata(json: string | null): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(json ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function auditMetadataChanges(
  metadata: Record<string, unknown>,
  allowedFields: readonly string[],
): AuditFieldChange[] {
  const safeValue = (value: unknown): value is AuditChangeValue =>
    value === null ||
    ["string", "number", "boolean"].includes(typeof value) ||
    (Array.isArray(value) && value.every((item) => typeof item === "string"));
  return Array.isArray(metadata.changes)
    ? metadata.changes.filter(
        (item): item is AuditFieldChange =>
          Boolean(item) &&
          typeof item === "object" &&
          allowedFields.includes(item.field) &&
          safeValue(item.before) &&
          safeValue(item.after),
      )
    : [];
}

export const AI_AUDIT_FIELDS = [
  "name",
  "purpose",
  "providerType",
  "model",
  "baseUrl",
  "isEnabled",
  "isDefault",
  "timeoutMs",
  "maxInputTokens",
  "maxOutputTokens",
  "maxAttempts",
  "credential",
] as const;
export const USER_AUDIT_FIELDS = [
  "displayName",
  "email",
  "roles",
  "isActive",
  "password",
  "sessions",
] as const;
export const PROJECT_AUDIT_FIELDS = [
  "title",
  "requestingArea",
  "description",
  "status",
  "template",
  "participant",
  "role",
] as const;
