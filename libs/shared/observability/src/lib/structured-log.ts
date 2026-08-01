import {
  asUtcIsoDateString,
  type CorrelationId,
  type UtcIsoDateString,
} from "@levantamiento-rq/shared-contracts";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  service: string;
  correlationId?: CorrelationId;
  operation?: string;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface StructuredLogEntry {
  level: LogLevel;
  message: string;
  service: string;
  timestampUtc: UtcIsoDateString;
  correlationId?: CorrelationId;
  operation?: string;
  metadata?: Readonly<Record<string, unknown>>;
}

export function createStructuredLogEntry(
  level: LogLevel,
  message: string,
  context: LogContext,
  now: () => Date = () => new Date(),
): StructuredLogEntry {
  return {
    level,
    message,
    service: context.service,
    timestampUtc: asUtcIsoDateString(now().toISOString()),
    ...(context.correlationId === undefined
      ? {}
      : { correlationId: context.correlationId }),
    ...(context.operation === undefined
      ? {}
      : { operation: context.operation }),
    ...(context.metadata === undefined ? {} : { metadata: context.metadata }),
  };
}
