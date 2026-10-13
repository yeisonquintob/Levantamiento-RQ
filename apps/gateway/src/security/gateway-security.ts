import {
  verifyAccessJwt,
  type JwtAccessVerificationConfig,
} from "@levantamiento-rq/shared-http";

import { ACCESS_COOKIE, readCookie } from "../auth/cookies";

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface RateLimitEntry {
  attempts: number;
  resetAt: number;
}

export class InMemorySlidingWindowLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();

  constructor(
    private readonly maximumAttempts: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  consume(key: string): RateLimitDecision {
    const instant = this.now();
    const normalizedKey = key.trim() || "unknown";
    const current = this.entries.get(normalizedKey);

    if (!current || current.resetAt <= instant) {
      this.entries.set(normalizedKey, {
        attempts: 1,
        resetAt: instant + this.windowMs,
      });
      this.prune(instant);
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (current.attempts >= this.maximumAttempts) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((current.resetAt - instant) / 1000),
        ),
      };
    }

    current.attempts += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private prune(instant: number): void {
    if (this.entries.size < 10_000) return;

    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= instant) this.entries.delete(key);
    }
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isBrowserMutationAllowed(input: {
  hasSessionCookie?: boolean;
  method: string;
  origin?: string;
  secFetchSite?: string;
  webOrigins: readonly string[];
}): boolean {
  if (input.secFetchSite?.toLowerCase() === "cross-site") return false;
  if (SAFE_METHODS.has(input.method.toUpperCase())) return true;
  const originAllowed = input.origin
    ? input.webOrigins.includes(input.origin)
    : false;
  if (input.secFetchSite) return originAllowed;
  if (!input.origin) return !input.hasSessionCookie;

  return originAllowed;
}

/**
 * Rutas del Gateway que se pueden llamar sin sesión (relativas al prefijo global). El resto exige una
 * credencial de acceso ANTES de leer el cuerpo de la petición.
 */
export const PUBLIC_GATEWAY_ROUTES: readonly string[] = [
  "health",
  "auth/register",
  "auth/sign-in",
  "auth/refresh",
  "auth/sign-out",
  "auth/microsoft/start",
  "auth/microsoft/callback",
];

export function requiresAccessCredential(input: {
  method: string;
  url: string;
  globalPrefix: string;
}): boolean {
  // La verificación previa de CORS no lleva credenciales.
  if (input.method.toUpperCase() === "OPTIONS") return false;

  const path = input.url.split("?", 1)[0] ?? "";
  const prefix = `/${input.globalPrefix.replace(/^\/+|\/+$/gu, "")}/`;
  // Fuera de la API (por ejemplo /api/docs en desarrollo) no se exige credencial aquí.
  if (!path.startsWith(prefix)) return false;

  const relative = path.slice(prefix.length).replace(/\/+$/u, "");
  return !PUBLIC_GATEWAY_ROUTES.includes(relative);
}

/**
 * Token de acceso de la petición, con la misma precedencia que usan los controladores: la cookie de sesión y,
 * si no hay, el encabezado `Authorization: Bearer`.
 */
export function selectAccessToken(input: {
  cookieHeader?: string;
  authorization?: string;
}): string | null {
  const cookieToken = readCookie(input.cookieHeader, ACCESS_COOKIE);
  if (cookieToken) return cookieToken;
  return /^Bearer\s+(.+)$/iu.exec(input.authorization ?? "")?.[1] ?? null;
}

/** Hay una credencial de acceso presente (cookie de sesión o `Authorization: Bearer`); no valida su firma. */
export function hasAccessCredential(input: {
  cookieHeader?: string;
  authorization?: string;
}): boolean {
  return selectAccessToken(input) !== null;
}

/**
 * Comprueba la firma, el emisor, la audiencia y el vencimiento del token con las mismas reglas que los
 * servicios. Sin JWKS configurado (solo fuera de producción) no hay con qué verificar y se acepta: en ese caso
 * únicamente se exige que haya credencial. Un token aceptado aquí puede ser rechazado después por el servicio
 * (por ejemplo, por cambio de contraseña pendiente): esto solo evita leer el cuerpo de quien no tiene ninguna.
 */
export async function acceptsAccessToken(
  token: string,
  verification: JwtAccessVerificationConfig | null,
): Promise<boolean> {
  if (!verification) return true;
  try {
    await verifyAccessJwt(token, verification);
    return true;
  } catch {
    return false;
  }
}

/**
 * Cabeceras CORS para una respuesta que el Gateway envía antes de que actúe el plugin de CORS (rechazos
 * tempranos). Sin ellas el navegador no puede leer el 401 y la web no llega a renovar la sesión caducada.
 */
export function corsHeadersForAllowedOrigin(
  origin: string | undefined,
  webOrigins: readonly string[],
): Record<string, string> {
  if (!origin || !webOrigins.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    vary: "Origin",
  };
}
