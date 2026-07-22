"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { prevFyLabel } from "@/lib/fy";
import { rolloverAction } from "@/app/(app)/new-year/actions";
import type { RolloverEdits, RolloverPlanRow } from "@/lib/dal/rollover";
import { streamLabel } from "@/lib/money/report-view";

const countInputCls =
  "tabular w-16 rounded-md border border-border-strong bg-surface px-2 py-1 text-right text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]";

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
  // Batches marked as passing out (graduating) — sent as count 0, which the
  // rollover treats as "do not carry this batch into the new year".
  const [passedOut, setPassedOut] = useState<Record<number, Record<string, boolean>>>({});

  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<null | { created: number; accounts: number; from: string; to: string }>(null);
  const [error, setError] = useState<string | null>(null);

  const prevBatchLabel = useMemo(() => prevFyLabel(fromYear), [fromYear]);

  // The promoted intake is DISPLAYED under the old-students row it will join
  // (that row previews the target-year invoice); `new` rows show only the
  // fresh intake. An intake with no same-semester old row keeps its promoted
  // input on the new row — the rollover creates that old invoice.
  const newBySlot = useMemo(() => {
    const m = new Map<string, RolloverPlanRow[]>();
    for (const r of rows) {
      if (r.category !== "new") continue;
      const k = `${r.accountId}:${r.semester}`;
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return m;
  }, [rows]);
  const oldSlots = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) if (r.category === "old") s.add(`${r.accountId}:${r.semester}`);
    return s;
  }, [rows]);

  const isPassedOut = (invoiceId: number, label: string) => passedOut[invoiceId]?.[label] === true;
  function togglePassOut(invoiceId: number, label: string) {
    setPassedOut((p) => ({
      ...p,
      [invoiceId]: { ...p[invoiceId], [label]: !p[invoiceId]?.[label] },
    }));
  }

  // An old row's target-year total: carried batches (minus passed-out) plus
  // the promoted intakes attached to it.
  const oldRowTotal = useCallback(
    (r: RolloverPlanRow) => {
      const carried =
        r.cohorts.length > 0
          ? r.cohorts.reduce(
              (a, c) =>
                a +
                (isPassedOut(r.invoiceId, c.enrollmentYear)
                  ? 0
                  : (cohortCounts[r.invoiceId]?.[c.enrollmentYear] ?? c.count)),
              0,
            )
          : (scalarCounts[r.invoiceId] ?? r.students);
      const promoted = (newBySlot.get(`${r.accountId}:${r.semester}`) ?? []).reduce(
        (a, n) => a + (promotedCounts[n.invoiceId] ?? n.students),
        0,
      );
      return carried + promoted;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cohortCounts, scalarCounts, promotedCounts, passedOut, newBySlot],
  );

  const totalStudents = useMemo(() => {
    let total = 0;
    for (const r of rows) {
      if (r.category === "old") {
        total += oldRowTotal(r);
      } else {
        // fresh intake; orphan intakes also add their promoted count here
        total += scalarCounts[r.invoiceId] ?? r.students;
        if (!oldSlots.has(`${r.accountId}:${r.semester}`)) {
          total += promotedCounts[r.invoiceId] ?? r.students;
        }
      }
    }
    return total;
  }, [rows, oldRowTotal, scalarCounts, promotedCounts, oldSlots]);

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
          if (isPassedOut(r.invoiceId, c.enrollmentYear)) {
            changed[c.enrollmentYear] = 0; // passed out — not carried
            continue;
          }
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
          {done.created} draft invoices across {done.accounts} accounts carry {done.from}&apos;s student
          counts. The {done.from} intake is now a returning batch. Prices start blank — set them on the
          Pricing master screen; bills are raised as and when needed. {done.from} is unchanged.
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
          Switch the year in the top bar to {done.to} to see the new Draft year.
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
          title={`Student counts → ${toYear}`}
          subtitle={`counts only · the ${fromYear} intake joins Old students as a batch · × marks a batch that passes out · prices are set afterwards on Pricing master`}
        />
        <div className="max-h-[460px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-sunken">
              <tr className="text-left text-xs text-text-muted">
                <th className="px-5 py-2.5 font-medium">Account</th>
                <th className="px-3 py-2.5 font-medium">Stream</th>
                <th className="px-5 py-2.5 text-right font-medium">Student counts for {toYear}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOld = r.category === "old";
                const attachedNew = isOld ? (newBySlot.get(`${r.accountId}:${r.semester}`) ?? []) : [];
                const orphanIntake =
                  r.category === "new" && !oldSlots.has(`${r.accountId}:${r.semester}`);
                return (
                  <tr key={r.invoiceId} className="border-b border-border-subtle last:border-0 align-top">
                    <td className="px-5 py-2 font-medium text-text-primary">{r.accountName}</td>
                    <td className="px-3 py-2 text-text-secondary">{streamLabel(r.category, r.semester)}</td>
                    <td className="px-5 py-2 text-right">
                      {isOld ? (
                        <div className="flex flex-col items-end gap-1">
                          {r.cohorts.map((ch) =>
                            isPassedOut(r.invoiceId, ch.enrollmentYear) ? (
                              <div key={ch.enrollmentYear} className="flex items-center justify-end gap-1.5">
                                <span className="text-[10px] text-text-muted line-through">
                                  {ch.enrollmentYear}
                                </span>
                                <span className="text-[10px] italic text-[var(--negative-text)]">
                                  passes out
                                </span>
                                <button
                                  onClick={() => togglePassOut(r.invoiceId, ch.enrollmentYear)}
                                  aria-label={`Keep batch ${ch.enrollmentYear} of ${r.accountName}`}
                                  className="rounded-md border border-border-strong px-1.5 py-0.5 text-[10px] font-medium text-text-secondary hover:bg-surface-hover"
                                >
                                  undo
                                </button>
                              </div>
                            ) : (
                              <div key={ch.enrollmentYear} className="flex items-center justify-end gap-1.5">
                                <span className="text-[10px] text-text-muted">{ch.enrollmentYear}</span>
                                <input
                                  type="number" min={0}
                                  value={cohortCounts[r.invoiceId]?.[ch.enrollmentYear] ?? ch.count}
                                  onChange={(e) =>
                                    setCohortCounts((p) => ({
                                      ...p,
                                      [r.invoiceId]: {
                                        ...p[r.invoiceId],
                                        [ch.enrollmentYear]: Math.max(0, parseInt(e.target.value, 10) || 0),
                                      },
                                    }))
                                  }
                                  aria-label={`${r.accountName} batch ${ch.enrollmentYear} count`}
                                  className={countInputCls}
                                />
                                <button
                                  onClick={() => togglePassOut(r.invoiceId, ch.enrollmentYear)}
                                  aria-label={`Mark batch ${ch.enrollmentYear} of ${r.accountName} as passed out`}
                                  title="Batch passes out — not carried into the new year"
                                  className="rounded-md border border-border-strong px-1.5 py-0.5 text-[10px] font-medium text-[var(--negative-text)] hover:bg-surface-hover"
                                >
                                  ×
                                </button>
                              </div>
                            ),
                          )}
                          {r.cohorts.length === 0 && (
                            <div className="flex items-center justify-end gap-1.5">
                              <span className="text-[10px] text-text-muted">
                                becomes batch {prevBatchLabel}
                              </span>
                              <input
                                type="number" min={0}
                                value={scalarCounts[r.invoiceId] ?? r.students}
                                onChange={(e) =>
                                  setScalarCounts((p) => ({
                                    ...p,
                                    [r.invoiceId]: Math.max(0, parseInt(e.target.value, 10) || 0),
                                  }))
                                }
                                aria-label={`${r.accountName} carried student count`}
                                className={countInputCls}
                              />
                            </div>
                          )}
                          {attachedNew.map((n) => (
                            <div key={n.invoiceId} className="flex items-center justify-end gap-1.5">
                              <span className="text-[10px] font-medium text-[var(--positive-text)]">
                                {fromYear} · new intake joins
                              </span>
                              <input
                                type="number" min={0}
                                value={promotedCounts[n.invoiceId] ?? n.students}
                                onChange={(e) =>
                                  setPromotedCounts((p) => ({
                                    ...p,
                                    [n.invoiceId]: Math.max(0, parseInt(e.target.value, 10) || 0),
                                  }))
                                }
                                aria-label={`${r.accountName} promoted batch count`}
                                className={countInputCls}
                              />
                            </div>
                          ))}
                          <span className="text-[10px] text-text-muted">total {oldRowTotal(r)}</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-end gap-1.5">
                          {orphanIntake && (
                            <div className="flex items-center justify-end gap-1.5">
                              <span className="text-[10px] font-medium text-[var(--positive-text)]">
                                promoted → old batch {fromYear}
                              </span>
                              <input
                                type="number" min={0}
                                value={promotedCounts[r.invoiceId] ?? r.students}
                                onChange={(e) =>
                                  setPromotedCounts((p) => ({
                                    ...p,
                                    [r.invoiceId]: Math.max(0, parseInt(e.target.value, 10) || 0),
                                  }))
                                }
                                aria-label={`${r.accountName} promoted batch count`}
                                className={countInputCls}
                              />
                            </div>
                          )}
                          <div className="flex items-center justify-end gap-1.5">
                            <span className="text-[10px] text-text-muted">fresh intake {toYear}</span>
                            <input
                              type="number" min={0}
                              value={scalarCounts[r.invoiceId] ?? r.students}
                              onChange={(e) =>
                                setScalarCounts((p) => ({
                                  ...p,
                                  [r.invoiceId]: Math.max(0, parseInt(e.target.value, 10) || 0),
                                }))
                              }
                              aria-label={`${r.accountName} fresh intake count`}
                              className={countInputCls}
                            />
                          </div>
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
          Creates draft invoices for {rows.length} student streams. Advance bills are not carried —
          create them when needed. {fromYear} stays untouched.
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
