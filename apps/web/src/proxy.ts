import { type NextRequest, NextResponse } from "next/server";

import { applySignInUrlPolicy } from "./app/sign-in/sign-in-url-policy";

const ACCESS_COOKIE = "rq_access";

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

  return NextResponse.next();
}

export const config = {
  matcher: ["/sign-in", "/workspace/:path*"],
};
