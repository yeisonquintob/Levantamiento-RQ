import { type NextRequest, NextResponse } from "next/server";

const ACCESS_COOKIE = "rq_access";

export function proxy(request: NextRequest) {
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
  matcher: ["/workspace/:path*"],
};
