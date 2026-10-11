import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { createRemoteJWKSet, jwtVerify } from "jose";

import type { AuthSessionResponse } from "@levantamiento-rq/shared-contracts";

import { AuthService, type SessionContext } from "./auth-service";
import {
  MICROSOFT_AUTH_CONFIG,
  type MicrosoftAuthConfig,
} from "./microsoft-auth-config";

const LOGIN_HOST = "https://login.microsoftonline.com";
const REQUEST_TIMEOUT_MS = 8000;

interface TransactionPayload {
  s: string;
  n: string;
  v: string;
  o: string;
  e: number;
}

export interface MicrosoftAuthorization {
  authorizationUrl: string;
  transaction: string;
}

export interface MicrosoftSignInResult {
  session: AuthSessionResponse;
  webOrigin: string;
}

function base64Url(value: Buffer): string {
  return value.toString("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

@Injectable()
export class MicrosoftAuthService {
  private keySet: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(
    @Inject(MICROSOFT_AUTH_CONFIG)
    private readonly config: MicrosoftAuthConfig,
    private readonly authService: AuthService,
  ) {}

  authorize(webOrigin: string): MicrosoftAuthorization {
    this.ensureEnabled();

    const state = base64Url(randomBytes(32));
    const nonce = base64Url(randomBytes(32));
    const verifier = base64Url(randomBytes(48));
    const challenge = base64Url(createHash("sha256").update(verifier).digest());

    const transaction = this.seal({
      s: state,
      n: nonce,
      v: verifier,
      o: webOrigin,
      e: Date.now() + this.config.transactionTtlSeconds * 1000,
    });

    const url = new URL(
      `${LOGIN_HOST}/${this.config.tenantId}/oauth2/v2.0/authorize`,
    );
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: "code",
      redirect_uri: this.config.redirectUri,
      response_mode: "query",
      scope: "openid profile email",
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();

    return { authorizationUrl: url.toString(), transaction };
  }

  async complete(
    input: { code: string; state: string; transaction: string },
    context: SessionContext,
  ): Promise<MicrosoftSignInResult> {
    this.ensureEnabled();

    const transaction = this.open(input.transaction);
    if (!safeEqual(transaction.s, input.state)) {
      throw new UnauthorizedException("La solicitud de acceso no es válida.");
    }

    const idToken = await this.exchangeCode(input.code, transaction.v);
    const email = await this.verifiedEmail(idToken, transaction.n);

    const session = await this.authService.signInWithExternalIdentity(
      email,
      "MICROSOFT",
      context,
    );

    return { session, webOrigin: transaction.o };
  }

  private ensureEnabled(): void {
    if (!this.config.enabled) {
      throw new ServiceUnavailableException(
        "El acceso con Microsoft no está configurado.",
      );
    }
  }

  private async exchangeCode(code: string, verifier: string): Promise<string> {
    let response: Response;
    try {
      response = await fetch(
        `${LOGIN_HOST}/${this.config.tenantId}/oauth2/v2.0/token`,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
            grant_type: "authorization_code",
            code,
            redirect_uri: this.config.redirectUri,
            code_verifier: verifier,
            scope: "openid profile email",
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
    } catch {
      throw new ServiceUnavailableException(
        "Microsoft no está disponible en este momento.",
      );
    }

    const payload = (await response.json().catch(() => null)) as {
      id_token?: unknown;
    } | null;

    if (!response.ok || typeof payload?.id_token !== "string") {
      throw new UnauthorizedException("Microsoft rechazó el acceso.");
    }

    return payload.id_token;
  }

  private async verifiedEmail(idToken: string, nonce: string): Promise<string> {
    this.keySet ??= createRemoteJWKSet(
      new URL(`${LOGIN_HOST}/${this.config.tenantId}/discovery/v2.0/keys`),
      { timeoutDuration: REQUEST_TIMEOUT_MS },
    );

    let claims: Record<string, unknown>;
    try {
      const verified = await jwtVerify(idToken, this.keySet, {
        issuer: `${LOGIN_HOST}/${this.config.tenantId}/v2.0`,
        audience: this.config.clientId,
        algorithms: ["RS256"],
      });
      claims = verified.payload as Record<string, unknown>;
    } catch {
      throw new UnauthorizedException("La identidad de Microsoft no es válida.");
    }

    if (
      typeof claims.nonce !== "string" ||
      !safeEqual(claims.nonce, nonce) ||
      claims.tid !== this.config.tenantId
    ) {
      throw new UnauthorizedException("La identidad de Microsoft no es válida.");
    }

    const candidate = [claims.email, claims.preferred_username, claims.upn].find(
      (value): value is string =>
        typeof value === "string" && /^[^@\s]+@[^@\s]+$/u.test(value),
    );

    if (!candidate) {
      throw new UnauthorizedException(
        "Microsoft no entregó un correo para la cuenta.",
      );
    }

    const domain = candidate.split("@")[1]?.toLowerCase() ?? "";
    if (
      this.config.allowedEmailDomains.length > 0 &&
      !this.config.allowedEmailDomains.includes(domain)
    ) {
      throw new UnauthorizedException(
        "El dominio de la cuenta de Microsoft no está permitido.",
      );
    }

    return candidate;
  }

  private signature(body: string): string {
    return createHmac(
      "sha256",
      createHmac("sha256", this.config.transactionSecret)
        .update("rq-microsoft-oidc-transaction")
        .digest(),
    )
      .update(body)
      .digest("base64url");
  }

  private seal(payload: TransactionPayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${body}.${this.signature(body)}`;
  }

  private open(token: string): TransactionPayload {
    const [body, signature, ...rest] = token.split(".");
    if (!body || !signature || rest.length > 0) {
      throw new UnauthorizedException("La solicitud de acceso no es válida.");
    }
    if (!safeEqual(this.signature(body), signature)) {
      throw new UnauthorizedException("La solicitud de acceso no es válida.");
    }

    let payload: TransactionPayload;
    try {
      payload = JSON.parse(
        Buffer.from(body, "base64url").toString("utf8"),
      ) as TransactionPayload;
    } catch {
      throw new UnauthorizedException("La solicitud de acceso no es válida.");
    }

    if (
      typeof payload.s !== "string" ||
      typeof payload.n !== "string" ||
      typeof payload.v !== "string" ||
      typeof payload.o !== "string" ||
      typeof payload.e !== "number" ||
      payload.e < Date.now()
    ) {
      throw new UnauthorizedException("La solicitud de acceso expiró.");
    }

    return payload;
  }
}
