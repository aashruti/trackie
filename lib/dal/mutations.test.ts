import { describe, it, expect, afterAll } from "vitest";
import { updateInvoice } from "./mutations";
import { getAccountDetail } from "./account-detail";
import { listAccountsForUser } from "./accounts";

const SUPER = { id: 1, role: "super-admin" as const };
const YEAR = "FY26–27";

async function pillaiNewInvoiceId() {
  const all = await listAccountsForUser(SUPER, YEAR);
  const pillai = all.find((a) => a.name.includes("Pillai"))!;
  const { db } = await import("@/lib/db/client");
  const { invoices } = await import("@/lib/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const [inv] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.accountId, pillai.id), eq(invoices.category, "new")));
  return { id: inv.id, accountId: pillai.id, original: inv.students };
}

describe("updateInvoice", () => {
  let restore: { id: number; original: number } | null = null;

  it("super-admin edit changes the computed margin and persists", async () => {
    const { id, accountId, original } = await pillaiNewInvoiceId();
    restore = { id, original };

    await updateInvoice(SUPER, id, { students: 200 });
    const detail = await getAccountDetail(SUPER, accountId, YEAR);
    const newInv = detail!.invoices.find((i) => i.category === "new")!;
    expect(newInv.students).toBe(200);
    expect(newInv.netMargin).toBe(200 * (21200 - 18500)); // 540000
  });

  it("rejects a viewer / unassigned editor", async () => {
    const { id } = await pillaiNewInvoiceId();
    await expect(
      updateInvoice({ id: 999, role: "viewer" }, id, { students: 5 }),
    ).rejects.toThrow();
    await expect(
      updateInvoice({ id: 999, role: "admin" }, id, { students: 5 }),
    ).rejects.toThrow();
  });

  afterAll(async () => {
    if (restore) await updateInvoice(SUPER, restore.id, { students: restore.original });
  });
});
