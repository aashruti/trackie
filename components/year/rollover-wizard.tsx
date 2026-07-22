"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { prevFyLabel } from "@/lib/fy";
import { rolloverAction } from "@/app/(app)/new-year/actions";
import type { RolloverEdits, RolloverPlanRow } from "@/lib/dal/rollover";
import { CATEGORY_LABEL, type ReportCategory } from "@/lib/money/report-view";

// RolloverPlanRow.category is DAL-typed as plain string, not the Category enum
// (see lib/dal/rollover.ts), so keep the runtime fallback.
function streamLabel(r: RolloverPlanRow) {
  const base = CATEGORY_LABEL[r.category as ReportCategory] ?? r.category;
  return r.semester === "none" ? base : `${base} · ${r.semester === "1" ? "1st" : "2nd"} sem`;
}

export function RolloverWizard({
  fromYear,
  suggestedToYear,
  rows,
}: {
  fromYear: string;
  suggestedToYear: string;
  rows: RolloverPlanRow[];
}) {
  const router = useRouter();
  const [toYear, setToYear] = useState(suggestedToYear);

  // Scalar counts: the carried count for a cohort-less `old` invoice, and the
  // fresh-intake estimate for a `new` invoice. Keyed by SOURCE invoice id.
  const [scalarCounts, setScalarCounts] = useState<Record<number, number>>(() =>
    Object.fromEntries(rows.filter((r) => r.cohorts.length === 0).map((r) => [r.invoiceId, r.students])),
  );
  // Per-batch counts (invoiceId → enrollmentYear → count) for cohort-driven `old` invoices.
  const [cohortCounts, setCohortCounts] = useState<Record<number, Record<string, number>>>(() =>
    Object.fromEntries(
      rows
        .filter((r) => r.cohorts.length > 0)
        .map((r) => [r.invoiceId, Object.fromEntries(r.cohorts.map((c) => [c.enrollmentYear, c.count]))]),
    ),
  );
  // Promoted-batch counts for `new` invoices — the count that joins the target
  // year's `old` invoice as a batch named after `fromYear`.
  const [promotedCounts, setPromotedCounts] = useState<Record<number, number>>(() =>
    Object.fromEntries(rows.filter((r) => r.category === "new").map((r) => [r.invoiceId, r.students])),
  );

  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<null | { created: number; accounts: number; from: string; to: string }>(null);
  const [error, setError] = useState<string | null>(null);

  const prevBatchLabel = useMemo(() => prevFyLabel(fromYear), [fromYear]);

  // Total students the target year will carry, given the current edits.
  const totalStudents = useMemo(() => {
    let total = 0;
    for (const r of rows) {
      if (r.cohorts.length > 0) {
        total += r.cohorts.reduce(
          (a, c) => a + (cohortCounts[r.invoiceId]?.[c.enrollmentYear] ?? c.count),
          0,
        );
      } else if (r.category === "new") {
        total += (promotedCounts[r.invoiceId] ?? r.students) + (scalarCounts[r.invoiceId] ?? r.students);
      } else {
        total += scalarCounts[r.invoiceId] ?? r.students;
      }
    }
    return total;
  }, [rows, cohortCounts, promotedCounts, scalarCounts]);

  function create() {
    setError(null);
    const edits: RolloverEdits = {};
    const scalarChanged: Record<number, number> = {};
    const cohortChanged: Record<number, Record<string, number>> = {};
    const promotedChanged: Record<number, number> = {};

    for (const r of rows) {
      if (r.cohorts.length > 0) {
        const changed: Record<string, number> = {};
        for (const c of r.cohorts) {
          const v = cohortCounts[r.invoiceId]?.[c.enrollmentYear];
          if (v != null && v !== c.count) changed[c.enrollmentYear] = v;
        }
        if (Object.keys(changed).length) cohortChanged[r.invoiceId] = changed;
      } else if (r.category === "new") {
        const p = promotedCounts[r.invoiceId];
        if (p != null && p !== r.students) promotedChanged[r.invoiceId] = p;
        const s = scalarCounts[r.invoiceId];
        if (s != null && s !== r.students) scalarChanged[r.invoiceId] = s;
      } else {
        const v = scalarCounts[r.invoiceId];
        if (v != null && v !== r.students) scalarChanged[r.invoiceId] = v;
      }
    }
    if (Object.keys(scalarChanged).length) edits.scalarCounts = scalarChanged;
    if (Object.keys(cohortChanged).length) edits.cohortCounts = cohortChanged;
    if (Object.keys(promotedChanged).length) edits.promotedCounts = promotedChanged;

    const capturedFrom = fromYear;
    const capturedTo = toYear;
    startTransition(async () => {
      try {
        const res = await rolloverAction(capturedFrom, capturedTo, edits);
        setDone({
          created: res.invoicesCreated,
          accounts: res.accountsRolled,
          from: capturedFrom,
          to: capturedTo,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Rollover failed");
      }
    });
  }

  if (done) {
    return (
      <Card className="p-6">
        <h3 className="text-base font-semibold text-text-primary">
          {done.to} created as Draft ✓
        </h3>
        <p className="mt-1 text-sm text-text-secondary">
          {done.created} invoices across {done.accounts} accounts were carried forward from {done.from} as
          Draft — student counts only. {done.from} is unchanged.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => router.push("/pricing")}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-fg hover:opacity-90"
          >
            Set prices
          </button>
          <button
            onClick={() => router.push("/dashboard")}
            className="rounded-md border border-border-strong px-4 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover"
          >
            Go to dashboard
          </button>
          <button
            onClick={() => router.push("/accounts")}
            className="rounded-md border border-border-strong px-4 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover"
          >
            View accounts
          </button>
        </div>
        <p className="mt-3 text-xs text-text-muted">
          Switch the year in the top bar to {done.to} to see the new Draft year. Prices are not set
          yet — invoices will bill at ₹0 until you set them on the Pricing master screen.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-6 p-5">
        <label className="block">
          <span className="text-xs font-medium text-text-secondary">Roll over from</span>
          <div className="mt-1 rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm font-medium text-text-primary">
            {fromYear}
          </div>
        </label>
        <span className="pb-2 text-text-muted">→</span>
        <label className="block">
          <span className="text-xs font-medium text-text-secondary">New academic year</span>
          <input
            value={toYear}
            onChange={(e) => setToYear(e.target.value)}
            className="mt-1 rounded-md border border-border-strong bg-surface px-3 py-2 text-sm font-medium text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]"
          />
        </label>
        <div className="ml-auto text-right">
          <div className="text-[11px] uppercase tracking-wide text-text-muted">Total students</div>
          <div className="text-lg font-semibold tabular text-text-primary">{totalStudents}</div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={`Carried streams → ${toYear}`}
          subtitle="counts only · set new-year prices afterwards on the Pricing master screen"
        />
        <div className="max-h-[460px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-sunken">
              <tr className="text-left text-xs text-text-muted">
                <th className="px-5 py-2.5 font-medium">Account</th>
                <th className="px-3 py-2.5 font-medium">Stream</th>
                <th className="px-5 py-2.5 text-right font-medium">New-year students</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const hasCohorts = r.cohorts.length > 0;
                const isNew = r.category === "new";
                const cohortTotal = hasCohorts
                  ? r.cohorts.reduce(
                      (a, ch) => a + (cohortCounts[r.invoiceId]?.[ch.enrollmentYear] ?? ch.count),
                      0,
                    )
                  : 0;
                return (
                  <tr key={r.invoiceId} className="border-b border-border-subtle last:border-0 align-top">
                    <td className="px-5 py-2 font-medium text-text-primary">{r.accountName}</td>
                    <td className="px-3 py-2 text-text-secondary">{streamLabel(r)}</td>
                    <td className="px-5 py-2 text-right">
                      {hasCohorts ? (
                        <div className="flex flex-col items-end gap-1">
                          {r.cohorts.map((ch) => (
                            <label key={ch.enrollmentYear} className="flex items-center justify-end gap-1.5">
                              <span className="text-[10px] text-text-muted">{ch.enrollmentYear}</span>
                              <input
                                type="number"
                                value={cohortCounts[r.invoiceId]?.[ch.enrollmentYear] ?? ch.count}
                                onChange={(e) =>
                                  setCohortCounts((p) => ({
                                    ...p,
                                    [r.invoiceId]: {
                                      ...p[r.invoiceId],
                                      [ch.enrollmentYear]: parseInt(e.target.value, 10) || 0,
                                    },
                                  }))
                                }
                                aria-label={`Batch ${ch.enrollmentYear} count`}
                                className="tabular w-16 rounded-md border border-border-strong bg-surface px-2 py-1 text-right text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
                              />
                            </label>
                          ))}
                          <span className="text-[10px] text-text-muted">total {cohortTotal}</span>
                        </div>
                      ) : isNew ? (
                        <div className="flex flex-col items-end gap-1.5">
                          <label className="flex items-center justify-end gap-1.5">
                            <span className="text-[10px] text-text-muted">promoted → batch {fromYear}</span>
                            <input
                              type="number"
                              value={promotedCounts[r.invoiceId] ?? r.students}
                              onChange={(e) =>
                                setPromotedCounts((p) => ({
                                  ...p,
                                  [r.invoiceId]: parseInt(e.target.value, 10) || 0,
                                }))
                              }
                              aria-label="Promoted batch count"
                              className="tabular w-20 rounded-md border border-border-strong bg-surface px-2 py-1 text-right text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
                            />
                          </label>
                          <label className="flex items-center justify-end gap-1.5">
                            <span className="text-[10px] text-text-muted">fresh intake</span>
                            <input
                              type="number"
                              value={scalarCounts[r.invoiceId] ?? r.students}
                              onChange={(e) =>
                                setScalarCounts((p) => ({
                                  ...p,
                                  [r.invoiceId]: parseInt(e.target.value, 10) || 0,
                                }))
                              }
                              aria-label="Fresh intake count"
                              className="tabular w-20 rounded-md border border-border-strong bg-surface px-2 py-1 text-right text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
                            />
                          </label>
                        </div>
                      ) : (
                        <div className="flex flex-col items-end gap-1">
                          <input
                            type="number"
                            value={scalarCounts[r.invoiceId] ?? r.students}
                            onChange={(e) =>
                              setScalarCounts((p) => ({
                                ...p,
                                [r.invoiceId]: parseInt(e.target.value, 10) || 0,
                              }))
                            }
                            aria-label="Carried student count"
                            className="tabular w-20 rounded-md border border-border-strong bg-surface px-2 py-1 text-right text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
                          />
                          <span className="text-[10px] text-text-muted">becomes batch {prevBatchLabel}</span>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {error && <p className="text-sm text-[var(--negative-text)]">{error}</p>}

      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted">
          Creates {rows.length} invoices as <strong>Draft</strong>. {fromYear} stays untouched.
        </p>
        <button
          onClick={create}
          disabled={pending || rows.length === 0}
          className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-fg hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Creating…" : `Create ${toYear} as Draft`}
        </button>
      </div>
    </div>
  );
}
