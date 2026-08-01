import type { CorrelationId, UtcIsoDateString } from "./identifiers.js";

export interface IntegrationEventEnvelope<
  TData extends Record<string, unknown> = Record<string, unknown>,
> {
  eventId: string;
  eventName: string;
  eventVersion: number;
  occurredAtUtc: UtcIsoDateString;
  producer: string;
  correlationId: CorrelationId;
  causationId?: string;
  organizationId?: string;
  data: TData;
}
