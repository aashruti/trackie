import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accounts, auditLog, invoices, leadFollowups, leads, oems, payments, users } from "@/lib/db/schema";
import { stampedDelete } from "./audit";
import { createLead, setLeadStage } from "./leads";
import { createInvoice } from "./account-admin";
import type { SessionUser } from "./authz";

/**
 * End-to-end proof that the audit_row()/stamp_row() triggers (migration
 * 0016_audit_foundation.sql) actually fire the way the rest of the DAL test
 * suite assumes: INSERT/UPDATE/DELETE audit rows carry the right actor and
 * before/after images, version bumps on update, and a DB-level CASCADE
 * delete still attributes to the actor when the child row was pre-stamped.
 *
 * Unlike audit.test.ts (which only checks stampedDelete's actor plumbing),
 * this file drives real DAL entry points (createLead, setLeadStage,
 * createInvoice) so the trigger behavior is verified against the actual
 * app-level write paths, not just direct db.update() calls.
 */

// Three DISTINCT real users so every actor assertion below is discriminating:
// a missing/wrong stamp lands on a different id and fails the test instead of
// accidentally matching. 1 and 3 are seeded super-admins; the third is a
// throwaway user created in beforeAll (mirrors lib/dal/delivery/programs.test.ts
// and lib/dal/groups.test.ts's OTHER-actor idiom).
const CREATOR: SessionUser = { id: 1, roles: ["super-admin"] };
const EDITOR: SessionUser = { id: 3, roles: ["super-admin"] };
let DELETER: SessionUser;

const RUN = String(Date.now()).slice(-9);
const fx = { deleterUserId: 0, oemId: 0, accountId: 0 };
const cleanup = { leadId: 0, invoiceId: 0, paymentId: 0 };

async function auditRowsFor(tableName: string, rowId: number) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.tableName, tableName), eq(auditLog.rowId, String(rowId))))
    .orderBy(auditLog.id);
}

beforeAll(async () => {
  const [deleter] = await db
    .insert(users)
    .values({
      name: `AuditBehavior Deleter ${RUN}`,
      email: `audit-behavior-deleter-${RUN}@test.local`,
      passwordHash: "x",
      role: "super-admin",
    })
    .returning({ id: users.id });
  fx.deleterUserId = deleter.id;
  DELETER = { id: deleter.id, roles: ["super-admin"] };

  // Fixtures for the invoice+payment cascade test only.
  const [oem] = await db
    .insert(oems)
    .values({ name: `AuditBehaviorOEM-${RUN}`, createdBy: CREATOR.id, updatedBy: CREATOR.id })
    .returning({ id: oems.id });
  fx.oemId = oem.id;
  const [acc] = await db
    .insert(accounts)
    .values({ name: `AuditBehaviorUni-${RUN}`, oemId: oem.id, createdBy: CREATOR.id, updatedBy: CREATOR.id })
    .returning({ id: accounts.id });
  fx.accountId = acc.id;
});

afterAll(async () => {
  // Data rows — best-effort, the tests themselves already delete most of these
  // (stampedDelete), so these are just safety nets for a failed assertion.
  if (cleanup.leadId) await db.delete(leads).where(eq(leads.id, cleanup.leadId));
  if (cleanup.invoiceId) await db.delete(invoices).where(eq(invoices.id, cleanup.invoiceId)); // cascades any surviving payment
  await db.delete(accounts).where(eq(accounts.id, fx.accountId));
  await db.delete(oems).where(eq(oems.id, fx.oemId));
  await db.delete(users).where(eq(users.id, fx.deleterUserId));

  // Purge every audit_log row this file generated (scoped by table + rowId,
  // no op filter — covers the INSERT, the stampedDelete pre-stamp UPDATE, and
  // the DELETE for each row) so repeated local runs never accumulate rows.
  const scopes: Array<[string, number]> = [
    ["accounts", fx.accountId],
    ["oems", fx.oemId],
    ["users", fx.deleterUserId],
  ];
  if (cleanup.leadId) scopes.push(["leads", cleanup.leadId]);
  if (cleanup.invoiceId) scopes.push(["invoices", cleanup.invoiceId]);
  if (cleanup.paymentId) scopes.push(["payments", cleanup.paymentId]);
  for (const [tableName, rowId] of scopes) {
    await db.delete(auditLog).where(and(eq(auditLog.tableName, tableName), eq(auditLog.rowId, String(rowId))));
  }
});

describe("audit-behavior — INSERT / UPDATE / DELETE lifecycle on a leads row", () => {
  it("createLead (INSERT) writes an audit row: op=INSERT, actor=creator, after set, before null", async () => {
    const lead = await createLead(CREATOR, {
      prospect: `AuditBehaviorLead ${RUN}`,
      owner: "Test Runner",
      students: 10,
      priceToUni: 1000,
      priceToDatagami: 600,
      // Empty (not omitted) so createLead's falsy check skips seeding a
      // lead_followups row — keeps this test's audit_log footprint to just
      // the leads table, which is all afterAll needs to purge.
      nextAction: "",
    });
    cleanup.leadId = lead.id;

    const [row] = await db.select().from(leads).where(eq(leads.id, lead.id)).limit(1);
    expect(row.createdBy).toBe(CREATOR.id);
    expect(row.updatedBy).toBe(CREATOR.id);
    expect(row.version).toBe(1);

    const rows = await auditRowsFor("leads", lead.id);
    expect(rows).toHaveLength(1);
    const insertRow = rows[0];
    expect(insertRow.op).toBe("INSERT");
    expect(insertRow.actorId).toBe(CREATOR.id);
    expect(insertRow.before).toBeNull();
    expect(insertRow.after).not.toBeNull();
    const after = insertRow.after as Record<string, unknown>;
    expect(after.id).toBe(lead.id);
    expect(after.prospect).toBe(`AuditBehaviorLead ${RUN}`);
    expect(after.stage).toBe("new");
    expect(after.created_by).toBe(CREATOR.id);
    expect(after.updated_by).toBe(CREATOR.id);
    expect(after.version).toBe(1);

    const followups = await db.select().from(leadFollowups).where(eq(leadFollowups.leadId, lead.id));
    expect(followups).toHaveLength(0); // createLead must not seed a followup for nextAction: "" — otherwise this test leaks audit rows it can't clean up
  });

  it("setLeadStage (UPDATE by a different actor) bumps version 1→2, moves updated_at, writes op=UPDATE with before/after, and leaves created_by untouched", async () => {
    const [before] = await db.select().from(leads).where(eq(leads.id, cleanup.leadId)).limit(1);
    expect(before.version).toBe(1);
    expect(before.stage).toBe("new");

    await setLeadStage(EDITOR, cleanup.leadId, "qualified");

    const [after] = await db.select().from(leads).where(eq(leads.id, cleanup.leadId)).limit(1);
    expect(after.stage).toBe("qualified");
    // version bumped by stamp_row()'s BEFORE UPDATE trigger.
    expect(after.version).toBe(2);
    // updated_at strictly moved past created_at. Insert and this update are
    // separate round-trips (well over 1ms apart), so a strict `>` is reliable
    // here — unlike a same-statement comparison, this isn't at the mercy of
    // clock resolution.
    expect(after.updatedAt.getTime()).toBeGreaterThan(after.createdAt.getTime());
    // The key discriminating assertion: created_by is immutable across an
    // edit by someone other than the creator; updated_by reflects the editor.
    expect(after.createdBy).toBe(CREATOR.id);
    expect(after.updatedBy).toBe(EDITOR.id);

    const rows = await auditRowsFor("leads", cleanup.leadId);
    const updateRows = rows.filter((r) => r.op === "UPDATE");
    expect(updateRows).toHaveLength(1);
    const updateRow = updateRows[0];
    expect(updateRow.actorId).toBe(EDITOR.id); // the editor, not the creator
    expect(updateRow.before).not.toBeNull();
    expect(updateRow.after).not.toBeNull();
    const beforeImg = updateRow.before as Record<string, unknown>;
    const afterImg = updateRow.after as Record<string, unknown>;
    expect(beforeImg.stage).toBe("new");
    expect(beforeImg.version).toBe(1);
    expect(afterImg.stage).toBe("qualified");
    expect(afterImg.version).toBe(2); // corroborates the version bump without relying on strict-greater timestamps
    expect(afterImg.updated_by).toBe(EDITOR.id);
    expect(afterImg.created_by).toBe(CREATOR.id); // immutable in the audit trail too
  });

  it("stampedDelete writes op=DELETE with actor=deleter (a third, distinct actor)", async () => {
    const count = await stampedDelete(leads, cleanup.leadId, DELETER.id);
    expect(count).toBe(1);

    const gone = await db.select().from(leads).where(eq(leads.id, cleanup.leadId));
    expect(gone).toHaveLength(0);

    const rows = await auditRowsFor("leads", cleanup.leadId);
    const deleteRows = rows.filter((r) => r.op === "DELETE");
    expect(deleteRows).toHaveLength(1);
    const deleteRow = deleteRows[0];
    expect(deleteRow.actorId).toBe(DELETER.id); // the deleter, distinct from both creator and editor
    expect(deleteRow.after).toBeNull();
    expect(deleteRow.before).not.toBeNull();
    const beforeImg = deleteRow.before as Record<string, unknown>;
    expect(beforeImg.stage).toBe("qualified"); // last state before deletion
  });
});

describe("audit-behavior — cascade delete: stampedDelete(invoices) carries the actor into a pre-stamped child payment", () => {
  it("deleting the invoice CASCADE-deletes the payment; both DELETE audit rows show the actor, not their original creator", async () => {
    const { id: invoiceId } = await createInvoice(CREATOR, fx.accountId, "FY26–27", {
      category: "new",
      semester: "none",
      students: 5,
      priceToUni: 2000,
      priceToDatagami: 1500,
      gstRate: 0.18,
      tdsRate: 0.1,
      status: "draft",
    });
    cleanup.invoiceId = invoiceId;

    const [payment] = await db
      .insert(payments)
      .values({
        invoiceId,
        direction: "receipt",
        paidOn: "2026-07-20",
        amount: "1000",
        mode: "RTGS",
        ref: `AuditBehaviorPay-${RUN}`,
        createdBy: CREATOR.id,
        updatedBy: CREATOR.id,
      })
      .returning({ id: payments.id });
    cleanup.paymentId = payment.id;

    // Both the invoice and the payment were created (and last edited) by
    // CREATOR. Stamp the payment with DELETER before deleting the invoice —
    // exactly the "after stamping the payment" step the DELETE trigger relies
    // on, since the CASCADE delete never runs app code, only reads
    // OLD.updated_by off the row as it stood at delete time.
    await db.update(payments).set({ updatedBy: DELETER.id }).where(eq(payments.id, payment.id));

    const count = await stampedDelete(invoices, invoiceId, DELETER.id);
    expect(count).toBe(1);

    const invoiceGone = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
    expect(invoiceGone).toHaveLength(0);
    const paymentGone = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(paymentGone).toHaveLength(0); // cascaded

    const invoiceRows = await auditRowsFor("invoices", invoiceId);
    const invoiceDelete = invoiceRows.filter((r) => r.op === "DELETE");
    expect(invoiceDelete).toHaveLength(1);
    expect(invoiceDelete[0].actorId).toBe(DELETER.id);

    const paymentRows = await auditRowsFor("payments", payment.id);
    const paymentDelete = paymentRows.filter((r) => r.op === "DELETE");
    expect(paymentDelete).toHaveLength(1);
    expect(paymentDelete[0].actorId).toBe(DELETER.id); // pre-stamped, so the CASCADE delete still attributes correctly
    // Sanity: the payment's creator (CREATOR) is NOT who the DELETE landed on
    // — proves this is actually reading the pre-stamp, not just always
    // reading created_by or some other stale field.
    expect(paymentDelete[0].actorId).not.toBe(CREATOR.id);
  });
});
