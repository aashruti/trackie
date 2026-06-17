"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import { updateInvoice, setCohorts, type InvoiceEdit, type CohortInput } from "@/lib/dal/mutations";
import { addPayment, deletePayment, type NewPayment } from "@/lib/dal/payments";
import { createInvoice, type NewInvoice } from "@/lib/dal/account-admin";

function sessionUser(session: { user: { id: string; role: "super-admin" | "admin" | "viewer" } }) {
  return { id: Number(session.user.id), role: session.user.role };
}

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
