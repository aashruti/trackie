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

/**
 * WHICH TABLE HAS WHICH REDACTED COLUMN — the single source of truth.
 *
 * `audit_row()` (migration 0016) strips three column names from every row image
 * it stores: `password_hash`, `aadhar`, `pan`. It does so with jsonb `-`, which
 * is a no-op on a table that has no such column — so the *trigger* is uniform
 * across all ~40 audited tables, but the *consequence* is not: only these two
 * tables actually own a redactable column.
 *
 *   users             → password_hash   (schema.ts:176)
 *   employee_profiles → aadhar, pan     (schema.ts:385-386)
 *
 * Anywhere else, "the changed column was redacted" is not an inference the log
 * can support — there is no column that could have been stripped. Every reader
 * of that inference must therefore consult this map first; see
 * {@link tableHasRedactedColumn}. `lib/dal/audit-log.test.ts` asserts this map
 * against `information_schema` so it cannot drift from the database.
 *
 * Lives here rather than in the `server-only` DAL because the viewer is a mix
 * of server and client components — see the file header.
 */
export const AUDIT_REDACTED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  users: ["password_hash"],
  employee_profiles: ["aadhar", "pan"],
};

/** The redacted columns `table_name` owns — empty for the great majority of tables. */
export function redactedColumnsFor(tableName: string): readonly string[] {
  return AUDIT_REDACTED_COLUMNS[tableName] ?? [];
}

/** Could a change on this table have been hidden by the trigger at all? */
export function tableHasRedactedColumn(tableName: string): boolean {
  return redactedColumnsFor(tableName).length > 0;
}
