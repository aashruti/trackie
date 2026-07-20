# Stackable Team Roles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the single `admin` role into a stackable set (`sales`, `delivery`, …), let a user hold several roles at once, and scope `delivery` to assigned universities — without changing anyone's effective access on deploy.

**Architecture:** `users.role` (one enum value) stays as a rollback seed; a new `user_roles` join table holds each user's role *set*. `SessionUser` becomes `{ id, roles: Role[] }`; authz tests set-membership. The `jwt` callback resolves the role set in the DB read it already does for the session store, so changes are live. Delivery DAL gains the finance DAL's existing account-scope filter.

**Tech Stack:** Auth.js v5, Next.js App Router, Drizzle, Postgres, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-17-stackable-team-roles-design.md` — read §5 (delivery scoping), §8 (equivalence guard), §10 (risk).

---

## Background an engineer needs

**The one rule that governs this whole change: no existing user's access may change on deploy — except one deliberate reduction.** `admin` becomes `sales` and, by design, `sales` *loses* the delivery-read that `admin` had (`canAccessDelivery` includes `admin` today; it won't include `sales`). Every other capability must be identical. This is enforced by a two-direction equivalence test (Task 2) — the deploy gate.

**Why a rename, not a new value:** `admin` → `sales` is `ALTER TYPE "role" RENAME VALUE`. Existing `admin` rows read as `sales` automatically — no data backfill for the rename itself. The enum stays five values: `super-admin, sales, viewer, hr, delivery`. Stacking is what provides cross-functional access, so no combined enum value is minted.

**The compiler is your enumeration tool.** Changing `SessionUser` from `{ id, role }` to `{ id, roles }` (Task 2) makes `tsc` flag every one of the ~45 sites that construct or read an actor. Task 4 is "fix what tsc reports." Do NOT try to find them by grep first — change the type, run `tsc`, fix the list it gives you. The three semantically-tricky spots are called out explicitly so a mechanical fix doesn't get them wrong.

**Production & migrations:** `scripts/db-migrate.ts` now defaults to local and needs `--prod` for production (fixed in #19); `vercel-build` runs it against prod on deploy. Do NOT run `--prod` by hand. The local DB holds **real staff records** — never seed/reset; tests make their own throwaway users and delete them.

**Dev/test gotchas:** stop any dev server before DB tests (`too many clients` = exhaustion, not failure; use the Browser pane's `preview_stop`, never Bash for a dev server). `npm test` has ONE pre-existing failure in `lib/board/constants.test.ts` (`lostCount`) that also fails on `main` — ignore it. Lint baseline on `main` is exactly `33 problems (3 errors, 30 warnings)`.

**Never touch or stage** `scripts/reset-db.ts`, `app/api/ping/`, `vercel.json` — the user's uncommitted work.

---

### Task 1: Migration — rename, `user_roles`, backfills

**Files:** Create `drizzle/0015_user_roles.sql`; modify `drizzle/meta/_journal.json`, `lib/db/enums.ts`, `lib/db/schema.ts`

- [ ] **Step 1: The migration SQL**

Create `drizzle/0015_user_roles.sql`:

```sql
-- Split the single role into a stackable set.
--  1. admin → sales (rename; existing admin rows read as sales automatically)
--  2. user_roles join: a user holds one OR MORE roles (union of permissions)
--  3. backfill each user's current scalar role into user_roles
--  4. safety: existing delivery users get ALL accounts assigned, so newly
--     scoping delivery (spec §5) doesn't drop them to zero visibility on deploy
-- users.role (scalar) is kept as a rollback seed; a follow-up PR drops it.
-- Spec: docs/superpowers/specs/2026-07-17-stackable-team-roles-design.md
ALTER TYPE "role" RENAME VALUE 'admin' TO 'sales';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_roles" (
	"user_id" integer NOT NULL,
	"role" "role" NOT NULL,
	CONSTRAINT "user_roles_user_id_role_pk" PRIMARY KEY("user_id","role")
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_roles_user_id_idx" ON "user_roles" ("user_id");--> statement-breakpoint
-- backfill: one row per user from their current scalar role
INSERT INTO "user_roles" ("user_id", "role")
  SELECT "id", "role" FROM "users"
  ON CONFLICT DO NOTHING;--> statement-breakpoint
-- delivery-scoping safety: any delivery user with no account assignments gets all
INSERT INTO "user_accounts" ("user_id", "account_id")
  SELECT u."id", a."id"
  FROM "users" u
  CROSS JOIN "accounts" a
  WHERE u."role" = 'delivery'
    AND NOT EXISTS (SELECT 1 FROM "user_accounts" ua WHERE ua."user_id" = u."id")
  ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Journal entry**

Append to `entries` in `drizzle/meta/_journal.json` after `0014` (mind the comma):

```json
    {
      "idx": 15,
      "version": "7",
      "when": 1784018500000,
      "tag": "0015_user_roles",
      "breakpoints": true
    }
```

- [ ] **Step 3: Enum rename in code**

In `lib/db/enums.ts`, change:

```ts
export const ROLES = ["super-admin", "admin", "viewer", "hr", "delivery"] as const;
```
to:
```ts
export const ROLES = ["super-admin", "sales", "viewer", "hr", "delivery"] as const;
```

- [ ] **Step 4: `user_roles` in the schema**

In `lib/db/schema.ts`, after `userAccounts`:

```ts
/**
 * A user's role SET — they hold one or more. Effective access is the union.
 * users.role (scalar) is kept as a rollback seed during the transition; this
 * table is the source of truth for authz.
 */
export const userRoles = pgTable(
  "user_roles",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] }), index("user_roles_user_id_idx").on(t.userId)],
);
```

(`index` and `primaryKey` are already imported in this file.)

- [ ] **Step 5: Run against LOCAL and verify the backfill**

Run: `npx tsx scripts/db-migrate.ts` (defaults to local). Expect it to apply `0015` and print `Migrating local`.

Write a throwaway `tmp-roles.test.ts` that asserts: every user has ≥1 `user_roles` row; the union of `user_roles.role` values matches each user's `users.role` (renamed); no `admin` value remains anywhere. Run via vitest, then delete it.

- [ ] **Step 6: Commit**

```bash
git add drizzle/0015_user_roles.sql drizzle/meta/_journal.json lib/db/enums.ts lib/db/schema.ts
git commit -m "feat(auth): user_roles join + rename admin→sales

Stackable roles: a user holds one or more. Backfills each user's scalar role
into user_roles; keeps users.role as a rollback seed. Safety-backfills
existing delivery users with all accounts so scoping delivery (next commits)
doesn't drop them to zero visibility."
```

---

### Task 2: authz.ts + the equivalence guard

**Files:** Modify `lib/dal/authz.ts`, `lib/dal/authz.test.ts`

This is the correctness heart. **Write the test first — it is the deploy gate.**

- [ ] **Step 1: Rewrite the test as the two-direction equivalence guard**

Replace `lib/dal/authz.test.ts`. Model each legacy role as its backfilled role SET and assert every `can*` answer is preserved — with the ONE intended change (`sales` loses delivery access) asserted explicitly:

```ts
import { describe, it, expect } from "vitest";
import {
  canEdit, canAccessLeads, assertLeadsAccess, scopeAccountIds,
  canAccessDelivery, assertDeliveryAccess, canManageDelivery, assertDeliveryManage,
  canManageGroups, assertGroupsManage, canManageHr, assertHrAccess,
  type SessionUser,
} from "./authz";

const u = (...roles: SessionUser["roles"]): SessionUser => ({ id: 1, roles });

const superAdmin = u("super-admin");
const sales = u("sales");        // ← was "admin"
const viewer = u("viewer");
const hr = u("hr");
const delivery = u("delivery");
const salesDelivery = u("sales", "delivery"); // cross-functional stack

describe("scopeAccountIds", () => {
  it("super-admin unrestricted; everyone else assigned", () => {
    expect(scopeAccountIds(superAdmin, [10, 20])).toBeNull();
    expect(scopeAccountIds(sales, [10, 20])).toEqual([10, 20]);
    expect(scopeAccountIds(delivery, [10])).toEqual([10]);
    expect(scopeAccountIds(viewer, [])).toEqual([]);
  });
});

describe("finance edit / leads / groups — sales inherits admin's finance access", () => {
  it("canEdit: super anything, sales only assigned, others never", () => {
    expect(canEdit(superAdmin, 99, [])).toBe(true);
    expect(canEdit(sales, 10, [10])).toBe(true);
    expect(canEdit(sales, 30, [10])).toBe(false);
    expect(canEdit(delivery, 10, [10])).toBe(false);
    expect(canEdit(viewer, 10, [10])).toBe(false);
  });
  it("leads + groups: super & sales yes; delivery/hr/viewer no", () => {
    for (const f of [canAccessLeads, canManageGroups]) {
      expect(f(superAdmin)).toBe(true);
      expect(f(sales)).toBe(true);
      expect(f(delivery)).toBe(false);
      expect(f(hr)).toBe(false);
      expect(f(viewer)).toBe(false);
    }
    expect(() => assertLeadsAccess(delivery)).toThrow();
    expect(() => assertGroupsManage(sales)).not.toThrow();
  });
});

describe("delivery — the ONE intended reduction: sales loses delivery access", () => {
  it("access: super & delivery yes; sales NO (was yes as admin); hr/viewer no", () => {
    expect(canAccessDelivery(superAdmin)).toBe(true);
    expect(canAccessDelivery(delivery)).toBe(true);
    expect(canAccessDelivery(sales)).toBe(false); // ← the deliberate change
    expect(canAccessDelivery(hr)).toBe(false);
  });
  it("manage: super & delivery yes; sales no", () => {
    expect(canManageDelivery(superAdmin)).toBe(true);
    expect(canManageDelivery(delivery)).toBe(true);
    expect(canManageDelivery(sales)).toBe(false);
  });
});

describe("hr", () => {
  it("super & hr manage; others cannot", () => {
    expect(canManageHr(superAdmin)).toBe(true);
    expect(canManageHr(hr)).toBe(true);
    expect(canManageHr(sales)).toBe(false);
    expect(() => assertHrAccess(delivery)).toThrow();
  });
});

describe("stacking — union of permissions", () => {
  it("{sales, delivery} gets BOTH finance edit and delivery manage", () => {
    expect(canEdit(salesDelivery, 10, [10])).toBe(true);
    expect(canAccessDelivery(salesDelivery)).toBe(true);
    expect(canManageDelivery(salesDelivery)).toBe(true);
    expect(canAccessLeads(salesDelivery)).toBe(true);
  });
  it("super-admin anywhere in the stack wins", () => {
    expect(scopeAccountIds(u("super-admin", "delivery"), [1])).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — it must fail to compile**

Run: `npx vitest run lib/dal/authz.test.ts`
Expected: FAIL — `SessionUser` still has `role`, not `roles`; and `sales` isn't a role yet. This is the red step.

- [ ] **Step 3: Rewrite `authz.ts`**

Change the type and every helper to set-membership. Full replacement of the logic (keep the doc comments, updated):

```ts
import type { Role } from "@/lib/db/enums";
import { UserError } from "@/lib/dal/errors";

export type SessionUser = { id: number; roles: Role[] };

function isSuper(user: SessionUser): boolean {
  return user.roles.includes("super-admin");
}
function has(user: SessionUser, role: Role): boolean {
  return user.roles.includes(role);
}

/** null = unrestricted (super-admin); else the assigned account ids. */
export function scopeAccountIds(user: SessionUser, assigned: number[]): number[] | null {
  return isSuper(user) ? null : assigned;
}

/** Edit finance on an account: super anywhere; sales only on assigned accounts. */
export function canEdit(user: SessionUser, accountId: number, assigned: number[]): boolean {
  if (isSuper(user)) return true;
  if (has(user, "sales")) return assigned.includes(accountId);
  return false;
}

export function canAccessLeads(user: SessionUser): boolean {
  return isSuper(user) || has(user, "sales");
}
export function assertLeadsAccess(user: SessionUser): void {
  if (!canAccessLeads(user)) throw new UserError("Leads is available to Sales / Super Admin only");
}

export function canManageHr(user: SessionUser): boolean {
  return isSuper(user) || has(user, "hr");
}
export function assertHrAccess(user: SessionUser): void {
  if (!canManageHr(user)) throw new UserError("HR administration is available to HR / Super Admin only");
}

/** SEE delivery — delivery team only now; sales no longer gets read access. */
export function canAccessDelivery(user: SessionUser): boolean {
  return isSuper(user) || has(user, "delivery");
}
export function assertDeliveryAccess(user: SessionUser): void {
  if (!canAccessDelivery(user)) throw new UserError("Delivery is available to the Delivery team / Super Admin only");
}

export function canManageDelivery(user: SessionUser): boolean {
  return isSuper(user) || has(user, "delivery");
}
export function assertDeliveryManage(user: SessionUser): void {
  if (!canManageDelivery(user)) throw new UserError("Only the Delivery team / Super Admin can modify delivery data");
}

export function canManageGroups(user: SessionUser): boolean {
  return isSuper(user) || has(user, "sales");
}
export function assertGroupsManage(user: SessionUser): void {
  if (!canManageGroups(user)) throw new UserError("Account groups are available to Sales / Super Admin only");
}
```

- [ ] **Step 4: Green the test**

Run: `npx vitest run lib/dal/authz.test.ts`
Expected: PASS. `tsc` will still be red across the codebase — that's Task 4.

- [ ] **Step 5: Commit**

```bash
git add lib/dal/authz.ts lib/dal/authz.test.ts
git commit -m "feat(auth): authz on role sets, not a single role

SessionUser carries roles[]; every can* helper tests membership. The
equivalence test asserts each legacy role's set reproduces today's access,
with the one intended reduction — sales loses admin's delivery read —
asserted explicitly. Stacking {sales, delivery} gives the union."
```

---

### Task 3: Carry `roles` through auth

**Files:** Modify `types/next-auth.d.ts`, `lib/auth/config.ts`

- [ ] **Step 1: Types**

In `types/next-auth.d.ts`, replace `role: Role` with `roles: Role[]` in `Session.user` and `User`, and in the JWT block replace `role?: Role` with `roles?: Role[]`.

- [ ] **Step 2: Resolve the role set in `authorize`, jwt, session**

Add a helper near the top of `lib/auth/config.ts` (import `userRoles`, `eq`, `db`):

```ts
async function rolesFor(userId: number): Promise<Role[]> {
  const rows = await db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, userId));
  return rows.map((r) => r.role);
}
```

`authorize` — replace the returned `role` with the set:

```ts
        return { id: String(u.id), name: u.name, email: u.email, roles: await rolesFor(u.id) };
```

The `jwt` callback (from PR #18) currently sets `token.role` on sign-in and, on later requests, only checks the session. Change it to carry — and **re-read** — the role set, so a role change applies on the next request:

```ts
    jwt: async ({ token, user }) => {
      if (user) {
        token.uid = user.id;
        token.roles = (user as { roles?: Role[] }).roles ?? [];
        token.sid = await createSession(Number(user.id));
        return token;
      }
      const sid = token.sid as string | undefined;
      if (!sid || !(await sessionExists(sid))) return null;
      // Live role resolution — same fail-closed contract as the session check.
      token.roles = await rolesFor(Number(token.uid));
      return token;
    },
```

The `session` callback sets `session.user.roles = token.roles as Role[]` (replacing the `role` line). Drop every remaining `token.role` / `session.user.role` reference.

- [ ] **Step 3: tsc + commit** (tsc still red elsewhere — Task 4). Commit after Task 4 verifies the whole tree, OR commit config now and note tsc is expected-red. Prefer committing with Task 4 so no commit is left non-compiling.

---

### Task 4: Fix the actor sites the compiler flags

**Files:** every file `tsc` reports. Do NOT pre-grep; let the compiler drive.

- [ ] **Step 1: Enumerate**

Run: `npx tsc --noEmit 2>&1 | grep -E "role" | head -80`. Every error is either an actor construction (`{ id, role: user.role }` → `{ id, roles: user.roles }`) or a direct comparison (`user.role === X`). Fix mechanically **except** the three below.

- [ ] **Step 2: The three that need thought (not mechanical)**

- **`app/(app)/dashboard/page.tsx`** — picks one view by role order (`role === "hr"` then `role === "delivery"`). Rewrite additively: show each panel the user's role set grants (`roles.includes("hr")` shows HR panel; `roles.includes("delivery")` shows delivery panel; finance panel for `sales`/super). A `{sales, delivery}` user must see both.
- **`components/shell/sidebar.tsx`** — `showFinance/showHr/showDelivery` become "any role grants it": `isSuper || roles.includes("sales")` for finance, `... "hr"` for HR, `... "delivery"` for delivery. Admin group stays `isSuper`.
- **`~14 DAL sites`** with `role === "super-admin" ? [] : assignedIds(...)` — change to `roles.includes("super-admin") ? [] : assignedIds(...)`. (These are the account-scope proxies; a stacked super-admin still bypasses scoping.)

Also: `assertSuperAdmin` in `user-admin.ts` / `account-admin.ts` / `rollover.ts` (delete-year) and `superAdminCount()` — change `role === "super-admin"` / `eq(users.role, ...)` to the `user_roles`-based check. **`superAdminCount` must count users whose `user_roles` includes `super-admin`**, not `users.role`, or the last-admin guard reads the stale scalar.

- [ ] **Step 3: Verify clean**

Run: `rm -rf .next/types && npx tsc --noEmit && npm run lint`. tsc clean; lint = the 33 baseline.

- [ ] **Step 4: Commit** (fold Task 3's config commit in here so nothing is left non-compiling)

```bash
git add -A -- ':!scripts/reset-db.ts' ':!vercel.json' ':!app/api/ping'
git commit -m "feat(auth): thread roles[] through the app

SessionUser/JWT/session carry the role set; the jwt callback reads it in the
per-request DB round trip so role changes are live. Dashboard and sidebar
show the UNION across a user's roles; super-admin account-scope bypass reads
the role set. superAdminCount counts user_roles, not the legacy scalar."
```

---

### Task 5: Scope delivery to assigned accounts

**Files:** Modify `lib/dal/delivery/programs.ts`, `events.ts`, `dashboard.ts`, `report.ts` (whichever read account-linked delivery data); add/extend `lib/dal/delivery/*.test.ts`

- [ ] **Step 1: Test first — scoping + the no-regression guard**

Add a test: a `delivery` user assigned `{A}` sees A's programs, not B's; a `super-admin` sees both; a delivery user assigned to *all* accounts (the §4 safety backfill) sees everything. (Integration test against seeded data, or a focused unit test if the scope filter is factored out.)

- [ ] **Step 2: Add the scope filter**

In `listPrograms` (and each list/read path), mirror the finance DAL idiom:

```ts
const assigned = user.roles.includes("super-admin") ? [] : await assignedIds(user.id);
const scope = scopeAccountIds(user, assigned); // null → all
// add to the where-conditions:
scope ? inArray(programs.accountId, scope.length ? scope : [-1]) : undefined,
```

`assignedIds` and `scopeAccountIds` are already imported patterns elsewhere; import them here. Apply the same to events/dashboard/report queries keyed on account.

- [ ] **Step 3: Verify + commit**

`npx vitest run lib/dal/delivery && npx tsc --noEmit`, then:

```bash
git add lib/dal/delivery
git commit -m "feat(delivery): scope delivery data to assigned universities

Delivery reads now filter by the caller's assigned accounts, like finance.
super-admin still sees all. Existing delivery users were all-accounts
backfilled in 0015 so nobody loses visibility on deploy."
```

---

### Task 6: Admin UI — multi-select roles

**Files:** Modify `components/admin/users-admin.tsx`, `app/(app)/admin/users/actions.ts`, `lib/dal/user-admin.ts`

- [ ] **Step 1: DAL — set the role set**

Replace `updateUserRole(userId, role)` semantics with `setUserRoles(actor, userId, roles: Role[])`: assert `users.manage` (super-admin), guard the last-super-admin rule (if removing `super-admin` from the last holder, throw), then delete-all + re-insert `user_roles` for that user (mirroring `setUserAccounts`). Also write the scalar `users.role` to `roles[0] ?? "viewer"` for display/rollback consistency during the expand phase. `createUser` takes `roles: Role[]`.

- [ ] **Step 2: Action + UI**

`setUserRolesAction(userId, roles)` mirroring the existing action shape. In `UserCard`, replace the single `<select>` with a checkbox set of the five roles. Show the account-assignment block when the set includes `sales` or `delivery` (an account-scoped role), hidden for pure super-admin/hr/viewer. Saving takes effect next request.

- [ ] **Step 3: Verify (browser) + commit**

Browser-verify with `verify-admin@test.local` / `Verify@12345` (never a real account): tick `{sales, delivery}` on `verify-delivery`, confirm on next navigation they get both surfaces scoped to their assigned universities; untick to a single role and confirm it narrows. Then commit.

---

### Task 7: Full verification (deploy gate)

- [ ] `npm test` — the authz equivalence test + delivery scoping test pass; only the pre-existing `lostCount` fails.
- [ ] `npx tsc --noEmit && npm run lint` — clean; lint = 33 baseline.
- [ ] `npm run build` — succeeds.
- [ ] **Backfill equivalence, both directions** — confirm the Task 2 test asserts no access gained/lost bar the intended `sales`-loses-delivery reduction.
- [ ] **Pre-deploy read-only production check** — a throwaway read-only probe (like the `0013`/`0014` audits): every one of the 18 users' `user_roles` reproduces their old `users.role`; every `delivery` user is all-accounts-assigned or already scoped. Delete the probe.
- [ ] `git status` shows ONLY the user's `scripts/reset-db.ts`, `app/api/ping/`, `vercel.json` — untouched.

---

## Follow-up (tracked, not in this PR)

- **Contract:** drop `users.role` once verified in production (spec §9). Its own migration + PR.
