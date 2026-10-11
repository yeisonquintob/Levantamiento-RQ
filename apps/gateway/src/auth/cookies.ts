export const ACCESS_COOKIE = "rq_access";
export const REFRESH_COOKIE = "rq_refresh";
export const MICROSOFT_TRANSACTION_COOKIE = "rq_ms_tx";

export function readCookie(
  header: string | undefined,
  name: string,
): string | null {
  if (!header) return null;

  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");

    if (rawName === name) {
      try {
        return decodeURIComponent(rawValue.join("="));
      } catch {
        return null;
      }
    }
  }

  return null;
}

export function hasCookie(header: string | undefined, name: string): boolean {
  if (!header) return false;
  return header
    .split(";")
    .some((part) => part.trim().split("=", 1)[0] === name);
}

export function serializeCookie(
  name: string,
  value: string,
  options: {
    maxAge: number;
    path: string;
    secure: boolean;
  },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${options.maxAge}`,
    `Path=${options.path}`,
    "HttpOnly",
    "SameSite=Lax",
  ];

  if (options.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}
