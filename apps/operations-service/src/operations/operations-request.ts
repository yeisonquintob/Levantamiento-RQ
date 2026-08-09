import type { AuthenticatedUser } from "@levantamiento-rq/shared-contracts";

export interface OperationsRequest {
  headers: Readonly<Record<string, string | string[] | undefined>>;
  ip?: string;
  authPrincipal?: AuthenticatedUser;
  accessToken?: string;
  correlationId?: string;
  idempotencyKey?: string | null;
}
