import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { importJWK, SignJWT } from "jose";

import type { AuthenticatedUser } from "@levantamiento-rq/shared-contracts";

import {
  OPERATIONS_AUTH_CONFIG,
  type OperationsAuthConfig,
} from "./operations-auth.config";

const SERVICE_USER_ID = "00000000-0000-4000-8000-000000000008";

export const OPERATIONS_SERVICE_ACTOR: AuthenticatedUser = {
  id: SERVICE_USER_ID,
  email: "operations-service@internal.local",
  displayName: "Operations Service",
  roles: ["SERVICE"],
  permissions: [
    "projects.read.all",
    "documents.approved.read",
    "templates.published.read",
  ],
  mustChangePassword: false,
};

@Injectable()
export class OperationsServiceToken {
  constructor(
    @Inject(OPERATIONS_AUTH_CONFIG)
    private readonly config: OperationsAuthConfig,
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
      email: OPERATIONS_SERVICE_ACTOR.email,
      name: OPERATIONS_SERVICE_ACTOR.displayName,
      roles: [...OPERATIONS_SERVICE_ACTOR.roles],
      permissions: [...OPERATIONS_SERVICE_ACTOR.permissions],
      mustChangePassword: false,
      service: "operations-service",
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
