import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { academicYears, accounts, invoices, oems, userAccounts, users } from "@/lib/db/schema";
import { globalSearch, escapeLike } from "./search";

const SUPER = { id: 1, roles: ["super-admin" as const] };
const YEAR = "FY26–27";
const RUN = String(Date.now()).slice(-6);

// Unique tokens so matches are isolated from seeded data (super searches ALL
// accounts, so generic terms would be non-deterministic under the group cap).
const A_NAME = `Zeta Search Uni ${RUN}`;
const A_CITY = `Testburg-${RUN}`;
const B_NAME = `Yotta Search College ${RUN}`;
const OEM_NAME = `SrchOEM-${RUN}`;

const fx = { oemId: 0, accA: 0, accB: 0, yearId: 0, userId: 0 };

beforeAll(async () => {
  const [year] = await db.select().from(academicYears).where(eq(academicYears.label, YEAR)).limit(1);
  fx.yearId = year.id;

  const [oem] = await db.insert(oems).values({ name: OEM_NAME }).returning({ id: oems.id });
  fx.oemId = oem.id;

  const [a] = await db
    .insert(accounts)
    .values({ name: A_NAME, city: A_CITY, oemId: oem.id })
    .returning({ id: accounts.id });
  const [b] = await db
    .insert(accounts)
    .values({ name: B_NAME, city: `Otherton-${RUN}`, oemId: oem.id })
    .returning({ id: accounts.id });
  fx.accA = a.id;
  fx.accB = b.id;

  await db.insert(invoices).values([
    // Account A: an overdue "Old students" bill.
    { accountId: a.id, yearId: year.id, category: "old", students: 10, priceToUni: "1000", priceToDatagami: "600", status: "overdue" },
    // Account B: a paid "Advance bill".
    { accountId: b.id, yearId: year.id, category: "advance", priceToUni: "2000", priceToDatagami: "1500", status: "paid" },
  ]);

  // A sales user scoped to account B ONLY — the scope boundary under test.
  const [u] = await db
    .insert(users)
    .values({ name: `Srch Sales ${RUN}`, email: `srch-sales-${RUN}@test.local`, passwordHash: "x", role: "sales" })
    .returning({ id: users.id });
  fx.userId = u.id;
  await db.insert(userAccounts).values({ userId: u.id, accountId: b.id });
});

afterAll(async () => {
  await db.delete(users).where(eq(users.id, fx.userId)); // cascades user_accounts
  await db.delete(invoices).where(inArray(invoices.accountId, [fx.accA, fx.accB]));
  await db.delete(accounts).where(inArray(accounts.id, [fx.accA, fx.accB]));
  await db.delete(oems).where(eq(oems.id, fx.oemId));
});

describe("escapeLike", () => {
  it("escapes ILIKE wildcards so they match literally", () => {
    expect(escapeLike("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
    expect(escapeLike("plain")).toBe("plain");
  });
});

describe("globalSearch — super-admin (unrestricted)", () => {
  it("finds accounts by name, by city, and by their OEM's name", async () => {
    const byName = await globalSearch(SUPER, A_NAME, YEAR);
    expect(byName.accounts.map((h) => h.id)).toContain(fx.accA);
    expect(byName.accounts.find((h) => h.id === fx.accA)?.href).toBe(`/accounts/${fx.accA}`);

    const byCity = await globalSearch(SUPER, A_CITY, YEAR);
    expect(byCity.accounts.map((h) => h.id)).toContain(fx.accA);

    // The OEM name matches both accounts and surfaces the OEM itself.
    const byOem = await globalSearch(SUPER, OEM_NAME, YEAR);
    expect(byOem.accounts.map((h) => h.id).sort()).toEqual([fx.accA, fx.accB].sort());
    expect(byOem.oems.map((h) => h.id)).toContain(fx.oemId);
    expect(byOem.oems.find((h) => h.id === fx.oemId)?.href).toBe(`/reports/oem/${encodeURIComponent(OEM_NAME)}`);
  });

  it("empty query returns nothing", async () => {
    expect(await globalSearch(SUPER, "   ", YEAR)).toEqual({ accounts: [], oems: [], invoices: [] });
  });

  it("wildcard characters are escaped, not treated as patterns", async () => {
    // If "%" were an unescaped pattern it would match every account; escaping
    // means it matches only names literally containing "%", so ours are absent.
    const res = await globalSearch(SUPER, "%", YEAR);
    expect(res.accounts.map((h) => h.id)).not.toContain(fx.accA);
    expect(res.accounts.map((h) => h.id)).not.toContain(fx.accB);
  });
});

describe("globalSearch — scoped sales user (assigned account B only)", () => {
  const SCOPED = () => ({ id: fx.userId, roles: ["sales" as const] });

  it("never returns an unassigned account, even when the OEM name matches it", async () => {
    const byOem = await globalSearch(SCOPED(), OEM_NAME, YEAR);
    expect(byOem.accounts.map((h) => h.id)).toContain(fx.accB);
    expect(byOem.accounts.map((h) => h.id)).not.toContain(fx.accA); // the leak guard
    // The OEM is still reachable (account B carries it), but only via B.
    expect(byOem.oems.map((h) => h.id)).toContain(fx.oemId);

    // A token unique to account A returns nothing for this user.
    const byAName = await globalSearch(SCOPED(), A_NAME, YEAR);
    expect(byAName.accounts).toHaveLength(0);
  });

  it("finds the scoped account's bills by stream and status", async () => {
    const byStream = await globalSearch(SCOPED(), "advance", YEAR);
    const hit = byStream.invoices.find((h) => h.href === `/accounts/${fx.accB}`);
    expect(hit).toBeDefined();
    expect(hit?.sublabel.toLowerCase()).toContain("advance");
    expect(hit?.sublabel.toLowerCase()).toContain("paid");

    // Account A's overdue bill is out of scope — not visible to this user.
    const byStatus = await globalSearch(SCOPED(), "overdue", YEAR);
    expect(byStatus.invoices.map((h) => h.href)).not.toContain(`/accounts/${fx.accA}`);
  });
});

describe("globalSearch — non-finance user", () => {
  it("returns nothing regardless of query (search is finance-gated)", async () => {
    const delivery = { id: fx.userId, roles: ["delivery" as const] };
    expect(await globalSearch(delivery, OEM_NAME, YEAR)).toEqual({ accounts: [], oems: [], invoices: [] });
  });
});
