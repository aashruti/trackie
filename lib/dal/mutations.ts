import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { invoices } from "@/lib/db/schema";
import type { Status } from "@/lib/money/types";
import { canEdit, type SessionUser } from "./authz";
import { assignedIds } from "./accounts";

export interface InvoiceEdit {
  students?: number;
  priceToUni?: number;
  priceToDatagami?: number;
  gstRate?: number; // fraction, e.g. 0.18
  tdsRate?: number; // fraction
  advanceAdj?: number;
  invoiceDate?: string | null;
  status?: Status;
}

const num = (v: number | undefined, min = 0) =>
  v == null ? undefined : Math.max(min, v);

/**
 * Update an invoice's numbers. Enforces `canEdit` for the owning account.
 * Returns the affected accountId (for revalidation) or throws on auth failure.
 */
export async function updateInvoice(
  user: SessionUser,
  invoiceId: number,
  edit: InvoiceEdit,
): Promise<{ accountId: number }> {
  const [inv] = await db
    .select({ id: invoices.id, accountId: invoices.accountId })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!inv) throw new Error("Invoice not found");

  const assigned = user.role === "super-admin" ? [] : await assignedIds(user.id);
  if (!canEdit(user, inv.accountId, assigned)) {
    throw new Error("Not authorized to edit this account");
  }

  const patch: Record<string, unknown> = {};
  if (edit.students != null) patch.students = num(edit.students);
  if (edit.priceToUni != null) patch.priceToUni = String(num(edit.priceToUni));
  if (edit.priceToDatagami != null)
    patch.priceToDatagami = String(num(edit.priceToDatagami));
  if (edit.gstRate != null)
    patch.gstRate = String(Math.max(0, Math.min(1, edit.gstRate)));
  if (edit.tdsRate != null)
    patch.tdsRate = String(Math.max(0, Math.min(1, edit.tdsRate)));
  if (edit.advanceAdj != null) patch.advanceAdj = String(num(edit.advanceAdj));
  if (edit.invoiceDate !== undefined) patch.invoiceDate = edit.invoiceDate;
  if (edit.status != null) patch.status = edit.status;

  if (Object.keys(patch).length > 0) {
    await db.update(invoices).set(patch).where(eq(invoices.id, invoiceId));
  }
  return { accountId: inv.accountId };
}
