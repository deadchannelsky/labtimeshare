import { NextRequest, NextResponse } from "next/server";
import { verifyJwt } from "./lib/auth";

const COOKIE_NAME = "lts-session";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow auth API routes through
  if (pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value ?? null;
  const payload = token ? await verifyJwt(token) : null;

  // Redirect root — logged-in users go to dashboard, everyone else to login
  if (pathname === "/") {
    if (payload) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Redirect logged-in users away from auth pages
  if (pathname === "/login" || pathname === "/register") {
    if (payload) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  // Protect dashboard and admin routes
  if (pathname.startsWith("/dashboard") || pathname.startsWith("/admin")) {
    if (!payload) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("from", pathname);
      return NextResponse.redirect(loginUrl);
    }

    // Admin/approver-only routes
    if (pathname.startsWith("/admin")) {
      if (payload.role !== "ADMIN" && payload.role !== "APPROVER") {
        return NextResponse.redirect(new URL("/dashboard", request.url));
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/dashboard/:path*", "/admin/:path*", "/login", "/register"],
};
