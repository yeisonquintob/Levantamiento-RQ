import { randomUUID } from "node:crypto";

import {
  asCorrelationId,
  type CorrelationId,
} from "@levantamiento-rq/shared-contracts";

export const CORRELATION_ID_HEADER = "x-correlation-id";

export interface CorrelationAwareRequest {
  headers?: Readonly<Record<string, unknown>>;
  correlationId?: CorrelationId;
  url?: string;
  raw?: {
    url?: string;
  };
}

export interface HeaderCapableResponse {
  header?: (name: string, value: string) => unknown;
  setHeader?: (name: string, value: string) => unknown;
}

export function resolveCorrelationId(value: unknown): CorrelationId {
  const candidate = Array.isArray(value) ? value[0] : value;

  if (typeof candidate === "string" && candidate.trim()) {
    return asCorrelationId(candidate.trim());
  }

  return asCorrelationId(randomUUID());
}

export function setCorrelationIdHeader(
  response: HeaderCapableResponse,
  correlationId: CorrelationId,
): void {
  if (typeof response.header === "function") {
    response.header(CORRELATION_ID_HEADER, correlationId);
    return;
  }

  if (typeof response.setHeader === "function") {
    response.setHeader(CORRELATION_ID_HEADER, correlationId);
  }
}
