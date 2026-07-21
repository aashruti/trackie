/**
 * The sliver of audit-viewer vocabulary that crosses the server/client boundary.
 * Client-safe (no `server-only`), same as lib/dates.ts.
 *
 * `lib/dal/audit-log.ts` is `server-only` and reaches the DB driver, so a client
 * component that VALUE-imports a constant from it pulls `postgres` into the
 * browser bundle — a build failure, and rightly so. (Type-only imports are
 * erased and stay fine.) Shared runtime constants therefore live here, and the
 * DAL re-exports them so server callers still have one import site.
 */

/**
 * The actor-filter sentinel meaning "rows with NO actor" (`actor_id IS NULL`) —
 * script/seed writes and referential SET NULL side effects, ~40% of the log.
 *
 * A sentinel rather than `null` because a filter object built from a URL cannot
 * otherwise distinguish "the reader asked for actor-less rows" from "the reader
 * did not filter by actor at all".
 */
export const AUDIT_ACTOR_NONE = "none";

export type AuditActorFilter = number | typeof AUDIT_ACTOR_NONE;
