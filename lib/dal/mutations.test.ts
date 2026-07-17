import { describe, it, expect, afterAll } from "vitest";
import { updateInvoice, setCohorts } from "./mutations";
import { getAccountDetail } from "./account-detail";
import { listAccountsForUser } from "./accounts";

const SUPER = { id: 1, roles: ["super-admin" as const] };
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
      updateInvoice({ id: 999, roles: ["viewer"] }, id, { students: 5 }),
    ).rejects.toThrow();
    await expect(
      updateInvoice({ id: 999, roles: ["sales"] }, id, { students: 5 }),
    ).rejects.toThrow();
  });

  afterAll(async () => {
    if (restore) await updateInvoice(SUPER, restore.id, { students: restore.original });
  });
});

describe("setCohorts", () => {
  let original: { id: number; cohorts: { enrollmentYear: string; count: number }[] } | null = null;

  it("replaces cohorts and syncs the invoice total to their sum", async () => {
    const all = await listAccountsForUser(SUPER, YEAR);
    const kalinga = all.find((a) => a.name.includes("Kalinga"))!;
    const before = await getAccountDetail(SUPER, kalinga.id, YEAR);
    const old1 = before!.invoices.find((i) => i.category === "old" && i.semester === "1")!;
    original = {
      id: old1.id,
      cohorts: old1.cohorts.map((c) => ({ enrollmentYear: c.enrollmentYear, count: c.count })),
    };

    await setCohorts(SUPER, old1.id, [
      { enrollmentYear: "2025-26", count: 100 },
      { enrollmentYear: "2024-25", count: 50 },
    ]);

    const after = await getAccountDetail(SUPER, kalinga.id, YEAR);
    const inv = after!.invoices.find((i) => i.id === old1.id)!;
    expect(inv.students).toBe(150); // total synced to cohort sum
    expect(inv.cohorts.length).toBe(2);
  });

  it("rejects a viewer", async () => {
    await expect(
      setCohorts({ id: 999, roles: ["viewer"] }, original!.id, []),
    ).rejects.toThrow();
  });

  afterAll(async () => {
    if (original) await setCohorts(SUPER, original.id, original.cohorts);
  });
});
