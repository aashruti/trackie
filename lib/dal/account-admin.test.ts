import { describe, it, expect, afterAll } from "vitest";
import { createAccount, createInvoice, listOems } from "./account-admin";
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

    await createInvoice(SUPER, acc.id, YEAR, {
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
