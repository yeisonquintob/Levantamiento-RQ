import type { AuthenticatedUser } from "@levantamiento-rq/shared-contracts";

export interface AiAnalysisRequest {
  headers: Readonly<Record<string, string | string[] | undefined>>;
  authPrincipal?: AuthenticatedUser;
  accessToken?: string;
  correlationId?: string;
}
