import { type NextRequest, NextResponse } from "next/server";

import { applySignInUrlPolicy } from "./app/sign-in/sign-in-url-policy";

const ACCESS_COOKIE = "rq_access";

function gatewayOrigin(request: NextRequest): string {
  if (process.env.NODE_ENV === "development") {
    const protocol = request.nextUrl.protocol === "https:" ? "https:" : "http:";
    return `${protocol}//${request.nextUrl.hostname}:3000`;
  }

  try {
    return new URL(
      process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000",
    ).origin;
  } catch {
    return "http://127.0.0.1:3000";
  }
}

function contentSecurityPolicy(nonce: string, request: NextRequest): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    `connect-src 'self' ${gatewayOrigin(request)}${process.env.NODE_ENV === "development" ? " ws: http:" : ""}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join("; ");
}

function secureNext(request: NextRequest): NextResponse {
  const nonce = btoa(crypto.randomUUID());
  const policy = contentSecurityPolicy(nonce, request);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/sign-in") {
    const policy = applySignInUrlPolicy(request.nextUrl.search);

    if (policy.changed) {
      const safeUrl = request.nextUrl.clone();
      safeUrl.search = policy.safeSearch;
      safeUrl.hash = "";
      const response = NextResponse.redirect(safeUrl);
      response.headers.set("Cache-Control", "no-store, max-age=0");
      response.headers.set("Referrer-Policy", "no-referrer");
      return response;
    }
  }

  const authenticated = Boolean(
    request.cookies.get(ACCESS_COOKIE)?.value,
  );

  if (
    request.nextUrl.pathname.startsWith("/workspace") &&
    !authenticated
  ) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  return secureNext(request);
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|sw.js).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
