import type { AuthenticatedUser } from "@levantamiento-rq/shared-contracts";

export interface AuthenticatedRequest {
  headers: Readonly<Record<string, string | string[] | undefined>>;
  authPrincipal?: AuthenticatedUser;
}
