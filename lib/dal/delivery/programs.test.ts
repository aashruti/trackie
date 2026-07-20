import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db/client";
import { accounts, deliveryMethods, oems, programs as programsTable, userAccounts, users } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import {
  createProgram,
  deleteProgram,
  getProgramCalendar,
  getProgramDetail,
  listPrograms,
  setProgramStatus,
  updateProgram,
} from "./programs";
import { addActivity, createEvent, deleteActivity, deleteEvent, setEventStatus, updateEvent } from "./events";
import { getAccountDeliveryReport } from "./report";
import { getDeliveryDashboard } from "./dashboard";
import type { SessionUser } from "@/lib/dal/authz";

const SUPER = { id: 1, roles: ["super-admin" as const] };
// Sales lost delivery read/write in the admin→sales split (the ONE intended
// reduction from stackable roles — see lib/dal/authz.test.ts).
const SALES = { id: 997, roles: ["sales" as const] };
const VIEWER = { id: 999, roles: ["viewer" as const] };
// Real users row (created in beforeAll) — activity attribution has a users FK.
const DELIVERY = { id: 0, roles: ["delivery" as const] };

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
  // Delivery is account-scoped now: assign the tester to this account so its
  // write paths (create/update/delete program/event) are in scope.
  await db.insert(userAccounts).values({ userId: u.id, accountId: acc.id });
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
    const report = (await getAccountDeliveryReport(SUPER, fixtures.accountId))!;
    expect(report.account.name).toBe(`TestUni-${RUN}`);
    expect(report.totals).toMatchObject({ programs: 2, events: 1, activities: 2, allocated: 50000, spent: 30000 });
    const withEvents = report.programs.find((p) => p.events.length)!;
    // Chronological narrative: venue booking (Jul 05) before day-1 sessions (Jul 10).
    expect(withEvents.events[0].activities.map((a) => a.title)).toEqual(["Venue booking", "Day 1 sessions"]);
    expect(await getAccountDeliveryReport(SUPER, 99999999)).toBeNull();
    // Sales lost delivery read access in the admin→sales split.
    await expect(getAccountDeliveryReport(SALES, fixtures.accountId)).rejects.toThrow();
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

    // Sales has no delivery access at all now (lost it in the admin→sales
    // split); viewer never had it either.
    await expect(listPrograms(SALES)).rejects.toThrow();
    await expect(createEvent(SALES, { programId, title: "Nope", startDate: "2026-07-01" })).rejects.toThrow();
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

// ─────────────────────────────────────────────────────────────────────────────
// Account scoping (spec §5): delivery reads are filtered to the caller's
// assigned universities, mirroring the finance DAL. Two fresh throwaway
// accounts (A, B) isolate this from both the seed data and the other
// describe block's fixtures, so every count below is exact — no "probably
// in the top 10" luck.
// ─────────────────────────────────────────────────────────────────────────────
describe("account scoping — delivery reads are filtered to assigned universities", () => {
  // Same UTC-day math as dashboard.ts's private isoPlusDays, so "upcoming"
  // fixtures land inside its 14-day horizon regardless of when the suite runs.
  function isoPlusDays(days: number): string {
    const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }

  const scope = { accountAId: 0, accountBId: 0, scopedUserId: 0, allAccessUserId: 0 };
  const ids = { programA: 0, programB: 0, users: [] as number[] };
  const cleanupProgramIds: number[] = [];

  // Roles are stackable sets now — one delivery user scoped to {A} only
  // (the new behavior), and one assigned to {A, B} (simulating the 0015
  // safety backfill that gave pre-existing delivery users ALL accounts).
  let DELIVERY_A: { id: number; roles: ["delivery"] };
  let DELIVERY_ALL: { id: number; roles: ["delivery"] };

  beforeAll(async () => {
    const [accA] = await db
      .insert(accounts)
      .values({ name: `ScopeA-${RUN}`, type: "university", city: "Pune", oemId: fixtures.oemId })
      .returning({ id: accounts.id });
    const [accB] = await db
      .insert(accounts)
      .values({ name: `ScopeB-${RUN}`, type: "university", city: "Pune", oemId: fixtures.oemId })
      .returning({ id: accounts.id });
    scope.accountAId = accA.id;
    scope.accountBId = accB.id;

    const [uScoped] = await db
      .insert(users)
      .values({ name: `Scoped Delivery ${RUN}`, email: `scoped-delivery-${RUN}@test.local`, passwordHash: "x", role: "delivery" })
      .returning({ id: users.id });
    const [uAll] = await db
      .insert(users)
      .values({ name: `All-Access Delivery ${RUN}`, email: `all-delivery-${RUN}@test.local`, passwordHash: "x", role: "delivery" })
      .returning({ id: users.id });
    scope.scopedUserId = uScoped.id;
    scope.allAccessUserId = uAll.id;
    ids.users.push(uScoped.id, uAll.id);
    DELIVERY_A = { id: uScoped.id, roles: ["delivery"] };
    DELIVERY_ALL = { id: uAll.id, roles: ["delivery"] };

    await db.insert(userAccounts).values([
      { userId: uScoped.id, accountId: accA.id }, // assigned {A} only
      { userId: uAll.id, accountId: accA.id }, // assigned {A, B} — the backfill case
      { userId: uAll.id, accountId: accB.id },
    ]);

    const { id: pA } = await createProgram(SUPER, {
      accountId: accA.id,
      oemId: fixtures.oemId,
      deliveryMethodId: fixtures.methodId,
      name: `ScopeProgA-${RUN}`,
    });
    const { id: pB } = await createProgram(SUPER, {
      accountId: accB.id,
      oemId: fixtures.oemId,
      deliveryMethodId: fixtures.methodId,
      name: `ScopeProgB-${RUN}`,
    });
    ids.programA = pA;
    ids.programB = pB;
    cleanupProgramIds.push(pA, pB);

    // A fixed-date event per account for calendar/report assertions, plus a
    // matching over-budget activity so the dashboard's "having" query has
    // something to filter on both sides.
    const evA = await createEvent(SUPER, { programId: pA, title: "ScopeEventA", startDate: "2026-07-10", budget: 1000 });
    const evB = await createEvent(SUPER, { programId: pB, title: "ScopeEventB", startDate: "2026-07-10", budget: 1000 });
    await addActivity(SUPER, "Scope Tester", { eventId: evA.id, type: "expense", title: "Spend A", activityDate: "2026-07-10", cost: 2000 });
    await addActivity(SUPER, "Scope Tester", { eventId: evB.id, type: "expense", title: "Spend B", activityDate: "2026-07-10", cost: 2000 });

    // A relative-to-now "planned" event per account so dashboard "upcoming"
    // (a 14-day rolling window) is deterministic regardless of run date.
    await createEvent(SUPER, { programId: pA, title: "UpcomingA", startDate: isoPlusDays(3) });
    await createEvent(SUPER, { programId: pB, title: "UpcomingB", startDate: isoPlusDays(3) });
  });

  afterAll(async () => {
    if (cleanupProgramIds.length) await db.delete(programsTable).where(inArray(programsTable.id, cleanupProgramIds));
    await db.delete(userAccounts).where(inArray(userAccounts.userId, ids.users));
    await db.delete(users).where(inArray(users.id, ids.users));
    await db.delete(accounts).where(inArray(accounts.id, [scope.accountAId, scope.accountBId]));
  });

  it("listPrograms: scoped user sees A, not B; super-admin and all-access delivery see both", async () => {
    const namesFor = async (user: SessionUser) => (await listPrograms(user, {})).map((r) => r.name);

    const scopedNames = await namesFor(DELIVERY_A);
    expect(scopedNames).toContain(`ScopeProgA-${RUN}`);
    expect(scopedNames).not.toContain(`ScopeProgB-${RUN}`);

    const allNames = await namesFor(DELIVERY_ALL);
    expect(allNames).toContain(`ScopeProgA-${RUN}`);
    expect(allNames).toContain(`ScopeProgB-${RUN}`);

    const superNames = await namesFor(SUPER);
    expect(superNames).toContain(`ScopeProgA-${RUN}`);
    expect(superNames).toContain(`ScopeProgB-${RUN}`);
  });

  it("getProgramDetail: a program outside scope is null, not another account's data", async () => {
    expect(await getProgramDetail(DELIVERY_A, ids.programB)).toBeNull();
    const own = await getProgramDetail(DELIVERY_A, ids.programA);
    expect(own?.name).toBe(`ScopeProgA-${RUN}`);
    // The all-access (backfilled) delivery user reaches both.
    expect((await getProgramDetail(DELIVERY_ALL, ids.programA))?.name).toBe(`ScopeProgA-${RUN}`);
    expect((await getProgramDetail(DELIVERY_ALL, ids.programB))?.name).toBe(`ScopeProgB-${RUN}`);
  });

  it("getProgramCalendar: out-of-scope program is null; in-scope shows its own event", async () => {
    expect(await getProgramCalendar(DELIVERY_A, ids.programB, 2026, 7)).toBeNull();
    const cal = await getProgramCalendar(DELIVERY_A, ids.programA, 2026, 7);
    expect(cal?.cells["2026-07-10"]?.events[0]).toMatchObject({ title: "ScopeEventA" });
  });

  it("getAccountDeliveryReport: out-of-scope account is null; in-scope account reports its own program", async () => {
    expect(await getAccountDeliveryReport(DELIVERY_A, scope.accountBId)).toBeNull();
    const report = await getAccountDeliveryReport(DELIVERY_A, scope.accountAId);
    expect(report?.programs.map((p) => p.name)).toEqual([`ScopeProgA-${RUN}`]);
    // The all-access delivery user reaches both accounts' reports.
    expect(await getAccountDeliveryReport(DELIVERY_ALL, scope.accountBId)).not.toBeNull();
  });

  it("getDeliveryDashboard: counts, over-budget and recent activity are all filtered by scope", async () => {
    const dashA = await getDeliveryDashboard(DELIVERY_A);
    expect(dashA.programs).toMatchObject({ total: 1, active: 1 });
    expect(dashA.overBudgetCount).toBe(1);
    expect(dashA.overBudget.every((e) => e.title !== "ScopeEventB")).toBe(true);
    expect(dashA.recent.some((r) => r.title === "Spend A")).toBe(true);
    expect(dashA.recent.every((r) => r.title !== "Spend B")).toBe(true);
    expect(dashA.upcomingCount).toBe(1);
    expect(dashA.upcoming.every((e) => e.title !== "UpcomingB")).toBe(true);

    // The all-access (backfilled) delivery user's dashboard sees both — the
    // regression guard: scoping must not drop an existing all-accounts user
    // to zero visibility.
    const dashAll = await getDeliveryDashboard(DELIVERY_ALL);
    expect(dashAll.programs).toMatchObject({ total: 2, active: 2 });
    expect(dashAll.overBudgetCount).toBe(2);
    expect(dashAll.recent.some((r) => r.title === "Spend A")).toBe(true);
    expect(dashAll.recent.some((r) => r.title === "Spend B")).toBe(true);
    expect(dashAll.upcomingCount).toBe(2);
  });

  // WRITES must be scoped too, not just reads. A scoped user seeing only A but
  // able to mutate B by guessing its id is an IDOR — read-hiding without
  // write-scoping is a false sense of isolation.
  it("write paths reject a scoped user acting on an out-of-scope account (B), allow in-scope (A)", async () => {
    // --- program writes on B: all rejected ---
    await expect(
      updateProgram(DELIVERY_A, ids.programB, {
        accountId: scope.accountBId, oemId: fixtures.oemId, deliveryMethodId: fixtures.methodId, name: "hijack",
      }),
    ).rejects.toThrow(/assigned universities/i);
    await expect(setProgramStatus(DELIVERY_A, ids.programB, "completed")).rejects.toThrow(/assigned universities/i);
    await expect(deleteProgram(DELIVERY_A, ids.programB)).rejects.toThrow(/assigned universities/i);
    // can't create a program under an account they can't reach
    await expect(
      createProgram(DELIVERY_A, {
        accountId: scope.accountBId, oemId: fixtures.oemId, deliveryMethodId: fixtures.methodId, name: "sneak",
      }),
    ).rejects.toThrow(/assigned universities/i);
    // and can't move an in-scope program (A) INTO an out-of-scope account (B)
    await expect(
      updateProgram(DELIVERY_A, ids.programA, {
        accountId: scope.accountBId, oemId: fixtures.oemId, deliveryMethodId: fixtures.methodId, name: "move-out",
      }),
    ).rejects.toThrow(/assigned universities/i);

    // program B is untouched by the rejected delete
    expect((await listPrograms(SUPER, { accountId: scope.accountBId })).some((p) => p.id === ids.programB)).toBe(true);

    // --- event/activity writes on B: rejected ---
    const evB = await createEvent(SUPER, { programId: ids.programB, title: "WriteScopeB", startDate: "2026-07-15" });
    await expect(
      createEvent(DELIVERY_A, { programId: ids.programB, title: "nope", startDate: "2026-07-15" }),
    ).rejects.toThrow(/assigned universities/i);
    await expect(updateEvent(DELIVERY_A, evB.id, { title: "hijack", startDate: "2026-07-15" })).rejects.toThrow(/assigned universities/i);
    await expect(setEventStatus(DELIVERY_A, evB.id, "cancelled")).rejects.toThrow(/assigned universities/i);
    await expect(deleteEvent(DELIVERY_A, evB.id)).rejects.toThrow(/assigned universities/i);
    await expect(
      addActivity(DELIVERY_A, "x", { eventId: evB.id, type: "note", title: "nope", activityDate: "2026-07-15" }),
    ).rejects.toThrow(/assigned universities/i);
    const actB = await addActivity(SUPER, "x", { eventId: evB.id, type: "note", title: "b", activityDate: "2026-07-15" });
    await expect(deleteActivity(DELIVERY_A, actB.id)).rejects.toThrow(/assigned universities/i);

    // --- in-scope (A) writes: allowed ---
    await expect(setProgramStatus(DELIVERY_A, ids.programA, "active")).resolves.toBeUndefined();
    const evA = await createEvent(DELIVERY_A, { programId: ids.programA, title: "WriteScopeA", startDate: "2026-07-15" });
    expect(evA.id).toBeGreaterThan(0);
    await expect(deleteEvent(DELIVERY_A, evA.id)).resolves.toBeUndefined();

    // super-admin bypasses scope on B
    await expect(setProgramStatus(SUPER, ids.programB, "active")).resolves.toBeUndefined();
    // evB + actB are under program B, which afterAll deletes (cascading them).
  });
});
