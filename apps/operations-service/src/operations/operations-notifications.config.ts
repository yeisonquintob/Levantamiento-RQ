export const OPERATIONS_NOTIFICATIONS_CONFIG = Symbol(
  "OPERATIONS_NOTIFICATIONS_CONFIG",
);

export interface OperationsNotificationsConfig {
  queueName: string;
  retryQueueName: string;
  retryRoutingKey: string;
  maxAttempts: number;
  retryDelayMs: number;
  emailEnabled: boolean;
}

function integer(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const parsed = value?.trim() ? Number(value) : fallback;
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} debe estar entre ${minimum} y ${maximum}.`);
  }
  return parsed;
}

function queueName(value: string | undefined): string {
  const resolved = value?.trim() || "rq-operations-notifications-v1";
  if (!/^[a-zA-Z0-9._-]{3,120}$/.test(resolved)) {
    throw new Error("OPERATIONS_NOTIFICATIONS_QUEUE no es válido.");
  }
  return resolved;
}

function boolean(value: string | undefined, name: string): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "false") return false;
  if (normalized === "true") return true;
  throw new Error(`${name} debe ser true o false.`);
}

export function loadOperationsNotificationsConfig(
  environment: NodeJS.ProcessEnv = process.env,
): OperationsNotificationsConfig {
  const name = queueName(environment.OPERATIONS_NOTIFICATIONS_QUEUE);
  return {
    queueName: name,
    retryQueueName: `${name}.retry`,
    retryRoutingKey: `${name}.retry`,
    maxAttempts: integer(
      environment.OPERATIONS_NOTIFICATIONS_ATTEMPTS,
      5,
      1,
      10,
      "OPERATIONS_NOTIFICATIONS_ATTEMPTS",
    ),
    retryDelayMs: integer(
      environment.OPERATIONS_NOTIFICATIONS_RETRY_MS,
      2_000,
      500,
      60_000,
      "OPERATIONS_NOTIFICATIONS_RETRY_MS",
    ),
    emailEnabled: boolean(
      environment.OPERATIONS_EMAIL_ENABLED,
      "OPERATIONS_EMAIL_ENABLED",
    ),
  };
}
