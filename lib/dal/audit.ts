import "server-only";
import { eq, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "@/lib/db/client";

/**
 * Delete a single row by id so the DELETE audit trigger records the ACTOR,
 * not the last editor. The trigger reads OLD.updated_by, so we stamp it
 * first, then delete. The stamp UPDATE itself writes its own UPDATE audit
 * row (a phantom row immediately before the DELETE row) — that's inherent
 * to the approach; viewers of the audit trail should collapse an
 * UPDATE-then-DELETE pair on the same row within the same instant.
 * Not atomic on neon-http (no transactions) — but the failure mode is benign:
 * a failed delete leaves only a touched updated_by/version, no data lost.
 * The table MUST have base columns (every audited table does) and a
 * single-column `id` primary key (composite-PK tables are rejected at
 * compile time by the `{ id: AnyPgColumn }` constraint).
 *
 * @returns the number of rows deleted (0 or 1) — callers that care should
 * throw their own UserError on 0; silent-0 is a valid outcome for callers
 * that don't.
 */
export async function stampedDelete(
  table: PgTable & { id: AnyPgColumn },
  id: number,
  actorId: number,
): Promise<number> {
  await db.update(table).set({ updatedBy: actorId } as never).where(eq(table.id, id));
  const deleted = await db.delete(table).where(eq(table.id, id)).returning({ id: table.id });
  return deleted.length;
}

/**
 * Same idiom as {@link stampedDelete}, for predicate-based (not single-id)
 * deletes — e.g. deleting all cohorts for an invoice. Stamps updated_by on
 * every row matching `where`, then deletes the same set, so each row's
 * DELETE audit entry carries the actor. As with stampedDelete, the stamp
 * UPDATE writes its own UPDATE audit row per matched row (phantom rows
 * immediately before the DELETE rows) — inherent, viewers collapse it.
 * Two round-trips regardless of how many rows match.
 * Not atomic on neon-http (no transactions) — same benign failure mode as
 * stampedDelete: a failed delete leaves touched updated_by/version, no data
 * lost.
 *
 * @returns the number of rows deleted.
 */
export async function stampedDeleteWhere(table: PgTable, where: SQL, actorId: number): Promise<number> {
  await db.update(table).set({ updatedBy: actorId } as never).where(where);
  const deleted = await db.delete(table).where(where).returning();
  return deleted.length;
}
