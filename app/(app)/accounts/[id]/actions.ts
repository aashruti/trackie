"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import { updateInvoice, type InvoiceEdit } from "@/lib/dal/mutations";

export async function updateInvoiceAction(
  accountId: number,
  invoiceId: number,
  edit: InvoiceEdit,
) {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  await updateInvoice(
    { id: Number(session.user.id), role: session.user.role },
    invoiceId,
    edit,
  );
  revalidatePath(`/accounts/${accountId}`);
  return { ok: true };
}
