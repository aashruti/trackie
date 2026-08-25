import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { payments, invoices } from "@/lib/db/schema";
import { DIRECTIONS, MODES } from "@/lib/db/enums";
import { canEdit, type SessionUser } from "./authz";
import { assignedIds } from "./accounts";
import { stampedDelete } from "./audit";
import { UserError } from "./errors";

export type Direction = (typeof DIRECTIONS)[number];
export type Mode = (typeof MODES)[number];

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

/** Editable fields on an existing ledger row. Its debit/credit direction stays fixed. */
export type PaymentEdit = Omit<NewPayment, "direction">;

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
  if (!inv) throw new UserError("Invoice not found");
  const assigned = user.roles.includes("super-admin") ? [] : await assignedIds(user.id);
  if (!canEdit(user, inv.accountId, assigned)) throw new UserError("Not authorized to edit this account");
  return inv.accountId;
}

function cleanPaymentEdit(entry: PaymentEdit) {
  if (!Number.isFinite(entry.amount) || entry.amount <= 0) {
    throw new UserError("Amount must be greater than zero.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.paidOn)) {
    throw new UserError("Pick a valid payment date.");
  }
  const parsedDate = new Date(`${entry.paidOn}T00:00:00.000Z`);
  if (Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== entry.paidOn) {
    throw new UserError("Pick a valid payment date.");
  }
  if (!MODES.some((mode) => mode === entry.mode)) {
    throw new UserError("Pick a valid payment mode.");
  }
  if (entry.ref != null && typeof entry.ref !== "string") {
    throw new UserError("Reference must be text.");
  }
  return {
    paidOn: entry.paidOn,
    amount: String(entry.amount),
    mode: entry.mode,
    ref: entry.ref?.trim() || null,
  };
}

/** Record a receipt or an OEM payment against an invoice. Returns the accountId. */
export async function addPayment(
  user: SessionUser,
  invoiceId: number,
  entry: NewPayment,
): Promise<{ accountId: number }> {
  const accountId = await assertCanEditInvoice(user, invoiceId);
  if (!DIRECTIONS.some((direction) => direction === entry.direction)) {
    throw new UserError("Pick a valid payment type.");
  }
  const clean = cleanPaymentEdit(entry);
  await db.insert(payments).values({
    invoiceId,
    direction: entry.direction,
    ...clean,
    createdBy: user.id,
    updatedBy: user.id,
  });
  return { accountId };
}

/** Correct an existing ledger row without changing whether it is a debit or credit. */
export async function updatePayment(
  user: SessionUser,
  paymentId: number,
  edit: PaymentEdit,
): Promise<{ accountId: number }> {
  const [payment] = await db
    .select({ invoiceId: payments.invoiceId })
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1);
  if (!payment) throw new UserError("Payment entry not found");

  const accountId = await assertCanEditInvoice(user, payment.invoiceId);
  const clean = cleanPaymentEdit(edit);
  const updated = await db
    .update(payments)
    .set({ ...clean, updatedBy: user.id })
    .where(eq(payments.id, paymentId))
    .returning({ id: payments.id });
  if (!updated.length) throw new UserError("Payment entry not found");
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
  if (!p) throw new UserError("Payment entry not found");
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
