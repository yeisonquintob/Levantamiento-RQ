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
