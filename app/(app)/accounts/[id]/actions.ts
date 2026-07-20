"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { updateInvoice, setCohorts, type InvoiceEdit, type CohortInput } from "@/lib/dal/mutations";
import { addPayment, deletePayment, type NewPayment } from "@/lib/dal/payments";
import {
  createInvoice,
  deleteAccount,
  deleteBill,
  getBillDeletionPreview,
  type BillDeletionPreview,
  type NewInvoice,
} from "@/lib/dal/account-admin";
import { isUserError } from "@/lib/dal/errors";
import type { Role } from "@/lib/db/enums";

// The repo's server-action convention (see accounts/groups, delivery/programs,
// hr/*): never let a raw throw reach the client — Next masks uncaught Server
// Action errors in production builds, so the caller would get an opaque digest
// instead of the message. A UserError's message is safe to show; anything else
// becomes a generic string and is logged server-side.
export type ActionResult = { ok: true } | { ok: false; error: string };
export type BillPreviewResult =
  | { ok: true; preview: BillDeletionPreview }
  | { ok: false; error: string };

function sessionUser(session: { user: { id: string; roles: Role[] } }) {
  return { id: Number(session.user.id), roles: session.user.roles };
}

export async function updateInvoiceAction(
  accountId: number,
  invoiceId: number,
  edit: InvoiceEdit,
) {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  await updateInvoice(
    { id: Number(session.user.id), roles: session.user.roles },
    invoiceId,
    edit,
  );
  revalidatePath(`/accounts/${accountId}`);
  return { ok: true };
}

export async function updateCohortsAction(
  accountId: number,
  invoiceId: number,
  cohorts: CohortInput[],
) {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  await setCohorts(sessionUser(session), invoiceId, cohorts);
  revalidatePath(`/accounts/${accountId}`);
  return { ok: true };
}

export async function createInvoiceAction(
  accountId: number,
  yearLabel: string,
  input: NewInvoice,
) {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  await createInvoice(sessionUser(session), accountId, yearLabel, input);
  revalidatePath(`/accounts/${accountId}`);
  return { ok: true };
}

export async function recordPaymentAction(
  accountId: number,
  invoiceId: number,
  entry: NewPayment,
) {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  await addPayment(sessionUser(session), invoiceId, entry);
  revalidatePath(`/accounts/${accountId}`);
  return { ok: true };
}

export async function deletePaymentAction(accountId: number, paymentId: number) {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  await deletePayment(sessionUser(session), paymentId);
  revalidatePath(`/accounts/${accountId}`);
  return { ok: true };
}

/**
 * What `deleteBillAction` would destroy, for the confirmation dialog. A read —
 * deliberately no revalidatePath, since nothing has changed yet.
 */
export async function billDeletionPreviewAction(
  accountId: number,
  invoiceId: number,
): Promise<BillPreviewResult> {
  try {
    const session = await auth();
    if (!session?.user) throw new Error("Not authenticated");
    const preview = await getBillDeletionPreview(sessionUser(session), accountId, invoiceId);
    return { ok: true, preview };
  } catch (e) {
    console.error("[bills:deletion-preview]", e);
    return {
      ok: false,
      error: isUserError(e)
        ? e.message
        : "Could not work out what deleting this bill would remove.",
    };
  }
}

/**
 * `expectedPaymentIds` is the ids of the payments the confirmation dialog
 * itemised — the delete is refused if the bill's payments no longer match it,
 * so the user can never destroy more than they were shown.
 */
export async function deleteBillAction(
  accountId: number,
  invoiceId: number,
  expectedPaymentIds: number[],
): Promise<ActionResult> {
  try {
    const session = await auth();
    if (!session?.user) throw new Error("Not authenticated");
    await deleteBill(sessionUser(session), accountId, invoiceId, expectedPaymentIds);
    revalidatePath(`/accounts/${accountId}`);
    return { ok: true };
  } catch (e) {
    console.error("[bills:delete]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not delete this bill." };
  }
}

export async function deleteAccountAction(accountId: number) {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  await deleteAccount(sessionUser(session), accountId);
  redirect("/accounts");
}
