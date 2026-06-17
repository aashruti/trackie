import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { academicYears, accounts, invoices, cohorts } from "@/lib/db/schema";
import { canEdit, type SessionUser } from "./authz";
import { assignedIds } from "./accounts";

export interface RolloverPlanRow {
  invoiceId: number;
  accountId: number;
  accountName: string;
  category: string;
  semester: string;
  students: number;
  priceToUni: number;
  priceToDatagami: number;
  gstRate: number;
  tdsRate: number;
  advanceAdj: number;
}

export interface RolloverPlan {
  fromYear: string;
  suggestedToYear: string;
  rows: RolloverPlanRow[];
}

/** Next "FYxx–yy" label after the given one (e.g. FY26–27 → FY27–28). */
function nextFyLabel(label: string): string {
  const m = label.match(/(\d{2})\D+(\d{2})/);
  if (!m) return label + " (next)";
  const a = (parseInt(m[1], 10) + 1) % 100;
  const b = (parseInt(m[2], 10) + 1) % 100;
  return `FY${String(a).padStart(2, "0")}–${String(b).padStart(2, "0")}`;
}

/** Editable per-invoice rows for the rollover wizard (carried-forward values). */
export async function getRolloverPlan(
  user: SessionUser,
  fromYearLabel: string,
): Promise<RolloverPlan> {
  const [fromYear] = await db
    .select()
    .from(academicYears)
    .where(eq(academicYears.label, fromYearLabel))
    .limit(1);
  if (!fromYear) {
    return { fromYear: fromYearLabel, suggestedToYear: nextFyLabel(fromYearLabel), rows: [] };
  }

  const assigned = user.role === "super-admin" ? [] : await assignedIds(user.id);
  const accRows = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts);
  const editableIds = accRows
    .filter((a) => canEdit(user, a.id, assigned))
    .map((a) => a.id);
  const nameById = new Map(accRows.map((a) => [a.id, a.name]));

  const invRows = editableIds.length
    ? await db
        .select()
        .from(invoices)
        .where(and(eq(invoices.yearId, fromYear.id), inArray(invoices.accountId, editableIds)))
    : [];

  const rows: RolloverPlanRow[] = invRows.map((r) => ({
    invoiceId: r.id,
    accountId: r.accountId,
    accountName: nameById.get(r.accountId) ?? "—",
    category: r.category,
    semester: r.semester,
    students: r.students,
    priceToUni: Number(r.priceToUni),
    priceToDatagami: Number(r.priceToDatagami),
    gstRate: Number(r.gstRate),
    tdsRate: Number(r.tdsRate),
    advanceAdj: Number(r.advanceAdj),
  }));
  rows.sort((a, b) => a.accountName.localeCompare(b.accountName));

  return { fromYear: fromYearLabel, suggestedToYear: nextFyLabel(fromYearLabel), rows };
}

export interface RolloverResult {
  toYearLabel: string;
  accountsRolled: number;
  invoicesCreated: number;
  skipped: number; // accounts that already had target-year invoices
}

/**
 * Roll a year forward into a new (Draft) year, retaining all prior-year data.
 * - Creates the target year if it doesn't exist.
 * - For each account the user can edit, clones its `from`-year invoices (+cohorts)
 *   into the target year with status `draft`, applying any edited student counts
 *   (countOverrides keyed by source invoice id).
 * - Skips an account if it already has target-year invoices (idempotent).
 * - The source year's rows are never modified.
 */
export async function rolloverYear(
  user: SessionUser,
  fromYearLabel: string,
  toYearLabel: string,
  countOverrides: Record<number, number> = {},
): Promise<RolloverResult> {
  const [fromYear] = await db
    .select()
    .from(academicYears)
    .where(eq(academicYears.label, fromYearLabel))
    .limit(1);
  if (!fromYear) throw new Error(`Source year ${fromYearLabel} not found`);

  // Create target year if missing.
  let [toYear] = await db
    .select()
    .from(academicYears)
    .where(eq(academicYears.label, toYearLabel))
    .limit(1);
  if (!toYear) {
    [toYear] = await db
      .insert(academicYears)
      .values({ label: toYearLabel })
      .returning();
  }

  // Accounts the user can edit.
  const assigned = user.role === "super-admin" ? [] : await assignedIds(user.id);
  const allAccounts = await db.select({ id: accounts.id }).from(accounts);
  const editable = allAccounts
    .map((a) => a.id)
    .filter((id) => canEdit(user, id, assigned));

  const result: RolloverResult = {
    toYearLabel,
    accountsRolled: 0,
    invoicesCreated: 0,
    skipped: 0,
  };

  for (const accountId of editable) {
    // Skip if target year already populated for this account (idempotent).
    const existing = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.accountId, accountId), eq(invoices.yearId, toYear.id)))
      .limit(1);
    if (existing.length) {
      result.skipped++;
      continue;
    }

    const src = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.accountId, accountId), eq(invoices.yearId, fromYear.id)));
    if (src.length === 0) continue;

    let rolledAny = false;
    for (const s of src) {
      const students =
        countOverrides[s.id] != null ? Math.max(0, countOverrides[s.id]) : s.students;

      const [created] = await db
        .insert(invoices)
        .values({
          accountId,
          yearId: toYear.id,
          category: s.category,
          semester: s.semester,
          students,
          priceToUni: s.priceToUni,
          priceToDatagami: s.priceToDatagami,
          gstRate: s.gstRate,
          tdsRate: s.tdsRate,
          advanceAdj: s.advanceAdj,
          invoiceDate: null,
          status: "draft",
        })
        .returning();
      result.invoicesCreated++;
      rolledAny = true;

      // Clone cohorts.
      const srcCohorts = await db
        .select()
        .from(cohorts)
        .where(eq(cohorts.invoiceId, s.id));
      if (srcCohorts.length) {
        await db.insert(cohorts).values(
          srcCohorts.map((c) => ({
            invoiceId: created.id,
            enrollmentYear: c.enrollmentYear,
            count: c.count,
            // Carry each cohort's locked price forward into the new year.
            priceToUni: c.priceToUni,
            priceToDatagami: c.priceToDatagami,
          })),
        );
      }
    }
    if (rolledAny) result.accountsRolled++;
  }

  return result;
}

/** Delete a year's invoices for accounts the user can edit (undo a rollover). */
export async function deleteYear(
  user: SessionUser,
  yearLabel: string,
): Promise<void> {
  if (user.role !== "super-admin") throw new Error("Only super-admin can delete a year");
  const [year] = await db
    .select()
    .from(academicYears)
    .where(eq(academicYears.label, yearLabel))
    .limit(1);
  if (!year) return;
  const ids = (
    await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.yearId, year.id))
  ).map((r) => r.id);
  if (ids.length) await db.delete(invoices).where(inArray(invoices.id, ids));
  await db.delete(academicYears).where(eq(academicYears.id, year.id));
}
