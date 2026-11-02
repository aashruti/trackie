import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";

// Roles that grant access to a functional AREA (finance, HR, delivery, admin).
// A user holding none of these — a pure `viewer`, or a brand-new user whose
// role set is still empty — is confined to the universal self-service floor.
const AREA_ROLES = ["super-admin", "sales", "hr", "delivery"];

export default auth((req) => {
  const { nextUrl } = req;
  // Read the role SET, not a scalar `role` — the session carries roles[] now.
  // (An earlier cast to { role?: string } silently read undefined here.)
  const roles = (req.auth?.user as { roles?: string[] } | undefined)?.roles;

  // Unauthenticated → sign in (preserves the previous middleware behaviour).
  if (!roles) {
    return NextResponse.redirect(new URL("/login", nextUrl));
  }

  const path = nextUrl.pathname;
  const hasArea = roles.some((r) => AREA_ROLES.includes(r));
  // Self-service floor — universal (spec §2): the team board plus each user's
  // own leave / payslips / attendance. Available even to a role-less/viewer
  // user, who would otherwise be wrongly blocked from /me/leave.
  const selfServe =
    path === "/team" || path.startsWith("/team/") ||
    path === "/me" || path.startsWith("/me/");
  if (!hasArea && !selfServe) {
    return NextResponse.redirect(new URL("/team", nextUrl));
  }
});

// signature/ stays public: email recipients' mail clients fetch those logos with
// no Trackie session, and a redirect to /login would show as a broken image.
export const config = {
  matcher: ["/((?!api/auth|login|_next/static|_next/image|favicon.ico|icon.svg|signature/).*)"],
};
