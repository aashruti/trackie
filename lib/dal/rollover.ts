import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { academicYears, accounts, invoices, cohorts, payments } from "@/lib/db/schema";
import { nextFyLabel, prevFyLabel } from "@/lib/fy";
import { canEdit, type SessionUser } from "./authz";
import { assignedIds } from "./accounts";
import { stampedDelete, stampedDeleteWhere } from "./audit";

export interface RolloverCohort {
  enrollmentYear: string;
  count: number;
}

export interface RolloverPlanRow {
  invoiceId: number;
  accountId: number;
  accountName: string;
  category: string; // "old" | "new" — advance streams are never rolled over
  semester: string;
  students: number;
  // Non-empty for cohort-driven old invoices; counts are edited per batch and
  // the scalar `students` is just their sum.
  cohorts: RolloverCohort[];
}

export interface RolloverPlan {
  fromYear: string;
  suggestedToYear: string;
  rows: RolloverPlanRow[];
}

/**
 * Wizard edits for rolloverYear. All keys are SOURCE-year invoice ids.
 * - scalarCounts: fresh-intake estimate for a `new` invoice, or the carried
 *   count for a scalar (cohort-less) `old` invoice.
 * - cohortCounts: per-batch counts for a cohort-driven `old` invoice.
 * - promotedCounts: the promoted batch's count for a `new` invoice
 *   (defaults to the source intake).
 */
export interface RolloverEdits {
  scalarCounts?: Record<number, number>;
  cohortCounts?: Record<number, Record<string, number>>;
  promotedCounts?: Record<number, number>;
}

/** Editable per-invoice count rows for the rollover wizard. */
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

  const assigned = user.roles.includes("super-admin") ? [] : await assignedIds(user.id);
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
  // Advance streams are not rolled over (counts-only), so the wizard never shows them.
  const studentRows = invRows.filter((r) => r.category !== "advance");

  const invIds = studentRows.map((r) => r.id);
  const cohortRows = invIds.length
    ? await db.select().from(cohorts).where(inArray(cohorts.invoiceId, invIds))
    : [];
  const cohortsByInvoice = new Map<number, RolloverCohort[]>();
  for (const c of cohortRows) {
    const list = cohortsByInvoice.get(c.invoiceId) ?? [];
    list.push({ enrollmentYear: c.enrollmentYear, count: c.count });
    cohortsByInvoice.set(c.invoiceId, list);
  }

  const rows: RolloverPlanRow[] = studentRows.map((r) => ({
    invoiceId: r.id,
    accountId: r.accountId,
    accountName: nameById.get(r.accountId) ?? "—",
    category: r.category,
    semester: r.semester,
    students: r.students,
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
 * Roll a year's STUDENT COUNTS forward into a new (Draft) year.
 *
 * Counts-only by design (2026-07-22 spec): no billing details are carried —
 * prices, GST/TDS, advance adjustments and dates all take their schema
 * defaults, and `advance` streams are not cloned at all. New-year prices are
 * entered on /pricing; bills are raised as and when needed.
 *
 * Batch lifecycle: the source year's `new` intake is PROMOTED into the target
 * year's `old` invoice as a batch named after the source year (the old invoice
 * is created if the account had none for that semester; duplicate `new`
 * streams merge into one batch). A cohort-less `old` invoice's scalar count is
 * materialized as a catch-all batch labeled with the year before the source
 * year, so every target-year old invoice is batch-driven.
 *
 * - Creates the target year row if it doesn't exist.
 * - Skips an account if it already has target-year invoices (idempotent).
 * - The source year's rows are never modified.
 */
export async function rolloverYear(
  user: SessionUser,
  fromYearLabel: string,
  toYearLabel: string,
  edits: RolloverEdits = {},
): Promise<RolloverResult> {
  // The two year lookups are independent — parallelise (house rule).
  const [[fromYear], [toYearRow]] = await Promise.all([
    db.select().from(academicYears).where(eq(academicYears.label, fromYearLabel)).limit(1),
    db.select().from(academicYears).where(eq(academicYears.label, toYearLabel)).limit(1),
  ]);
  if (!fromYear) throw new Error(`Source year ${fromYearLabel} not found`);

  // Create target year if missing.
  let toYear = toYearRow;
  if (!toYear) {
    [toYear] = await db
      .insert(academicYears)
      .values({ label: toYearLabel, createdBy: user.id, updatedBy: user.id })
      .returning();
  }

  // Accounts the user can edit.
  const assigned = user.roles.includes("super-admin") ? [] : await assignedIds(user.id);
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
  if (!editable.length) return result;

  // Batched reads (house no-N+1 rule): already-populated accounts, all source
  // invoices, all source cohorts — 3 queries regardless of account count.
  const [populatedRows, srcRows] = await Promise.all([
    db
      .select({ accountId: invoices.accountId })
      .from(invoices)
      .where(and(eq(invoices.yearId, toYear.id), inArray(invoices.accountId, editable))),
    db
      .select()
      .from(invoices)
      .where(and(eq(invoices.yearId, fromYear.id), inArray(invoices.accountId, editable))),
  ]);
  const populated = new Set(populatedRows.map((r) => r.accountId));
  const srcByAccount = new Map<number, typeof srcRows>();
  for (const s of srcRows) {
    const list = srcByAccount.get(s.accountId) ?? [];
    list.push(s);
    srcByAccount.set(s.accountId, list);
  }
  const srcIds = srcRows.map((r) => r.id);
  const cohortRows = srcIds.length
    ? await db.select().from(cohorts).where(inArray(cohorts.invoiceId, srcIds))
    : [];
  const cohortsByInvoice = new Map<number, typeof cohortRows>();
  for (const c of cohortRows) {
    const list = cohortsByInvoice.get(c.invoiceId) ?? [];
    list.push(c);
    cohortsByInvoice.set(c.invoiceId, list);
  }

  const count = (v: number | undefined, fallback: number) =>
    v != null && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : fallback;

  // Pure JS from here: build the target-year invoice plans per account.
  interface Plan {
    accountId: number;
    category: "old" | "new";
    semester: (typeof srcRows)[number]["semester"];
    students: number;
    batches: RolloverCohort[];
  }
  const plans: Plan[] = [];
  for (const accountId of editable) {
    if (populated.has(accountId)) {
      result.skipped++;
      continue;
    }
    const src = srcByAccount.get(accountId) ?? [];
    if (!src.length) continue;

    const accountPlans: Plan[] = [];
    // Old invoices: carry batches (counts only). A cohort-less old invoice's
    // scalar count becomes a catch-all batch so the promoted batch can join it.
    for (const s of src.filter((r) => r.category === "old")) {
      const srcC = cohortsByInvoice.get(s.id) ?? [];
      let batches: RolloverCohort[];
      if (srcC.length) {
        const covr = edits.cohortCounts?.[s.id];
        batches = srcC
          .map((c) => ({
            enrollmentYear: c.enrollmentYear,
            count: count(covr?.[c.enrollmentYear], c.count),
          }))
          // A batch zeroed in the wizard has passed out — it is not carried.
          .filter((b) => b.count > 0);
      } else {
        const carried = count(edits.scalarCounts?.[s.id], s.students);
        batches = carried > 0 ? [{ enrollmentYear: prevFyLabel(fromYearLabel), count: carried }] : [];
      }
      accountPlans.push({ accountId, category: "old", semester: s.semester, students: 0, batches });
    }
    // New invoices: promote the intake into the same-semester old invoice
    // (created if absent), then start a fresh intake row.
    for (const n of src.filter((r) => r.category === "new")) {
      const promoted = count(edits.promotedCounts?.[n.id], n.students);
      if (promoted > 0) {
        let target = accountPlans.find((p) => p.category === "old" && p.semester === n.semester);
        if (!target) {
          target = { accountId, category: "old", semester: n.semester, students: 0, batches: [] };
          accountPlans.push(target);
        }
        const existing = target.batches.find((b) => b.enrollmentYear === fromYearLabel);
        if (existing) existing.count += promoted; // duplicate `new` streams merge
        else target.batches.push({ enrollmentYear: fromYearLabel, count: promoted });
      }

      accountPlans.push({
        accountId,
        category: "new",
        semester: n.semester,
        students: count(edits.scalarCounts?.[n.id], n.students),
        batches: [],
      });
    }
    // `advance` streams are deliberately not cloned (counts-only rollover).

    // Cohort-driven invoices keep students = Σ batch counts (engine's basis).
    for (const p of accountPlans) {
      if (p.batches.length) p.students = p.batches.reduce((a, b) => a + b.count, 0);
    }
    // An old invoice whose batches ALL passed out (and gained no promotion)
    // carries nothing — creating it would just be clutter. `new` invoices are
    // always created, as the placeholder the fresh intake is entered into.
    const carried = accountPlans.filter((p) => p.category === "new" || p.batches.length > 0);
    if (carried.length) {
      plans.push(...carried);
      result.accountsRolled++;
    }
  }

  if (plans.length) {
    // Two bulk inserts. Postgres preserves VALUES order in RETURNING, so
    // created[i] corresponds to plans[i].
    // NOT atomic (neon-http has no transactions — see user-admin.ts): a crash
    // between the inserts leaves cohort-less old invoices, and the idempotent
    // skip then blocks a re-run for those accounts. Recovery: super-admin
    // deleteYear (the sanctioned rollover undo), then roll over again.
    const created = await db
      .insert(invoices)
      .values(
        plans.map((p) => ({
          accountId: p.accountId,
          yearId: toYear.id,
          category: p.category,
          semester: p.semester,
          students: p.students,
          // Counts-only: prices/GST/TDS/advanceAdj take their schema defaults.
          invoiceDate: null,
          status: "draft" as const,
          createdBy: user.id,
          updatedBy: user.id,
        })),
      )
      .returning({ id: invoices.id });
    result.invoicesCreated = created.length;

    const cohortValues = plans.flatMap((p, i) =>
      p.batches.map((b) => ({
        invoiceId: created[i].id,
        enrollmentYear: b.enrollmentYear,
        count: b.count,
        priceToUni: null,
        priceToDatagami: null,
        createdBy: user.id,
        updatedBy: user.id,
      })),
    );
    if (cohortValues.length) await db.insert(cohorts).values(cohortValues);
  }

  return result;
}

/** Delete ALL of a year's invoices (and their cascaded cohorts/payments); super-admin only (undo a rollover). */
export async function deleteYear(
  user: SessionUser,
  yearLabel: string,
): Promise<void> {
  if (!user.roles.includes("super-admin")) throw new Error("Only super-admin can delete a year");
  const [year] = await db
    .select()
    .from(academicYears)
    .where(eq(academicYears.label, yearLabel))
    .limit(1);
  if (!year) return;
  const ids = (
    await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.yearId, year.id))
  ).map((r) => r.id);
  if (ids.length) {
    // Pre-stamp cascade children so their DELETE audit rows carry the
    // deleter (spec §4 Cascades; mirrors deleteGroup).
    await db.update(cohorts).set({ updatedBy: user.id }).where(inArray(cohorts.invoiceId, ids));
    await db.update(payments).set({ updatedBy: user.id }).where(inArray(payments.invoiceId, ids));
    await stampedDeleteWhere(invoices, inArray(invoices.id, ids), user.id);
  }
  await stampedDelete(academicYears, year.id, user.id);
}
