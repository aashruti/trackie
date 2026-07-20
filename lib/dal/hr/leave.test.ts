import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, employeeProfiles } from "@/lib/db/schema";
import { getOrCreateEmployeeForUser, monthsAccruedToDate } from "./leave";

/** Pro-rata accrual months for Earned leave (1.5/mo), given date-of-joining. */
describe("monthsAccruedToDate — pro-rata for mid-year joiners", () => {
  it("no DOJ / joined a prior year → full months elapsed", () => {
    expect(monthsAccruedToDate(null, 2026, 7)).toBe(7); // Jan–Jul
    expect(monthsAccruedToDate("2025-01-07", 2026, 7)).toBe(7);
    expect(monthsAccruedToDate("2023-12-01", 2026, 6)).toBe(6);
  });

  it("joined mid-year → accrues from the join month (inclusive)", () => {
    expect(monthsAccruedToDate("2026-05-26", 2026, 7)).toBe(3); // May, Jun, Jul → 3 mo → ×1.5 = 4.5 (Abhishek)
    expect(monthsAccruedToDate("2026-01-05", 2026, 3)).toBe(3); // Jan–Mar
    expect(monthsAccruedToDate("2026-05-26", 2026, 12)).toBe(8); // May–Dec
  });

  it("joined this month → 1 month", () => {
    expect(monthsAccruedToDate("2026-07-15", 2026, 7)).toBe(1);
  });

  it("joined after the leave year → 0", () => {
    expect(monthsAccruedToDate("2027-01-01", 2026, 7)).toBe(0);
    expect(monthsAccruedToDate("2026-08-01", 2026, 7)).toBe(0); // joins next month
  });

  it("caps at 12 months", () => {
    expect(monthsAccruedToDate("2020-01-01", 2026, 12)).toBe(12);
    expect(monthsAccruedToDate(null, 2026, 12)).toBe(12);
  });
});

describe("getOrCreateEmployeeForUser — everyone can reach leave self-service", () => {
  const RUN = String(Date.now()).slice(-7);
  const created: number[] = [];

  async function throwawayUser(suffix: string): Promise<number> {
    const [u] = await db
      .insert(users)
      .values({ name: `Leave Test ${suffix}`, email: `leave-${suffix}-${RUN}@test.local`, passwordHash: "x", role: "viewer" })
      .returning({ id: users.id });
    created.push(u.id);
    return u.id;
  }

  it("provisions a minimal active profile for a user who has none, and is idempotent", async () => {
    const uid = await throwawayUser("none");
    const first = await getOrCreateEmployeeForUser(uid);
    expect(first).not.toBeNull();
    expect(first!.employeeCode).toBe(`U${uid}`);

    // Idempotent: a second call returns the same profile, never a duplicate.
    const second = await getOrCreateEmployeeForUser(uid);
    expect(second!.employeeId).toBe(first!.employeeId);
    const rows = await db.select({ id: employeeProfiles.id }).from(employeeProfiles).where(eq(employeeProfiles.userId, uid));
    expect(rows.length).toBe(1);

    // Self-service provisioning: the audit trigger reads created_by/updated_by
    // off the row — the requesting user is their own actor here.
    const [profile] = await db.select().from(employeeProfiles).where(eq(employeeProfiles.userId, uid));
    expect(profile.createdBy).toBe(uid);
    expect(profile.updatedBy).toBe(uid);
  });

  it("returns null and provisions NOTHING for a deactivated (inactive) employee", async () => {
    const uid = await throwawayUser("inactive");
    await db.insert(employeeProfiles).values({ userId: uid, employeeCode: `X${uid}`, status: "inactive" });
    const res = await getOrCreateEmployeeForUser(uid);
    expect(res).toBeNull(); // deactivated employees stay out — the redirect fires
    const rows = await db.select({ id: employeeProfiles.id }).from(employeeProfiles).where(eq(employeeProfiles.userId, uid));
    expect(rows.length).toBe(1); // no second profile created
  });

  it("returns an existing active profile unchanged", async () => {
    const uid = await throwawayUser("active");
    const [p] = await db.insert(employeeProfiles).values({ userId: uid, employeeCode: `A${uid}` }).returning({ id: employeeProfiles.id });
    const res = await getOrCreateEmployeeForUser(uid);
    expect(res!.employeeId).toBe(p.id);
    expect(res!.employeeCode).toBe(`A${uid}`); // not overwritten with U<id>
  });

  afterAll(async () => {
    // Delete each throwaway's employee_profiles row FIRST, while the user still
    // exists: self-provisioned profiles now stamp updated_by = the user's own
    // id, and the DELETE audit trigger needs that actor row present to satisfy
    // audit_log's actor_id FK. Deleting the user first would cascade-delete the
    // profile in the same statement the actor row disappears in, and the FK
    // check (which sees the transaction's own uncommitted delete) would fail.
    for (const id of created) await db.delete(employeeProfiles).where(eq(employeeProfiles.userId, id));
    for (const id of created) await db.delete(users).where(eq(users.id, id));
  });
});
