import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { SignJWT } from "jose";

import type { AuthenticatedUser } from "@levantamiento-rq/shared-contracts";

import {
  AI_ANALYSIS_AUTH_CONFIG,
  type AiAnalysisAuthConfig,
} from "./ai-analysis-auth.config";

const SERVICE_USER_ID = "00000000-0000-4000-8000-000000000005";

export const AI_ANALYSIS_SERVICE_ACTOR: AuthenticatedUser = {
  id: SERVICE_USER_ID,
  email: "ai-analysis-service@internal.local",
  displayName: "AI Analysis Service",
  roles: ["ADMIN"],
  permissions: ["system.admin"],
  mustChangePassword: false,
};

@Injectable()
export class AiAnalysisServiceToken {
  constructor(
    @Inject(AI_ANALYSIS_AUTH_CONFIG)
    private readonly config: AiAnalysisAuthConfig,
  ) {}

  issue(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      typ: "access",
      sid: randomUUID(),
      email: AI_ANALYSIS_SERVICE_ACTOR.email,
      name: AI_ANALYSIS_SERVICE_ACTOR.displayName,
      roles: [...AI_ANALYSIS_SERVICE_ACTOR.roles],
      permissions: [...AI_ANALYSIS_SERVICE_ACTOR.permissions],
      mustChangePassword: false,
      service: "ai-analysis-service",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(SERVICE_USER_ID)
      .setIssuer(this.config.issuer)
      .setAudience(this.config.audience)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .setJti(randomUUID())
      .sign(new TextEncoder().encode(this.config.accessSecret));
  }
}
