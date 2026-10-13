import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

/**
 * Runs before every page and API request (Next.js "proxy", formerly middleware).
 * Not logged in → pages redirect to /login, API calls get a 401.
 * Every API route ALSO checks the session itself (defense in depth).
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const ok = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value, process.env.SESSION_SECRET?.trim());
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Please log in first.", action: "Open the app and log in." } },
      { status: 401 },
    );
  }
  const loginUrl = new URL("/login", request.url);
  if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Everything except: the login page, login/logout API, and Next.js static files.
  matcher: ["/((?!login|api/auth/|_next/static|_next/image|favicon.ico).*)"],
};
