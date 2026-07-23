import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { getCurrentYear } from "@/lib/dal/years";
import { globalSearch } from "@/lib/dal/search";

export const runtime = "nodejs";
export const preferredRegion = "sin1";

// Backs the ⌘K command palette. Finance-gated + account-scoped inside
// `globalSearch`; this handler only authenticates and resolves the year.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const q = req.nextUrl.searchParams.get("q") ?? "";
  const yearLabel = await getCurrentYear();
  const results = await globalSearch(
    { id: Number(session.user.id), roles: session.user.roles },
    q,
    yearLabel,
  );
  return NextResponse.json(results);
}
