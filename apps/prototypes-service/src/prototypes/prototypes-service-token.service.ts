import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { importJWK, SignJWT } from "jose";
import {
  PROTOTYPES_AUTH_CONFIG,
  type PrototypesAuthConfig,
} from "./prototypes-auth.config";
const SERVICE_USER_ID = "00000000-0000-4000-8000-000000000009";
@Injectable()
export class PrototypesServiceToken {
  constructor(
    @Inject(PROTOTYPES_AUTH_CONFIG)
    private readonly config: PrototypesAuthConfig,
  ) {}
  async issue(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const key = await importJWK(
      JSON.parse(
        Buffer.from(this.config.workloadPrivateJwk, "base64").toString("utf8"),
      ),
      "EdDSA",
    );
    return new SignJWT({
      typ: "access",
      sid: randomUUID(),
      email: "prototypes-service@internal.local",
      name: "Prototypes Service",
      roles: ["SERVICE"],
      permissions: ["ai.prototype-plan.execute"],
      mustChangePassword: false,
      service: "prototypes-service",
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
      .sign(key);
  }
}
