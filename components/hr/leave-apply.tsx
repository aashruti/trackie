"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import type { LeaveTypeRow, LeaveRequestRow, BalanceLedgerRow } from "@/lib/dal/hr/leave";
import { applyLeaveAction } from "@/app/(app)/me/leave/actions";

type BalanceType = BalanceLedgerRow["types"][number];

function fmt(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });
}
function range(a: string, b: string) {
  return a === b ? fmt(a) : `${fmt(a)} → ${fmt(b)}`;
}
function typeTone(code: string) {
  return code === "EL" ? "positive" : code === "SL" ? "pending" : code === "CL" ? "info" : "neutral";
}
function statusTone(s: string) {
  return s === "approved" ? "positive" : s === "rejected" ? "negative" : s === "pending" ? "pending" : "neutral";
}
function workingDays(start: string, end: string, half: boolean) {
  if (!start || !end || end < start) return 0;
  if (half) return 0.5;
  let count = 0;
  const d = new Date(start + "T00:00:00Z");
  const last = new Date(end + "T00:00:00Z");
  let guard = 0;
  while (d <= last && guard < 366) {
    if (d.getUTCDay() !== 0) count++;
    d.setUTCDate(d.getUTCDate() + 1);
    guard++;
  }
  return count;
}

const inputCls =
  "w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-[var(--primary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--primary-subtle)]";

export function LeaveApply({
  types,
  balances,
  requests,
}: {
  types: LeaveTypeRow[];
  balances: BalanceType[];
  requests: LeaveRequestRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const [leaveTypeId, setLeaveTypeId] = useState<number | "">(types[0]?.id ?? "");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [reason, setReason] = useState("");

  const days = useMemo(() => workingDays(startDate, endDate || startDate, isHalfDay), [startDate, endDate, isHalfDay]);
  const selectedBalance = balances.find((b) => b.leaveTypeId === leaveTypeId);

  function submit() {
    setError(null);
    if (leaveTypeId === "") return setError("Pick a leave type.");
    if (!startDate) return setError("Pick a start date.");
    const end = endDate || startDate;
    if (end < startDate) return setError("End date is before start date.");
    if (!reason.trim()) return setError("Add a short reason.");
    if (days <= 0) return setError("The selected range has no working days.");

    startTransition(async () => {
      try {
        await applyLeaveAction({
          leaveTypeId: Number(leaveTypeId),
          startDate,
          endDate: end,
          isHalfDay,
          reason: reason.trim(),
        });
        setOk(true);
        setReason("");
        setStartDate("");
        setEndDate("");
        setIsHalfDay(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      {/* Apply form */}
      <div className="space-y-5">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-text-primary">Apply for leave</h2>
          <p className="mt-0.5 text-sm text-text-secondary">Requests go to HR for approval.</p>
        </div>

        <div className="space-y-4 rounded-xl border border-border bg-surface p-5">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Leave type</span>
            <select value={leaveTypeId} onChange={(e) => setLeaveTypeId(Number(e.target.value))} className={inputCls}>
              {types.map((t) => (
                <option key={t.id} value={t.id}>{t.name}{t.isPaid ? "" : " (unpaid)"}</option>
              ))}
            </select>
            {selectedBalance && (
              <span className="mt-1 block text-[11px] text-text-muted">
                Remaining balance: <span className="tabular font-semibold text-text-secondary">{selectedBalance.pending}</span> day(s)
              </span>
            )}
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Start date</span>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-text-muted">End date</span>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={isHalfDay} className={`${inputCls} disabled:opacity-50`} />
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" checked={isHalfDay} onChange={(e) => { setIsHalfDay(e.target.checked); if (e.target.checked) setEndDate(""); }} className="h-4 w-4 accent-[var(--primary)]" />
            Half day
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Reason</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Brief reason for your leave…" className={inputCls} />
          </label>

          <div className="flex items-center justify-between border-t border-border-subtle pt-3">
            <span className="text-sm text-text-secondary">
              {days > 0 ? <>This request is <span className="tabular font-semibold text-text-primary">{days}</span> working day{days === 1 ? "" : "s"}.</> : "Select dates to see the day count."}
            </span>
            <button
              onClick={submit}
              disabled={pending}
              className="rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-fg)] transition-colors hover:bg-[var(--primary-hover)] disabled:opacity-50"
            >
              {pending ? "Submitting…" : "Submit request"}
            </button>
          </div>

          {error && (
            <p className="rounded-md border border-[var(--negative-border)] bg-[var(--negative-subtle)] px-3 py-2 text-sm text-[var(--negative-text)]">{error}</p>
          )}
          {ok && !error && (
            <p className="rounded-md border border-[var(--positive-border)] bg-[var(--positive-subtle)] px-3 py-2 text-sm text-[var(--positive-text)]">Request submitted — HR has been notified.</p>
          )}
        </div>

        {/* My requests */}
        <div>
          <h3 className="mb-2 text-sm font-semibold text-text-primary">My requests</h3>
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-sunken text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">Dates</th>
                  <th className="px-4 py-2.5 text-right">Days</th>
                  <th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {requests.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-text-muted">No requests yet.</td></tr>
                )}
                {requests.map((r) => (
                  <tr key={r.id} className="border-b border-border-subtle last:border-0">
                    <td className="px-4 py-2.5"><Badge tone={typeTone(r.leaveTypeCode)}>{r.leaveTypeName}</Badge></td>
                    <td className="px-4 py-2.5 text-text-secondary">{range(r.startDate, r.endDate)}</td>
                    <td className="px-4 py-2.5 text-right tabular text-text-secondary">{r.days}</td>
                    <td className="px-4 py-2.5"><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Balances */}
      <aside className="space-y-2">
        <h3 className="text-sm font-semibold text-text-primary">My balances</h3>
        <div className="space-y-2 rounded-xl border border-border bg-surface p-4">
          {balances.length === 0 && <p className="text-sm text-text-muted">No balances set.</p>}
          {balances.map((b) => (
            <div key={b.leaveTypeId} className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm text-text-secondary">
                <Badge tone={typeTone(b.code)}>{b.name}</Badge>
              </span>
              <span className="tabular text-sm font-semibold text-text-primary">{b.pending}</span>
            </div>
          ))}
          <p className="border-t border-border-subtle pt-2 text-[11px] text-text-muted">
            Balance = carry-forward + accrued − used.
          </p>
        </div>
      </aside>
    </div>
  );
}
