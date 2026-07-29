import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  accounts,
  invoices,
  oems,
  userAccounts,
  userRoles,
  users,
} from "@/lib/db/schema";
import { todayISO } from "@/lib/dates";
import { computeInvoice } from "@/lib/money/compute";
import type { Category, Semester, Status } from "@/lib/money/types";
import {
  classifyInvoiceForSalesPush,
  isInPastWindow,
  salesPushWindow,
  type SalesPushWindow,
} from "@/lib/sales/push-window";
import { assignedIds } from "./accounts";
import {
  assertFinanceAccess,
  scopeAccountIds,
  type SessionUser,
} from "./authz";
import { loadCohortPricing } from "./cohort-pricing";
import { loadPaymentLedger, type Mode } from "./payments";

export type SalesPushInvoice = {
  invoiceId: number;
  accountId: number;
  accountName: string;
  oem: string;
  owner: string;
  category: Category;
  semester: Semester;
  status: Status;
  invoiceDate: string | null;
  dueDate: string | null;
  billing: number;
  received: number;
  outstanding: number;
};

export type SalesPushReceipt = {
  paymentId: number;
  invoiceId: number;
  accountId: number;
  accountName: string;
  owner: string;
  category: Category;
  semester: Semester;
  paidOn: string;
  amount: number;
  mode: Mode;
  ref: string | null;
};

export type SalesPushData = {
  window: SalesPushWindow;
  summary: {
    collectedAmount: number;
    collectedCount: number;
    missedAmount: number;
    missedCount: number;
    upcomingAmount: number;
    upcomingCount: number;
    invoiceToRaiseAmount: number;
    invoiceToRaiseCount: number;
  };
  collections: {
    received: SalesPushReceipt[];
    missed: SalesPushInvoice[];
    upcoming: SalesPushInvoice[];
  };
  invoices: {
    raisedRecently: SalesPushInvoice[];
    missedToRaise: SalesPushInvoice[];
    scheduledToRaise: SalesPushInvoice[];
  };
  dataQuality: {
    openWithoutDueDate: SalesPushInvoice[];
    draftsWithoutInvoiceDate: SalesPushInvoice[];
  };
};

function amount(
  rows: SalesPushInvoice[],
  key: "billing" | "outstanding",
): number {
  return rows.reduce((sum, row) => sum + Math.max(0, row[key]), 0);
}

/**
 * Rolling weekly-call view. Invoice dates are both historical facts and future
 * reminders; due dates drive collection follow-ups; receipt dates prove what
 * was actually collected.
 */
export async function getSalesPushData(
  user: SessionUser,
  today = todayISO(),
): Promise<SalesPushData> {
  assertFinanceAccess(user);
  const window = salesPushWindow(today);
  const assigned = user.roles.includes("super-admin")
    ? []
    : await assignedIds(user.id);
  const scope = scopeAccountIds(user, assigned);

  const accountRows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      oem: oems.name,
      isSelf: oems.isSelf,
    })
    .from(accounts)
    .innerJoin(oems, eq(accounts.oemId, oems.id))
    .where(
      scope === null
        ? undefined
        : inArray(accounts.id, scope.length ? scope : [-1]),
    );

  const accountIds = accountRows.map((account) => account.id);
  const accountById = new Map(
    accountRows.map((account) => [account.id, account]),
  );

  const [invoiceRows, ownerRows] = accountIds.length
    ? await Promise.all([
        db
          .select()
          .from(invoices)
          .where(inArray(invoices.accountId, accountIds)),
        db
          .select({
            accountId: userAccounts.accountId,
            owner: users.name,
          })
          .from(userAccounts)
          .innerJoin(users, eq(userAccounts.userId, users.id))
          // user_accounts is shared by Sales and Delivery scoping. Only people
          // who actually hold the Sales role belong on the Sales Push board.
          .innerJoin(
            userRoles,
            and(eq(userRoles.userId, users.id), eq(userRoles.role, "sales")),
          )
          .where(inArray(userAccounts.accountId, accountIds)),
      ])
    : [[], []];

  const ownersByAccount = new Map<number, string[]>();
  for (const row of ownerRows) {
    const names = ownersByAccount.get(row.accountId) ?? [];
    if (!names.includes(row.owner)) names.push(row.owner);
    ownersByAccount.set(row.accountId, names);
  }

  const invoiceIds = invoiceRows.map((invoice) => invoice.id);
  const [ledgers, cohortPricing] = await Promise.all([
    loadPaymentLedger(invoiceIds),
    loadCohortPricing(invoiceIds),
  ]);

  const reportInvoices: SalesPushInvoice[] = invoiceRows.map((invoice) => {
    const account = accountById.get(invoice.accountId)!;
    const ledger = ledgers.get(invoice.id) ?? [];
    const computed = computeInvoice({
      category: invoice.category,
      semester: invoice.semester,
      students: invoice.students,
      priceToUni: Number(invoice.priceToUni),
      priceToDatagami: Number(invoice.priceToDatagami),
      gstRate: Number(invoice.gstRate),
      tdsRate: Number(invoice.tdsRate),
      advanceAdj: Number(invoice.advanceAdj),
      payments: ledger
        .filter((payment) => payment.direction === "receipt")
        .map((payment) => ({ amount: payment.amount })),
      oemPayments: ledger
        .filter((payment) => payment.direction === "oem-payment")
        .map((payment) => ({ amount: payment.amount })),
      selfSupplied: account.isSelf,
      cohortPricing: cohortPricing.get(invoice.id),
    });

    return {
      invoiceId: invoice.id,
      accountId: account.id,
      accountName: account.name,
      oem: account.oem,
      owner: ownersByAccount.get(account.id)?.join(", ") || "Unassigned",
      category: invoice.category,
      semester: invoice.semester,
      status: invoice.status,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      billing: computed.billing,
      received: computed.received,
      outstanding: computed.outstanding,
    };
  });

  const received: SalesPushReceipt[] = [];
  for (const invoice of reportInvoices) {
    for (const payment of ledgers.get(invoice.invoiceId) ?? []) {
      if (
        payment.direction !== "receipt" ||
        !isInPastWindow(payment.paidOn, window)
      )
        continue;
      received.push({
        paymentId: payment.id,
        invoiceId: invoice.invoiceId,
        accountId: invoice.accountId,
        accountName: invoice.accountName,
        owner: invoice.owner,
        category: invoice.category,
        semester: invoice.semester,
        paidOn: payment.paidOn,
        amount: payment.amount,
        mode: payment.mode,
        ref: payment.ref,
      });
    }
  }

  const classified = reportInvoices.map((invoice) => ({
    invoice,
    flags: classifyInvoiceForSalesPush(invoice, window),
  }));
  const missed = classified
    .filter(({ flags }) => flags.missedCollection)
    .map(({ invoice }) => invoice);
  const upcoming = classified
    .filter(({ flags }) => flags.upcomingCollection)
    .map(({ invoice }) => invoice);
  const raisedRecently = classified
    .filter(({ flags }) => flags.raisedRecently)
    .map(({ invoice }) => invoice);
  const missedToRaise = classified
    .filter(({ flags }) => flags.missedInvoiceRaise)
    .map(({ invoice }) => invoice);
  const scheduledToRaise = classified
    .filter(({ flags }) => flags.scheduledInvoiceRaise)
    .map(({ invoice }) => invoice);
  const openWithoutDueDate = classified
    .filter(({ flags }) => flags.openWithoutDueDate)
    .map(({ invoice }) => invoice);
  const draftsWithoutInvoiceDate = classified
    .filter(({ flags }) => flags.draftWithoutInvoiceDate)
    .map(({ invoice }) => invoice);

  received.sort(
    (a, b) => b.paidOn.localeCompare(a.paidOn) || b.paymentId - a.paymentId,
  );
  missed.sort(
    (a, b) =>
      (a.dueDate ?? "").localeCompare(b.dueDate ?? "") ||
      b.outstanding - a.outstanding,
  );
  upcoming.sort(
    (a, b) =>
      (a.dueDate ?? "").localeCompare(b.dueDate ?? "") ||
      b.outstanding - a.outstanding,
  );
  raisedRecently.sort(
    (a, b) =>
      (b.invoiceDate ?? "").localeCompare(a.invoiceDate ?? "") ||
      b.invoiceId - a.invoiceId,
  );
  missedToRaise.sort(
    (a, b) =>
      (a.invoiceDate ?? "").localeCompare(b.invoiceDate ?? "") ||
      b.billing - a.billing,
  );
  scheduledToRaise.sort(
    (a, b) =>
      (a.invoiceDate ?? "").localeCompare(b.invoiceDate ?? "") ||
      b.billing - a.billing,
  );

  const invoiceToRaise = [...missedToRaise, ...scheduledToRaise];
  return {
    window,
    summary: {
      collectedAmount: received.reduce(
        (sum, receipt) => sum + receipt.amount,
        0,
      ),
      collectedCount: received.length,
      missedAmount: amount(missed, "outstanding"),
      missedCount: missed.length,
      upcomingAmount: amount(upcoming, "outstanding"),
      upcomingCount: upcoming.length,
      invoiceToRaiseAmount: amount(invoiceToRaise, "billing"),
      invoiceToRaiseCount: invoiceToRaise.length,
    },
    collections: { received, missed, upcoming },
    invoices: { raisedRecently, missedToRaise, scheduledToRaise },
    dataQuality: { openWithoutDueDate, draftsWithoutInvoiceDate },
  };
}
