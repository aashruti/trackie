import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { isUserError } from "@/lib/dal/errors";
import { storeProgramFile, UploadError } from "@/lib/dal/delivery/po-files";
import { MAX_FILE_BYTES } from "@/lib/delivery/upload-rules";
import { isStorageConfigured } from "@/lib/storage/blob";
import { revalidatePath } from "next/cache";

export const runtime = "nodejs";
export const preferredRegion = "sin1";

// Uploads a PO document (no paymentId) or a payment proof. Authorization and
// validation live in `storeProgramFile`; this handler authenticates, parses the
// form and translates errors. Never returns the blob URL.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const programId = Number((await params).id);
  if (!Number.isInteger(programId) || programId <= 0) {
    return NextResponse.json({ error: "Program not found." }, { status: 404 });
  }
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: "File storage isn't configured. Ask an admin to set it up." }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Could not read the upload." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "That file is larger than 4 MB." }, { status: 400 });

  const rawPayment = form.get("paymentId");
  let paymentId: number | null = null;
  if (typeof rawPayment === "string" && rawPayment.trim() !== "") {
    paymentId = Number(rawPayment);
    if (!Number.isInteger(paymentId) || paymentId <= 0) {
      return NextResponse.json({ error: "Invalid payment." }, { status: 400 });
    }
  }

  try {
    const row = await storeProgramFile(
      { id: Number(session.user.id), roles: session.user.roles },
      { programId, paymentId, fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
    );
    revalidatePath(`/delivery/programs/${programId}`);
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    if (e instanceof UploadError) return NextResponse.json({ error: e.message }, { status: 400 });
    // Scope / role / missing program all read as not found.
    if (isUserError(e)) return NextResponse.json({ error: "Program not found." }, { status: 404 });
    console.error("[delivery-files:upload]", e);
    return NextResponse.json({ error: "Could not upload the file." }, { status: 503 });
  }
}
