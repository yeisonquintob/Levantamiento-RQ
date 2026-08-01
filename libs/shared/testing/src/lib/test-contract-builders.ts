import {
  asCorrelationId,
  asUtcIsoDateString,
  type IntegrationEventEnvelope,
  type ProblemDetails,
} from "@levantamiento-rq/shared-contracts";

export function createTestCorrelationId(value = "test-correlation-id") {
  return asCorrelationId(value);
}

export function createTestIntegrationEvent<
  TData extends Record<string, unknown>,
>(
  data: TData,
  overrides: Partial<Omit<IntegrationEventEnvelope<TData>, "data">> = {},
): IntegrationEventEnvelope<TData> {
  return {
    eventId: "00000000-0000-4000-8000-000000000001",
    eventName: "test.event",
    eventVersion: 1,
    occurredAtUtc: asUtcIsoDateString("2026-08-01T00:00:00.000Z"),
    producer: "test-suite",
    correlationId: createTestCorrelationId(),
    data,
    ...overrides,
  };
}

export function createTestProblemDetails(
  overrides: Partial<ProblemDetails> = {},
): ProblemDetails {
  return {
    type: "https://errors.levantamiento-rq.local/test",
    title: "Error de prueba",
    status: 400,
    detail: "Detalle de prueba.",
    instance: "/api/v1/test",
    correlationId: createTestCorrelationId(),
    timestampUtc: asUtcIsoDateString("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}
