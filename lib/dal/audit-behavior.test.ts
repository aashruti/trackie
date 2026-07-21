import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accounts, auditLog, invoices, leadFollowups, leads, oems, payments, users } from "@/lib/db/schema";
import { stampedDelete } from "./audit";
import { changedFields, isStampOnlyUpdate } from "./audit-log";
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
/** oems / users rows the fold-discrimination tests create, purged in afterAll. */
const foldCleanup = { oemIds: [] as number[], userIds: [] as number[] };

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
  // The SET NULL fixture's oem SURVIVES its author's deletion — that is the
  // whole point of the test — so it has to be removed here explicitly.
  for (const id of foldCleanup.oemIds) await db.delete(oems).where(eq(oems.id, id));
  for (const id of foldCleanup.userIds) await db.delete(users).where(eq(users.id, id));
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
  for (const id of foldCleanup.oemIds) scopes.push(["oems", id]);
  for (const id of foldCleanup.userIds) scopes.push(["users", id]);
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

/**
 * The two CAUSES that both produce a `{updated_by}`-only UPDATE — driven
 * through the live triggers, because the whole question is what the database
 * actually writes, not what a synthetic fixture asserts it writes.
 *
 *  1. `stampedDelete`'s pre-stamp: a deliberate write of the DELETER's id,
 *     immediately before the row vanishes. Noise; foldable.
 *  2. `ON DELETE SET NULL` on `updated_by`: Postgres rewriting the column to
 *     NULL on every SURVIVING row the deleted user last touched. Real history;
 *     never foldable.
 *
 * Same diff shape, opposite meanings. `isStampOnlyUpdate` must separate them on
 * the after-image value (a stamp is an id, SET NULL is null) — a rule keyed on
 * shape alone folds (2) and so hides a deleted user's footprint across the
 * database under a badge that says "delete noise".
 */
describe("audit-behavior — a {updated_by} diff has two causes, and only one is foldable", () => {
  /** The changed-key diff of an audit row, as the viewer computes it. */
  function diffOf(row: { before: unknown; after: unknown }) {
    return changedFields(row.before, row.after);
  }

  it("ON DELETE SET NULL: the trail left on a SURVIVING row is NOT folded", async () => {
    const [author] = await db
      .insert(users)
      .values({
        name: `AuditFold Author ${RUN}`,
        email: `audit-fold-author-${RUN}@test.local`,
        passwordHash: "x",
        role: "sales",
      })
      .returning({ id: users.id });
    foldCleanup.userIds.push(author.id);

    // An oem this user authored and last touched. Nothing else references them,
    // so the only thing their deletion can do to this row is SET NULL.
    const [oem] = await db
      .insert(oems)
      .values({ name: `AuditFoldOEM-${RUN}`, createdBy: author.id, updatedBy: author.id })
      .returning({ id: oems.id });
    foldCleanup.oemIds.push(oem.id);

    await db.delete(users).where(eq(users.id, author.id));

    // The premise of the whole test: the oem is still here. Deleting a user
    // does not delete what they touched — it only unlinks them from it.
    const [survivor] = await db.select().from(oems).where(eq(oems.id, oem.id));
    expect(survivor, "the oem must survive its author's deletion").toBeDefined();
    expect(survivor.updatedBy).toBeNull();

    const updates = (await auditRowsFor("oems", oem.id)).filter((r) => r.op === "UPDATE");
    // Postgres applies each referential action as its own UPDATE — one per FK —
    // so created_by and updated_by arrive as two separate audit rows.
    const shapes = updates.map((r) => diffOf(r).map((c) => c.key));
    expect(shapes).toContainEqual(["created_by"]);
    expect(shapes).toContainEqual(["updated_by"]);

    const setNullRow = updates.find((r) => {
      const d = diffOf(r);
      return d.length === 1 && d[0].key === "updated_by";
    })!;
    expect(setNullRow, "the SET NULL side effect must produce a {updated_by} row").toBeDefined();
    // The discriminator, straight off the row the trigger stored.
    expect((setNullRow.after as Record<string, unknown>).updated_by).toBeNull();
    expect((setNullRow.before as Record<string, unknown>).updated_by).toBe(author.id);

    // The assertion this test exists for. Under the shape-only rule this is
    // `true`, and the viewer hides the fact that a just-deleted user's name was
    // on this row — one such row per record they last touched, across up to 30
    // tables, which is precisely what a forensic reader comes looking for.
    expect(isStampOnlyUpdate("UPDATE", diffOf(setNullRow))).toBe(false);
  });

  it("stamp-then-delete: the genuine phantom IS still folded", async () => {
    const [oem] = await db
      .insert(oems)
      .values({ name: `AuditFoldPhantom-${RUN}`, createdBy: CREATOR.id, updatedBy: CREATOR.id })
      .returning({ id: oems.id });
    foldCleanup.oemIds.push(oem.id);

    await stampedDelete(oems, oem.id, DELETER.id);
    expect(await db.select().from(oems).where(eq(oems.id, oem.id))).toHaveLength(0);

    const rows = await auditRowsFor("oems", oem.id);
    const updates = rows.filter((r) => r.op === "UPDATE");
    expect(updates).toHaveLength(1);
    const phantom = updates[0];

    // Identical SHAPE to the SET NULL row above…
    expect(diffOf(phantom).map((c) => c.key)).toEqual(["updated_by"]);
    // …and a different CAUSE, visible only in the after-image: a real id, the
    // deleter's, written on purpose. Never NULL — stampedDelete writes an actor.
    expect((phantom.after as Record<string, unknown>).updated_by).toBe(DELETER.id);
    expect(isStampOnlyUpdate("UPDATE", diffOf(phantom))).toBe(true);

    // And it really is the delete's phantom: the DELETE row follows it.
    expect(rows.filter((r) => r.op === "DELETE")).toHaveLength(1);
  });
});
