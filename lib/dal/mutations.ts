import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { invoices, cohorts } from "@/lib/db/schema";
import type { Status } from "@/lib/money/types";
import { canEdit, type SessionUser } from "./authz";
import { assignedIds } from "./accounts";
import { stampedDeleteWhere } from "./audit";

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
  oemAdvanceAdj?: number;
  invoiceDate?: string | null;
  dueDate?: string | null;
  status?: Status;
}

const num = (v: number | undefined, min = 0) =>
  v == null || !Number.isFinite(v) ? undefined : Math.max(min, v);

/**
 * Merge cohort rows that share a batch label AND price — label normalization can
 * fold two spellings of one intake year (e.g. "2024-25" and "FY24-25") into a
 * single label, and the UI keys batches by label, so same-label same-price rows
 * must collapse (counts sum) before reaching the DB.
 *
 * Rows that share a label but carry DIFFERENT locked prices are left separate —
 * they are money-bearing and merging them would silently drop a price. This
 * mirrors migration 0020, which likewise merges only price-agreeing duplicates
 * and leaves conflicting ones for manual resolution.
 */
export function mergeCohortRows<T extends { enrollmentYear: string; count: number; priceToUni: string | null; priceToDatagami: string | null }>(
  rows: T[],
): T[] {
  const out: T[] = [];
  // Key by label + exact price pair so only truly-identical batches merge.
  // Fields are joined with the ASCII unit separator (0x1F), which can't occur
  // in a (free-text) label or a numeric price string — so no field value can
  // shift into the next and cause a spurious merge.
  const byKey = new Map<string, T>();
  for (const r of rows) {
    const key = [r.enrollmentYear, r.priceToUni ?? "", r.priceToDatagami ?? ""].join(String.fromCharCode(31));
    const prev = byKey.get(key);
    if (prev) prev.count += r.count;
    else {
      const copy = { ...r };
      byKey.set(key, copy);
      out.push(copy); // preserve first-seen order
    }
  }
  return out;
}

/**
 * Update an invoice's numbers. Enforces `canEdit` for the owning account.
 * Returns the affected accountId (for revalidation) or throws on auth failure.
 */
export async function updateInvoice(
  user: SessionUser,
  invoiceId: number,
  edit: InvoiceEdit,
  // Callers that update many invoices in one request (e.g. the /pricing bulk
  // save) can pass the user's assigned account ids once, so each write doesn't
  // re-query them. Ignored for super-admin (canEdit short-circuits).
  assignedOverride?: number[],
): Promise<{ accountId: number }> {
  const [inv] = await db
    .select({ id: invoices.id, accountId: invoices.accountId })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!inv) throw new Error("Invoice not found");

  const assigned =
    assignedOverride ?? (user.roles.includes("super-admin") ? [] : await assignedIds(user.id));
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
  if (edit.oemAdvanceAdj != null) patch.oemAdvanceAdj = String(num(edit.oemAdvanceAdj));
  if (edit.invoiceDate !== undefined) patch.invoiceDate = edit.invoiceDate;
  if (edit.dueDate !== undefined) patch.dueDate = edit.dueDate;
  if (edit.status != null) patch.status = edit.status;

  if (Object.keys(patch).length > 0) {
    await db
      .update(invoices)
      .set({ ...patch, updatedBy: user.id })
      .where(eq(invoices.id, invoiceId));
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
  // See updateInvoice — pass once for a bulk request to avoid re-querying.
  assignedOverride?: number[],
): Promise<{ accountId: number; total: number }> {
  const [inv] = await db
    .select({ id: invoices.id, accountId: invoices.accountId })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!inv) throw new Error("Invoice not found");
  const assigned =
    assignedOverride ?? (user.roles.includes("super-admin") ? [] : await assignedIds(user.id));
  if (!canEdit(user, inv.accountId, assigned)) throw new Error("Not authorized");

  const price = (v: number | null | undefined) =>
    v == null || v <= 0 ? null : String(Math.max(0, v));
  const clean = mergeCohortRows(
    list
      .map((c) => ({
        enrollmentYear: c.enrollmentYear.trim(),
        count: Math.max(0, Math.floor(c.count)),
        priceToUni: price(c.priceToUni),
        priceToDatagami: price(c.priceToDatagami),
      }))
      .filter((c) => c.enrollmentYear.length > 0),
  );
  const total = clean.reduce((a, c) => a + c.count, 0);

  await stampedDeleteWhere(cohorts, eq(cohorts.invoiceId, invoiceId), user.id);
  if (clean.length > 0) {
    await db.insert(cohorts).values(
      clean.map((c) => ({
        invoiceId,
        enrollmentYear: c.enrollmentYear,
        count: c.count,
        priceToUni: c.priceToUni,
        priceToDatagami: c.priceToDatagami,
        createdBy: user.id,
        updatedBy: user.id,
      })),
    );
  }
  await db
    .update(invoices)
    .set({ students: total, updatedBy: user.id })
    .where(eq(invoices.id, invoiceId));
  return { accountId: inv.accountId, total };
}
