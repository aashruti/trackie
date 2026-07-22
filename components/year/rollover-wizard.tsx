"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { batchLabelDesc, prevFyLabel } from "@/lib/fy";
import { rolloverAction } from "@/app/(app)/new-year/actions";
import type { RolloverEdits, RolloverPlanRow } from "@/lib/dal/rollover";

const countInputCls =
  "tabular w-16 rounded-md border border-border-strong bg-surface px-2 py-1 text-right text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]";

const semLabel = (s: string) => (s === "none" ? "" : ` · ${s === "1" ? "1st" : "2nd"} sem`);
const semOrder = (s: string) => (s === "none" ? 0 : parseInt(s, 10));

/** One target-year "Old students · sem" row: the source old invoice (if any)
 *  plus every same-semester `new` intake that promotes into it. */
interface OldDisplayRow {
  semester: string;
  sourceOld?: RolloverPlanRow;
  promotedFrom: RolloverPlanRow[];
}
interface AccountGroup {
  accountId: number;
  accountName: string;
  news: RolloverPlanRow[]; // fresh-intake rows
  olds: OldDisplayRow[];
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
  // Batches marked as passing out (graduating) — sent as count 0, which the
  // rollover treats as "do not carry this batch into the new year".
  const [passedOut, setPassedOut] = useState<Record<number, Record<string, boolean>>>({});

  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<null | { created: number; accounts: number; from: string; to: string }>(null);
  const [error, setError] = useState<string | null>(null);

  const prevBatchLabel = useMemo(() => prevFyLabel(fromYear), [fromYear]);

  // Group source invoices by account and synthesize the target-year Old rows.
  // Every `new` intake promotes into an old invoice of its semester (the DAL
  // creates one if none exists), so an account with only `new` streams still
  // gets a proper Old students row here — not the intake crammed onto New.
  const groups = useMemo<AccountGroup[]>(() => {
    const order: number[] = [];
    const map = new Map<number, { name: string; news: RolloverPlanRow[]; olds: RolloverPlanRow[] }>();
    for (const r of rows) {
      if (!map.has(r.accountId)) {
        map.set(r.accountId, { name: r.accountName, news: [], olds: [] });
        order.push(r.accountId);
      }
      const g = map.get(r.accountId)!;
      (r.category === "new" ? g.news : g.olds).push(r);
    }
    return order.map((id) => {
      const g = map.get(id)!;
      const oldBySem = new Map(g.olds.map((o) => [o.semester, o]));
      const sems = new Set<string>([...g.olds.map((o) => o.semester), ...g.news.map((n) => n.semester)]);
      const olds: OldDisplayRow[] = [...sems]
        .sort((a, b) => semOrder(a) - semOrder(b))
        .map((semester) => ({
          semester,
          sourceOld: oldBySem.get(semester),
          promotedFrom: g.news.filter((n) => n.semester === semester),
        }));
      return {
        accountId: id,
        accountName: g.name,
        news: [...g.news].sort((a, b) => semOrder(a.semester) - semOrder(b.semester)),
        olds,
      };
    });
  }, [rows]);

  const freshOf = (n: RolloverPlanRow) => scalarCounts[n.invoiceId] ?? n.students;
  const promotedOf = (n: RolloverPlanRow) => promotedCounts[n.invoiceId] ?? n.students;
  const isPassedOut = (invoiceId: number, label: string) => passedOut[invoiceId]?.[label] === true;
  const carriedOf = (o: RolloverPlanRow, label: string, orig: number) =>
    isPassedOut(o.invoiceId, label) ? 0 : (cohortCounts[o.invoiceId]?.[label] ?? orig);

  function togglePassOut(invoiceId: number, label: string) {
    setPassedOut((p) => ({ ...p, [invoiceId]: { ...p[invoiceId], [label]: !p[invoiceId]?.[label] } }));
  }

  const oldRowTotal = useCallback(
    (o: OldDisplayRow) => {
      let t = o.promotedFrom.reduce((a, n) => a + promotedOf(n), 0);
      if (o.sourceOld) {
        t +=
          o.sourceOld.cohorts.length > 0
            ? o.sourceOld.cohorts.reduce((a, c) => a + carriedOf(o.sourceOld!, c.enrollmentYear, c.count), 0)
            : (scalarCounts[o.sourceOld.invoiceId] ?? o.sourceOld.students);
      }
      return t;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [promotedCounts, cohortCounts, scalarCounts, passedOut],
  );

  const totalStudents = useMemo(() => {
    let total = 0;
    for (const g of groups) {
      for (const n of g.news) total += freshOf(n);
      for (const o of g.olds) total += oldRowTotal(o);
    }
    return total;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, scalarCounts, oldRowTotal]);

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
        <h3 className="text-base font-semibold text-text-primary">{done.to} created as Draft ✓</h3>
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
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-sunken">
              <tr className="text-left text-xs text-text-muted">
                <th className="px-5 py-2.5 font-medium">Stream</th>
                <th className="px-5 py-2.5 text-right font-medium">Student counts for {toYear}</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <FragmentGroup key={g.accountId}>
                  <tr className="border-b border-border-subtle bg-surface-sunken">
                    <td colSpan={2} className="px-5 py-2 text-sm font-semibold text-text-primary">
                      {g.accountName}
                    </td>
                  </tr>

                  {/* New students first (newest — fresh intake for the target year). */}
                  {g.news.map((n) => (
                    <tr key={`n-${n.invoiceId}`} className="border-b border-border-subtle align-top">
                      <td className="px-5 py-2">
                        <span className="rounded bg-[var(--positive-subtle)] px-1.5 py-0.5 text-xs font-medium text-[var(--positive-text)]">
                          New students{semLabel(n.semester)}
                        </span>
                      </td>
                      <td className="px-5 py-2 text-right">
                        <label className="flex items-center justify-end gap-1.5">
                          <span className="text-[10px] text-text-muted">fresh intake {toYear}</span>
                          <input
                            type="number"
                            min={0}
                            value={scalarCounts[n.invoiceId] ?? n.students}
                            onChange={(e) =>
                              setScalarCounts((p) => ({
                                ...p,
                                [n.invoiceId]: Math.max(0, parseInt(e.target.value, 10) || 0),
                              }))
                            }
                            aria-label={`${g.accountName} fresh intake count`}
                            className={countInputCls}
                          />
                        </label>
                      </td>
                    </tr>
                  ))}

                  {/* Old students — carried batches + the promoted intake, newest on top. */}
                  {g.olds.map((o) => {
                    const key = o.sourceOld?.invoiceId ?? `syn-${o.semester}`;
                    const batches = o.sourceOld
                      ? [...o.sourceOld.cohorts].sort((a, b) =>
                          batchLabelDesc(a.enrollmentYear, b.enrollmentYear),
                        )
                      : [];
                    return (
                      <tr key={`o-${key}`} className="border-b border-border-subtle align-top">
                        <td className="px-5 py-2">
                          <span className="rounded bg-[var(--info-subtle)] px-1.5 py-0.5 text-xs font-medium text-[var(--info-text)]">
                            Old students{semLabel(o.semester)}
                          </span>
                        </td>
                        <td className="px-5 py-2 text-right">
                          <div className="flex flex-col items-end gap-1.5">
                            {/* Promoted intake(s) — the newest batch, on top. */}
                            {o.promotedFrom.map((n) => (
                              <label key={`p-${n.invoiceId}`} className="flex items-center justify-end gap-1.5">
                                <span className="text-[10px] font-medium text-[var(--positive-text)]">
                                  {fromYear} · new intake joins
                                </span>
                                <input
                                  type="number"
                                  min={0}
                                  value={promotedCounts[n.invoiceId] ?? n.students}
                                  onChange={(e) =>
                                    setPromotedCounts((p) => ({
                                      ...p,
                                      [n.invoiceId]: Math.max(0, parseInt(e.target.value, 10) || 0),
                                    }))
                                  }
                                  aria-label={`${g.accountName} promoted batch count`}
                                  className={countInputCls}
                                />
                              </label>
                            ))}

                            {/* Carried batches, newest → oldest. */}
                            {batches.map((ch) =>
                              isPassedOut(o.sourceOld!.invoiceId, ch.enrollmentYear) ? (
                                <div key={ch.enrollmentYear} className="flex items-center justify-end gap-1.5">
                                  <span className="text-[10px] text-text-muted line-through">
                                    {ch.enrollmentYear}
                                  </span>
                                  <span className="text-[10px] italic text-[var(--negative-text)]">
                                    passes out
                                  </span>
                                  <button
                                    onClick={() => togglePassOut(o.sourceOld!.invoiceId, ch.enrollmentYear)}
                                    aria-label={`Keep batch ${ch.enrollmentYear} of ${g.accountName}`}
                                    className="rounded-md border border-border-strong px-1.5 py-0.5 text-[10px] font-medium text-text-secondary hover:bg-surface-hover"
                                  >
                                    undo
                                  </button>
                                </div>
                              ) : (
                                <div key={ch.enrollmentYear} className="flex items-center justify-end gap-1.5">
                                  <span className="text-[10px] text-text-muted">{ch.enrollmentYear}</span>
                                  <input
                                    type="number"
                                    min={0}
                                    value={cohortCounts[o.sourceOld!.invoiceId]?.[ch.enrollmentYear] ?? ch.count}
                                    onChange={(e) =>
                                      setCohortCounts((p) => ({
                                        ...p,
                                        [o.sourceOld!.invoiceId]: {
                                          ...p[o.sourceOld!.invoiceId],
                                          [ch.enrollmentYear]: Math.max(0, parseInt(e.target.value, 10) || 0),
                                        },
                                      }))
                                    }
                                    aria-label={`${g.accountName} batch ${ch.enrollmentYear} count`}
                                    className={countInputCls}
                                  />
                                  <button
                                    onClick={() => togglePassOut(o.sourceOld!.invoiceId, ch.enrollmentYear)}
                                    aria-label={`Mark batch ${ch.enrollmentYear} of ${g.accountName} as passed out`}
                                    title="Batch passes out — not carried into the new year"
                                    className="rounded-md border border-border-strong px-1.5 py-0.5 text-[10px] font-medium text-[var(--negative-text)] hover:bg-surface-hover"
                                  >
                                    ×
                                  </button>
                                </div>
                              ),
                            )}

                            {/* Scalar (cohort-less) old invoice → single carried batch. */}
                            {o.sourceOld && o.sourceOld.cohorts.length === 0 && (
                              <label className="flex items-center justify-end gap-1.5">
                                <span className="text-[10px] text-text-muted">becomes batch {prevBatchLabel}</span>
                                <input
                                  type="number"
                                  min={0}
                                  value={scalarCounts[o.sourceOld.invoiceId] ?? o.sourceOld.students}
                                  onChange={(e) =>
                                    setScalarCounts((p) => ({
                                      ...p,
                                      [o.sourceOld!.invoiceId]: Math.max(0, parseInt(e.target.value, 10) || 0),
                                    }))
                                  }
                                  aria-label={`${g.accountName} carried student count`}
                                  className={countInputCls}
                                />
                              </label>
                            )}

                            <span className="text-[10px] text-text-muted">total {oldRowTotal(o)}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </FragmentGroup>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {error && <p className="text-sm text-[var(--negative-text)]">{error}</p>}

      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted">
          Carries {fromYear}&apos;s student counts into {toYear} as <strong>Draft</strong>. Advance bills
          are not carried — create them when needed. {fromYear} stays untouched.
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

/** Table bodies can't take a keyed <Fragment> with a ref, so a tiny wrapper. */
function FragmentGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
