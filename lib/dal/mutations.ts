import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { invoices, cohorts } from "@/lib/db/schema";
import type { Status } from "@/lib/money/types";
import { canEdit, type SessionUser } from "./authz";
import { assignedIds } from "./accounts";

export interface CohortInput {
  enrollmentYear: string;
  count: number;
  priceToUni?: number | null;
  priceToDatagami?: number | null;
}

export interface InvoiceEdit {
  students?: number;
  priceToUni?: number;
  priceToDatagami?: number;
  gstRate?: number; // fraction, e.g. 0.18
  tdsRate?: number; // fraction
  advanceAdj?: number;
  invoiceDate?: string | null;
  dueDate?: string | null;
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
  if (edit.students != null) {
    // When the invoice is cohort-driven, `students` is derived from the cohort
    // sum (the money engine's basis) — a direct scalar edit would silently
    // diverge from the cohorts, so ignore it. Counts are edited via setCohorts.
    const [hasCohort] = await db
      .select({ id: cohorts.id })
      .from(cohorts)
      .where(eq(cohorts.invoiceId, invoiceId))
      .limit(1);
    if (!hasCohort) patch.students = num(edit.students);
  }
  if (edit.priceToUni != null) patch.priceToUni = String(num(edit.priceToUni));
  if (edit.priceToDatagami != null)
    patch.priceToDatagami = String(num(edit.priceToDatagami));
  if (edit.gstRate != null)
    patch.gstRate = String(Math.max(0, Math.min(1, edit.gstRate)));
  if (edit.tdsRate != null)
    patch.tdsRate = String(Math.max(0, Math.min(1, edit.tdsRate)));
  if (edit.advanceAdj != null) patch.advanceAdj = String(num(edit.advanceAdj));
  if (edit.invoiceDate !== undefined) patch.invoiceDate = edit.invoiceDate;
  if (edit.dueDate !== undefined) patch.dueDate = edit.dueDate;
  if (edit.status != null) patch.status = edit.status;

  if (Object.keys(patch).length > 0) {
    await db.update(invoices).set(patch).where(eq(invoices.id, invoiceId));
  }
  return { accountId: inv.accountId };
}

/**
 * Replace an invoice's enrollment-year cohort distribution and sync the invoice's
 * total student count to the sum of the cohorts. Enforces `canEdit`.
 */
export async function setCohorts(
  user: SessionUser,
  invoiceId: number,
  list: CohortInput[],
): Promise<{ accountId: number; total: number }> {
  const [inv] = await db
    .select({ id: invoices.id, accountId: invoices.accountId })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!inv) throw new Error("Invoice not found");
  const assigned = user.role === "super-admin" ? [] : await assignedIds(user.id);
  if (!canEdit(user, inv.accountId, assigned)) throw new Error("Not authorized");

  const price = (v: number | null | undefined) =>
    v == null || v <= 0 ? null : String(Math.max(0, v));
  const clean = list
    .map((c) => ({
      enrollmentYear: c.enrollmentYear.trim(),
      count: Math.max(0, Math.floor(c.count)),
      priceToUni: price(c.priceToUni),
      priceToDatagami: price(c.priceToDatagami),
    }))
    .filter((c) => c.enrollmentYear.length > 0);
  const total = clean.reduce((a, c) => a + c.count, 0);

  await db.delete(cohorts).where(eq(cohorts.invoiceId, invoiceId));
  if (clean.length > 0) {
    await db.insert(cohorts).values(
      clean.map((c) => ({
        invoiceId,
        enrollmentYear: c.enrollmentYear,
        count: c.count,
        priceToUni: c.priceToUni,
        priceToDatagami: c.priceToDatagami,
      })),
    );
  }
  await db.update(invoices).set({ students: total }).where(eq(invoices.id, invoiceId));
  return { accountId: inv.accountId, total };
}
