import type { AuthenticatedUser } from "@levantamiento-rq/shared-contracts";

export interface SourcesRequest {
  headers: Readonly<Record<string, string | string[] | undefined>>;
  authPrincipal?: AuthenticatedUser;
  accessToken?: string;
}
