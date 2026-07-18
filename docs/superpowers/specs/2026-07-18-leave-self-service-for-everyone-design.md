# Leave Self-Service for Everyone

**Date:** 2026-07-18
**Status:** Approved for implementation.
**Depends on:** the stackable-roles PR (#22) — its `proxy.ts` self-service floor is what lets a
`viewer` reach `/me/*` at all; without it this change only helps non-viewers.

## Problem

Applying for or viewing leave requires an `employee_profiles` row (`leave_requests.employeeId` →
`employee_profiles.id`). The admin "Create user" flow does **not** create a profile, so any user added
as an app user (a finance/sales person, or anyone) is redirected off `/me/leave` — they can't apply
for or check their own leave. The user wants this to work for **everyone**.

Local reality: 17/20 users already have a profile; the 3 without are two synthetic test accounts and
one real user. So the fix targets the minority and all future users.

## Approach (user's choice): auto-provision on first access

A user with **no** employee profile gets a minimal one created the first time they open a `/me/*`
self-service page, so they can immediately apply for and check leave. No migration, no backfill —
provisioning is lazy and idempotent.

- **`getOrCreateEmployeeForUser(userId)`** (new, in `lib/dal/hr/leave.ts` beside `getEmployeeForUser`):
  1. If an **active** profile exists → return it.
  2. Else if **any** profile exists (i.e. an *inactive* one) → return `null`. An inactive profile
     means a deactivated employee (they left); do not reactivate them by provisioning. The page's
     existing redirect still fires for this case — intended.
  3. Else → insert a minimal profile and return it.
- **Minimal insert:** `{ userId, employeeCode: "U${userId}" }`. Every other column has a default
  (`status` → `active`, salary/deductions → 0/₹200 PT, `altCodes` → `[]`, off-days → defaults). The
  `U`-prefixed code is collision-free (`userId` is unique) and visibly distinct from HR's roster codes
  (`DG008`, `TH095`). Race-safe via `onConflictDoNothing()` on the unique `user_id`, then re-read.
- **Balances degrade gracefully:** the leave view lists every active leave type; a fresh profile with
  no `leave_balances` rows shows the type's `annualEntitlement` as the total, with **0 accrued/
  remaining** until the monthly accrual runs — which is correct for a just-provisioned employee, not a
  gap. They can still submit requests (the apply form is fully functional; HR approves).

## Wiring

All three self-service entry points provision, so a user isn't provisioned by one page and bounced by
another:

- **`/me/leave`** — swap `getEmployeeForUser` → `getOrCreateEmployeeForUser`; keep `if (!me) redirect`
  (now only fires for deactivated employees).
- **`/me/attendance`, `/me/payslips`** — call `getOrCreateEmployeeForUser(user.id)` before their
  existing `isEmployee` check; provisioning makes that check pass for active/new users, and leaves it
  failing (→ redirect) only for deactivated ones.

## Accepted consequence

Auto-created profiles appear in HR's roster at ₹0 salary (they *are* the roster). Harmless: a ₹0
profile yields a ₹0 payslip; HR can set a real salary for anyone payroll-tracked. This is the
trade-off the user accepted for "everyone is an employee".

## Testing

`lib/dal/hr/leave.test.ts` (integration, throwaway users):
- a user with no profile → `getOrCreateEmployeeForUser` creates an **active** profile with code
  `U<id>`, and a second call returns the same one (idempotent, no duplicate).
- a user with an **inactive** profile → returns `null`, creates nothing (deactivated stays out).
- a user with an active profile → returns it unchanged, creates nothing.
- after provisioning, the user can create a leave request (the `employeeId` resolves).

Browser: sign in as a profile-less user, open `/me/leave`, confirm the leave view loads (not a
redirect) with default balances and an apply form.

## Out of scope

- Backfilling existing profile-less users (lazy provisioning covers them on first visit).
- Changing `createUser` to eagerly create a profile (lazy is enough; eager would fill the roster
  before anyone uses leave).
- Any change to leave entitlements/accrual — a new profile inherits leave-type defaults.
