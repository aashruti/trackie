import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accounts, invoices, academicYears, oems } from "@/lib/db/schema";
import { computeAccount } from "@/lib/money/compute";
import type { InvoiceInputWithStatus, Status } from "@/lib/money/types";
import { scopeAccountIds, type SessionUser } from "./authz";
import { assignedIds } from "./accounts";
import { loadPaymentLites, loadPaymentLedger } from "./payments";

export interface OemAccountRow {
  id: number;
  name: string;
  students: number;
  billed: number;
  received: number;
  outstanding: number;
  payable: number;
  paidToOem: number;
  outstandingToOem: number;
  netMargin: number;
  status: Status;
}

export interface OemPaymentRow {
  account: string;
  stream: string;
  direction: "receipt" | "oem-payment";
  paidOn: string;
  amount: number;
  mode: string;
  ref: string | null;
}

export interface OemReport {
  oem: string;
  isSelf: boolean;
  accounts: OemAccountRow[];
  payments: OemPaymentRow[];
  totals: {
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
  };
}

const CATEGORY_LABEL: Record<string, string> = {
  advance: "Advance bill",
  old: "Old students",
  new: "New students",
};
function streamLabel(category: string, semester: string) {
  const base = CATEGORY_LABEL[category] ?? category;
  return semester === "none" ? base : `${base} (${semester === "1" ? "1st" : "2nd"} sem)`;
}

/** Consolidated report for one OEM: every account, every payment, and totals. */
export async function getOemReport(
  user: SessionUser,
  oemName: string,
  yearLabel: string,
): Promise<OemReport | null> {
  const [oem] = await db.select().from(oems).where(eq(oems.name, oemName)).limit(1);
  if (!oem) return null;

  const [year] = await db
    .select()
    .from(academicYears)
    .where(eq(academicYears.label, yearLabel))
    .limit(1);
  const blankTotals = {
    students: 0, billed: 0, received: 0, outstanding: 0, payable: 0,
    paidToOem: 0, outstandingToOem: 0, netMargin: 0, netGst: 0,
    tdsReceivable: 0, tdsPayable: 0,
  };
  if (!year) {
    return { oem: oem.name, isSelf: oem.isSelf, accounts: [], payments: [], totals: blankTotals };
  }

  const assigned = user.role === "super-admin" ? [] : await assignedIds(user.id);
  const scope = scopeAccountIds(user, assigned);

  const accRows = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(
      scope === null
        ? eq(accounts.oemId, oem.id)
        : and(eq(accounts.oemId, oem.id), inArray(accounts.id, scope.length ? scope : [-1])),
    );

  const report: OemReport = {
    oem: oem.name,
    isSelf: oem.isSelf,
    accounts: [],
    payments: [],
    totals: { ...blankTotals },
  };

  for (const a of accRows) {
    const invRows = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.accountId, a.id), eq(invoices.yearId, year.id)));
    const invoiceIds = invRows.map((r) => r.id);
    const lites = await loadPaymentLites(invoiceIds);
    const ledger = await loadPaymentLedger(invoiceIds);

    const inputs: InvoiceInputWithStatus[] = invRows.map((r) => ({
      category: r.category, semester: r.semester, students: r.students,
      priceToUni: Number(r.priceToUni), priceToDatagami: Number(r.priceToDatagami),
      gstRate: Number(r.gstRate), tdsRate: Number(r.tdsRate), advanceAdj: Number(r.advanceAdj),
      status: r.status, payments: lites.get(r.id)?.receipts ?? [],
      oemPayments: lites.get(r.id)?.oemPayments ?? [], selfSupplied: oem.isSelf,
    }));

    const c = computeAccount(inputs);
    const students = c.invoices.filter((i) => i.category !== "advance").reduce((s, i) => s + i.students, 0);

    report.accounts.push({
      id: a.id, name: a.name, students,
      billed: c.billing, received: c.received, outstanding: c.outstanding,
      payable: c.payable, paidToOem: c.paidToOem, outstandingToOem: c.outstandingToOem,
      netMargin: c.netMargin, status: c.status,
    });

    const t = report.totals;
    t.students += students; t.billed += c.billing; t.received += c.received;
    t.outstanding += c.outstanding; t.payable += c.payable; t.paidToOem += c.paidToOem;
    t.outstandingToOem += c.outstandingToOem; t.netMargin += c.netMargin;
    t.netGst += c.netGst; t.tdsReceivable += c.tdsReceivable; t.tdsPayable += c.tdsPayable;

    // Collect every payment across this account's invoices.
    for (const r of invRows) {
      for (const p of ledger.get(r.id) ?? []) {
        report.payments.push({
          account: a.name,
          stream: streamLabel(r.category, r.semester),
          direction: p.direction,
          paidOn: p.paidOn,
          amount: p.amount,
          mode: p.mode,
          ref: p.ref,
        });
      }
    }
  }

  report.accounts.sort((x, y) => y.billed - x.billed);
  report.payments.sort((x, y) => x.paidOn.localeCompare(y.paidOn));
  return report;
}
