import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { academicYears, accounts, cohorts, invoices } from "@/lib/db/schema";
import { batchLabelDesc } from "@/lib/fy";
import { canEdit, scopeAccountIds, type SessionUser } from "./authz";
import { assignedIds } from "./accounts";

export interface PricingBatch {
  enrollmentYear: string;
  count: number;
  priceToUni: number | null; // null → falls back to the invoice price
  priceToDatagami: number | null;
}

export interface PricingInvoiceRow {
  invoiceId: number;
  category: string;
  semester: string;
  students: number;
  priceToUni: number;
  priceToDatagami: number;
  gstRate: number;
  tdsRate: number;
  advanceAdj: number;
  status: string;
  batches: PricingBatch[]; // non-empty → cohort-driven (students = Σ counts)
}

export interface PricingAccountRow {
  accountId: number;
  accountName: string;
  editable: boolean;
  invoices: PricingInvoiceRow[];
}

// New students first — matches the accounts team's reading order on /pricing.
const CATEGORY_ORDER: Record<string, number> = { new: 0, old: 1 };

/**
 * Every visible account's invoices (+batches) for a year, for the /pricing
 * master screen. Same scoping as the accounts list: super-admin sees all,
 * sales sees assigned; `editable` mirrors canEdit per account. Accounts with
 * no invoices in the year are omitted. 3–4 queries total (no N+1).
 */
export async function getPricingMaster(
  user: SessionUser,
  yearLabel: string,
): Promise<PricingAccountRow[]> {
  // Year lookup and assignment scoping are independent — parallelise (house rule).
  const [[year], assigned] = await Promise.all([
    db.select().from(academicYears).where(eq(academicYears.label, yearLabel)).limit(1),
    user.roles.includes("super-admin") ? Promise.resolve([]) : assignedIds(user.id),
  ]);
  if (!year) return [];

  const scope = scopeAccountIds(user, assigned);
  const accRows = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(scope === null ? undefined : inArray(accounts.id, scope.length ? scope : [-1]));
  if (!accRows.length) return [];

  const accountIds = accRows.map((a) => a.id);
  // Student streams only — advance bills are billing artifacts (their "price"
  // is a lump advance amount, not per-student pricing) and are managed on the
  // account screen. User-confirmed 2026-07-22.
  const invRows = await db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.yearId, year.id),
        inArray(invoices.accountId, accountIds),
        ne(invoices.category, "advance"),
      ),
    );
  const invIds = invRows.map((r) => r.id);
  const cohortRows = invIds.length
    ? await db.select().from(cohorts).where(inArray(cohorts.invoiceId, invIds))
    : [];

  const batchesByInvoice = new Map<number, PricingBatch[]>();
  for (const c of cohortRows) {
    const list = batchesByInvoice.get(c.invoiceId) ?? [];
    list.push({
      enrollmentYear: c.enrollmentYear,
      count: c.count,
      priceToUni: c.priceToUni == null ? null : Number(c.priceToUni),
      priceToDatagami: c.priceToDatagami == null ? null : Number(c.priceToDatagami),
    });
    batchesByInvoice.set(c.invoiceId, list);
  }

  const byAccount = new Map<number, PricingInvoiceRow[]>();
  for (const r of invRows) {
    const row: PricingInvoiceRow = {
      invoiceId: r.id,
      category: r.category,
      semester: r.semester,
      students: r.students,
      priceToUni: Number(r.priceToUni),
      priceToDatagami: Number(r.priceToDatagami),
      gstRate: Number(r.gstRate),
      tdsRate: Number(r.tdsRate),
      advanceAdj: Number(r.advanceAdj),
      status: r.status,
      batches: (batchesByInvoice.get(r.id) ?? []).sort((a, b) =>
        batchLabelDesc(a.enrollmentYear, b.enrollmentYear),
      ),
    };
    const list = byAccount.get(r.accountId) ?? [];
    list.push(row);
    byAccount.set(r.accountId, list);
  }

  return accRows
    .filter((a) => byAccount.has(a.id))
    .map((a) => ({
      accountId: a.id,
      accountName: a.name,
      editable: canEdit(user, a.id, assigned),
      invoices: (byAccount.get(a.id) ?? []).sort(
        (x, y) =>
          (CATEGORY_ORDER[x.category] ?? 9) - (CATEGORY_ORDER[y.category] ?? 9) ||
          x.semester.localeCompare(y.semester),
      ),
    }))
    .sort((a, b) => a.accountName.localeCompare(b.accountName));
}
