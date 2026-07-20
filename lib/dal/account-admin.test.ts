import { describe, it, expect, afterAll } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  accounts,
  auditLog,
  cohorts,
  invoices,
  oems,
  payments,
  tasks,
  userAccounts,
  users,
} from "@/lib/db/schema";
import { createAccount, createInvoice, deleteAccount, listOems } from "./account-admin";
import { getAccountDetail } from "./account-detail";

const SUPER = { id: 1, roles: ["super-admin" as const] };
const YEAR = "FY26–27";

describe("account-admin", () => {
  let accountId: number | null = null;

  it("super-admin creates an account + invoice end to end", async () => {
    const oems = await listOems();
    const ibm = oems.find((o) => o.name === "IBM")!;

    const acc = await createAccount(SUPER, {
      name: "Test University (admin-created)",
      type: "university",
      oemId: ibm.id,
    });
    accountId = acc.id;

    const invoice = await createInvoice(SUPER, acc.id, YEAR, {
      category: "new",
      semester: "none",
      students: 100,
      priceToUni: 20000,
      priceToDatagami: 17000,
      gstRate: 0.18,
      tdsRate: 0.1,
      status: "raised",
    });

    const detail = await getAccountDetail(SUPER, acc.id, YEAR);
    expect(detail!.name).toMatch(/Test University/);
    expect(detail!.invoices.length).toBe(1);
    expect(detail!.totals.netMargin).toBe(100 * (20000 - 17000)); // 300000

    // The audit trigger reads updated_by off the row to attribute the audit_log
    // entry — assert the app actually stamped both columns on insert.
    const { db } = await import("@/lib/db/client");
    const t = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const [accountRow] = await db.select().from(t.accounts).where(eq(t.accounts.id, acc.id)).limit(1);
    expect(accountRow.createdBy).toBe(SUPER.id);
    expect(accountRow.updatedBy).toBe(SUPER.id);
    const [invoiceRow] = await db
      .select()
      .from(t.invoices)
      .where(eq(t.invoices.id, invoice.id))
      .limit(1);
    expect(invoiceRow.createdBy).toBe(SUPER.id);
    expect(invoiceRow.updatedBy).toBe(SUPER.id);
  });

  it("rejects a non-super-admin creating an account", async () => {
    await expect(
      createAccount({ id: 2, roles: ["sales"] }, { name: "X", type: "university", oemId: 1 }),
    ).rejects.toThrow();
  });

  afterAll(async () => {
    if (accountId) {
      const { db } = await import("@/lib/db/client");
      const t = await import("@/lib/db/schema");
      const { eq } = await import("drizzle-orm");
      await db.delete(t.invoices).where(eq(t.invoices.accountId, accountId));
      await db.delete(t.accounts).where(eq(t.accounts.id, accountId));
    }
  });
});

describe("deleteAccount — the full cascade names the DELETER", () => {
  const RUN = String(Date.now()).slice(-9);
  const fx = { oemId: 0, accountId: 0, deleterId: 0, memberId: 0 };
  const cleanup = { invoiceId: 0, paymentId: 0, cohortId: 0, taskId: 0 };

  afterAll(async () => {
    // The test itself deletes the account; these are safety nets for a failure.
    await db.delete(tasks).where(eq(tasks.id, cleanup.taskId));
    await db.delete(invoices).where(eq(invoices.accountId, fx.accountId));
    await db.delete(accounts).where(eq(accounts.id, fx.accountId));
    await db.delete(oems).where(eq(oems.id, fx.oemId));
    await db.delete(users).where(eq(users.id, fx.memberId));
    await db.delete(users).where(eq(users.id, fx.deleterId));

    const scopes: Array<[string, number]> = [
      ["accounts", fx.accountId],
      ["oems", fx.oemId],
      ["users", fx.memberId],
      ["users", fx.deleterId],
      ["invoices", cleanup.invoiceId],
      ["payments", cleanup.paymentId],
      ["cohorts", cleanup.cohortId],
      ["tasks", cleanup.taskId],
    ];
    for (const [tableName, rowId] of scopes) {
      if (!rowId) continue;
      await db.delete(auditLog).where(and(eq(auditLog.tableName, tableName), eq(auditLog.rowId, String(rowId))));
    }
    // user_accounts has a composite PK → row_id is NULL; scope by the image.
    if (fx.accountId) {
      await db
        .delete(auditLog)
        .where(
          and(
            eq(auditLog.tableName, "user_accounts"),
            sql`coalesce(${auditLog.before} ->> 'account_id', ${auditLog.after} ->> 'account_id') = ${String(fx.accountId)}`,
          ),
        );
    }
  });

  it("invoice, payment, cohort, user assignment and orphaned task all carry the deleting admin as actor", async () => {
    // CREATOR (SUPER) builds everything; a DISTINCT super-admin deletes it, so
    // every actor assertion below discriminates between the two.
    const [deleter] = await db
      .insert(users)
      .values({
        name: `Account Deleter ${RUN}`,
        email: `account-deleter-${RUN}@test.local`,
        passwordHash: "x",
        role: "super-admin",
      })
      .returning({ id: users.id });
    fx.deleterId = deleter.id;
    const DELETER = { id: deleter.id, roles: ["super-admin" as const] };

    const [member] = await db
      .insert(users)
      .values({
        name: `Account Member ${RUN}`,
        email: `account-member-${RUN}@test.local`,
        passwordHash: "x",
        role: "sales",
      })
      .returning({ id: users.id });
    fx.memberId = member.id;

    const [oem] = await db
      .insert(oems)
      .values({ name: `DeleteAccountOEM-${RUN}`, createdBy: SUPER.id, updatedBy: SUPER.id })
      .returning({ id: oems.id });
    fx.oemId = oem.id;
    const [acc] = await db
      .insert(accounts)
      .values({ name: `DeleteAccountUni-${RUN}`, oemId: oem.id, createdBy: SUPER.id, updatedBy: SUPER.id })
      .returning({ id: accounts.id });
    fx.accountId = acc.id;

    const invoice = await createInvoice(SUPER, acc.id, YEAR, {
      category: "new",
      semester: "none",
      students: 5,
      priceToUni: 2000,
      priceToDatagami: 1500,
      gstRate: 0.18,
      tdsRate: 0.1,
      status: "draft",
    });
    cleanup.invoiceId = invoice.id;

    const [payment] = await db
      .insert(payments)
      .values({
        invoiceId: invoice.id,
        direction: "receipt",
        paidOn: "2026-07-20",
        amount: "1000",
        mode: "RTGS",
        ref: `DeleteAccountPay-${RUN}`,
        createdBy: SUPER.id,
        updatedBy: SUPER.id,
      })
      .returning({ id: payments.id });
    cleanup.paymentId = payment.id;

    const [cohort] = await db
      .insert(cohorts)
      .values({
        invoiceId: invoice.id,
        enrollmentYear: "2024-25",
        count: 5,
        createdBy: SUPER.id,
        updatedBy: SUPER.id,
      })
      .returning({ id: cohorts.id });
    cleanup.cohortId = cohort.id;

    await db
      .insert(userAccounts)
      .values({ userId: member.id, accountId: acc.id, createdBy: SUPER.id, updatedBy: SUPER.id });

    const [task] = await db
      .insert(tasks)
      .values({
        title: `DeleteAccount Task ${RUN}`,
        accountId: acc.id,
        createdBy: SUPER.id,
        updatedBy: SUPER.id,
      })
      .returning({ id: tasks.id });
    cleanup.taskId = task.id;

    await deleteAccount(DELETER, acc.id);

    const deleteActor = async (tableName: string, rowId: number) => {
      const rows = await db
        .select()
        .from(auditLog)
        .where(
          and(eq(auditLog.tableName, tableName), eq(auditLog.rowId, String(rowId)), eq(auditLog.op, "DELETE")),
        );
      expect(rows).toHaveLength(1);
      return rows[0].actorId;
    };

    // The account itself and its invoices were already stamped before this fix.
    expect(await deleteActor("accounts", acc.id)).toBe(DELETER.id);
    expect(await deleteActor("invoices", invoice.id)).toBe(DELETER.id);

    // These four were not. Each was last touched by SUPER, so an unstamped
    // delete would name SUPER — a real, uninvolved admin — as the destroyer of
    // this account's financial history.
    expect(await deleteActor("payments", payment.id)).toBe(DELETER.id);
    expect(await deleteActor("payments", payment.id)).not.toBe(SUPER.id);
    expect(await deleteActor("cohorts", cohort.id)).toBe(DELETER.id);
    expect(await deleteActor("cohorts", cohort.id)).not.toBe(SUPER.id);

    const assignmentDelete = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.tableName, "user_accounts"),
          eq(auditLog.op, "DELETE"),
          sql`coalesce(${auditLog.before} ->> 'account_id', '') = ${String(acc.id)}`,
          sql`coalesce(${auditLog.before} ->> 'user_id', '') = ${String(member.id)}`,
        ),
      );
    expect(assignmentDelete).toHaveLength(1);
    expect(assignmentDelete[0].actorId).toBe(DELETER.id);
    expect(assignmentDelete[0].actorId).not.toBe(SUPER.id);

    // tasks.account_id is ON DELETE SET NULL — the task survives, orphaned, and
    // that un-linking is itself an audited UPDATE that reads updated_by.
    const unlink = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.tableName, "tasks"),
          eq(auditLog.rowId, String(task.id)),
          eq(auditLog.op, "UPDATE"),
          sql`coalesce(${auditLog.before} ->> 'account_id', '') = ${String(acc.id)}`,
          sql`${auditLog.after} ->> 'account_id' IS NULL`,
        ),
      );
    expect(unlink).toHaveLength(1);
    expect(unlink[0].actorId).toBe(DELETER.id);
    expect(unlink[0].actorId).not.toBe(SUPER.id);

    const [taskRow] = await db.select().from(tasks).where(eq(tasks.id, task.id)).limit(1);
    expect(taskRow.accountId).toBeNull(); // orphaned, not deleted
  });
});
