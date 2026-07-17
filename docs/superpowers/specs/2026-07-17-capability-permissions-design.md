# Role-Based Permissions (editable roles → capabilities)

**Date:** 2026-07-17
**Status:** Approved for implementation. User decisions: **editable roles** (a role owns a capability
set; editing it propagates to every holder), **one role per user** (a role held by any number of
people), **account/university access stays per-user**, **HR split into sub-actions** so "manage
attendance but not approve leave" is expressible, and **immediate effect**.
**Depends on:** the session store (PR #18) — its per-request DB read is what makes live propagation cheap.

> **Supersedes the earlier draft of this file**, which stored capabilities directly on each user and
> treated named roles as one-click UI "sugar". The user wants roles to be **first-class, editable,
> inherited**: change a role's permissions and every user holding it updates automatically. That is a
> stored Users → Role → Capabilities binding, not sugar. Rebuilt around it.

## 1. Problem

A user has **exactly one** hard-coded role (`super-admin` / `admin` / `hr` / `delivery` / `viewer`) —
a single enum column, checked everywhere as `role === X`. Three limits:

- **No cross-functional users.** Someone doing HR *and* Delivery must be `super-admin`, which also
  grants finance. No way to hold two hats without holding all of them.
- **No read-only-per-area, no partial-area.** "viewer" sees only the team board. You cannot express
  "sees finance but can't edit it", nor "HR person who manages attendance but can't approve leave".
- **Roles are baked into code.** Adding "Finance & Delivery Head" means an enum change and a deploy.
  The user wants to **create and edit roles at runtime**, and have edits apply to holders live.

## 2. The model

```
User ──(one)──▶ Role ──(many)──▶ Capabilities
     ╲
      ╲──(many)──▶ Accounts (universities they may touch)   [orthogonal, per-user]
```

- A **role** is a named row that owns a set of **capabilities**. Editable at runtime.
- A **user** holds **exactly one** role and inherits its capabilities. A role may be held by any
  number of users.
- **Editing a role's capabilities propagates to every holder on their next request** — because a
  user's effective capabilities are *resolved through their role*, never copied onto the user (§7).
- **University access is per-user** (the existing `userAccounts` table), orthogonal to the role: two
  people both holding "Finance Head" can cover different universities (§6).
- **Cross-functional = a custom role**, e.g. "Finance & Delivery Head". You don't stack roles; you
  make a role with both areas' capabilities.

## 3. Capabilities (17)

HR is split into sub-actions (the user's "manage attendance but not approve leave" case); the other
areas stay View/Manage where no finer signal exists. Adding sub-actions to another area later is
purely additive.

**Finance / Leads / Groups / Delivery / Users — View + Manage (Manage implies View):**

| Capability | `.view` | `.manage` adds |
| --- | --- | --- |
| `finance.*` | accounts, invoices, payments, reports (read); rollover setup under manage | edit accounts, record receipts, pay OEM, run rollover |
| `leads.*` | see the CRM pipeline | create / convert leads |
| `groups.*` | see the grouped profitability view | create / edit account groups |
| `delivery.*` | see programs, events, board | create / edit programs, log activities |
| `users.*` | see the user list & roles | create users, edit roles, reset passwords, assign roles |

**HR — split, because the sub-actions are independently meaningful:**

| Capability | Grants |
| --- | --- |
| `hr.view` | see HR dashboards, rosters, reports |
| `hr.attendance.manage` | upload / mark / edit others' attendance |
| `hr.leave.approve` | approve or reject others' leave requests |
| `hr.payroll.manage` | run and finalise payroll |

(Each maps to a real, separable surface — `/hr/attendance`, `/hr/leave`, `/hr/payroll` — with its own
DAL, so these gates are enforceable, not cosmetic.) **Each HR manage/approve sub-capability implies
`hr.view`** — you cannot manage attendance you cannot see — so a role with any HR manage sub-action
auto-includes `hr.view`, the same Manage-implies-View rule the other areas use.

**Standalone toggles (scope / danger, not read-vs-write):**

| Capability | Meaning |
| --- | --- |
| `accounts.all` | see **all** accounts, bypassing the per-user assigned-account scope (§6) |
| `accounts.create` | create brand-new accounts (super-admin-only today) |
| `year.delete` | delete an academic year (destructive, super-admin-only today) |

### The universal floor — self-service, everyone, no role needed

**Self-service** (acting on your *own* records) is available to **every authenticated user**, gated
by nothing:

- the **team board** (`/team`)
- **apply for / view own leave** (`/me/leave`)
- **view own payslips** (`/me/payslips`)
- **mark / view own attendance** (`/me/attendance`)

**Applying for leave is universal; approving it needs `hr.leave.approve`.** This fixes a live bug:
today the `proxy.ts` redirect sends `viewer` to `/team` for everything, so a viewer **cannot even
reach `/me/leave` to apply**. The self-service DALs are already scoped to the caller's own id
(`getEmployeeForUser(actor.id)`, `listMyRequests(user)` — verified), so a universal floor leaks
nobody else's data. The redirect generalises: a user whose role grants no area capabilities lands on
their self-service surface, never a dead end.

## 4. Seeded roles + the backfill

Roles are editable, but the system ships with a starter set. Two groups:

**(a) Backfill-equivalent roles — reproduce today's five roles exactly, so no existing user's access
changes on deploy.** This is the lockout guard's reference (§9).

| Seeds as role | Capabilities (must equal the legacy role's `authz.ts` answers exactly) |
| --- | --- |
| **Super Admin** *(system, protected)* | all 17 |
| **Finance Manager** *(← legacy `admin`)* | `finance.view/manage`, `leads.view/manage`, `groups.view/manage`, `delivery.view` *(no `accounts.all` — stays account-scoped)* |
| **HR Head** *(← legacy `hr`)* | `hr.view`, `hr.attendance.manage`, `hr.leave.approve`, `hr.payroll.manage` |
| **Delivery Manager** *(← legacy `delivery`)* | `delivery.view/manage` |
| **Employee** *(← legacy `viewer`)* | *(none — universal floor only)* |

**Backfill step:** create these five roles, then set each user's `role_id` to the role matching their
old `role` enum. Idempotent.

**(b) Extra ready-to-assign roles from the user's examples** (net-new; editable/deletable):

| Role | Capabilities |
| --- | --- |
| **Finance & Delivery Head** | `finance.view/manage`, `delivery.view/manage`, `accounts.all` |
| **Finance Head** | `finance.view/manage`, `accounts.all` — read+write finance, all universities |
| **HR User** | `hr.view`, `hr.attendance.manage` — **cannot approve leave**, exactly the user's example |

## 5. Storage

**Migration `0015_roles.sql`:**
- `capability` **pgEnum** over the 17 values.
- `roles` — `id` serial PK, `name` text NOT NULL UNIQUE, `is_system` boolean NOT NULL default false
  (protects seeded Super Admin from deletion / capability-stripping, §8), `created_at`.
- `role_capabilities` — `(role_id → roles.id ON DELETE CASCADE, capability)` composite PK; indexed on
  `role_id`.
- `users` += `role_id` integer, FK → `roles.id` **ON DELETE RESTRICT** (you can't delete a role while
  users hold it — the UI reassigns them first). Nullable during the expand phase (§8), then NOT NULL.
- Backfill (§4) runs in/after the migration.

`userAccounts` is unchanged (§6).

## 6. Account scope stays per-user and orthogonal

`userAccounts(user_id, account_id)` still governs *which* finance accounts a user sees. `accounts.all`
(a capability, so it lives on the role) bypasses it. So: **role = what you can do; `userAccounts` =
which universities you can do finance things to** (consulted only when the role lacks `accounts.all`).
Two "Finance Head" holders with different `userAccounts` rows see different universities — which is
why account access is per-user, not per-role (user's decision).

## 7. Authz — resolve through the role, live

`SessionUser` becomes `{ id, capabilities: Capability[] }`. The capabilities are **resolved from the
user's role**, so editing the role updates everyone holding it without touching user rows.

- `lib/dal/authz.ts` `can*` helpers become capability checks via a `has(user, cap)` helper:
  `canManageHr → has("hr.*")` per action; `canManageDelivery → has("delivery.manage")`;
  `canEdit → has("finance.manage") && (has("accounts.all") || assigned)`;
  `scopeAccountIds → has("accounts.all") ? all : assigned`. **Manage-implies-View is enforced at the
  grant boundary** so read checks test one capability.
- **`assertSuperAdmin` is overloaded — it must NOT collapse to one capability.** Each call site maps
  to a *different* one; a blanket mapping would, e.g., let a user-manager delete academic years:

  | `assertSuperAdmin` site | Correct capability |
  | --- | --- |
  | `lib/dal/user-admin.ts` (manage users, reset passwords, assign roles) | `has("users.manage")` |
  | `lib/dal/account-admin.ts` (account mutations) | `has("finance.manage")` (+ `accounts.create` on create) |
  | `lib/dal/rollover.ts:257` (delete academic year) | `has("year.delete")` |
  | `accounts/new` (create account) | `has("accounts.create")` |

- The `jwt` callback already reads the DB every request (session store). It resolves the user's role
  → capabilities in the **same round trip** and puts the array on the token. So a role edit, or a
  user's role reassignment, applies on their **next request** — no logout. `token.role` →
  `token.capabilities`; `next-auth.d.ts` and the session callback carry the array.
- `~45 mechanical actor sites` change `{ id, role }` → `{ id, capabilities }`. `~35 direct-comparison
  sites` each convert to the matching `has(...)`. **Three are error-prone and called out:**
  - **`dashboard/page.tsx`** picks ONE view by role order — must become additive (show every panel
    the user has View for), or a cross-functional user only sees their first-matched panel.
  - **`components/shell/sidebar.tsx`** — nav visibility becomes per-capability.
  - **`~14 DAL sites`** use `role === "super-admin"` as a proxy for "unrestricted account scope" →
    each becomes `has("accounts.all")`, not an identity check.

## 8. Not locking everyone out — guards

- **Super Admin role is `is_system`:** cannot be deleted, and cannot have `users.manage` removed
  (that check lives in the role-edit DAL). Losing it would strip the ability to manage roles/users.
- **Last-admin guard:** the existing `superAdminCount()` generalises to "at least one **enabled user**
  whose role includes `users.manage`" — block any edit (role capability change, role reassignment,
  user delete/deactivate) that would drop that count to zero.
- **`ON DELETE RESTRICT`** on `users.role_id`: a role can't be deleted out from under its holders; the
  UI forces reassignment first.

## 9. Expand / contract for the old `role` column

The legacy `users.role` enum still feeds display and the backfill. Rather than leave it to rot (the
drift that produced the orphan `password_changed_at`):

- **Expand (this work):** add `roles` / `role_capabilities` / `users.role_id`, backfill, switch all
  authz + display to the role/capability model. Display now shows **`role.name`** directly (roles are
  named rows — no derived badges needed). `role` stays only as a rollback seed, read by nothing.
- **Contract (tracked follow-up PR):** once verified in production, drop `users.role`. Explicit task,
  not an orphan.

## 10. Admin UI — two surfaces

**Manage roles** (`/admin/roles`, needs `users.manage`): list roles; create/rename/delete (delete
blocked while held); an **editable capability grid per role** — six areas (Finance/Leads/Groups/
Delivery/Users as View+Manage, HR as its four sub-toggles) plus the three standalone toggles. Saving
a role's grid is the "propagates to all holders" moment. The seeded roles (§4) appear here, editable;
Super Admin shows its protections (can't delete, can't drop `users.manage`).

**Assign role** (on each user row in `/admin/users`): a single-select of roles (replacing the old
role `<select>`), plus the existing per-user university assignment. Saving takes effect on the
target's next request (§7).

There is no separate "presets" concept — **the roles *are* the presets**, now first-class and
editable, exactly as the user asked.

## 11. Testing — the lockout guard is non-negotiable

- **`lib/dal/authz.test.ts`** rewritten to assert `can*` against capability sets.
- **Backfill-equivalence test (both directions):** for each of the five legacy roles, the seeded
  role's capabilities make every `can*`/`assert*` return **exactly** what the legacy role returned —
  no less (nobody loses access) **and no more** (nobody is silently over-granted).
- **Live-propagation test:** a user holding role R; add a capability to R; the user's next resolved
  capability set includes it **without** touching the user row — proving inheritance, not copy.
- **Role DAL tests:** create/rename/delete-blocked-while-held; can't delete Super Admin; can't strip
  `users.manage` from Super Admin; last-`users.manage` guard.
- **Pre-deploy production check (read-only):** every one of the 18 users' resolved capabilities
  reproduces their current effective access. Driven, not assumed.
- **Browser:** a backfilled Finance Manager sees exactly today's surface; editing that role to add
  `delivery.manage` makes delivery edit controls appear for **all** its holders on next navigation
  (no re-login); an HR User can open `/hr/attendance` but the leave-approve control is absent; any
  user can reach `/me/leave` to apply.

## 12. Out of scope

- **Dropping the legacy `role` column** — the tracked contract PR (§9).
- **Per-account capabilities** ("manage finance for university X only"). Scope stays the coarse
  per-user `userAccounts` grain.
- **Multiple roles per user** — explicitly rejected; cross-functional = a custom role.
- **A role/permission audit log** — grants are `console.info`'d like the other security actions.

## 13. Risk

This rewrites the authorization layer of a live app with real users and money. Two failure modes:
**someone locked out** and **someone over-granted** — both caught by §11's two-direction
backfill-equivalence test plus the per-user pre-deploy check. Plus a new one this model introduces:
**a bad role edit hits every holder at once** (that's the feature). Mitigated by the §8 guards (system
role, last-admin, delete-restrict) and by role edits being reversible — re-editing the role restores
access on the next request, since nothing was copied onto users.
