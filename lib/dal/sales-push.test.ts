import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  academicYears,
  accounts,
  invoices,
  oems,
  userAccounts,
  userRoles,
  users,
} from "@/lib/db/schema";
import { getSalesPushData } from "./sales-push";

const SUPER = { id: 1, roles: ["super-admin" as const] };
const RUN = `${Date.now()}`;
const fx = {
  oemId: 0,
  accountId: 0,
  invoiceId: 0,
  userIds: [] as number[],
};

beforeAll(async () => {
  const [year] = await db
    .select({ id: academicYears.id })
    .from(academicYears)
    .limit(1);
  if (!year) throw new Error("Sales Push test requires an academic year");

  const [oem] = await db
    .insert(oems)
    .values({ name: `Sales Push OEM ${RUN}` })
    .returning({ id: oems.id });
  fx.oemId = oem.id;

  const [account] = await db
    .insert(accounts)
    .values({ name: `Sales Push Account ${RUN}`, oemId: oem.id })
    .returning({ id: accounts.id });
  fx.accountId = account.id;

  const [invoice] = await db
    .insert(invoices)
    .values({
      accountId: account.id,
      yearId: year.id,
      category: "new",
      semester: "none",
      students: 1,
      priceToUni: "1000",
      priceToDatagami: "800",
      invoiceDate: "2026-07-29",
      status: "raised",
    })
    .returning({ id: invoices.id });
  fx.invoiceId = invoice.id;

  const insertedUsers = await db
    .insert(users)
    .values([
      {
        name: `Sales Person ${RUN}`,
        email: `sales-push-sales-${RUN}@test.local`,
        passwordHash: "x",
        role: "sales",
      },
      {
        name: `Delivery Person ${RUN}`,
        email: `sales-push-delivery-${RUN}@test.local`,
        passwordHash: "x",
        role: "delivery",
      },
      {
        name: `Mixed Person ${RUN}`,
        email: `sales-push-mixed-${RUN}@test.local`,
        passwordHash: "x",
        role: "sales",
      },
    ])
    .returning({ id: users.id });
  fx.userIds = insertedUsers.map((user) => user.id);

  await db.insert(userRoles).values([
    { userId: fx.userIds[0], role: "sales" },
    { userId: fx.userIds[1], role: "delivery" },
    { userId: fx.userIds[2], role: "sales" },
    { userId: fx.userIds[2], role: "delivery" },
  ]);
  await db.insert(userAccounts).values(
    fx.userIds.map((userId) => ({
      userId,
      accountId: account.id,
    })),
  );
});

afterAll(async () => {
  if (fx.invoiceId)
    await db.delete(invoices).where(eq(invoices.id, fx.invoiceId));
  if (fx.userIds.length) {
    await db
      .delete(userAccounts)
      .where(inArray(userAccounts.userId, fx.userIds));
    await db.delete(userRoles).where(inArray(userRoles.userId, fx.userIds));
    await db.delete(users).where(inArray(users.id, fx.userIds));
  }
  if (fx.accountId)
    await db.delete(accounts).where(eq(accounts.id, fx.accountId));
  if (fx.oemId) await db.delete(oems).where(eq(oems.id, fx.oemId));
});

describe("getSalesPushData owners", () => {
  it("shows Sales users and excludes Delivery-only assignees", async () => {
    const data = await getSalesPushData(SUPER, "2026-07-29");
    const invoice = data.invoices.raisedRecently.find(
      (row) => row.invoiceId === fx.invoiceId,
    );

    expect(invoice).toBeDefined();
    expect(new Set(invoice!.owner.split(", "))).toEqual(
      new Set([`Sales Person ${RUN}`, `Mixed Person ${RUN}`]),
    );
    expect(invoice!.owner).not.toContain(`Delivery Person ${RUN}`);
  });
});
