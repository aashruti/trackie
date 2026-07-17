# Capability-Based Permissions

**Date:** 2026-07-17
**Status:** Approved for implementation (user chose the full capability grid over role-stacking;
immediate effect; View/Manage per area; Create-account and Delete-year as separate toggles)
**Depends on:** the session store (PR #18) — its per-request DB read is what makes immediate effect cheap

## 1. Problem

A user has **exactly one** role (`super-admin` / `admin` / `hr` / `delivery` / `viewer`) — a single
enum column, and every permission check is `role === X`. The roles are mutually exclusive, so:

- **No cross-functional users.** Someone who does both HR and Delivery must be `super-admin`, which
  also grants finance. There is no way to hold two hats without holding all of them.
- **No read-only-per-area.** "viewer" sees only the team board. There is no "sees finance but can't
  edit it" — View and Manage are welded together inside each role.

The user wants per-user, per-area control: each area independently **View** (read-only) or **Manage**
(read + write), any combination, toggled per person.

## 2. The model

Every area exposes two capabilities — **View** and **Manage** — where **Manage implies View**
(granting Manage confers read access; you never grant Manage without View). Plus three standalone
toggles that are about *scope* or *danger*, not read-vs-write.

### The 15 capabilities

**View/Manage pairs (one per area):**

| Area | `.view` grants | `.manage` additionally grants |
| --- | --- | --- |
| `finance` | accounts, invoices, payments, reports (read); includes new-year rollover setup under manage | edit accounts, record receipts, pay OEM, run rollover |
| `leads` | see the CRM pipeline | create / convert leads |
| `groups` | see the grouped profitability view | create / edit account groups |
| `hr` | see attendance, leave, payroll | mark attendance, approve leave, run payroll |
| `delivery` | see programs, events, board | create / edit programs, log activities |
| `users` | see the user list | create users, reset passwords, assign capabilities |

**Standalone toggles:**

| Capability | Meaning | Why not View/Manage |
| --- | --- | --- |
| `accounts.all` | see **all** accounts, bypassing the assigned-account scope | it's a *scope* modifier, orthogonal to read/write (see §6) |
| `accounts.create` | create brand-new accounts | super-admin-only today — stricter than editing existing ones, so kept a separate grant (user's call) |
| `year.delete` | delete an academic year | destructive, irreversible, super-admin-only — kept behind a deliberate danger toggle (user's call) |

### The universal floor — self-service, available to everyone

Some surfaces are **self-service**: a person acting on *their own* records. These are available to
**every authenticated user**, gated by nothing, because acting on your own data needs no grant:

- the **team board** (`/team`)
- **apply for / view own leave** (`/me/leave`)
- **view own payslips** (`/me/payslips`)
- **mark / view own attendance** (`/me/attendance`)

The HR capabilities gate only the **management** surface (`/hr/*`) — approving others' leave, running
payroll, seeing everyone's attendance. The split is *self-service vs. management*: **applying for
leave is universal; approving it needs `hr.manage`.** The same shape applies wherever a `/me/*`
self-view mirrors an `/hr/*` management view.

**This fixes a current bug.** Today the `proxy.ts` redirect sends `viewer` to `/team` for everything,
so a viewer **cannot even reach `/me/leave` to apply** — the page has no gate of its own, only the
blanket redirect blocks it. Under this model the redirect generalises: a user with no area
capabilities lands on their self-service surface, never a dead end, and can always apply for their own
leave.

## 3. Backfill — the highest-stakes part of this whole change

18 real people are in production with existing roles. **A wrong backfill row locks someone out of
production on deploy.** Each current role maps to exactly these capabilities, chosen to reproduce
today's `authz.ts` matrix precisely:

| Current role | Capabilities granted |
| --- | --- |
| **super-admin** | Manage on all six areas + `accounts.all` + `accounts.create` + `year.delete` (everything) |
| **admin** | `finance.view`, `finance.manage`, `leads.view`, `leads.manage`, `groups.view`, `groups.manage`, `delivery.view` |
| **hr** | `hr.view`, `hr.manage` |
| **delivery** | `delivery.view`, `delivery.manage` |
| **viewer** | *(none — team board only)* |

Note the deliberate asymmetries, each reproducing a current rule:
- `admin` gets `delivery.view` but **not** `delivery.manage` (`canAccessDelivery` includes admin;
  `canManageDelivery` does not).
- `admin` gets neither `accounts.all` (admins are account-scoped) nor `accounts.create` nor `users.*`
  (the users page is super-admin-only) nor `year.delete`.
- `admin` **does** get `finance.manage`, which includes new-year rollover — matching `new-year` being
  `super || admin` today.

**The migration must assert, per user, that the derived capability set reproduces every
`authz.ts`/`can*` answer the user's old role gave.** This is a test, not a hope — see §9.

## 4. Storage

**Migration `0015_user_capabilities.sql`** — a `capability` pgEnum over the 15 values, and a
`user_capabilities` join table `(user_id, capability)` with a composite PK, `ON DELETE CASCADE` on
`user_id`, indexed on `user_id`. This mirrors the existing `userAccounts` join-table pattern exactly.

Backfill runs **in the migration** (or a one-shot invoked by it): read each user's `role`, insert the
mapped rows. Idempotent (`ON CONFLICT DO NOTHING`).

## 5. Authz rewrite

**`lib/dal/authz.ts`** is the hub. `SessionUser` changes from `{ id, role }` to
`{ id, capabilities: Capability[] }` (an array; membership tested with `.includes`). Every `can*`
helper becomes a capability check:

| Helper | Was | Becomes |
| --- | --- | --- |
| `canManageHr` | `super \|\| hr` | `has("hr.manage")` |
| `canAccessDelivery` | `super \|\| delivery \|\| admin` | `has("delivery.view")` |
| `canManageDelivery` | `super \|\| delivery` | `has("delivery.manage")` |
| `canAccessLeads` | `super \|\| admin` | `has("leads.view")` |
| `canManageGroups` | `super \|\| admin` | `has("groups.manage")` |
| `canEdit` | `super \|\| (admin && assigned)` | `has("finance.manage") && (has("accounts.all") \|\| assigned)` |
| `scopeAccountIds` | `super → all; else assigned` | `has("accounts.all") → all; else assigned` |

**`assertSuperAdmin` is overloaded and must NOT collapse to one capability.** It currently gates three
different things, and each maps to a *different* capability — mapping them all to `users.manage` would,
for example, let a user-manager delete academic years:

| `assertSuperAdmin` call site | Correct capability |
| --- | --- |
| `lib/dal/user-admin.ts` (create/edit users, reset passwords, roles) | `has("users.manage")` |
| `lib/dal/account-admin.ts` (account-admin mutations) | `has("finance.manage")` — with `accounts.create` for the create path |
| `lib/dal/rollover.ts:257` (delete academic year) | `has("year.delete")` |
| `accounts/new` (create account) | `has("accounts.create")` |

Each call site is converted to its specific capability; there is no blanket `assertSuperAdmin`
replacement.

A small helper `has(user, cap)` centralises the check, and **Manage-implies-View is enforced at the
grant boundary** (granting `x.manage` always co-grants `x.view`), so read checks never have to test
both.

`~45 mechanical actor sites` change from `{ id, role: user.role }` to
`{ id, capabilities: user.capabilities }`. `~35 direct-comparison sites` (listed in the exploration
map) each convert to the matching `has(...)`. The three riskiest, called out because a mechanical
find-replace would get them wrong:

- **`dashboard/page.tsx`** picks ONE view by role order (`hr` before `delivery` before finance). A
  user with several areas would silently get only the first. This must become additive — show every
  panel the user has View for.
- **`components/shell/sidebar.tsx`** — nav visibility per area becomes per-capability; the natural fit.
- **`~14 DAL sites`** use `role === "super-admin"` as a proxy for "unrestricted account scope". Each
  becomes `has("accounts.all")`, not an identity check.

## 6. Account scope stays orthogonal

`userAccounts` still governs *which* finance accounts a scoped user sees. `accounts.all` is the
capability that bypasses it — exactly as `super-admin` does today. So the model stays two-dimensional:
**capabilities = what you can do; `userAccounts` = which accounts you can do finance things to** (only
relevant when you lack `accounts.all`).

## 7. Immediate effect (user's choice)

The `jwt` callback already reads the DB every request (the session store's `sessionExists`). It will
read the user's capabilities in the **same round trip** and put them on the token, so a capability
change applies on the user's **next request** — no logout, no forced sign-out.

This is the payoff of the session-store work: a month ago, capabilities cached in the JWT would have
needed a re-login (or the forced-logout hammer) to refresh. Now it's one extra column on a query we
already run. `token.role` is replaced by `token.capabilities`; `next-auth.d.ts` and the session
callback change to carry the array.

## 8. Display — `role` becomes derived, then dropped

`role` currently drives display (user menu, badges, topbar). After this it governs nothing. Rather
than leave a vestigial column (the exact drift that produced the orphan `password_changed_at`), this
uses a deliberate **expand/contract**:

- **Expand (this PR):** add `user_capabilities`, backfill from `role`, switch all authz + display to
  capabilities. The user card shows derived area badges (e.g. "Finance · Delivery · HR"). `role` stays
  in the DB **only** as a rollback seed, read by nothing.
- **Contract (tracked follow-up, separate PR):** once verified in production, a migration drops the
  `role` column. This is an explicit, tracked task — not an orphan — closed out deliberately.

## 9. Testing — the lockout guard is non-negotiable

- **`lib/dal/authz.test.ts`** is rewritten: every `can*` assertion now runs against capability sets
  instead of roles. The existing 20 role-based cases become the reference for the backfill.
- **A backfill-equivalence test:** for each of the five legacy roles, assert that
  `capabilitiesFor(role)` makes every `can*`/`assert*` return exactly what the role returned. This is
  the test that proves nobody's access silently changes.
- **A production-safety step in the plan:** before deploy, run a read-only check that every one of the
  18 users' derived capabilities reproduce their current effective access. Driven, not assumed.
- **Browser verification:** a backfilled `admin` sees exactly the finance/leads/groups/delivery-view
  surface they see today; granting that same user `delivery.manage` makes the delivery edit controls
  appear on the **next navigation**, no re-login (proving §7); a `hr`-only user still can't reach
  finance.

## 10. Admin UI

The single-select role `<select>` on each user row becomes a **grouped capability grid**: six areas
each with View/Manage (Manage auto-checks View), plus the three standalone toggles in a small "Access
scope & danger" group. Changes save through the existing `updateUser*` action shape and, per §7, take
effect on the target's next request.

### 10a. Presets (predefined roles)

A row of **preset buttons** sits above the grid. Clicking one **applies** its capability set to the
tick-boxes; the admin can then adjust individual toggles before saving. **A preset is UI sugar — a
one-click tick-pattern — not a stored binding.** The backend stores only the resulting capabilities,
so there is exactly one source of truth (the grid); a preset never competes with it. This is the
deliberate reason presets do *not* reintroduce the hybrid model's two-concepts problem.

The presets are defined once, as capability sets, and are the same bundles the backfill uses — so a
preset named "Finance Admin" grants exactly what today's `admin` role does:

| Preset | Capabilities |
| --- | --- |
| **Super Admin** | everything (all 15) |
| **Finance Admin** | `finance.view/manage`, `leads.view/manage`, `groups.view/manage`, `delivery.view` — today's `admin` |
| **Finance (read-only)** | `finance.view`, `leads.view`, `groups.view`, `delivery.view` — the view-only person the old model couldn't express |
| **HR Manager** | `hr.view/manage` |
| **Delivery Manager** | `delivery.view/manage` |
| **Employee** | *(none — universal floor only: team board + self-service)* — today's `viewer` |

Because presets and the backfill share one definition (`PRESETS` in the capability module), they
can't drift: the backfill in §3 is literally "apply the preset that matches each legacy role."

**Preset ≠ label.** Applying "HR Manager" then ticking `delivery.view` is fine — the user simply has
those capabilities; they are not "an HR Manager with an exception". The card shows derived area badges
(§8), not a preset name, so there is nothing to go stale.

## 11. Out of scope

- **Dropping the `role` column** — deliberately deferred to the contract PR (§8), tracked.
- **Per-account capabilities** (e.g. "manage finance for account X only"). Scope stays at the coarse
  `userAccounts` grain; capabilities are global to the user.
- **A capability audit log.** Grants are `console.info`'d like the other security actions.

## 12. Risk

This rewrites the authorization layer of a working app with real users and money. The two failure
modes that matter: **someone locked out** (guarded by §9's backfill-equivalence test + the pre-deploy
per-user check) and **someone over-granted** (guarded by the same equivalence test — the backfill must
grant *no more* than the old role, not just *no less*). Both are caught by asserting exact equivalence,
in both directions, before deploy.
