# Audit Log (base entity + triggers) and Bill Deletion

**Date:** 2026-07-20
**Status:** Approved for implementation.
**Supersedes:** the interim idea of a one-off `bill_deletions` table — the generic audit log replaced it during design.

## Problem

Two asks, one foundation:

1. **Bills (invoices) get created accidentally or need changes later.** Today only `draft` invoices
   can be deleted (`deleteDraftInvoice`); finalized bills are immortal. The user wants to delete any
   bill, with its payments going with it, behind a confirmation dialog that lists exactly what will
   be erased.
2. **No record of who did what.** Deleting financial history with no trace is unacceptable, and the
   user chose to generalize: an audit table that tracks *all* key CRUD operations (user creation,
   account creation, bill/payment changes, …) — not just bill deletions.

## User decisions (recorded)

- Bill delete = **hard delete + audit trail** (not soft-delete/void).
- **Any status** deletable (draft / raised / partially-paid / paid / overdue).
- **Super Admin only** may delete bills (not sales-with-assignment).
- Audit capture = **Postgres triggers**, coverage = **all CRUDs**, with an **in-app viewer now**.
- The trigger/actor conflict (below) is resolved by the user's own proposal: a **base entity** with
  `created_at / updated_at / created_by / updated_by / version` on every table, which the triggers read.

## The constraint that shaped the design

Production uses the **neon-http driver: no transactions, no session state** (each statement is a
stateless HTTP request — see the notes in `lib/dal/user-admin.ts:161` and `lib/db/client.ts`). A
trigger can always capture *what* changed, but the conventional way to tell it *who* (a per-request
`SET app.actor_id`) cannot work: session variables don't survive between stateless requests.

**Resolution:** the actor rides *inside the mutation statement itself* as ordinary columns
(`created_by` / `updated_by`). The audit trigger reads `NEW.updated_by`. Statelessness stops
mattering. This is why the base entity isn't cosmetic — it is the actor-delivery mechanism.

## Architecture

### 1. Base entity columns (every table)

A shared Drizzle spread helper, included by all 25 domain tables:

| column | type | notes |
|---|---|---|
| `created_at` | timestamptz NOT NULL default now() | 12 tables already have it; kept as-is there |
| `updated_at` | timestamptz NOT NULL default now() | maintained by trigger, never by app code |
| `created_by` | int NULL → `users.id` ON DELETE SET NULL | NULL = unknown (pre-migration rows, scripts) |
| `updated_by` | int NULL → `users.id` ON DELETE SET NULL | the actor; app supplies it on every write |
| `version` | int NOT NULL default 1 | incremented by trigger on every update |

Nullable `_by` is deliberate: existing rows have no known author; seed/import scripts have no user;
`users.created_by` is self-referential at bootstrap. Existing rows in tables that lack
`created_at` get the migration timestamp (the standard, slightly-false default) with `created_by`
NULL as the honest "unknown".

### 2. Trigger functions (one migration, two functions, attached per table)

- **`stamp_row()`** — `BEFORE UPDATE` on every audited table:
  `NEW.updated_at = now(); NEW.version = OLD.version + 1;`. The app never touches these two.
- **`audit_row()`** — `AFTER INSERT OR UPDATE OR DELETE`, row-level, on every audited table.
  Writes one `audit_log` row using `TG_TABLE_NAME` / `TG_OP`:
  - `actor_id` = `NEW.updated_by` (INSERT/UPDATE) or `OLD.updated_by` (DELETE)
  - `before` = `to_jsonb(OLD)` (UPDATE/DELETE), `after` = `to_jsonb(NEW)` (INSERT/UPDATE)

Both created with `CREATE OR REPLACE FUNCTION`; triggers via `DROP TRIGGER IF EXISTS … ; CREATE
TRIGGER …` so the migration is idempotent and re-runnable (house rule for enum/DDL migrations).

### 3. `audit_log` table

| column | type |
|---|---|
| `id` | bigserial PK |
| `at` | timestamptz NOT NULL default now() |
| `table_name` | text NOT NULL |
| `op` | text NOT NULL — `INSERT` / `UPDATE` / `DELETE` |
| `row_id` | text — the row's `id`, stored as text so it survives the row's deletion |
| `actor_id` | int NULL → `users.id` ON DELETE SET NULL |
| `before`, `after` | jsonb |

Indexes: `(table_name, at DESC)`, `(actor_id, at DESC)`. Append-only; no retention policy in v1
(volumes here are tiny). **No triggers on `audit_log` itself** (no recursion).

### 4. App-side stamping (the only duty mutations have)

- **INSERT:** include `createdBy: actor.id, updatedBy: actor.id`.
- **UPDATE:** include `updatedBy: actor.id` in `.set({...})`.
- **DELETE:** **stamp-then-delete** — `UPDATE … SET updated_by = actor.id` then `DELETE`, so the
  delete trigger's `OLD.updated_by` is the deleter, not the last editor. Non-atomic on neon-http;
  benign failure mode (a failed delete leaves only a touched `updated_by`/version). A small DAL
  helper (`stampedDelete(table, id, actorId)`) keeps this one idiom in one place.
- Most DAL mutations already receive `SessionUser`; the handful that don't (e.g. parts of
  `lib/dal/tasks.ts`) get an `actor` parameter threaded in — same motion as the roles[] refactor.

**Cascades:** `ON DELETE CASCADE` fires child-table triggers, so cascaded rows ARE audited. Their
`OLD.updated_by` is only correct if stamped first. `deleteBill` explicitly stamps its payments and
cohorts before deleting the invoice, so the whole cascade carries the right actor. Deep, rare
cascades (whole-account delete) stamp only the root; descendants' audit rows then show a stale/NULL
actor, correlated by timestamp — an accepted, documented trade-off.

### 5. Audited-table skiplist

Everything is audited **except**:

- `audit_log` — recursion.
- `auth_sessions` — one row per login/logout; pure noise with zero forensic value.
- `attendance_punches` — row-level only. One biometric import writes hundreds of punch rows; the
  meaningful, audited event is the `attendance_uploads` row (which IS audited).

### 6. Coverage enforcement (structural, not disciplinary)

An integration test introspects `information_schema` / `pg_trigger`: **every** public table not on
the skiplist must have all five base columns AND both triggers, else the test fails. New tables
can't silently skip auditing. (Forgetting `updatedBy` in an update statement is softer: the event is
still captured, the actor shows the previous editor. Mitigated by the helper + review; not
perfectly preventable without transactions. Named trade-off.)

### 7. Viewer — `/admin/audit` (PR 2)

Super-Admin only (same gate as `/admin/users`). Newest-first, paginated (50/page). Filters: table,
actor, op, date range. Each entry expands to a changed-fields diff computed from `before`/`after`
(keys whose values differ), with `INSERT` showing the new row and `DELETE` the erased one. DAL:
`listAuditEntries(actor, filters, page)` — one filtered query + `users` join for actor names; no N+1.

### 8. Bill deletion (PR 3 — the original feature, now thin)

- **DAL `deleteBill(actor, accountId, invoiceId)`**: `assertSuperAdmin` → verify the invoice exists
  and belongs to `accountId` → stamp invoice + its payments + its cohorts → delete the invoice
  (payments/cohorts cascade; every row audited with the right actor).
- **DAL `getBillDeletionPreview(actor, accountId, invoiceId)`**: the confirmation-dialog payload —
  every payment (direction, amount, paid-on, mode, ref), per-direction totals (receipts vs
  OEM payments), cohort count. Two queries max.
- **UI**: a Delete action per bill (rendered only for Super Admins — the page already knows
  `user.roles`) opening a modal: “Deleting this bill permanently deletes it and everything below —
  N payment entries (listed) and M cohort rows. This cannot be undone.” Confirm → server action →
  revalidate. The existing draft-only delete button is subsumed by this (draft bills simply show an
  empty payment list in the dialog).
- `deleteDraftInvoice` is retired in favor of `deleteBill` (one code path; the status check drops
  away since any status is deletable).

## Data-safety guarantee (user's explicit concern)

The foundation migration **changes no existing data**: it adds columns (new values only), an empty
table, and triggers that fire only on future writes. No row is updated or deleted; no existing
column value is read or rewritten. The money engine reads none of the new columns.

**Proof before prod:** run the migration locally, then diff the full `/reports` page and the XLSX
export before vs. after — must be byte-identical. Full test suite runs on the migrated schema.
Only then does a merge trigger the (same, idempotent) migration in production via `vercel-build`.

## Rollout — three stacked PRs

1. **Foundation**: migration (columns + `audit_log` + functions + triggers), Drizzle base-column
   helper, actor stamping across all DAL mutations, `stampedDelete` helper, coverage test, report
   byte-parity verification. *(Biggest PR — touches every mutation site, changes no behavior.)*
2. **Viewer**: `/admin/audit` page + `listAuditEntries` DAL + nav entry (Admin group).
3. **Bill delete**: `deleteBill` + preview DAL + confirmation modal + action; retire
   `deleteDraftInvoice`.

Each PR: spec→plan→implement→strict review→merge, per house process.

## Out of scope

- Undo/restore (hard delete is final; the audit row is the safety net).
- Retention/pruning of `audit_log` (revisit if volume ever matters).
- Optimistic-locking enforcement using `version` (the column exists; enforcing concurrency
  semantics app-wide is its own project).
- Auditing reads. Log-in/out events (`auth_sessions` is skiplisted).
- A “who last touched this” UI on entity pages (the columns make it possible later).

## Testing

- **Foundation**: coverage introspection test (columns + triggers on every non-skiplisted table);
  stamp behavior (update bumps `version`/`updated_at`, keeps `created_*`); audit rows written with
  correct op/actor/before/after for insert, update, stamped delete, and cascaded delete; report
  byte-parity before/after migration.
- **Viewer**: filter correctness (table/actor/op/date), pagination, super-admin gate.
- **Bill delete**: non-super rejected; wrong-account invoice rejected; delete removes invoice +
  payments + cohorts; audit rows exist for all cascaded rows with the deleting actor; preview
  payload matches the payments actually deleted; report totals drop by exactly the deleted bill's
  contribution.
