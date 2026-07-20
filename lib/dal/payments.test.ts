import { describe, it, expect, afterAll } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { auditLog, payments } from "@/lib/db/schema";
import type { Role } from "@/lib/db/enums";
import { addPayment, deletePayment } from "./payments";
import { getAccountDetail } from "./account-detail";
import { listAccountsForUser } from "./accounts";

const SUPER = { id: 1, roles: ["super-admin" as const] };
// A different super-admin (Dhaval, id 3, exists locally) — used to make the
// delete-actor test discriminating: insert as SUPER, delete as OTHER, so a
// plain unstamped delete (which would leave OLD.updated_by as the inserter,
// 1) fails the assertion instead of accidentally matching.
const OTHER = { id: 3, roles: ["super-admin"] as Role[] };
const YEAR = "FY26–27";

async function pillai() {
  const all = await listAccountsForUser(SUPER, YEAR);
  const acc = all.find((a) => a.name.includes("Pillai"))!;
  const detail = await getAccountDetail(SUPER, acc.id, YEAR);
  const newInv = detail!.invoices.find((i) => i.category === "new")!;
  return { accountId: acc.id, invoiceId: newInv.id, afterTds: newInv.afterTds, payable: newInv.payable };
}

describe("payment ledger", () => {
  // Every payment id this run creates, whether or not the individual test
  // deletes it itself — used at the end to sweep the audit_log rows those
  // inserts/deletes/stamps left behind.
  const created: number[] = [];

  it("a receipt increases received and reduces outstanding", async () => {
    const { accountId, invoiceId, afterTds } = await pillai();
    await addPayment(SUPER, invoiceId, {
      direction: "receipt",
      amount: 1_000_000,
      paidOn: "2026-05-01",
      mode: "RTGS",
      ref: "UTR-TEST-1",
    });
    const detail = await getAccountDetail(SUPER, accountId, YEAR);
    const inv = detail!.invoices.find((i) => i.id === invoiceId)!;
    created.push(inv.ledger[0].id);
    expect(inv.received).toBe(1_000_000);
    expect(inv.outstanding).toBe(afterTds - 1_000_000);
    expect(inv.ledger.length).toBe(1);

    // The audit trigger reads created_by/updated_by off the row — assert the
    // app stamped the freshly-inserted payment.
    const [row] = await db.select().from(payments).where(eq(payments.id, inv.ledger[0].id)).limit(1);
    expect(row.createdBy).toBe(SUPER.id);
    expect(row.updatedBy).toBe(SUPER.id);
  });

  it("an OEM payment increases paidToOem and reduces outstandingToOem", async () => {
    const { accountId, invoiceId, payable } = await pillai();
    await addPayment(SUPER, invoiceId, {
      direction: "oem-payment",
      amount: 500_000,
      paidOn: "2026-05-02",
      mode: "NEFT",
      ref: "UTR-TEST-2",
    });
    const detail = await getAccountDetail(SUPER, accountId, YEAR);
    const inv = detail!.invoices.find((i) => i.id === invoiceId)!;
    created.push(...inv.ledger.map((l) => l.id));
    expect(inv.paidToOem).toBe(500_000);
    expect(inv.outstandingToOem).toBe(payable - 500_000);
  });

  it("delete stamps the actor via the audit trigger", async () => {
    const { accountId, invoiceId } = await pillai();
    // Insert as SUPER, then delete as a DIFFERENT super-admin (OTHER). If
    // stampedDelete were reverted to a plain delete, OLD.updated_by would
    // still read 1 (the inserter) — so asserting actorId === OTHER.id (3)
    // only passes when the delete itself stamps the actor.
    await addPayment(SUPER, invoiceId, {
      direction: "receipt",
      amount: 1,
      paidOn: "2026-05-03",
      mode: "UPI",
      ref: "UTR-TEST-DELETE",
    });
    const detail = await getAccountDetail(SUPER, accountId, YEAR);
    const inv = detail!.invoices.find((i) => i.id === invoiceId)!;
    const entry = inv.ledger.find((l) => l.ref === "UTR-TEST-DELETE")!;
    created.push(entry.id);

    await deletePayment(OTHER, entry.id);

    // Row is gone, so assert via the audit trail instead: the DELETE entry's
    // actor must be the deleter (OTHER), not the inserter (SUPER).
    const rows = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.tableName, "payments"),
          eq(auditLog.rowId, String(entry.id)),
          eq(auditLog.op, "DELETE"),
        ),
      );
    expect(rows.length).toBe(1);
    expect(rows[0].actorId).toBe(OTHER.id);
  });

  it("rejects a viewer", async () => {
    const { invoiceId } = await pillai();
    await expect(
      addPayment({ id: 999, roles: ["viewer"] }, invoiceId, {
        direction: "receipt",
        amount: 1,
        paidOn: "2026-05-01",
        mode: "UPI",
      }),
    ).rejects.toThrow();
  });

  afterAll(async () => {
    const ids = [...new Set(created)];
    for (const id of ids) {
      try {
        await deletePayment(SUPER, id);
      } catch {
        /* already gone */
      }
    }
    // The stamped deletes (and the stamp-then-delete idiom's phantom UPDATE
    // audit row) leave audit_log rows behind for every payment this run
    // touched — sweep them so the audit trail doesn't accumulate test noise.
    if (ids.length > 0) {
      try {
        await db
          .delete(auditLog)
          .where(
            and(
              eq(auditLog.tableName, "payments"),
              inArray(
                auditLog.rowId,
                ids.map((id) => String(id)),
              ),
            ),
          );
      } catch {
        /* best effort */
      }
    }
  });
});
