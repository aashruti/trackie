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
import type { Role } from "@/lib/db/enums";

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
): Promise<BillDeletionPreview> {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return getBillDeletionPreview(sessionUser(session), accountId, invoiceId);
}

export async function deleteBillAction(accountId: number, invoiceId: number) {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  await deleteBill(sessionUser(session), accountId, invoiceId);
  revalidatePath(`/accounts/${accountId}`);
  return { ok: true };
}

export async function deleteAccountAction(accountId: number) {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  await deleteAccount(sessionUser(session), accountId);
  redirect("/accounts");
}
