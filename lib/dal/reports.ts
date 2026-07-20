import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accounts, invoices, academicYears, oems } from "@/lib/db/schema";
import { computeAccount } from "@/lib/money/compute";
import type { InvoiceComputed, InvoiceInputWithStatus } from "@/lib/money/types";
import {
  emptyByCategory,
  type BillLite,
  type ReportData,
  type ReportMetrics,
  type ReportRow,
} from "@/lib/money/report-view";
import { scopeAccountIds, type SessionUser } from "./authz";
import { assignedIds } from "./accounts";
import { loadPaymentLites } from "./payments";
import { loadCohortPricing } from "./cohort-pricing";

/**
 * Keys of T whose value is a number — a metric can only map to a numeric field.
 * `-?` is load-bearing: without it the mapped type keeps InvoiceComputed's
 * optional props optional, so each contributes `undefined` to the union.
 */
type NumericKey<T> = { [K in keyof T]-?: T[K] extends number ? K : never }[keyof T];

/**
 * report metric ← engine field. `students` is excluded: it is the one field with
 * a rule rather than a rename.
 *
 * Typed as a total Record, so adding a ReportMetrics field fails to compile HERE,
 * where the gap is, instead of silently reading 0 on every row. Values are
 * constrained to numeric engine fields, so a metric cannot be pointed at
 * `category` and silently sum garbage.
 */
const METRIC_SOURCE: Record<
  Exclude<keyof ReportMetrics, "students">,
  NumericKey<InvoiceComputed>
> = {
  billed: "billing",
  received: "received",
  outstanding: "outstanding",
  payable: "payable",
  paidToOem: "paidToOem",
  outstandingToOem: "outstandingToOem",
  netMargin: "netMargin",
  netGst: "gstDiff",
  tdsReceivable: "tdsIn",
  tdsPayable: "tdsOut",
  advanceTdsCost: "advanceTdsCost",
};

// Hoisted: the pairs are fixed, so walk them per invoice without re-deriving.
const METRIC_ENTRIES = Object.entries(METRIC_SOURCE) as [
  Exclude<keyof ReportMetrics, "students">,
  NumericKey<InvoiceComputed>,
][];

/**
 * Raw, UNFILTERED report data: per account, money bucketed by bill type.
 *
 * Totals, by-OEM rollups, aging and row order are NOT computed here — they all
 * depend on which bill types the viewer ticked, and live in `selectReport`
 * (lib/money/report-view.ts). Keeping server copies would just be a second
 * source of truth that drifts from the screen.
 */
export async function getReportData(
  user: SessionUser,
  yearLabel: string,
): Promise<ReportData> {
  const empty: ReportData = { rows: [] };

  const [year] = await db
    .select()
    .from(academicYears)
    .where(eq(academicYears.label, yearLabel))
    .limit(1);
  if (!year) return empty;

  const assigned = user.roles.includes("super-admin") ? [] : await assignedIds(user.id);
  const scope = scopeAccountIds(user, assigned);

  const accRows = await db
    .select({ id: accounts.id, name: accounts.name, oem: oems.name, isSelf: oems.isSelf })
    .from(accounts)
    .innerJoin(oems, eq(accounts.oemId, oems.id))
    .where(scope === null ? undefined : inArray(accounts.id, scope.length ? scope : [-1]));

  if (!accRows.length) return empty;

  const accountIds = accRows.map((a) => a.id);
  const allInvRows = await db
    .select()
    .from(invoices)
    .where(and(inArray(invoices.accountId, accountIds), eq(invoices.yearId, year.id)));

  const invsByAccount = new Map<number, typeof allInvRows>();
  for (const inv of allInvRows) {
    const list = invsByAccount.get(inv.accountId) ?? [];
    list.push(inv);
    invsByAccount.set(inv.accountId, list);
  }

  const allInvIds = allInvRows.map((r) => r.id);
  const [lites, cohortPx] = await Promise.all([
    loadPaymentLites(allInvIds),
    loadCohortPricing(allInvIds),
  ]);

  const rows: ReportRow[] = [];

  for (const a of accRows) {
    const invRows = invsByAccount.get(a.id) ?? [];
    const inputs: InvoiceInputWithStatus[] = invRows.map((r) => ({
      category: r.category, semester: r.semester, students: r.students,
      priceToUni: Number(r.priceToUni), priceToDatagami: Number(r.priceToDatagami),
      gstRate: Number(r.gstRate), tdsRate: Number(r.tdsRate), advanceAdj: Number(r.advanceAdj),
      status: r.status, payments: lites.get(r.id)?.receipts ?? [],
      oemPayments: lites.get(r.id)?.oemPayments ?? [], selfSupplied: a.isSelf,
      cohortPricing: cohortPx.get(r.id),
    }));

    // `computeAccount` already returns each invoice computed and tagged with its
    // category, so bucketing is a pure JS pass over a result we already have.
    const c = computeAccount(inputs);
    const byCategory = emptyByCategory();
    const bills: BillLite[] = [];

    for (const inv of c.invoices) {
      const cat = inv.category;
      const m = byCategory[cat];
      // An advance is a token payment, not a headcount.
      m.students += cat === "advance" ? 0 : inv.students;
      for (const [metric, src] of METRIC_ENTRIES) m[metric] += inv[src];

      bills.push({
        category: cat,
        status: inv.status,
        outstanding: inv.outstanding,
        received: inv.received,
      });
    }

    rows.push({ id: a.id, name: a.name, oem: a.oem, byCategory, bills });
  }

  return { rows };
}
