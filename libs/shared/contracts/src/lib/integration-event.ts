import type { CorrelationId, UtcIsoDateString } from "./identifiers.js";

export const INTEGRATION_EVENT_NAMES = [
  "source.ready",
  "analysis.requested",
  "analysis.started",
  "analysis.completed",
  "analysis.failed",
  "review.requested",
  "review.changes-requested",
  "document.approved",
  "document.rejected",
  "export.requested",
  "export.completed",
  "export.failed",
] as const;

export type IntegrationEventName = (typeof INTEGRATION_EVENT_NAMES)[number];

export interface IntegrationEventEnvelope<
  TData extends Record<string, unknown> = Record<string, unknown>,
> {
  eventId: string;
  eventName: IntegrationEventName;
  eventVersion: number;
  occurredAtUtc: UtcIsoDateString;
  producer: string;
  correlationId: CorrelationId;
  causationId?: string;
  organizationId?: string;
  data: TData;
}
