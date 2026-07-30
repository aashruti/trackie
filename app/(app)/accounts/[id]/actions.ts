"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { updateInvoice, setCohorts, type InvoiceEdit, type CohortInput } from "@/lib/dal/mutations";
import { addPayment, deletePayment, type NewPayment } from "@/lib/dal/payments";
import {
  createInvoice,
  createPreferredStay,
  deleteAccount,
  deleteBill,
  deletePreferredStay,
  getBillDeletionPreview,
  updateAccount,
  updateAccountLogistics,
  updatePreferredStay,
  type AccountEdit,
  type AccountLogisticsInput,
  type BillDeletionPreview,
  type NewInvoice,
  type PreferredStayInput,
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
  // Auth lives outside the try so an unauthenticated call surfaces a clear
  // auth error (the file's convention), instead of being swallowed into the
  // generic "couldn't work out…" string below.
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  try {
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
 * `expectedPaymentIds` and `expectedCohortCount` are what the confirmation
 * dialog itemised — the delete is refused if the bill's payments or cohort
 * count no longer match, so the user is stopped from destroying a set they
 * were never shown (changes that land in the tiny non-atomic window between the
 * DAL's re-read and the cascade are not caught — see deleteBill).
 */
export async function deleteBillAction(
  accountId: number,
  invoiceId: number,
  expectedPaymentIds: number[],
  expectedCohortCount: number,
): Promise<ActionResult> {
  // Auth outside the try so an unauthenticated call surfaces a clear auth error
  // instead of the generic "could not delete" string (matches the file).
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  try {
    await deleteBill(sessionUser(session), accountId, invoiceId, expectedPaymentIds, expectedCohortCount);
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

export async function updateAccountAction(
  accountId: number,
  edit: AccountEdit,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  try {
    await updateAccount(sessionUser(session), accountId, edit);
    revalidatePath(`/accounts/${accountId}`);
    revalidatePath("/accounts");
    return { ok: true };
  } catch (e) {
    console.error("[accounts:update]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not update the account." };
  }
}

export async function updateAccountLogisticsAction(
  accountId: number,
  input: AccountLogisticsInput,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  try {
    await updateAccountLogistics(sessionUser(session), accountId, input);
    revalidatePath(`/accounts/${accountId}`);
    revalidatePath("/delivery/accounts");
    revalidatePath(`/delivery/accounts/${accountId}`);
    revalidatePath(`/delivery/report/${accountId}`);
    return { ok: true };
  } catch (e) {
    console.error("[accounts:update-logistics]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not update university logistics." };
  }
}

function revalidateAccountStays(accountId: number) {
  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/delivery/accounts");
  revalidatePath(`/delivery/accounts/${accountId}`);
  revalidatePath(`/delivery/report/${accountId}`);
}

export async function createPreferredStayAction(
  accountId: number,
  input: PreferredStayInput,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  try {
    await createPreferredStay(sessionUser(session), accountId, input);
    revalidateAccountStays(accountId);
    return { ok: true };
  } catch (e) {
    console.error("[accounts:create-preferred-stay]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not add the preferred stay." };
  }
}

export async function updatePreferredStayAction(
  accountId: number,
  stayId: number,
  input: PreferredStayInput,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  try {
    await updatePreferredStay(sessionUser(session), accountId, stayId, input);
    revalidateAccountStays(accountId);
    return { ok: true };
  } catch (e) {
    console.error("[accounts:update-preferred-stay]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not update the preferred stay." };
  }
}

export async function deletePreferredStayAction(
  accountId: number,
  stayId: number,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  try {
    await deletePreferredStay(sessionUser(session), accountId, stayId);
    revalidateAccountStays(accountId);
    return { ok: true };
  } catch (e) {
    console.error("[accounts:delete-preferred-stay]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not remove the preferred stay." };
  }
}
