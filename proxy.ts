import { NextResponse, type NextRequest } from "next/server";
import { refreshSession } from "@/utils/supabase/proxy";

// Explicit public-route allowlist. Everything NOT listed here requires a
// session, an active profile, and (if must_change_password is set) is
// redirected to /change-password first. This is a UX convenience only —
// the authoritative checks live in RLS policies and RPCs, since a route
// guard alone is not a substitute for row-level authorization.
const PUBLIC_PATHS = ["/login", "/setup"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const { response, user, supabase } = await refreshSession(request);

  if (isPublicPath(pathname)) {
    return response;
  }

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_active, must_change_password")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !profile.is_active) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (profile.must_change_password && pathname !== "/change-password") {
    return NextResponse.redirect(new URL("/change-password", request.url));
  }

  const homePath = profile.role === "teacher" ? "/teacher" : "/student";

  if (pathname === "/") {
    return NextResponse.redirect(new URL(homePath, request.url));
  }

  const otherRolePrefix = profile.role === "teacher" ? "/student" : "/teacher";
  if (pathname === otherRolePrefix || pathname.startsWith(`${otherRolePrefix}/`)) {
    return NextResponse.redirect(new URL(homePath, request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
