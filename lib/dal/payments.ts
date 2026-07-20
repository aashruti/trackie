import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { payments, invoices } from "@/lib/db/schema";
import { canEdit, type SessionUser } from "./authz";
import { assignedIds } from "./accounts";
import { stampedDelete } from "./audit";

export type Direction = "receipt" | "oem-payment";
export type Mode = "RTGS" | "NEFT" | "IMPS" | "UPI" | "Cheque";

export interface PaymentEntry {
  id: number;
  invoiceId: number;
  direction: Direction;
  paidOn: string;
  amount: number;
  mode: Mode;
  ref: string | null;
}

export interface NewPayment {
  direction: Direction;
  amount: number;
  paidOn: string; // YYYY-MM-DD
  mode: Mode;
  ref?: string | null;
}

/** Amounts split by direction, keyed by invoiceId — feeds the money engine. */
export interface PaymentLites {
  receipts: { amount: number }[];
  oemPayments: { amount: number }[];
}

async function assertCanEditInvoice(user: SessionUser, invoiceId: number): Promise<number> {
  const [inv] = await db
    .select({ id: invoices.id, accountId: invoices.accountId })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!inv) throw new Error("Invoice not found");
  const assigned = user.roles.includes("super-admin") ? [] : await assignedIds(user.id);
  if (!canEdit(user, inv.accountId, assigned)) throw new Error("Not authorized");
  return inv.accountId;
}

/** Record a receipt or an OEM payment against an invoice. Returns the accountId. */
export async function addPayment(
  user: SessionUser,
  invoiceId: number,
  entry: NewPayment,
): Promise<{ accountId: number }> {
  const accountId = await assertCanEditInvoice(user, invoiceId);
  await db.insert(payments).values({
    invoiceId,
    direction: entry.direction,
    paidOn: entry.paidOn,
    amount: String(Math.max(0, entry.amount)),
    mode: entry.mode,
    ref: entry.ref ?? null,
    createdBy: user.id,
    updatedBy: user.id,
  });
  return { accountId };
}

export async function deletePayment(
  user: SessionUser,
  paymentId: number,
): Promise<{ accountId: number }> {
  const [p] = await db
    .select({ id: payments.id, invoiceId: payments.invoiceId })
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1);
  if (!p) throw new Error("Payment not found");
  const accountId = await assertCanEditInvoice(user, p.invoiceId);
  await stampedDelete(payments, paymentId, user.id);
  return { accountId };
}

/** Engine-ready amounts split by direction for a set of invoices. */
export async function loadPaymentLites(
  invoiceIds: number[],
): Promise<Map<number, PaymentLites>> {
  const map = new Map<number, PaymentLites>();
  if (invoiceIds.length === 0) return map;
  const rows = await db
    .select({ invoiceId: payments.invoiceId, direction: payments.direction, amount: payments.amount })
    .from(payments)
    .where(inArray(payments.invoiceId, invoiceIds));
  for (const r of rows) {
    const entry = map.get(r.invoiceId) ?? { receipts: [], oemPayments: [] };
    const amt = { amount: Number(r.amount) };
    if (r.direction === "receipt") entry.receipts.push(amt);
    else entry.oemPayments.push(amt);
    map.set(r.invoiceId, entry);
  }
  return map;
}

/** Full ledger rows per invoice for the UI. */
export async function loadPaymentLedger(
  invoiceIds: number[],
): Promise<Map<number, PaymentEntry[]>> {
  const map = new Map<number, PaymentEntry[]>();
  if (invoiceIds.length === 0) return map;
  const rows = await db
    .select()
    .from(payments)
    .where(inArray(payments.invoiceId, invoiceIds));
  for (const r of rows) {
    const list = map.get(r.invoiceId) ?? [];
    list.push({
      id: r.id,
      invoiceId: r.invoiceId,
      direction: r.direction,
      paidOn: r.paidOn,
      amount: Number(r.amount),
      mode: r.mode,
      ref: r.ref,
    });
    map.set(r.invoiceId, list);
  }
  for (const [, list] of map) list.sort((a, b) => a.paidOn.localeCompare(b.paidOn));
  return map;
}
