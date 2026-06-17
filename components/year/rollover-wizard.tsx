"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { computeInvoice } from "@/lib/money/compute";
import type { Category, Semester } from "@/lib/money/types";
import { rolloverAction } from "@/app/(app)/new-year/actions";
import type { RolloverPlanRow } from "@/lib/dal/rollover";

const CATEGORY_LABEL: Record<string, string> = {
  advance: "Advance",
  old: "Old students",
  new: "New students",
};
function streamLabel(r: RolloverPlanRow) {
  const base = CATEGORY_LABEL[r.category] ?? r.category;
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
  const [counts, setCounts] = useState<Record<number, number>>(() =>
    Object.fromEntries(rows.map((r) => [r.invoiceId, r.students])),
  );
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<null | { created: number; accounts: number }>(null);
  const [error, setError] = useState<string | null>(null);

  const projected = useMemo(() => {
    let billing = 0;
    let margin = 0;
    for (const r of rows) {
      const c = computeInvoice({
        category: r.category as Category,
        semester: r.semester as Semester,
        students: counts[r.invoiceId] ?? r.students,
        priceToUni: r.priceToUni,
        priceToDatagami: r.priceToDatagami,
        gstRate: r.gstRate,
        tdsRate: r.tdsRate,
        advanceAdj: r.advanceAdj,
      });
      billing += c.billing;
      margin += c.netMargin;
    }
    return { billing, margin };
  }, [rows, counts]);

  function create() {
    setError(null);
    const overrides: Record<number, number> = {};
    for (const r of rows) {
      const v = counts[r.invoiceId];
      if (v != null && v !== r.students) overrides[r.invoiceId] = v;
    }
    startTransition(async () => {
      try {
        const res = await rolloverAction(fromYear, toYear, overrides);
        setDone({ created: res.invoicesCreated, accounts: res.accountsRolled });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Rollover failed");
      }
    });
  }

  if (done) {
    return (
      <Card className="p-6">
        <h3 className="text-base font-semibold text-text-primary">
          {toYear} created as Draft ✓
        </h3>
        <p className="mt-1 text-sm text-text-secondary">
          {done.created} invoices across {done.accounts} accounts were cloned from {fromYear} as
          Draft. {fromYear} is unchanged.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => router.push("/dashboard")}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-fg hover:opacity-90"
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
          Switch the year in the top bar to {toYear} to see the new Draft year.
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
        <div className="ml-auto flex items-end gap-6">
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wide text-text-muted">Projected billing</div>
            <Money value={projected.billing} compact className="text-lg font-semibold" />
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wide text-text-muted">Projected margin</div>
            <Money value={projected.margin} compact tone="positive" className="text-lg font-semibold" />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={`Cloned streams → ${toYear}`}
          subtitle="prices carried forward · edit student counts for the new year"
        />
        <div className="max-h-[460px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-sunken">
              <tr className="text-left text-xs text-text-muted">
                <th className="px-5 py-2.5 font-medium">Account</th>
                <th className="px-3 py-2.5 font-medium">Stream</th>
                <th className="px-3 py-2.5 text-right font-medium">New count</th>
                <th className="px-3 py-2.5 text-right font-medium">Proj. billing</th>
                <th className="px-5 py-2.5 text-right font-medium">Proj. margin</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const c = computeInvoice({
                  category: r.category as Category,
                  semester: r.semester as Semester,
                  students: counts[r.invoiceId] ?? r.students,
                  priceToUni: r.priceToUni,
                  priceToDatagami: r.priceToDatagami,
                  gstRate: r.gstRate,
                  tdsRate: r.tdsRate,
                  advanceAdj: r.advanceAdj,
                });
                return (
                  <tr key={r.invoiceId} className="border-b border-border-subtle last:border-0">
                    <td className="px-5 py-2 font-medium text-text-primary">{r.accountName}</td>
                    <td className="px-3 py-2 text-text-secondary">{streamLabel(r)}</td>
                    <td className="px-3 py-2 text-right">
                      {r.category === "advance" ? (
                        <span className="text-text-muted">—</span>
                      ) : (
                        <input
                          type="number"
                          value={counts[r.invoiceId] ?? r.students}
                          onChange={(e) =>
                            setCounts((p) => ({
                              ...p,
                              [r.invoiceId]: parseInt(e.target.value, 10) || 0,
                            }))
                          }
                          className="tabular w-20 rounded-md border border-border-strong bg-surface px-2 py-1 text-right text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 text-right"><Money value={c.billing} compact /></td>
                    <td className="px-5 py-2 text-right"><Money value={c.netMargin} compact tone="auto" /></td>
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
