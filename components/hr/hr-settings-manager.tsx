"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { HolidayRow } from "@/lib/dal/hr/holidays";
import { addHolidayAction, deleteHolidayAction, reapplyHolidayAction } from "@/app/(app)/hr/settings/actions";

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function HrSettingsManager({ holidays }: { holidays: HolidayRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [name, setName] = useState("");

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      setBusyId(null);
      if (!res.ok) { setError(res.error ?? "Something went wrong."); return; }
      onOk?.();
      router.refresh();
    });
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!date || !name.trim()) { setError("Pick a date and give the holiday a name."); return; }
    run(() => addHolidayAction(date, name.trim()), () => { setDate(""); setName(""); });
  }

  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  return (
    <div className="max-w-2xl space-y-6">
      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-text-primary">Company holidays</h2>
        <p className="mt-0.5 text-xs text-text-muted">
          Paid, org-wide days off. Adding one marks every active employee “Holiday” for that date (it never overwrites an
          existing attendance mark). For a floating holiday given to just one person, use the day-wise marker instead.
        </p>

        {/* Add form */}
        <form onSubmit={add} className="mt-4 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm text-text-primary focus:border-[var(--primary)] focus:outline-none" />
          </label>
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs font-medium text-text-secondary">
            Name
            <input type="text" value={name} maxLength={120} placeholder="e.g. Independence Day" onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm text-text-primary focus:border-[var(--primary)] focus:outline-none" />
          </label>
          <button type="submit" disabled={pending}
            className="rounded-md bg-[var(--primary)] px-4 py-1.5 text-sm font-semibold text-[var(--primary-fg)] transition-colors hover:bg-[var(--primary-hover)] disabled:opacity-50">
            Add holiday
          </button>
        </form>
        {error && <p className="mt-3 rounded-md border border-[var(--negative-border)] bg-[var(--negative-subtle)] px-3 py-2 text-sm text-[var(--negative-text)]">{error}</p>}

        {/* List */}
        <div className="mt-4 overflow-hidden rounded-lg border border-border">
          {holidays.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-text-muted">No company holidays yet.</p>
          ) : (
            holidays.map((h) => {
              const past = h.date < todayIso;
              return (
                <div key={h.id} className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-4 py-2.5 last:border-0">
                  <div className="min-w-[150px]">
                    <div className={`text-sm font-medium ${past ? "text-text-muted" : "text-text-primary"}`}>{fmtDate(h.date)}</div>
                  </div>
                  <div className="min-w-0 flex-1 text-sm text-text-secondary">{h.name}</div>
                  <span className="shrink-0 rounded-full bg-[var(--neutral-status-subtle)] px-2 py-0.5 text-xs text-text-muted" title="Employees this holiday is applied to">
                    {h.applied} applied
                  </span>
                  <button disabled={pending} onClick={() => { setBusyId(h.id); run(() => reapplyHolidayAction(h.id)); }}
                    className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-hover disabled:opacity-40"
                    title="Re-apply to any employees enrolled since this holiday was added">
                    {busyId === h.id && pending ? "…" : "Re-apply"}
                  </button>
                  <button disabled={pending} onClick={() => { if (confirm(`Delete “${h.name}” (${fmtDate(h.date)})? This removes the auto-applied holiday marks.`)) { setBusyId(h.id); run(() => deleteHolidayAction(h.id)); } }}
                    className="shrink-0 rounded-md border border-[var(--negative-border)] px-2 py-1 text-xs font-medium text-[var(--negative-text)] transition-colors hover:bg-[var(--negative-subtle)] disabled:opacity-40">
                    Delete
                  </button>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
