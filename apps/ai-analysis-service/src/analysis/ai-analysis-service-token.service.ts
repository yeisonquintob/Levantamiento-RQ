import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { importJWK, SignJWT } from "jose";

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
  roles: ["SERVICE"],
  permissions: [
    "projects.read.all",
    "documents.read.all",
    "documents.ai.apply",
    "sources.internal-image.read",
  ],
  mustChangePassword: false,
};

@Injectable()
export class AiAnalysisServiceToken {
  constructor(
    @Inject(AI_ANALYSIS_AUTH_CONFIG)
    private readonly config: AiAnalysisAuthConfig,
  ) {}

  async issue(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const privateKey = await importJWK(
      JSON.parse(
        Buffer.from(this.config.workloadPrivateJwk, "base64").toString("utf8"),
      ),
      "EdDSA",
    );
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
      .setProtectedHeader({
        alg: "EdDSA",
        kid: this.config.workloadKeyId,
        typ: "JWT",
      })
      .setSubject(SERVICE_USER_ID)
      .setIssuer(this.config.issuer)
      .setAudience(this.config.audience)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .setJti(randomUUID())
      .sign(privateKey);
  }
}
