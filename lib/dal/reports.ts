import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accounts, invoices, academicYears, oems } from "@/lib/db/schema";
import { computeAccount } from "@/lib/money/compute";
import type { InvoiceInputWithStatus, Status } from "@/lib/money/types";
import { scopeAccountIds, type SessionUser } from "./authz";
import { assignedIds } from "./accounts";
import { loadPaymentLites } from "./payments";
import { loadCohortPricing } from "./cohort-pricing";

export interface ReportRow {
  id: number;
  name: string;
  oem: string;
  students: number;
  billed: number;
  received: number;
  outstanding: number;
  payable: number;
  paidToOem: number;
  outstandingToOem: number;
  netMargin: number;
  netGst: number;
  tdsReceivable: number;
  tdsPayable: number;
  advanceTdsCost: number;
  status: Status;
}

export interface ReportData {
  rows: ReportRow[];
  byOem: { oem: string; billed: number; netMargin: number; payable: number }[];
  aging: { current: number; d31_60: number; d61_90: number; d90plus: number };
  totals: Omit<ReportRow, "id" | "name" | "oem" | "status">;
}

export async function getReportData(
  user: SessionUser,
  yearLabel: string,
): Promise<ReportData> {
  const blankTotals = {
    students: 0, billed: 0, received: 0, outstanding: 0, payable: 0,
    paidToOem: 0, outstandingToOem: 0, netMargin: 0, netGst: 0,
    tdsReceivable: 0, tdsPayable: 0, advanceTdsCost: 0,
  };
  const empty: ReportData = {
    rows: [], byOem: [], aging: { current: 0, d31_60: 0, d61_90: 0, d90plus: 0 },
    totals: { ...blankTotals },
  };

  const [year] = await db
    .select()
    .from(academicYears)
    .where(eq(academicYears.label, yearLabel))
    .limit(1);
  if (!year) return empty;

  const assigned = user.role === "super-admin" ? [] : await assignedIds(user.id);
  const scope = scopeAccountIds(user, assigned);

  const accRows = await db
    .select({ id: accounts.id, name: accounts.name, oem: oems.name, isSelf: oems.isSelf })
    .from(accounts)
    .innerJoin(oems, eq(accounts.oemId, oems.id))
    .where(scope === null ? undefined : inArray(accounts.id, scope.length ? scope : [-1]));

  const data: ReportData = { rows: [], byOem: [], aging: { ...empty.aging }, totals: { ...blankTotals } };
  const oemAgg = new Map<string, { billed: number; netMargin: number; payable: number }>();

  if (!accRows.length) return data;

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

    const c = computeAccount(inputs);
    const students = c.invoices.filter((i) => i.category !== "advance").reduce((s, i) => s + i.students, 0);

    const row: ReportRow = {
      id: a.id, name: a.name, oem: a.oem, students,
      billed: c.billing, received: c.received, outstanding: c.outstanding,
      payable: c.payable, paidToOem: c.paidToOem, outstandingToOem: c.outstandingToOem,
      netMargin: c.netMargin, netGst: c.netGst, tdsReceivable: c.tdsReceivable,
      tdsPayable: c.tdsPayable, advanceTdsCost: c.advanceTdsCost, status: c.status,
    };
    data.rows.push(row);

    const t = data.totals;
    t.students += students; t.billed += c.billing; t.received += c.received;
    t.outstanding += c.outstanding; t.payable += c.payable; t.paidToOem += c.paidToOem;
    t.outstandingToOem += c.outstandingToOem; t.netMargin += c.netMargin;
    t.netGst += c.netGst; t.tdsReceivable += c.tdsReceivable; t.tdsPayable += c.tdsPayable;
    t.advanceTdsCost += c.advanceTdsCost;

    const agg = oemAgg.get(a.oem) ?? { billed: 0, netMargin: 0, payable: 0 };
    agg.billed += c.billing; agg.netMargin += c.netMargin; agg.payable += c.payable;
    oemAgg.set(a.oem, agg);

    for (const inv of c.invoices) {
      if (inv.outstanding <= 1) continue;
      if (inv.status === "overdue") data.aging.d90plus += inv.outstanding;
      else if (inv.status === "partially-paid") data.aging.d31_60 += inv.outstanding;
      else data.aging.current += inv.outstanding;
    }
  }

  data.rows.sort((x, y) => y.billed - x.billed);
  data.byOem = [...oemAgg.entries()]
    .map(([oem, v]) => ({ oem, ...v }))
    .sort((x, y) => y.netMargin - x.netMargin);
  return data;
}
