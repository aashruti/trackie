import { describe, it, expect, afterAll, beforeAll } from "vitest";
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
import {
  createAccount,
  createInvoice,
  deleteAccount,
  deleteBill,
  getBillDeletionPreview,
  listOems,
} from "./account-admin";
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

describe("deleteBill / getBillDeletionPreview", () => {
  const RUN = String(Date.now()).slice(-9);
  // SUPER creates everything; a DISTINCT super-admin deletes, so every actor
  // assertion discriminates between creator and deleter.
  const fx = { oemId: 0, accountId: 0, otherAccountId: 0, deleterId: 0 };
  const cleanup = {
    invoiceId: 0,
    otherInvoiceId: 0,
    paymentIds: [] as number[],
    cohortIds: [] as number[],
  };
  let DELETER = { id: 0, roles: ["super-admin" as const] };
  const SALES = { id: 2, roles: ["sales" as const] };

  beforeAll(async () => {
    const [deleter] = await db
      .insert(users)
      .values({
        name: `Bill Deleter ${RUN}`,
        email: `bill-deleter-${RUN}@test.local`,
        passwordHash: "x",
        role: "super-admin",
      })
      .returning({ id: users.id });
    fx.deleterId = deleter.id;
    DELETER = { id: deleter.id, roles: ["super-admin" as const] };

    const [oem] = await db
      .insert(oems)
      .values({ name: `DeleteBillOEM-${RUN}`, createdBy: SUPER.id, updatedBy: SUPER.id })
      .returning({ id: oems.id });
    fx.oemId = oem.id;

    const [acc] = await db
      .insert(accounts)
      .values({ name: `DeleteBillUni-${RUN}`, oemId: oem.id, createdBy: SUPER.id, updatedBy: SUPER.id })
      .returning({ id: accounts.id });
    fx.accountId = acc.id;

    // A SECOND account, to prove the ownership check: its invoice must be
    // untouchable through fx.accountId.
    const [other] = await db
      .insert(accounts)
      .values({ name: `DeleteBillOther-${RUN}`, oemId: oem.id, createdBy: SUPER.id, updatedBy: SUPER.id })
      .returning({ id: accounts.id });
    fx.otherAccountId = other.id;

    // The bill under test is deliberately NOT a draft — any-status deletion is
    // the whole point of the feature.
    const invoice = await createInvoice(SUPER, fx.accountId, YEAR, {
      category: "old",
      semester: "none",
      students: 8,
      priceToUni: 2000,
      priceToDatagami: 1500,
      gstRate: 0.18,
      tdsRate: 0.1,
      status: "paid",
    });
    cleanup.invoiceId = invoice.id;

    const otherInvoice = await createInvoice(SUPER, fx.otherAccountId, YEAR, {
      category: "new",
      semester: "none",
      students: 3,
      priceToUni: 1000,
      priceToDatagami: 800,
      gstRate: 0.18,
      tdsRate: 0.1,
      status: "raised",
    });
    cleanup.otherInvoiceId = otherInvoice.id;

    // Two receipts and one OEM payment. The receipt amounts are chosen so a
    // naive float sum drifts: 1029.80 + 1740.23 === 2770.0299999999997 in
    // binary float, not 2770.03. The totals assertion below is exact, so a
    // naive sum fails the test.
    // Inserted out of date order so the preview's ordering is discriminating.
    const paid = await db
      .insert(payments)
      .values([
        {
          invoiceId: invoice.id,
          direction: "receipt" as const,
          paidOn: "2026-03-15",
          amount: "1740.23",
          mode: "NEFT" as const,
          ref: `DeleteBillPay-B-${RUN}`,
          createdBy: SUPER.id,
          updatedBy: SUPER.id,
        },
        {
          invoiceId: invoice.id,
          direction: "receipt" as const,
          paidOn: "2026-01-10",
          amount: "1029.80",
          mode: "RTGS" as const,
          ref: `DeleteBillPay-A-${RUN}`,
          createdBy: SUPER.id,
          updatedBy: SUPER.id,
        },
        {
          invoiceId: invoice.id,
          direction: "oem-payment" as const,
          paidOn: "2026-05-01",
          amount: "1500.55",
          mode: "UPI" as const,
          ref: null,
          createdBy: SUPER.id,
          updatedBy: SUPER.id,
        },
      ])
      .returning({ id: payments.id });
    cleanup.paymentIds = paid.map((p) => p.id);

    const madeCohorts = await db
      .insert(cohorts)
      .values([
        {
          invoiceId: invoice.id,
          enrollmentYear: "2024-25",
          count: 5,
          createdBy: SUPER.id,
          updatedBy: SUPER.id,
        },
        {
          invoiceId: invoice.id,
          enrollmentYear: "2025-26",
          count: 3,
          createdBy: SUPER.id,
          updatedBy: SUPER.id,
        },
      ])
      .returning({ id: cohorts.id });
    cleanup.cohortIds = madeCohorts.map((c) => c.id);
  });

  afterAll(async () => {
    // The delete test removes cleanup.invoiceId itself; these are safety nets.
    if (cleanup.invoiceId) await db.delete(invoices).where(eq(invoices.id, cleanup.invoiceId));
    if (cleanup.otherInvoiceId) await db.delete(invoices).where(eq(invoices.id, cleanup.otherInvoiceId));
    if (fx.accountId) await db.delete(accounts).where(eq(accounts.id, fx.accountId));
    if (fx.otherAccountId) await db.delete(accounts).where(eq(accounts.id, fx.otherAccountId));
    if (fx.oemId) await db.delete(oems).where(eq(oems.id, fx.oemId));
    if (fx.deleterId) await db.delete(users).where(eq(users.id, fx.deleterId));

    const scopes: Array<[string, number]> = [
      ["accounts", fx.accountId],
      ["accounts", fx.otherAccountId],
      ["oems", fx.oemId],
      ["users", fx.deleterId],
      ["invoices", cleanup.invoiceId],
      ["invoices", cleanup.otherInvoiceId],
      ...cleanup.paymentIds.map((id) => ["payments", id] as [string, number]),
      ...cleanup.cohortIds.map((id) => ["cohorts", id] as [string, number]),
    ];
    for (const [tableName, rowId] of scopes) {
      if (!rowId) continue;
      await db.delete(auditLog).where(and(eq(auditLog.tableName, tableName), eq(auditLog.rowId, String(rowId))));
    }
  });

  it("rejects a non-super-admin — both the preview and the delete", async () => {
    await expect(getBillDeletionPreview(SALES, fx.accountId, cleanup.invoiceId)).rejects.toThrow(
      /Super Admin/,
    );
    await expect(
      deleteBill(SALES, fx.accountId, cleanup.invoiceId, cleanup.paymentIds),
    ).rejects.toThrow(/Super Admin/);

    // Nothing was destroyed on the way to the rejection.
    const still = await db.select().from(invoices).where(eq(invoices.id, cleanup.invoiceId));
    expect(still).toHaveLength(1);
  });

  it("rejects an invoice that belongs to a DIFFERENT account", async () => {
    // The retired deleteDraftInvoice authorized against the caller-supplied
    // accountId but resolved the invoice by id alone — so this call would have
    // deleted another account's bill. Both functions must resolve the invoice
    // AND check that it belongs to the account the caller named.
    await expect(
      getBillDeletionPreview(DELETER, fx.accountId, cleanup.otherInvoiceId),
    ).rejects.toThrow(/not found/i);
    await expect(deleteBill(DELETER, fx.accountId, cleanup.otherInvoiceId, [])).rejects.toThrow(
      /not found/i,
    );

    // The other account's invoice survives untouched.
    const survivor = await db.select().from(invoices).where(eq(invoices.id, cleanup.otherInvoiceId));
    expect(survivor).toHaveLength(1);
    expect(survivor[0].accountId).toBe(fx.otherAccountId);
  });

  it("preview lists every payment, both direction totals, and the cohort count", async () => {
    const preview = await getBillDeletionPreview(DELETER, fx.accountId, cleanup.invoiceId);

    expect(preview.invoiceId).toBe(cleanup.invoiceId);
    expect(preview.cohortCount).toBe(2);

    // Oldest first, regardless of insertion order.
    expect(preview.payments.map((p) => p.paidOn)).toEqual(["2026-01-10", "2026-03-15", "2026-05-01"]);
    expect(preview.payments).toHaveLength(3);
    expect(preview.payments[0]).toMatchObject({
      invoiceId: cleanup.invoiceId,
      direction: "receipt",
      paidOn: "2026-01-10",
      amount: 1029.8,
      mode: "RTGS",
      ref: `DeleteBillPay-A-${RUN}`,
    });
    expect(preview.payments[1]).toMatchObject({
      direction: "receipt",
      amount: 1740.23,
      mode: "NEFT",
      ref: `DeleteBillPay-B-${RUN}`,
    });
    expect(preview.payments[2]).toMatchObject({
      direction: "oem-payment",
      amount: 1500.55,
      mode: "UPI",
      ref: null,
    });

    // Exact, not toBeCloseTo: a naive 1029.8 + 1740.23 lands on
    // 2770.0299999999997 and must fail here.
    expect(preview.receiptsTotal).toBe(2770.03);
    expect(preview.oemPaymentsTotal).toBe(1500.55);
    // The two directions are not conflated.
    expect(preview.receiptsTotal).not.toBe(preview.oemPaymentsTotal);
  });

  it("deletes a PAID (non-draft) bill along with its payments and cohorts", async () => {
    // Snapshot what the preview promised, so the post-delete assertions check
    // the same set of rows the dialog would have shown the user.
    const preview = await getBillDeletionPreview(DELETER, fx.accountId, cleanup.invoiceId);
    const previewedPaymentIds = preview.payments.map((p) => p.id).sort((a, b) => a - b);
    expect(previewedPaymentIds).toEqual([...cleanup.paymentIds].sort((a, b) => a - b));

    const [before] = await db.select().from(invoices).where(eq(invoices.id, cleanup.invoiceId));
    expect(before.status).toBe("paid"); // the retired function would have refused here

    await deleteBill(DELETER, fx.accountId, cleanup.invoiceId, previewedPaymentIds);

    expect(await db.select().from(invoices).where(eq(invoices.id, cleanup.invoiceId))).toHaveLength(0);
    expect(await db.select().from(payments).where(eq(payments.invoiceId, cleanup.invoiceId))).toHaveLength(0);
    expect(await db.select().from(cohorts).where(eq(cohorts.invoiceId, cleanup.invoiceId))).toHaveLength(0);
  });

  it("audits the invoice and every cascaded payment/cohort against the DELETER", async () => {
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

    expect(await deleteActor("invoices", cleanup.invoiceId)).toBe(DELETER.id);
    expect(await deleteActor("invoices", cleanup.invoiceId)).not.toBe(SUPER.id);

    // Every cascaded child too — each was created and last edited by SUPER, so
    // a missing pre-stamp would name SUPER, a real uninvolved admin.
    for (const paymentId of cleanup.paymentIds) {
      expect(await deleteActor("payments", paymentId)).toBe(DELETER.id);
      expect(await deleteActor("payments", paymentId)).not.toBe(SUPER.id);
    }
    for (const cohortId of cleanup.cohortIds) {
      expect(await deleteActor("cohorts", cohortId)).toBe(DELETER.id);
      expect(await deleteActor("cohorts", cohortId)).not.toBe(SUPER.id);
    }
  });
});

describe("deleteBill — the confirm must assert on what the dialog previewed", () => {
  const RUN = String(Date.now()).slice(-9);
  const fx = { oemId: 0, accountId: 0, deleterId: 0 };
  // A: stale-vs-correct ids. B: order-independence. C: preview payload only.
  const cleanup = {
    invoiceIds: [] as number[],
    // Every payment ever created here, including the interloper — the afterAll
    // audit sweep must cover rows the tests delete themselves.
    paymentIds: [] as number[],
  };
  const inv = { a: 0, b: 0, c: 0 };
  const pay = { a: [] as number[], b: [] as number[] };
  let DELETER = { id: 0, roles: ["super-admin" as const] };

  async function addPayments(invoiceId: number, refs: string[]) {
    const rows = await db
      .insert(payments)
      .values(
        refs.map((ref, i) => ({
          invoiceId,
          direction: "receipt" as const,
          paidOn: `2026-0${i + 1}-05`,
          amount: "500",
          mode: "NEFT" as const,
          ref: `${ref}-${RUN}`,
          createdBy: SUPER.id,
          updatedBy: SUPER.id,
        })),
      )
      .returning({ id: payments.id });
    const ids = rows.map((r) => r.id);
    cleanup.paymentIds.push(...ids);
    return ids;
  }

  beforeAll(async () => {
    const [deleter] = await db
      .insert(users)
      .values({
        name: `Stale Deleter ${RUN}`,
        email: `stale-deleter-${RUN}@test.local`,
        passwordHash: "x",
        role: "super-admin",
      })
      .returning({ id: users.id });
    fx.deleterId = deleter.id;
    DELETER = { id: deleter.id, roles: ["super-admin" as const] };

    const [oem] = await db
      .insert(oems)
      .values({ name: `StaleBillOEM-${RUN}`, createdBy: SUPER.id, updatedBy: SUPER.id })
      .returning({ id: oems.id });
    fx.oemId = oem.id;

    const [acc] = await db
      .insert(accounts)
      .values({ name: `StaleBillUni-${RUN}`, oemId: oem.id, createdBy: SUPER.id, updatedBy: SUPER.id })
      .returning({ id: accounts.id });
    fx.accountId = acc.id;

    // Three bills that deliberately share a label ("Old", no semester) — the
    // exact collision FIX 3's billed amount + invoice date exist to resolve.
    const mk = async (students: number, priceToUni: number, advanceAdj: number, date: string) => {
      const { id } = await createInvoice(SUPER, fx.accountId, YEAR, {
        category: "old",
        semester: "none",
        students,
        priceToUni,
        priceToDatagami: 800,
        gstRate: 0.18,
        tdsRate: 0.1,
        advanceAdj,
        invoiceDate: date,
        status: "paid",
      });
      cleanup.invoiceIds.push(id);
      return id;
    };
    inv.a = await mk(4, 2500, 0, "2026-02-01");
    inv.b = await mk(4, 2500, 0, "2026-02-02");
    inv.c = await mk(6, 1000, 1000, "2026-03-09");

    pay.a = await addPayments(inv.a, ["StaleA1", "StaleA2"]);
    pay.b = await addPayments(inv.b, ["StaleB1", "StaleB2"]);
  });

  afterAll(async () => {
    for (const id of cleanup.invoiceIds) await db.delete(invoices).where(eq(invoices.id, id));
    if (fx.accountId) await db.delete(accounts).where(eq(accounts.id, fx.accountId));
    if (fx.oemId) await db.delete(oems).where(eq(oems.id, fx.oemId));
    if (fx.deleterId) await db.delete(users).where(eq(users.id, fx.deleterId));

    const scopes: Array<[string, number]> = [
      ["accounts", fx.accountId],
      ["oems", fx.oemId],
      ["users", fx.deleterId],
      ...cleanup.invoiceIds.map((id) => ["invoices", id] as [string, number]),
      ...cleanup.paymentIds.map((id) => ["payments", id] as [string, number]),
    ];
    for (const [tableName, rowId] of scopes) {
      if (!rowId) continue;
      await db.delete(auditLog).where(and(eq(auditLog.tableName, tableName), eq(auditLog.rowId, String(rowId))));
    }
  });

  it("REFUSES to delete when a payment was added after the preview, and destroys nothing", async () => {
    // The user opens the dialog: it itemises the two payments below, and that
    // list is the whole reason a paid bill is deletable at all.
    const preview = await getBillDeletionPreview(DELETER, fx.accountId, inv.a);
    const previewedIds = preview.payments.map((p) => p.id);
    expect(previewedIds).toHaveLength(2);

    // …and while the dialog sits open, a third payment lands on the bill.
    const [interloper] = await addPayments(inv.a, ["StaleA3-late"]);

    // Confirming now would destroy strictly MORE money than the dialog showed.
    await expect(
      deleteBill(DELETER, fx.accountId, inv.a, previewedIds),
    ).rejects.toThrow(/changed since you opened this dialog/i);

    // Nothing at all was destroyed — not the bill, not any payment, including
    // the two the user *did* approve.
    expect(await db.select().from(invoices).where(eq(invoices.id, inv.a))).toHaveLength(1);
    const survivors = await db.select({ id: payments.id }).from(payments).where(eq(payments.invoiceId, inv.a));
    expect(survivors.map((p) => p.id).sort((x, y) => x - y)).toEqual(
      [...previewedIds, interloper].sort((x, y) => x - y),
    );
  });

  it("deletes once the ids match the bill again — a re-opened dialog succeeds", async () => {
    // Exactly what the user would do next: reopen the dialog, see all three
    // payments, and confirm against that fresh list.
    const preview = await getBillDeletionPreview(DELETER, fx.accountId, inv.a);
    const previewedIds = preview.payments.map((p) => p.id);
    expect(previewedIds).toHaveLength(3);

    await deleteBill(DELETER, fx.accountId, inv.a, previewedIds);

    expect(await db.select().from(invoices).where(eq(invoices.id, inv.a))).toHaveLength(0);
    expect(await db.select().from(payments).where(eq(payments.invoiceId, inv.a))).toHaveLength(0);
  });

  it("compares the ids as a SET — the same payments in a different order still delete", async () => {
    const preview = await getBillDeletionPreview(DELETER, fx.accountId, inv.b);
    const shuffled = [...preview.payments.map((p) => p.id)].reverse();
    expect(shuffled).toHaveLength(2);
    // Guard the guard: a reversal only proves order-independence if the order
    // actually differs.
    expect(shuffled).not.toEqual(preview.payments.map((p) => p.id));

    await deleteBill(DELETER, fx.accountId, inv.b, shuffled);

    expect(await db.select().from(invoices).where(eq(invoices.id, inv.b))).toHaveLength(0);
    expect(await db.select().from(payments).where(eq(payments.invoiceId, inv.b))).toHaveLength(0);
  });

  it("preview carries the invoice's own billed amount and date, so a shared label is still unambiguous", async () => {
    const preview = await getBillDeletionPreview(DELETER, fx.accountId, inv.c);

    // 6 × 1000 = 6000 taxable, less the 1000 advance = 5000 net, +18% GST.
    expect(preview.billedAmount).toBe(5900);
    expect(preview.invoiceDate).toBe("2026-03-09");

    // C carries no payments — the identifying fields must not depend on them.
    expect(preview.payments).toHaveLength(0);
  });
});
