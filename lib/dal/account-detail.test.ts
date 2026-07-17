import { describe, it, expect } from "vitest";
import { getAccountDetail } from "./account-detail";
import { listAccountsForUser } from "./accounts";

const SUPER = { id: 1, roles: ["super-admin" as const] };
const YEAR = "FY26–27";

describe("getAccountDetail", () => {
  it("returns Pillai with advance + new invoices and ₹3,86,000 margin", async () => {
    const all = await listAccountsForUser(SUPER, YEAR);
    const pillai = all.find((a) => a.name.includes("Pillai"))!;
    const detail = await getAccountDetail(SUPER, pillai.id, YEAR);
    expect(detail).not.toBeNull();
    expect(detail!.oem).toBe("IBM");
    const cats = detail!.invoices.map((i) => i.category).sort();
    expect(cats).toEqual(["advance", "new"]);
    expect(Math.round(detail!.totals.netMargin)).toBe(386_000);
  });

  it("returns null for an account outside a sales user's assignments", async () => {
    const all = await listAccountsForUser(SUPER, YEAR);
    const anyId = all[0].id;
    // sales id 999 has no assignments → no access
    const detail = await getAccountDetail({ id: 999, roles: ["sales"] }, anyId, YEAR);
    expect(detail).toBeNull();
  });
});
