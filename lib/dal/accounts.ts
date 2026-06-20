import "server-only";
import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accounts, invoices, academicYears, oems, userAccounts } from "@/lib/db/schema";
import { computeAccount } from "@/lib/money/compute";
import type { InvoiceInputWithStatus, Status } from "@/lib/money/types";
import { scopeAccountIds, type SessionUser } from "./authz";
import { loadPaymentLites } from "./payments";
import { loadCohortPricing } from "./cohort-pricing";
import { todayISO } from "@/lib/dates";

function effStatus(dbStatus: Status, dueDate: string | null | undefined, today: string): Status {
  if (dueDate && dueDate < today && (dbStatus === "raised" || dbStatus === "partially-paid")) {
    return "overdue";
  }
  return dbStatus;
}

/** Account ids assigned to a user (for admin/viewer scoping). */
export async function assignedIds(userId: number): Promise<number[]> {
  const rows = await db
    .select({ id: userAccounts.accountId })
    .from(userAccounts)
    .where(eq(userAccounts.userId, userId));
  return rows.map((r) => r.id);
}

/**
 * List accounts visible to a user for a given academic year, each with the money
 * engine's computed rollups. Enforces per-account RBAC at the query level.
 */
export async function listAccountsForUser(
  user: SessionUser,
  yearLabel: string,
  assignedOverride?: number[],
) {
  const [year] = await db
    .select()
    .from(academicYears)
    .where(eq(academicYears.label, yearLabel))
    .limit(1);
  if (!year) return [];

  const assigned =
    assignedOverride ?? (user.role === "super-admin" ? [] : await assignedIds(user.id));
  const scope = scopeAccountIds(user, assigned);

  const accRows = await db
    .select({ id: accounts.id, name: accounts.name, type: accounts.type, oem: oems.name, isSelf: oems.isSelf })
    .from(accounts)
    .innerJoin(oems, eq(accounts.oemId, oems.id))
    .where(scope === null ? undefined : inArray(accounts.id, scope.length ? scope : [-1]));

  if (!accRows.length) return [];

  // Batch: fetch all invoices for all accounts in one query (eliminates N+1 loop).
  const accountIds = accRows.map((a) => a.id);
  const allInvRows = await db
    .select()
    .from(invoices)
    .where(and(inArray(invoices.accountId, accountIds), eq(invoices.yearId, year.id)));

  // Group invoices by accountId for O(1) lookup below.
  const invsByAccount = new Map<number, typeof allInvRows>();
  for (const inv of allInvRows) {
    const list = invsByAccount.get(inv.accountId) ?? [];
    list.push(inv);
    invsByAccount.set(inv.accountId, list);
  }

  // Batch: load payments + cohort pricing for ALL invoices at once (2 queries total).
  const allInvIds = allInvRows.map((r) => r.id);
  const [lites, cohortPx] = await Promise.all([
    loadPaymentLites(allInvIds),
    loadCohortPricing(allInvIds),
  ]);

  // Pure-JS computation per account — no more DB calls inside the loop.
  const today = todayISO();
  const result = [];
  for (const a of accRows) {
    const invRows = invsByAccount.get(a.id) ?? [];
    const inputs: InvoiceInputWithStatus[] = invRows.map((r) => ({
      category: r.category,
      semester: r.semester,
      students: r.students,
      priceToUni: Number(r.priceToUni),
      priceToDatagami: Number(r.priceToDatagami),
      gstRate: Number(r.gstRate),
      tdsRate: Number(r.tdsRate),
      advanceAdj: Number(r.advanceAdj),
      status: effStatus(r.status, r.dueDate, today),
      payments: lites.get(r.id)?.receipts ?? [],
      oemPayments: lites.get(r.id)?.oemPayments ?? [],
      selfSupplied: a.isSelf,
      cohortPricing: cohortPx.get(r.id),
    }));

    const computed = computeAccount(inputs);
    result.push({
      id: a.id,
      name: a.name,
      type: a.type,
      oem: a.oem,
      billing: computed.billing,
      received: computed.received,
      outstanding: computed.outstanding,
      payable: computed.payable,
      netMargin: computed.netMargin,
      gstDiff: computed.gstDiff,
      hasNegative: computed.hasNegative,
      status: computed.status,
    });
  }
  return result;
}

export interface OverdueInvoice {
  invoiceId: number;
  accountId: number;
  accountName: string;
  category: string;
  semester: string;
  dueDate: string;
}

/** Invoices past their due date that are still unpaid (raised or partially-paid). */
export async function listOverdueInvoices(
  user: SessionUser,
): Promise<OverdueInvoice[]> {
  const today = todayISO();
  let accFilter;
  if (user.role !== "super-admin") {
    const allowed = await assignedIds(user.id);
    if (allowed.length === 0) return [];
    accFilter = inArray(invoices.accountId, allowed);
  }

  const rows = await db
    .select({
      invoiceId: invoices.id,
      accountId: accounts.id,
      accountName: accounts.name,
      category: invoices.category,
      semester: invoices.semester,
      dueDate: invoices.dueDate,
    })
    .from(invoices)
    .innerJoin(accounts, eq(invoices.accountId, accounts.id))
    .where(
      and(
        lt(invoices.dueDate, today),
        inArray(invoices.status, ["raised", "partially-paid"] as Status[]),
        accFilter,
      ),
    )
    .orderBy(asc(invoices.dueDate));

  return rows
    .filter((r): r is typeof r & { dueDate: string } => r.dueDate != null)
    .map((r) => ({
      invoiceId: r.invoiceId,
      accountId: r.accountId,
      accountName: r.accountName,
      category: r.category,
      semester: r.semester,
      dueDate: r.dueDate,
    }));
}
