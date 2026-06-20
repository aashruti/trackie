import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";

export default auth((req) => {
  const { nextUrl } = req;
  const user = req.auth?.user as { role?: string } | undefined;

  // Unauthenticated → sign in (preserves the previous middleware behaviour).
  if (!user) {
    return NextResponse.redirect(new URL("/login", nextUrl));
  }

  // Viewers (Designer / Employee) only get the Team board — send them there.
  const path = nextUrl.pathname;
  const teamOnly = path === "/team" || path.startsWith("/team/");
  if (user.role === "viewer" && !teamOnly) {
    return NextResponse.redirect(new URL("/team", nextUrl));
  }
});

export const config = {
  matcher: ["/((?!api/auth|login|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
