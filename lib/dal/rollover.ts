import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { academicYears, accounts, invoices, cohorts } from "@/lib/db/schema";
import { canEdit, type SessionUser } from "./authz";
import { assignedIds } from "./accounts";

export interface RolloverCohort {
  enrollmentYear: string;
  count: number;
  priceToUni: number | null;
  priceToDatagami: number | null;
}

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
  // When non-empty, this invoice's money is cohort-driven; the new-year count is
  // edited per cohort (the scalar `students` is just their sum).
  cohorts: RolloverCohort[];
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

  // Load cohorts for these invoices so the wizard can edit per-batch counts.
  const invIds = invRows.map((r) => r.id);
  const cohortRows = invIds.length
    ? await db.select().from(cohorts).where(inArray(cohorts.invoiceId, invIds))
    : [];
  const cohortsByInvoice = new Map<number, RolloverCohort[]>();
  for (const c of cohortRows) {
    const list = cohortsByInvoice.get(c.invoiceId) ?? [];
    list.push({
      enrollmentYear: c.enrollmentYear,
      count: c.count,
      priceToUni: c.priceToUni == null ? null : Number(c.priceToUni),
      priceToDatagami: c.priceToDatagami == null ? null : Number(c.priceToDatagami),
    });
    cohortsByInvoice.set(c.invoiceId, list);
  }

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
    cohorts: cohortsByInvoice.get(r.id) ?? [],
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
  // Per-cohort count overrides: invoiceId → { enrollmentYear → new count }.
  // For cohort-driven invoices these (not the scalar countOverrides) adjust the
  // money, and the invoice's `students` is synced to the resulting cohort sum.
  cohortOverrides: Record<number, Record<string, number>> = {},
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
      // Clone cohorts, applying any per-batch count overrides.
      const srcCohorts = await db
        .select()
        .from(cohorts)
        .where(eq(cohorts.invoiceId, s.id));
      const covr = cohortOverrides[s.id];
      const clonedCohorts = srcCohorts.map((c) => ({
        invoiceId: 0, // set after the invoice is created
        enrollmentYear: c.enrollmentYear,
        count:
          covr && covr[c.enrollmentYear] != null
            ? Math.max(0, Math.floor(covr[c.enrollmentYear]))
            : c.count,
        // Carry each cohort's locked price forward into the new year.
        priceToUni: c.priceToUni,
        priceToDatagami: c.priceToDatagami,
      }));

      // Cohort-driven invoices: students = Σ cohort counts (the engine's basis),
      // so the scalar override is ignored to keep the two in sync. Otherwise the
      // scalar override (or carried count) wins.
      const students = srcCohorts.length
        ? clonedCohorts.reduce((a, c) => a + c.count, 0)
        : countOverrides[s.id] != null
          ? Math.max(0, countOverrides[s.id])
          : s.students;

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

      if (clonedCohorts.length) {
        await db
          .insert(cohorts)
          .values(clonedCohorts.map((c) => ({ ...c, invoiceId: created.id })));
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
