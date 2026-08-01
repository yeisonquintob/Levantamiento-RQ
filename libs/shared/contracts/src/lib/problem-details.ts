import type { CorrelationId, UtcIsoDateString } from "./identifiers.js";

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  correlationId: CorrelationId;
  timestampUtc: UtcIsoDateString;
  errors?: Readonly<Record<string, readonly string[]>>;
  metadata?: Readonly<Record<string, unknown>>;
}
