import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accounts, invoices, academicYears, oems } from "@/lib/db/schema";
import { computeAccount } from "@/lib/money/compute";
import type { InvoiceInputWithStatus, AccountComputed, Status } from "@/lib/money/types";
import { scopeAccountIds, type SessionUser } from "./authz";
import { assignedIds } from "./accounts";
import { loadPaymentLites } from "./payments";
import { loadCohortPricing } from "./cohort-pricing";

export interface PortfolioRow {
  id: number;
  name: string;
  oem: string;
  billed: number;
  received: number;
  outstanding: number;
  netMargin: number;
  hasNegative: boolean;
  status: Status;
}

export interface Portfolio {
  totals: {
    billed: number;
    received: number;
    outstanding: number;
    payable: number;
    paidToOem: number;
    outstandingToOem: number;
    netMargin: number;
  };
  reserves: {
    netGst: number;
    tdsReceivable: number;
    tdsPayable: number;
    advanceTdsCost: number;
  };
  counts: { accounts: number; openInvoices: number; negativeMargin: number };
  rows: PortfolioRow[];
  marginByOem: { oem: string; margin: number }[];
  aging: { current: number; d31_60: number; d61_90: number; d90plus: number };
}

/**
 * Portfolio rollup for a user + academic year, RBAC-scoped. Aggregates
 * `computeAccount` results across every account the caller can see.
 */
export async function getPortfolioForUser(
  user: SessionUser,
  yearLabel: string,
  assignedOverride?: number[],
): Promise<Portfolio> {
  const empty: Portfolio = {
    totals: { billed: 0, received: 0, outstanding: 0, payable: 0, paidToOem: 0, outstandingToOem: 0, netMargin: 0 },
    reserves: { netGst: 0, tdsReceivable: 0, tdsPayable: 0, advanceTdsCost: 0 },
    counts: { accounts: 0, openInvoices: 0, negativeMargin: 0 },
    rows: [],
    marginByOem: [],
    aging: { current: 0, d31_60: 0, d61_90: 0, d90plus: 0 },
  };

  const [year] = await db
    .select()
    .from(academicYears)
    .where(eq(academicYears.label, yearLabel))
    .limit(1);
  if (!year) return empty;

  const assigned =
    assignedOverride ?? (user.role === "super-admin" ? [] : await assignedIds(user.id));
  const scope = scopeAccountIds(user, assigned);

  const accRows = await db
    .select({ id: accounts.id, name: accounts.name, oem: oems.name, isSelf: oems.isSelf })
    .from(accounts)
    .innerJoin(oems, eq(accounts.oemId, oems.id))
    .where(scope === null ? undefined : inArray(accounts.id, scope.length ? scope : [-1]));

  const p: Portfolio = structuredClone(empty);
  const oemMargins = new Map<string, number>();

  for (const a of accRows) {
    const invRows = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.accountId, a.id), eq(invoices.yearId, year.id)));

    const invIds = invRows.map((r) => r.id);
    const lites = await loadPaymentLites(invIds);
    const cohortPx = await loadCohortPricing(invIds);
    const inputs: InvoiceInputWithStatus[] = invRows.map((r) => ({
      category: r.category,
      semester: r.semester,
      students: r.students,
      priceToUni: Number(r.priceToUni),
      priceToDatagami: Number(r.priceToDatagami),
      gstRate: Number(r.gstRate),
      tdsRate: Number(r.tdsRate),
      advanceAdj: Number(r.advanceAdj),
      status: r.status,
      payments: lites.get(r.id)?.receipts ?? [],
      oemPayments: lites.get(r.id)?.oemPayments ?? [],
      selfSupplied: a.isSelf,
      cohortPricing: cohortPx.get(r.id),
    }));

    const c: AccountComputed = computeAccount(inputs);

    p.totals.billed += c.billing;
    p.totals.received += c.received;
    p.totals.outstanding += c.outstanding;
    p.totals.payable += c.payable;
    p.totals.paidToOem += c.paidToOem;
    p.totals.outstandingToOem += c.outstandingToOem;
    p.totals.netMargin += c.netMargin;
    p.reserves.netGst += c.netGst;
    p.reserves.tdsReceivable += c.tdsReceivable;
    p.reserves.tdsPayable += c.tdsPayable;
    p.reserves.advanceTdsCost += c.advanceTdsCost;
    p.counts.accounts += 1;
    p.counts.openInvoices += c.invoices.filter((i) => i.outstanding > 1).length;
    if (c.hasNegative) p.counts.negativeMargin += 1;

    oemMargins.set(a.oem, (oemMargins.get(a.oem) ?? 0) + c.netMargin);

    // Coarse aging proxy from invoice status (real due-date aging is future work).
    for (const inv of c.invoices) {
      if (inv.outstanding <= 1) continue;
      if (inv.status === "overdue") p.aging.d90plus += inv.outstanding;
      else if (inv.status === "partially-paid") p.aging.d31_60 += inv.outstanding;
      else p.aging.current += inv.outstanding;
    }

    p.rows.push({
      id: a.id,
      name: a.name,
      oem: a.oem,
      billed: c.billing,
      received: c.received,
      outstanding: c.outstanding,
      netMargin: c.netMargin,
      hasNegative: c.hasNegative,
      status: c.status,
    });
  }

  p.rows.sort((x, y) => y.billed - x.billed);
  p.marginByOem = [...oemMargins.entries()]
    .map(([oem, margin]) => ({ oem, margin }))
    .sort((x, y) => y.margin - x.margin);

  return p;
}
