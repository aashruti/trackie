"use client";

import { useState, useTransition } from "react";
import { updateCohortsAction } from "@/app/(app)/accounts/[id]/actions";

interface Row {
  enrollmentYear: string;
  count: number;
}

export function CohortEditor({
  accountId,
  invoiceId,
  initial,
  onClose,
}: {
  accountId: number;
  invoiceId: number;
  initial: Row[];
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(
    initial.length ? initial.map((r) => ({ ...r })) : [{ enrollmentYear: "", count: 0 }],
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const total = rows.reduce((a, r) => a + (Number(r.count) || 0), 0);

  function update(i: number, patch: Partial<Row>) {
    setRows((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function add() {
    setRows((p) => [...p, { enrollmentYear: "", count: 0 }]);
  }
  function remove(i: number) {
    setRows((p) => p.filter((_, idx) => idx !== i));
  }

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await updateCohortsAction(
          accountId,
          invoiceId,
          rows.filter((r) => r.enrollmentYear.trim()),
        );
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  }

  const inputCls =
    "rounded-md border border-border-strong bg-surface px-2 py-1 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]";

  return (
    <div className="mt-3 rounded-lg border border-[var(--primary-border)] bg-surface-sunken p-4">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
        Edit cohorts · total syncs to student count
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={r.enrollmentYear}
              onChange={(e) => update(i, { enrollmentYear: e.target.value })}
              placeholder="2024-25"
              className={`w-28 ${inputCls}`}
              aria-label="Enrollment year"
            />
            <input
              type="number"
              value={r.count || ""}
              onChange={(e) => update(i, { count: parseInt(e.target.value, 10) || 0 })}
              placeholder="count"
              className={`tabular w-24 ${inputCls}`}
              aria-label="Cohort count"
            />
            <button
              onClick={() => remove(i)}
              className="rounded-md border border-border-strong px-2 py-1 text-xs text-[var(--negative-text)] hover:bg-surface-hover"
              aria-label="Remove cohort"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={add}
        className="mt-2 rounded-md border border-border-strong px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-surface-hover"
      >
        + Add year
      </button>

      <div className="mt-3 flex items-center justify-between border-t border-border-subtle pt-3">
        <span className="text-xs text-text-secondary">
          New total: <span className="tabular font-semibold text-text-primary">{total}</span> students
        </span>
        <div className="flex gap-2">
          <button onClick={onClose} className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={pending}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-fg hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save cohorts"}
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-[var(--negative-text)]">{error}</p>}
    </div>
  );
}
