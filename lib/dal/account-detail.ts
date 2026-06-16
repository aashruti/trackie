import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accounts, invoices, academicYears, oems } from "@/lib/db/schema";
import { computeAccount } from "@/lib/money/compute";
import type { InvoiceInputWithStatus, Status } from "@/lib/money/types";
import { type SessionUser } from "./authz";
import { assignedIds } from "./accounts";

export interface AccountDetail {
  id: number;
  name: string;
  type: string;
  oem: string;
  status: Status;
  totals: { billed: number; received: number; outstanding: number; payable: number; netMargin: number };
  reserves: { netGst: number; tdsReceivable: number; tdsPayable: number; advanceTdsCost: number };
  invoices: ReturnType<typeof computeAccount>["invoices"];
}

/** Single account with fully computed invoices. Returns null if out of the caller's scope. */
export async function getAccountDetail(
  user: SessionUser,
  accountId: number,
  yearLabel: string,
): Promise<AccountDetail | null> {
  // Scope check: admin/viewer may only see assigned accounts.
  if (user.role !== "super-admin") {
    const allowed = await assignedIds(user.id);
    if (!allowed.includes(accountId)) return null;
  }

  const [year] = await db
    .select()
    .from(academicYears)
    .where(eq(academicYears.label, yearLabel))
    .limit(1);
  if (!year) return null;

  const [acc] = await db
    .select({ id: accounts.id, name: accounts.name, type: accounts.type, oem: oems.name })
    .from(accounts)
    .innerJoin(oems, eq(accounts.oemId, oems.id))
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!acc) return null;

  const invRows = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.accountId, acc.id), eq(invoices.yearId, year.id)));

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
    payments: [],
  }));

  const c = computeAccount(inputs);
  return {
    id: acc.id,
    name: acc.name,
    type: acc.type,
    oem: acc.oem,
    status: c.status,
    totals: {
      billed: c.billing,
      received: c.received,
      outstanding: c.outstanding,
      payable: c.payable,
      netMargin: c.netMargin,
    },
    reserves: {
      netGst: c.netGst,
      tdsReceivable: c.tdsReceivable,
      tdsPayable: c.tdsPayable,
      advanceTdsCost: c.advanceTdsCost,
    },
    invoices: c.invoices,
  };
}
