import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db/client";
import { accounts, deliveryMethods, oems, programs as programsTable, users } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import {
  createProgram,
  deleteProgram,
  getProgramCalendar,
  getProgramDetail,
  listPrograms,
  updateProgram,
} from "./programs";
import { addActivity, createEvent, deleteActivity, deleteEvent, setEventStatus } from "./events";
import { getAccountDeliveryReport } from "./report";

const SUPER = { id: 1, role: "super-admin" as const };
const ADMIN = { id: 997, role: "admin" as const };
const VIEWER = { id: 999, role: "viewer" as const };
// Real users row (created in beforeAll) — activity attribution has a users FK.
const DELIVERY = { id: 0, role: "delivery" as const };

// Unique names so reruns against a dirty local DB never collide.
const RUN = String(Date.now()).slice(-6);
const fixtures = { accountId: 0, oemId: 0, methodId: 0, userId: 0 };
const cleanup = { programIds: [] as number[] };

beforeAll(async () => {
  const [u] = await db
    .insert(users)
    .values({ name: `Delivery Tester ${RUN}`, email: `delivery-test-${RUN}@test.local`, passwordHash: "x", role: "delivery" })
    .returning({ id: users.id });
  fixtures.userId = u.id;
  DELIVERY.id = u.id;
  const [oem] = await db.insert(oems).values({ name: `TestOEM-${RUN}` }).returning({ id: oems.id });
  fixtures.oemId = oem.id;
  const [acc] = await db
    .insert(accounts)
    .values({ name: `TestUni-${RUN}`, type: "university", city: "Pune", oemId: oem.id })
    .returning({ id: accounts.id });
  fixtures.accountId = acc.id;
  const [method] = await db
    .insert(deliveryMethods)
    .values({ name: `Style-${RUN}`, code: `S${RUN}` })
    .returning({ id: deliveryMethods.id });
  fixtures.methodId = method.id;
});

afterAll(async () => {
  // Programs cascade events + activities; then remove the fixture refs.
  if (cleanup.programIds.length) await db.delete(programsTable).where(inArray(programsTable.id, cleanup.programIds));
  await db.delete(accounts).where(eq(accounts.id, fixtures.accountId));
  await db.delete(deliveryMethods).where(eq(deliveryMethods.id, fixtures.methodId));
  await db.delete(oems).where(eq(oems.id, fixtures.oemId));
  await db.delete(users).where(eq(users.id, fixtures.userId));
});

describe("programs — CRUD, rollups, budget math", () => {
  let programId = 0;
  let eventId = 0;

  it("delivery role creates a program; list shows joined context + zero rollups", async () => {
    const { id } = await createProgram(DELIVERY, {
      accountId: fixtures.accountId,
      oemId: fixtures.oemId,
      deliveryMethodId: fixtures.methodId,
      name: `IBM D2S ${RUN}`,
      startDate: "2026-07-01",
      endDate: "2027-03-31",
      totalBudget: 200000,
    });
    programId = id;
    cleanup.programIds.push(id);
    const rows = await listPrograms(SUPER, { accountId: fixtures.accountId });
    expect(rows).toHaveLength(1);
    const p = rows[0];
    expect(p.accountName).toBe(`TestUni-${RUN}`);
    expect(p.oemName).toBe(`TestOEM-${RUN}`);
    expect(p.methodCode).toBe(`S${RUN}`);
    expect(p.status).toBe("active");
    expect(p.totalBudget).toBe(200000);
    expect(p).toMatchObject({ eventCount: 0, allocated: 0, spent: 0 });
  });

  it("events allocate budget; activities accrue spend; detail rolls both up", async () => {
    const e1 = await createEvent(DELIVERY, {
      programId,
      title: "Kickoff workshop",
      venue: "Main auditorium",
      startDate: "2026-07-10",
      endDate: "2026-07-12",
      budget: 50000,
    });
    eventId = e1.id;
    await addActivity(DELIVERY, "Test Runner", {
      eventId,
      type: "expense",
      title: "Venue booking",
      activityDate: "2026-07-05",
      cost: 30000,
    });
    await addActivity(DELIVERY, "Test Runner", {
      eventId,
      type: "session",
      title: "Day 1 sessions",
      activityDate: "2026-07-10",
    });

    const detail = (await getProgramDetail(SUPER, programId))!;
    expect(detail.events).toHaveLength(1);
    expect(detail.events[0].budget).toBe(50000);
    expect(detail.events[0].spent).toBe(30000);
    expect(detail.events[0].activities).toHaveLength(2);
    expect(detail.allocated).toBe(50000);
    expect(detail.spent).toBe(30000);

    const list = await listPrograms(SUPER, { accountId: fixtures.accountId });
    expect(list[0]).toMatchObject({ eventCount: 1, allocated: 50000, spent: 30000 });
  });

  it("over-budget shows through spend > budget; cancelled events free allocation but keep spend", async () => {
    const e2 = await createEvent(SUPER, {
      programId,
      title: "Hackathon",
      startDate: "2026-08-01",
      budget: 10000,
    });
    const act = await addActivity(SUPER, "Test Runner", {
      eventId: e2.id,
      type: "expense",
      title: "Deposit paid",
      activityDate: "2026-07-20",
      cost: 12000,
    });
    let detail = (await getProgramDetail(SUPER, programId))!;
    const hack = detail.events.find((e) => e.id === e2.id)!;
    expect(hack.spent).toBeGreaterThan(hack.budget); // over budget is representable
    expect(detail.allocated).toBe(60000);
    expect(detail.spent).toBe(42000);

    await setEventStatus(SUPER, e2.id, "cancelled");
    detail = (await getProgramDetail(SUPER, programId))!;
    expect(detail.allocated).toBe(50000); // cancelled allocation freed
    expect(detail.spent).toBe(42000); // burned money still counted

    await deleteActivity(SUPER, act.id);
    detail = (await getProgramDetail(SUPER, programId))!;
    expect(detail.spent).toBe(30000);
    await deleteEvent(SUPER, e2.id);
  });

  it("calendar places spans and activity dots", async () => {
    const cal = (await getProgramCalendar(SUPER, programId, 2026, 7))!;
    expect(cal.days).toHaveLength(31);
    expect(cal.cells["2026-07-10"].events[0]).toMatchObject({ title: "Kickoff workshop", starts: true, ends: false });
    expect(cal.cells["2026-07-12"].events[0]).toMatchObject({ ends: true });
    expect(cal.cells["2026-07-05"].activities[0]).toMatchObject({ title: "Venue booking", cost: 30000 });
    expect(cal.summary).toMatchObject({ events: 1, activities: 2, cost: 30000 });
    // Nothing bleeds into August except events spanning it (none here).
    const aug = (await getProgramCalendar(SUPER, programId, 2026, 8))!;
    expect(Object.keys(aug.cells)).toHaveLength(0);
  });

  it("account report aggregates programs → events → activities chronologically", async () => {
    const { id: second } = await createProgram(SUPER, {
      accountId: fixtures.accountId,
      oemId: fixtures.oemId,
      deliveryMethodId: fixtures.methodId,
      name: `Datagami T3 ${RUN}`,
    });
    cleanup.programIds.push(second);
    const report = (await getAccountDeliveryReport(ADMIN, fixtures.accountId))!; // admin can READ
    expect(report.account.name).toBe(`TestUni-${RUN}`);
    expect(report.totals).toMatchObject({ programs: 2, events: 1, activities: 2, allocated: 50000, spent: 30000 });
    const withEvents = report.programs.find((p) => p.events.length)!;
    // Chronological narrative: venue booking (Jul 05) before day-1 sessions (Jul 10).
    expect(withEvents.events[0].activities.map((a) => a.title)).toEqual(["Venue booking", "Day 1 sessions"]);
    expect(await getAccountDeliveryReport(SUPER, 99999999)).toBeNull();
  });

  it("update + validation + role gates", async () => {
    await updateProgram(SUPER, programId, {
      accountId: fixtures.accountId,
      oemId: fixtures.oemId,
      deliveryMethodId: fixtures.methodId,
      name: `IBM D2S ${RUN} v2`,
      status: "on-hold",
    });
    const detail = (await getProgramDetail(SUPER, programId))!;
    expect(detail.name).toBe(`IBM D2S ${RUN} v2`);
    expect(detail.status).toBe("on-hold");

    await expect(
      createProgram(SUPER, { accountId: fixtures.accountId, oemId: fixtures.oemId, deliveryMethodId: fixtures.methodId, name: "Bad dates", startDate: "2026-07-10", endDate: "2026-07-01" }),
    ).rejects.toThrow(/end date/i);
    await expect(
      createEvent(SUPER, { programId, title: "Negative", startDate: "2026-07-01", budget: -5 }),
    ).rejects.toThrow(/positive/i);

    // Admin reads, never writes; viewer does neither.
    await expect(listPrograms(ADMIN)).resolves.toBeInstanceOf(Array);
    await expect(createEvent(ADMIN, { programId, title: "Nope", startDate: "2026-07-01" })).rejects.toThrow();
    await expect(listPrograms(VIEWER)).rejects.toThrow();
    await expect(getProgramDetail(VIEWER, programId)).rejects.toThrow();
  });

  it("deactivated teaching styles are rejected for new programs but kept on update", async () => {
    const { setMethodActive } = await import("./methods");
    await setMethodActive(SUPER, fixtures.methodId, false);
    try {
      await expect(
        createProgram(SUPER, {
          accountId: fixtures.accountId,
          oemId: fixtures.oemId,
          deliveryMethodId: fixtures.methodId,
          name: `Retired style ${RUN}`,
        }),
      ).rejects.toThrow(/deactivated/);
      // A program already on the style may keep it when edited.
      await updateProgram(SUPER, programId, {
        accountId: fixtures.accountId,
        oemId: fixtures.oemId,
        deliveryMethodId: fixtures.methodId,
        name: `IBM D2S ${RUN} v2`,
        status: "on-hold",
      });
    } finally {
      await setMethodActive(SUPER, fixtures.methodId, true);
    }
  });

  it("deleteProgram cascades its events and activities", async () => {
    const { id } = await createProgram(SUPER, {
      accountId: fixtures.accountId,
      oemId: fixtures.oemId,
      deliveryMethodId: fixtures.methodId,
      name: `Throwaway ${RUN}`,
    });
    await createEvent(SUPER, { programId: id, title: "Doomed", startDate: "2026-07-01" });
    await deleteProgram(SUPER, id);
    expect(await getProgramDetail(SUPER, id)).toBeNull();
  });
});
