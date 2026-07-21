import "server-only";
import { and, desc, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { auditLog, users } from "@/lib/db/schema";
import {
  AUDIT_ACTOR_NONE,
  AUDIT_REDACTED_COLUMNS,
  redactedColumnsFor,
  tableHasRedactedColumn,
  type AuditActorFilter,
} from "@/lib/audit-view";
import { UserError } from "./errors";
import { type SessionUser } from "./authz";

/**
 * Read side of the audit trail — the `/admin/audit` viewer (spec §7).
 *
 * Deliberately NOT in lib/dal/audit.ts: that file is the WRITE-side idiom
 * (stampedDelete / stampedDeleteWhere, which exist so DELETE triggers capture
 * the right actor). This one only reads. Keeping them apart keeps
 * `server-only` write helpers from being pulled into read paths and keeps each
 * file's concern legible.
 */

function assertSuperAdmin(user: SessionUser): void {
  // UserError (not bare Error) so the server action surfaces this message
  // verbatim — "you lack the role" is exactly the kind of thing the user
  // should read, unlike an internal driver error.
  if (!user.roles.includes("super-admin")) {
    throw new UserError("The audit log is available to Super Admins only");
  }
}

export type AuditOp = "INSERT" | "UPDATE" | "DELETE";

/** A jsonb row image as the triggers write it: snake_case column → value. */
export type AuditRowImage = Record<string, unknown>;

// Defined in the client-safe module (the filter bar needs the sentinel too) and
// re-exported here so server-side callers keep a single import site.
export {
  AUDIT_ACTOR_NONE,
  AUDIT_REDACTED_COLUMNS,
  redactedColumnsFor,
  tableHasRedactedColumn,
  type AuditActorFilter,
};

export interface AuditFilters {
  /** Exact `audit_log.table_name`, e.g. "invoices". */
  tableName?: string;
  /**
   * Exact actor id, or {@link AUDIT_ACTOR_NONE} for rows with no actor at all.
   * A numeric id never matches NULL-actor rows, and vice versa — the two are
   * disjoint, and together they cover the log.
   */
  actorId?: AuditActorFilter;
  op?: AuditOp;
  /**
   * Inclusive lower bound, as a plain `YYYY-MM-DD` calendar day — NOT a Date.
   *
   * `audit_log.at` is `timestamp without time zone` holding the DATABASE's
   * local wall clock. A JS `Date` cannot express that: drizzle binds one via
   * `.toISOString()`, i.e. in UTC, so `new Date("2026-07-20T00:00:00.000")`
   * (Node-local midnight) arrives as `2026-07-19 18:30:00` at an Asia/Kolkata
   * database, and the filter quietly returns the wrong day — measured here,
   * 5,732 rows for "20 Jul" when 14,518 occurred, plus 5.5h of the 19th
   * wrongly included. The skew vanishes wherever Node's TZ happens to equal
   * the DB's (Vercel/Neon are both UTC), which is exactly what kept it latent
   * in production.
   *
   * So the bound travels as the calendar day the reader actually picked and is
   * compared against `at::date` in SQL, where "the day" means the same thing on
   * both sides. See {@link buildWhere}.
   */
  from?: string;
  /** Inclusive upper bound, as a plain `YYYY-MM-DD` calendar day. See {@link AuditFilters.from}. */
  to?: string;
}

export interface FieldChange {
  /** The column name as the trigger recorded it (snake_case). */
  key: string;
  /** Value before the change; `undefined` when the key did not exist before. */
  before: unknown;
  /** Value after the change; `undefined` when the key no longer exists. */
  after: unknown;
}

export interface AuditEntry {
  id: number;
  at: Date;
  tableName: string;
  op: AuditOp;
  /** NULL for composite-PK tables (user_roles, user_accounts, …). */
  rowId: string | null;
  /**
   * NULL for system/script writes. Survives the named user's deletion —
   * audit_log.actor_id deliberately has no FK (schema.ts:693).
   */
  actorId: number | null;
  /**
   * NULL when the actor is NULL *or* when the actor row no longer exists.
   * The UI must render "unknown" / "user #<actorId>" — never invent a name.
   */
  actorName: string | null;
  before: AuditRowImage | null;
  after: AuditRowImage | null;
  /**
   * The diff, over the changed-key set POSTGRES computed — see
   * {@link fieldChangesForKeys} and {@link listAuditEntries}.
   */
  changedFields: FieldChange[];
  /**
   * True for an UPDATE that recorded an attribution change and nothing else,
   * with a real actor id — NOT for the identically-shaped row that
   * `ON DELETE SET NULL` leaves on a surviving one. A description of the row,
   * not a diagnosis of what produced it. Presentation hint only — see
   * {@link isStampOnlyUpdate}.
   */
  isStampOnly: boolean;
  /**
   * True for an UPDATE whose only VISIBLE change is attribution, but which the
   * database stamped as a real edit, ON A TABLE THAT OWNS A REDACTED COLUMN —
   * meaning the column that changed is one `audit_row()` strips. A password
   * change lands here. See {@link isRedactedOnlyUpdate}.
   *
   * This is the opposite of noise: the value is (rightly) unrecoverable, but
   * the EVENT — someone changed a credential or a regulated identifier on this
   * row, at this time — is the highest-signal thing the log records. The viewer
   * must say so rather than render a bare `updated_at`/`version` diff, and must
   * never fold it away.
   */
  isRedactedOnly: boolean;
  /**
   * The SAME diff shape on a table with NO redactable column — where the
   * credential inference is simply unavailable. See {@link isPreGuardStampUpdate}.
   */
  isPreGuardStamp: boolean;
}

export interface AuditPage {
  entries: AuditEntry[];
  /** 1-based. */
  page: number;
  pageSize: number;
  /** Whether a page `page + 1` exists. */
  hasMore: boolean;
}

export const AUDIT_PAGE_SIZE = 50;

/** Structural equality for JSON values (jsonb round-trips as fresh objects, so `===` is useless). */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => jsonEqual(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  // Key ORDER is not significant in JSON; key SET is.
  return ak.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && jsonEqual(ao[k], bo[k]));
}

function asImage(value: unknown): AuditRowImage | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as AuditRowImage;
}

/**
 * The changed-key diff for one audit entry, computed in JS. Pure — no DB, no
 * clock — so it is exhaustively unit-testable.
 *
 * NOT what the viewer runs on. {@link listAuditEntries} gets its changed-key
 * set from Postgres and renders it through {@link fieldChangesForKeys}, because
 * this function inherits `JSON.parse`'s 2^53 precision limit and can therefore
 * MISS a real change between two large `numeric` values. It stays as the
 * executable statement of the null/missing-key policy that the SQL predicate
 * has to match, and the tests hold the two to the same rules; do not wire it
 * back into a read path.
 *
 * - **UPDATE** (both images present): only the keys whose values differ.
 * - **INSERT** (`before` null): every key of the new row, `before: undefined`.
 * - **DELETE** (`after` null): every key of the erased row, `after: undefined`.
 *
 * Null / undefined / missing-key policy, stated explicitly because jsonb makes
 * all three representable:
 * - An explicit `null` on one side and a MISSING key on the other are reported
 *   as a change. They are genuinely different facts — "the column exists and
 *   holds SQL NULL" vs "the column was not in the row image at all" (which in
 *   practice only happens across a schema migration, and is exactly the thing
 *   an auditor wants to see rather than have silently smoothed over).
 * - Two explicit `null`s are equal, so an untouched nullable column is excluded.
 * - A missing key on BOTH sides simply never appears (it is in neither key set).
 *
 * Keys are returned sorted, so a diff renders in a stable order regardless of
 * jsonb key ordering.
 */
export function changedFields(before: unknown, after: unknown): FieldChange[] {
  const b = asImage(before);
  const a = asImage(after);
  if (!b && !a) return [];

  if (!b && a) {
    return Object.keys(a)
      .sort()
      .map((key) => ({ key, before: undefined, after: a[key] }));
  }
  if (b && !a) {
    return Object.keys(b)
      .sort()
      .map((key) => ({ key, before: b[key], after: undefined }));
  }

  const bi = b as AuditRowImage;
  const ai = a as AuditRowImage;
  const keys = [...new Set([...Object.keys(bi), ...Object.keys(ai)])].sort();
  const out: FieldChange[] = [];
  for (const key of keys) {
    const hadBefore = Object.prototype.hasOwnProperty.call(bi, key);
    const hasAfter = Object.prototype.hasOwnProperty.call(ai, key);
    // A key present on only one side is a change even if its value is null —
    // see the null/missing policy above.
    if (hadBefore && hasAfter && jsonEqual(bi[key], ai[key])) continue;
    out.push({
      key,
      before: hadBefore ? bi[key] : undefined,
      after: hasAfter ? ai[key] : undefined,
    });
  }
  return out;
}

/**
 * The rendered diff for a changed-key set that SOMEONE ELSE decided — namely
 * Postgres, in {@link listAuditEntries}. Same `FieldChange` shape as
 * {@link changedFields}, and the same missing-key convention (`undefined` where
 * the key was not in that image), but it does not judge which keys changed.
 *
 * The split exists because the two halves of a diff have different authorities.
 * WHICH keys changed is a correctness question and jsonb is the only thing that
 * can answer it: `postgres` runs jsonb through `JSON.parse`, so two `numeric`
 * values differing only past 2^53 arrive as the same JS double and a real
 * change disappears — measured, `12345678901234567890` and `…891` are `===`
 * after parsing while Postgres reports them distinct, and every money column in
 * this schema (`payments.amount`, `invoices.*`, `payslips.*`) is unconstrained
 * `numeric`. WHAT the values were is a rendering question, and the parsed image
 * is what the panel has to show either way.
 *
 * So a high-precision change now always appears as a changed KEY. Its rendered
 * values may still print identically, which is honest — that is genuinely what
 * survived `JSON.parse`, and a key listed with two equal-looking values is a
 * far better failure than a change silently absent from the diff.
 */
export function fieldChangesForKeys(
  before: unknown,
  after: unknown,
  keys: readonly string[],
): FieldChange[] {
  const b = asImage(before);
  const a = asImage(after);
  return [...keys].sort().map((key) => ({
    key,
    before: b && Object.prototype.hasOwnProperty.call(b, key) ? b[key] : undefined,
    after: a && Object.prototype.hasOwnProperty.call(a, key) ? a[key] : undefined,
  }));
}

/**
 * Does this entry record an attribution change and NOTHING else — with a real
 * actor id rather than a NULL?
 *
 * READ THE NAME AS A DESCRIPTION OF THE ROW, NOT A DIAGNOSIS OF ITS CAUSE.
 * Four review rounds of this file each tried to read `diff === {updated_by}`
 * as evidence of one particular cause, and each time another cause turned up.
 * At least three are known to produce it:
 *
 *  1. **stamp-then-delete.** `stampedDelete` writes the DELETER's id into
 *     `updated_by` and then deletes the row, so the trigger records an UPDATE
 *     immediately before the DELETE. Since migration 0017 `stamp_row()` skips
 *     the `updated_at`/`version` bump when the sole difference is attribution,
 *     that pre-stamp's diff is precisely `{updated_by}`.
 *  2. **A save that changed nothing else.** `UPDATE accounts SET city = city,
 *     updated_by = 3` is a real write by a real person that happens to move no
 *     other column. 0017's guard withholds the version bump, so the trigger
 *     records the same `{updated_by}` diff, with the same kind of real actor id
 *     as (1). Nothing in a single row separates it from a pre-delete stamp —
 *     measured here, 205 rows of the local log carry this shape and 80 of them
 *     are never followed by a DELETE at all, so they cannot be pre-delete
 *     stamps. (The write itself is the real defect and is filed separately;
 *     this file only has to stop mis-describing the result.)
 *  3. **`ON DELETE SET NULL` on `updated_by`.** All 30 audited tables point
 *     `updated_by` at `users.id` with that referential action, and Postgres
 *     applies it as an internal UPDATE. So deleting one user rewrites
 *     `updated_by → NULL` on every row they last touched — rows that SURVIVE,
 *     across up to 30 tables, one audit row each. That is real history: it is
 *     the record of a deleted user's footprint, and "what did the user I just
 *     deleted have their hands on?" is exactly what a forensic reader opens
 *     this viewer to ask.
 *
 * **What this predicate actually separates is (3) from (1) and (2)**, on the
 * after-image's `updated_by`: a write by somebody leaves an id, SET NULL leaves
 * NULL. That distinction is sound and is the one that matters for folding —
 * (3) is history a reader came for, (1) and (2) are attribution churn worth
 * collapsing by default. It does NOT distinguish (1) from (2), and no rule over
 * a single row can, so nothing downstream may say which one it is saying. The
 * value is already carried here by {@link fieldChangesForKeys} as the
 * `updated_by` change's `after`, so nothing is re-derived and the predicate
 * stays pure and client-safe.
 *
 * Verified end-to-end against the live triggers in audit-behavior.test.ts, for
 * all three causes.
 *
 * Two further shapes are deliberately NOT folded, because a shared shape is not
 * a shared cause:
 *
 *  - **A bumped `version`.** Post-0017 `stamp_row` only bumps it when a
 *    non-attribution column changed, so a bumped version is Postgres ASSERTING
 *    that a real edit happened. The pre-0017 rule ("diff ⊆ {updated_by,
 *    updated_at, version}") hid 1,842 such rows.
 *  - **An EMPTY diff** — two identical row images. This used to be documented
 *    here as "every changed column was redacted out of both images, i.e. a
 *    password / aadhar / pan change, the single highest-signal event type in
 *    the log". That was the same shape-for-cause mistake, and it is false. A
 *    redacted change is seen UNREDACTED by `stamp_row()` (a BEFORE trigger on
 *    the real row), so it bumps `version` and lands as `{updated_at, version}`,
 *    not as an empty diff — pinned end-to-end against the live trigger in
 *    audit-log.test.ts. What an empty diff actually is: a write that set a row
 *    to the values it already held. The log agrees on both counts — of its
 *    2,083 empty diffs, 1,459 (70%) are on tables with no redactable column at
 *    all (user_roles alone has 899), and the oldest of them postdates the
 *    newest pre-0017 row, because before 0017 `stamp_row` bumped `version` on
 *    every UPDATE and an empty diff was not producible. Never folded; see
 *    {@link isRedactedOnlyUpdate}, which excludes it for the same reason.
 *
 * This is a PRESENTATION flag, not a filter: `listAuditEntries` still returns
 * every row and the SQL never excludes any. The raw log must stay complete and
 * inspectable — the viewer decides whether to fold these away.
 *
 * Only UPDATE can qualify. An INSERT or DELETE always says something real (a
 * row appeared or vanished) even if the row's only columns are attribution.
 */
export function isStampOnlyUpdate(op: AuditOp, changes: FieldChange[]): boolean {
  if (op !== "UPDATE") return false;
  // Exactly one changed key, and it is the attribution column. An empty diff is
  // a no-op write, not an absent one, and is never folded.
  if (changes.length !== 1) return false;
  const [stamp] = changes;
  if (stamp.key !== "updated_by") return false;
  // The after-image's updated_by. An id ⇒ somebody's write (cause 1 or 2, and
  // this cannot tell which); NULL ⇒ the ON DELETE SET NULL side effect on a row
  // that is still there. `undefined` means the key left the after image
  // entirely (a schema migration) — also not folded.
  return stamp.after !== null && stamp.after !== undefined;
}

/**
 * Columns carrying attribution/bookkeeping rather than user-meaningful data.
 */
const ATTRIBUTION_KEYS = new Set(["updated_by", "updated_at", "version"]);

/**
 * The DIFF SHAPE both classifications below key off: an UPDATE whose visible
 * diff is attribution-only, yet which carries a `version` bump.
 *
 * The shape alone says only "the database moved the version without showing a
 * reason". What that MEANS depends entirely on the table — which is the whole
 * point of splitting this out.
 *
 * `version` specifically, NOT `version || updated_at`. Only the version bump
 * carries the inference. `stamp_row()` moves the two together, so on the shape
 * this is meant to catch the version is always there; but an `updated_at`-only
 * diff is a write that set the timestamp without the guard firing, which
 * asserts nothing about a hidden column having moved. Accepting it let a shape
 * that means nothing borrow the meaning of one that does.
 */
function isAttributionBumpShape(op: AuditOp, changes: FieldChange[]): boolean {
  if (op !== "UPDATE") return false;
  // An empty diff is a different (weaker) signal — see isRedactedOnlyUpdate.
  if (changes.length === 0) return false;
  if (!changes.every((c) => ATTRIBUTION_KEYS.has(c.key))) return false;
  return changes.some((c) => c.key === "version");
}

/**
 * An UPDATE that changed ONLY columns the trigger redacts — i.e. a credential
 * or regulated-identifier change. See {@link AuditEntry.isRedactedOnly}.
 *
 * How this is knowable despite the value being stripped:
 *
 * `stamp_row()` is a BEFORE trigger on the REAL row, so it sees password_hash
 * and friends unredacted, and since 0017 it bumps `updated_at`/`version` only
 * when a non-attribution column actually changed. `audit_row()` then strips the
 * secret from both images but leaves that bump in place. So an audit row whose
 * visible diff is attribution-only YET carries a version/updated_at bump is
 * Postgres testifying: a real column changed, and it is one you are not allowed
 * to see. Verified end-to-end against the live trigger in audit-log.test.ts —
 * `UPDATE users SET password_hash = …` lands as exactly `{updated_at, version}`.
 *
 * THE TABLE IS PART OF THE INFERENCE, and leaving it out was the bug this
 * replaced. The argument above has a silent premise: that a stripped column
 * exists to be stripped. Only `users` and `employee_profiles` own one
 * ({@link AUDIT_REDACTED_COLUMNS}); on `invoices` there is no `password_hash`,
 * `aadhar` or `pan` for `audit_row()` to remove, so a version bump with no
 * visible change cannot mean a hidden column moved — it means something else
 * entirely ({@link isPreGuardStampUpdate}). Judged on `(op, changes)` alone,
 * this flagged 1,945 rows of the real log of which 1,365 (70%) were on tables
 * with no redactable column at all — invoices 540, user_roles 417, cohorts 100,
 * … — each one telling the reader a credential had been changed on a row that
 * has never held one. In a viewer whose entire value is not lying about
 * history, that is the one thing it may not do.
 *
 * An EMPTY diff is also deliberately excluded, for a parallel reason: with 0017
 * in place a redacted change always bumps the version, so two identical images
 * mean no non-attribution column moved at all. Never folded either, but
 * described for what it is rather than overclaimed.
 *
 * WHY THIS ONE KEEPS ITS CAUSAL CLAIM while the others gave theirs up. The
 * inference is a deduction, not a shape reading, and it has exactly two
 * premises, both checked: (a) `stamp_row()` bumps `version` only when a
 * non-attribution column differs, and nothing else in the codebase writes
 * `version` — there is no explicit `version:` write anywhere in lib/dal; (b) on
 * `users` and `employee_profiles` the ONLY columns absent from the stored
 * images are the redacted ones, so a column that moved without appearing here
 * must be one of them. The conclusion follows.
 *
 * It survives the move to SQL-computed changed keys, and in fact only becomes
 * sound there. While the key set was computed in JS, premise (b) had a hole:
 * two `numeric` values differing beyond 2^53 collapse to one double under
 * `JSON.parse`, so a VISIBLE column could change and vanish from the diff,
 * leaving this shape with an entirely mundane explanation. Postgres compares
 * the raw jsonb and does not lose those, so "no visible column changed" now
 * means it. See {@link listAuditEntries}.
 */
export function isRedactedOnlyUpdate(
  tableName: string,
  op: AuditOp,
  changes: FieldChange[],
): boolean {
  return isAttributionBumpShape(op, changes) && tableHasRedactedColumn(tableName);
}

/**
 * The attribution-bump shape on a table that owns NO redactable column — so the
 * {@link isRedactedOnlyUpdate} deduction is unavailable here, its premise being
 * that there is a stripped column to have moved.
 *
 * What is OBSERVED, and nothing beyond it: `version` moved, and no other column
 * the log records differs between the two images. What that is consistent with,
 * without picking one — pre-0017 `stamp_row()`, which bumped `version` and
 * `updated_at` on every UPDATE including attribution-only ones; or any later
 * write that moved a column this log does not store.
 *
 * The previous wording asserted two things it could not: that "nothing was
 * hidden", and that "since 0017 this shape is no longer produced". Both are
 * falsifiable — the first assumes the stored images are the whole row, the
 * second is a claim about the future made from a `max(at)` over rows that
 * happen to exist today. Neither is needed to make the row legible, so both are
 * gone.
 *
 * Kept as its own flag rather than folded into "attribution only": the version
 * DID move, and quietly hiding a row because we cannot explain it is the same
 * failure mode as loudly mislabelling it.
 */
export function isPreGuardStampUpdate(
  tableName: string,
  op: AuditOp,
  changes: FieldChange[],
): boolean {
  return isAttributionBumpShape(op, changes) && !tableHasRedactedColumn(tableName);
}

function buildWhere(filters: AuditFilters): SQL | undefined {
  const clauses: SQL[] = [];
  if (filters.tableName) clauses.push(eq(auditLog.tableName, filters.tableName));
  if (filters.actorId !== undefined) {
    clauses.push(
      filters.actorId === AUDIT_ACTOR_NONE
        ? isNull(auditLog.actorId)
        : eq(auditLog.actorId, filters.actorId),
    );
  }
  if (filters.op) clauses.push(eq(auditLog.op, filters.op));
  // Compared as CALENDAR DAYS, in the database's own terms, never as JS Dates —
  // see AuditFilters.from for why binding a Date here is silently wrong. Both
  // sides are cast to `date`, so the bound means the day the reader picked and
  // `to` covers that whole day without needing a 23:59:59.999 fudge.
  if (filters.from) clauses.push(sql`${auditLog.at}::date >= ${filters.from}::date`);
  if (filters.to) clauses.push(sql`${auditLog.at}::date <= ${filters.to}::date`);
  if (clauses.length === 0) return undefined;
  return and(...clauses);
}

/**
 * One page of the audit feed, newest first, with the actor's name resolved.
 *
 * ONE query: the rows plus a LEFT JOIN on `users` for the name. No N+1, and
 * the join must stay LEFT on both counts — `actor_id` is nullable (system and
 * script writes), and even a non-null actor may name a user who has since been
 * deleted (there is deliberately no FK). Either way the id survives and the
 * name comes back NULL; the caller shows "unknown" and the id, never a guess.
 *
 * Ordering is `id DESC`, NOT `at DESC`. `id` is a monotonic bigserial and is
 * the primary key, so it is already indexed and needs no sort — whereas the
 * two `at` indexes are both composite-leading (table_name, at) / (actor_id,
 * at) and so do nothing for the UNFILTERED feed, which would fall back to a
 * full sort of 20k+ rows on every page load. Since audit rows are only ever
 * appended, id order and at order agree, so this costs the reader nothing.
 *
 * THE CHANGED-KEY SET IS COMPUTED BY POSTGRES, not in JS, and that is a
 * correctness requirement rather than an optimisation — see
 * {@link fieldChangesForKeys} for the 2^53 `numeric` collapse it avoids. The
 * scalar subquery walks the union of both images' keys and keeps those where
 * `before->k IS DISTINCT FROM after->k`, which reproduces the documented
 * null/missing policy exactly: `->` yields SQL NULL for an absent key and jsonb
 * `null` for an explicit one, and `IS DISTINCT FROM` separates them, so
 * "absent" and "present and null" stay the different facts {@link changedFields}
 * says they are, while two explicit nulls compare equal.
 *
 * Measured cost, `EXPLAIN (ANALYZE, BUFFERS)` on the unfiltered first page of
 * the 29,415-row local log: 0.176 ms → 0.561 ms execution, shared buffers 36 →
 * 28. The subplan runs once per RETURNED row (51 loops at ~0.009 ms), not once
 * per row in the table, because the LIMIT is applied first — so the cost is
 * bounded by page size and does not grow with the log. The planner's total-cost
 * estimate does inflate (5,218 → 169,632), but that is the estimate for the
 * un-limited node and is not what executes.
 *
 * Pagination reports `hasMore` from a 51-row fetch rather than a total count.
 * A `count(*)` over the whole (or filtered) log is a second full scan on every
 * page load of a table that only grows; "Next" enabled/disabled is what the UI
 * actually needs, and it comes free with one extra row. The trade is that we
 * cannot render "page 7 of 42" — an acceptable loss for a forensic feed nobody
 * paginates deeply, and a total count can be added later as its own opt-in
 * call if it is ever wanted.
 */
export async function listAuditEntries(
  actor: SessionUser,
  filters: AuditFilters = {},
  page = 1,
): Promise<AuditPage> {
  assertSuperAdmin(actor);
  const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;

  const rows = await db
    .select({
      id: auditLog.id,
      at: auditLog.at,
      tableName: auditLog.tableName,
      op: auditLog.op,
      rowId: auditLog.rowId,
      actorId: auditLog.actorId,
      actorName: users.name,
      before: auditLog.before,
      after: auditLog.after,
      // The authoritative diff. Compared as raw jsonb, inside the database.
      changedKeys: sql<string[]>`(
        SELECT coalesce(array_agg(k.key ORDER BY k.key), ARRAY[]::text[])
        FROM jsonb_object_keys(
          coalesce(${auditLog.before}, '{}'::jsonb) || coalesce(${auditLog.after}, '{}'::jsonb)
        ) AS k(key)
        WHERE ${auditLog.before} -> k.key IS DISTINCT FROM ${auditLog.after} -> k.key
      )`,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorId))
    .where(buildWhere(filters))
    .orderBy(desc(auditLog.id))
    .limit(AUDIT_PAGE_SIZE + 1) // +1 sentinel → hasMore without a count(*)
    .offset((safePage - 1) * AUDIT_PAGE_SIZE);

  const hasMore = rows.length > AUDIT_PAGE_SIZE;
  const entries: AuditEntry[] = rows.slice(0, AUDIT_PAGE_SIZE).map((r) => {
    const op = r.op as AuditOp;
    const changes = fieldChangesForKeys(r.before, r.after, r.changedKeys ?? []);
    return {
      id: r.id,
      at: r.at,
      tableName: r.tableName,
      op,
      rowId: r.rowId,
      actorId: r.actorId,
      actorName: r.actorName ?? null,
      before: asImage(r.before),
      after: asImage(r.after),
      changedFields: changes,
      isStampOnly: isStampOnlyUpdate(op, changes),
      isRedactedOnly: isRedactedOnlyUpdate(r.tableName, op, changes),
      isPreGuardStamp: isPreGuardStampUpdate(r.tableName, op, changes),
    };
  });

  return { entries, page: safePage, pageSize: AUDIT_PAGE_SIZE, hasMore };
}

export interface AuditActorOption {
  id: number;
  /** NULL when the actor has since been deleted — show the id instead. */
  name: string | null;
}

export interface AuditFilterOptions {
  /** Distinct `table_name` values present in the log, alphabetical. */
  tableNames: string[];
  /**
   * Distinct non-null actors present in the log, named where still resolvable.
   *
   * The NULL actor is deliberately NOT an entry here — it has no id and no name
   * to offer. The viewer adds its own "System / unknown" choice, which maps to
   * {@link AUDIT_ACTOR_NONE}.
   */
  actors: AuditActorOption[];
}

/**
 * The values the filter dropdowns should offer — derived from the log itself
 * rather than hardcoding ~30 table names that would drift the moment a table
 * is added or renamed.
 *
 * Two independent reads, batched (house rule). Both are cheap: the distinct
 * set over `table_name` is a couple of dozen values, and the distinct actor
 * scan rides the (actor_id, at) index. Neither returns a row count.
 */
export async function listAuditFilterOptions(actor: SessionUser): Promise<AuditFilterOptions> {
  assertSuperAdmin(actor);

  const [tableRows, actorRows] = await Promise.all([
    db
      .selectDistinct({ tableName: auditLog.tableName })
      .from(auditLog)
      .orderBy(auditLog.tableName),
    // LEFT JOIN for the same reason as listAuditEntries: an actor whose user
    // row is gone still appears in the log and still deserves a filter option.
    db
      .selectDistinct({ id: auditLog.actorId, name: users.name })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorId))
      .where(isNotNull(auditLog.actorId))
      .orderBy(sql`2 nulls last`, sql`1`),
  ]);

  return {
    tableNames: tableRows.map((r) => r.tableName),
    actors: actorRows
      .filter((r): r is { id: number; name: string | null } => r.id !== null)
      .map((r) => ({ id: r.id, name: r.name ?? null })),
  };
}
