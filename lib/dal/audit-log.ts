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
  /** Precomputed diff — see {@link changedFields}. */
  changedFields: FieldChange[];
  /**
   * True for the phantom UPDATE our stamp-then-delete idiom writes immediately
   * before each DELETE. Presentation hint only — see {@link isStampOnlyUpdate}.
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
 * The changed-key diff for one audit entry. Pure — no DB, no clock — so it is
 * exhaustively unit-testable.
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
 * Is this entry the phantom half of a stamp-then-delete pair — and NOTHING else?
 *
 * `stampedDelete` sets `updated_by` on a row and then deletes it, so every
 * delete produces an UPDATE audit row immediately before the DELETE row. That
 * single artefact is the only thing worth folding, and since migration 0017 it
 * is exactly identifiable: `stamp_row()` now SKIPS the updated_at/version bump
 * when the sole difference is attribution, so the pre-stamp's diff is precisely
 * `{updated_by}`.
 *
 * The rule is therefore `diff === {updated_by}`, and deliberately not "diff ⊆
 * {updated_by, updated_at, version}", which is what it used to be. That older,
 * pre-0017 rule folded 3,803 of 24,954 real rows when only 151 were genuine
 * phantoms. Two things it swallowed, both of which are real history:
 *
 *  - **A bumped `version`.** Post-0017 `stamp_row` only bumps it when a
 *    non-attribution column changed, so a bumped version is Postgres ASSERTING
 *    that a real edit happened. Folding those hid 1,842 rows.
 *  - **An EMPTY diff.** Identical images do not mean "nothing happened"; they
 *    mean every changed column was redacted out of both images by
 *    `audit_row()` — i.e. a password / aadhar / pan change. 1,713 rows, and
 *    the single highest-signal event type in the log. An empty diff is never
 *    folded; see {@link AuditEntry.isRedactedOnly}.
 *
 * This is a PRESENTATION flag, not a filter: `listAuditEntries` still returns
 * every row and the SQL never excludes any. The raw log must stay complete and
 * inspectable — the viewer decides whether to fold these away.
 *
 * Only UPDATE can be a phantom. An INSERT or DELETE always says something real
 * (a row appeared or vanished) even if the row's only columns are attribution.
 */
export function isStampOnlyUpdate(op: AuditOp, changes: FieldChange[]): boolean {
  if (op !== "UPDATE") return false;
  // An empty diff is a fully-redacted change, not an absence of one.
  if (changes.length === 0) return false;
  return changes.every((c) => c.key === "updated_by");
}

/**
 * Columns carrying attribution/bookkeeping rather than user-meaningful data.
 */
const ATTRIBUTION_KEYS = new Set(["updated_by", "updated_at", "version"]);

/**
 * The DIFF SHAPE both classifications below key off: an UPDATE whose visible
 * diff is attribution-only, yet which carries an `updated_at`/`version` bump.
 *
 * The shape alone says only "the database moved the version without showing a
 * reason". What that MEANS depends entirely on the table — which is the whole
 * point of splitting this out.
 */
function isAttributionBumpShape(op: AuditOp, changes: FieldChange[]): boolean {
  if (op !== "UPDATE") return false;
  // An empty diff is a different (weaker) signal — see isRedactedOnlyUpdate.
  if (changes.length === 0) return false;
  if (!changes.every((c) => ATTRIBUTION_KEYS.has(c.key))) return false;
  return changes.some((c) => c.key === "version" || c.key === "updated_at");
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
 * bump is unexplained rather than explained-but-hidden.
 *
 * What is actually known about these rows, and nothing beyond it: the database
 * moved `version`/`updated_at` while every column this log can show stayed the
 * same, and no column on this table is one the trigger strips. So nothing was
 * hidden; the bump simply had no accompanying column change.
 *
 * That is precisely what pre-0017 `stamp_row()` did — it bumped `updated_at`
 * and `version` on every UPDATE, including writes that touched only attribution.
 * Migration 0017 added the guard, so the shape is no longer producible on a
 * non-redacted table; measured against the real log, the newest such row is
 * 2026-07-21 00:13, i.e. all 1,365 of them predate the guard.
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
    const changes = changedFields(r.before, r.after);
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
