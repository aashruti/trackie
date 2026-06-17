import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accounts, invoices, academicYears, oems, userAccounts } from "@/lib/db/schema";
import { computeAccount } from "@/lib/money/compute";
import type { InvoiceInputWithStatus } from "@/lib/money/types";
import { scopeAccountIds, type SessionUser } from "./authz";

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

  const result = [];
  for (const a of accRows) {
    const invRows = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.accountId, a.id), eq(invoices.yearId, year.id)));

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
      payments: [], // receipts wired in the payments milestone
      selfSupplied: a.isSelf,
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
