import "server-only";
import { and, desc, eq, gte, isNotNull, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { auditLog, users } from "@/lib/db/schema";
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

export interface AuditFilters {
  /** Exact `audit_log.table_name`, e.g. "invoices". */
  tableName?: string;
  /** Exact actor id. Rows with a NULL actor are never matched by this. */
  actorId?: number;
  op?: AuditOp;
  /** Inclusive lower bound on `at`. */
  from?: Date;
  /** Inclusive upper bound on `at`. */
  to?: Date;
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

/**
 * Columns that carry attribution/bookkeeping rather than user-meaningful data.
 * A change confined to these is not an edit anyone asked for.
 */
const ATTRIBUTION_KEYS = new Set(["updated_by", "updated_at", "version"]);

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
 * Is this entry the phantom half of a stamp-then-delete pair?
 *
 * `stampedDelete` sets `updated_by` on a row and then deletes it, so every
 * delete produces an UPDATE audit row (touching only updated_by, plus the
 * updated_at/version the triggers bump) immediately before the DELETE row. A
 * bill deletion writes 6 rows where a human cares about 3.
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
  return changes.every((c) => ATTRIBUTION_KEYS.has(c.key));
}

function buildWhere(filters: AuditFilters): SQL | undefined {
  const clauses: SQL[] = [];
  if (filters.tableName) clauses.push(eq(auditLog.tableName, filters.tableName));
  if (filters.actorId !== undefined) clauses.push(eq(auditLog.actorId, filters.actorId));
  if (filters.op) clauses.push(eq(auditLog.op, filters.op));
  if (filters.from) clauses.push(gte(auditLog.at, filters.from));
  if (filters.to) clauses.push(lte(auditLog.at, filters.to));
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
  /** Distinct non-null actors present in the log, named where still resolvable. */
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
