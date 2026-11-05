import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { getProgramFileForDownload } from "@/lib/dal/delivery/po-files";
import { contentDisposition } from "@/lib/delivery/upload-rules";

export const runtime = "nodejs";
export const preferredRegion = "sin1";

// Streams a private PO document / payment proof. Scope is enforced inside
// `getProgramFileForDownload`; out-of-scope reads as 404.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const fileId = Number((await params).fileId);
  if (!Number.isInteger(fileId) || fileId <= 0) return NextResponse.json({ error: "not found" }, { status: 404 });

  let file;
  try {
    file = await getProgramFileForDownload({ id: Number(session.user.id), roles: session.user.roles }, fileId);
  } catch (e) {
    console.error("[delivery-files:download]", e);
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.bytes.length),
      "Content-Disposition": contentDisposition(file.fileName, true),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
