# Stackable Team Roles (split admin → sales, account-scope delivery)

**Date:** 2026-07-17
**Status:** Approved for implementation. User decisions: **stack roles** (a user holds one or more of a
fixed set; permissions are the union), split the old `admin` into **sales**, make **delivery
account-scoped**, keep account/university access **per-user**.
**Depends on:** the session store (PR #18) — its per-request DB read makes role changes take effect live.

> **Supersedes the capability-matrix draft** (`2026-07-17-capability-permissions-design.md`, removed).
> That approach — 17 fine-grained capabilities, editable role rows, a role-management UI — was judged
> **overkill for an 18-person tool** by the user. This is the small version: a fixed set of named
> roles you can *stack*, which solves the actual need (cross-functional people, separated teams)
> without a permission engine.

## 1. Problem

Today a user has **exactly one** role (`super-admin` / `admin` / `hr` / `delivery` / `viewer`), and:

- **`admin` is one blob.** It bundles the finance/sales side (accounts, invoices, payments, reports,
  leads, groups). The user wants the **sales team** and the **delivery team** as distinct roles.
- **No cross-functional users.** Someone doing both sales and delivery must be `super-admin`, which
  also grants HR and all universities.
- **Delivery isn't account-scoped.** A `delivery` user sees *all* delivery data; the user wants them
  scoped to their assigned universities, the same way sales is.

## 2. The model — fixed roles, stackable, account-scoped

A user holds **one or more** roles from a fixed set; their access is the **union**. There is no
permission grid and no runtime role editing — the roles are hard-coded, exactly as today, just
reorganised and stackable.

| Role | Grants | Account-scoped? |
| --- | --- | --- |
| **super-admin** | everything, all modules | No — sees all universities |
| **sales** *(renamed from `admin`)* | accounts, invoices, payments, reports, leads, account groups | **Yes** — assigned universities |
| **delivery** | delivery module (programs, events, board, activities) | **Yes** — assigned universities *(new)* |
| **hr** | HR management (`/hr/*`) | No — HR is about employees, not universities |
| **viewer** | team board only | — |

- **Cross-functional = stacking.** A person who runs sales *and* delivery for their universities holds
  `{sales, delivery}`. No combined role to mint; any combination just works.
- **Account access is per-user** (`userAccounts`), shared across all of a user's scoped roles — one
  assignment list governs both their sales and delivery visibility.
- **Self-service stays universal** — the team board and `/me/*` (own leave/attendance/payslips) need
  no role, as today.

### What changes vs. today

1. **`admin` → `sales`** (rename). `sales` is finance-only; it **drops** the delivery-view that
   `admin` had — someone who needs delivery now stacks `delivery`.
2. **`delivery` becomes account-scoped** — its DAL queries gain the same `scopeAccountIds` filter that
   sales already uses. This is the main new code (§5).
3. **One role → a set of roles** — `users.role` (scalar) becomes a `user_roles` join (§4), and authz
   tests membership instead of equality (§6).

## 3. Not the capability matrix — recorded so it isn't revisited by accident

The rejected alternative was per-capability, per-user grants with editable role rows (Users → Role →
17 Capabilities, a role-management UI, live propagation). It is genuinely more powerful — read-vs-write
per area, "manage attendance but not approve leave", runtime-authored roles. It was **rejected as
overkill**: five stackable roles cover the stated needs (team separation + a few cross-functional
people) with a fraction of the surface. If a future need genuinely requires sub-area granularity, the
capability model is the documented escalation — but not now.

## 4. Storage

**Migration `0015_user_roles.sql`:**
- Rename the enum value: `ALTER TYPE "role" RENAME VALUE 'admin' TO 'sales'`. Existing `admin` rows
  read as `sales` automatically — no data backfill for the rename.
- `user_roles` join table — `(user_id → users.id ON DELETE CASCADE, role "role")` composite PK,
  indexed on `user_id`. Mirrors `userAccounts`.
- **Backfill:** insert one `user_roles` row per user from their current `users.role`. Idempotent.
- **Delivery-scoping safety backfill:** for every user whose set includes `delivery`, if they have no
  `userAccounts` rows, insert assignments for **all current accounts** — so scoping `delivery` doesn't
  silently drop them to zero visibility on deploy. (Prod may have no `delivery` users yet; the guard
  is free either way.)

`users.role` (scalar) stays through the **expand** phase as a rollback seed and the backfill source;
a tracked **contract** PR drops it once verified in production (§9) — not left to rot.

## 5. Delivery becomes account-scoped

Today delivery DAL (`lib/dal/delivery/programs.ts`, `events.ts`, `dashboard.ts`, `report.ts`) returns
all data. Each read path gains the existing scoping idiom used across the finance DAL:

```ts
const assigned = user.roles.includes("super-admin") ? [] : await assignedIds(user.id);
const scope = scopeAccountIds(user, assigned); // null → all; else the assigned account ids
// …filter programs/events by account id in `scope`
```

Programs are tied to accounts (universities), so filtering by account id is the natural key. `super-admin`
still sees all; `delivery`/stacked users see only their assigned universities' delivery data. This is
the change with real regression risk — hence the §4 all-accounts backfill for existing delivery users.

## 6. Authz — membership, not equality

`SessionUser` becomes `{ id, roles: Role[] }`. Every check tests set membership:

| Helper | Was | Becomes |
| --- | --- | --- |
| `scopeAccountIds` | `super → all; else assigned` | `roles.includes("super-admin") → all; else assigned` |
| `canEdit` | `super \|\| (admin && assigned)` | `super \|\| (roles.includes("sales") && assigned)` |
| `canAccessLeads` / `canManageGroups` | `super \|\| admin` | `super \|\| roles.includes("sales")` |
| `canAccessDelivery` | `super \|\| delivery \|\| admin` | `super \|\| roles.includes("delivery")` |
| `canManageDelivery` | `super \|\| delivery` | `super \|\| roles.includes("delivery")` |
| `canManageHr` | `super \|\| hr` | `super \|\| roles.includes("hr")` |
| `assertSuperAdmin` (users/accounts admin, delete-year) | `role === "super-admin"` | `roles.includes("super-admin")` |

A small `hasRole(user, r)` / `isSuper(user)` helper centralises it. Note `admin`'s old delivery-view
is intentionally gone — delivery visibility now requires the `delivery` role in the stack.

**Flow-through:** `token.role` → `token.roles` (array); `next-auth.d.ts` and the session callback carry
it; the `jwt` callback resolves the user's role set in the DB read it already does for the session
store, so a role change applies on the next request. `~45 actor sites` change `role: user.role` →
`roles: user.roles`. **Three error-prone spots:**
- **`dashboard/page.tsx`** picks ONE view by role order → must show the **union** of panels the user's
  roles grant, or a `{sales, delivery}` user only sees the first.
- **`components/shell/sidebar.tsx`** — nav visibility becomes "any role grants this section".
- **`~14 DAL sites`** use `role === "super-admin"` as the "sees all accounts" proxy → `isSuper(user)`.

## 7. Admin UI

The single-select role `<select>` on each user row becomes a **small multi-select / checkbox set** of
the five roles (a user can tick several). The existing per-user **account assignment** UI now shows for
any user holding an account-scoped role (`sales` and/or `delivery`); it stays hidden for a pure
`super-admin` / `hr` / `viewer`. Saving takes effect on the target's next request (§6).

## 8. Testing

- **`lib/dal/authz.test.ts`** rewritten to run each `can*` against **role sets**, including stacks:
  `{sales, delivery}` grants both finance-edit and delivery-manage; `{hr}` grants neither.
- **Backfill equivalence (both directions):** each legacy single role → its one-element set reproduces
  **exactly** today's `can*` answers — no access gained or lost. `admin`'s set `{sales}` must equal
  old-admin access *except* the deliberately-removed delivery-view (asserted as the one intended diff).
- **Delivery scoping test:** a `delivery` user with accounts `{A}` sees A's programs and **not** B's;
  a `super-admin` sees both. Plus: the all-accounts safety backfill leaves an unassigned delivery user
  seeing everything (no regression).
- **Pre-deploy read-only check:** each of the 18 users' resolved role set reproduces their current
  access; every existing `delivery` user ends up either all-accounts-assigned or already scoped.
- **Browser:** a backfilled `sales` user sees exactly today's admin surface minus delivery; stacking
  `delivery` onto them makes the Delivery nav + their assigned universities' programs appear on next
  navigation (no re-login); a `delivery`-only user cannot reach finance.

## 9. Expand / contract for `users.role`

- **Expand (this work):** add `user_roles`, backfill, switch authz + display to the set. Display shows
  the user's roles (e.g. "Sales · Delivery"). `users.role` kept only as rollback seed, read by nothing.
- **Contract (tracked follow-up PR):** drop `users.role` once verified in production. Explicit task,
  not an orphan column.

## 10. Guards & risk

- **Last-super-admin guard:** the existing `superAdminCount()` generalises to "≥1 user whose role set
  includes `super-admin`"; block any change (unstacking, delete, deactivate) that would zero it.
- **Two failure modes:** *locked out* (guarded by §8's two-direction equivalence test + the §4
  delivery all-accounts backfill + the per-user pre-deploy check) and *over-granted* (same equivalence
  test — the split must grant no more than before; `sales` loses delivery-view by design, asserted).
- This still edits the authorization layer of a live app with real money data — smaller than the
  matrix, but the same category of risk, so the equivalence test gates the deploy.

## 11. Out of scope

- The capability matrix / editable roles / per-area read-write (§3 — rejected as overkill).
- Dropping `users.role` (the tracked contract PR, §9).
- Per-account *roles* (e.g. "sales for university X, delivery for university Y") — scope stays one
  per-user account list shared across the user's roles.
- HR account-scoping — HR is about employees, not universities.
