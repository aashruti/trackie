"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import { saveMySignature } from "@/lib/dal/signature";
import { validateSignature, type SignatureFields } from "@/lib/signature/render";

export async function saveSignatureAction(
  input: SignatureFields,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  const userId = session?.user?.id ? Number(session.user.id) : null;
  if (!userId) return { ok: false, error: "Not signed in." };

  const parsed = validateSignature(input);
  if (!parsed.ok) return parsed;

  await saveMySignature(userId, parsed.value);
  revalidatePath("/me/signature");
  return { ok: true };
}
