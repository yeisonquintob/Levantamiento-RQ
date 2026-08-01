import type { UtcIsoDateString } from "./identifiers.js";

export type ServiceHealthStatus = "ok" | "degraded" | "unavailable";

export interface ServiceHealth {
  service: string;
  status: ServiceHealthStatus;
  timestampUtc: UtcIsoDateString;
  version?: string;
}
