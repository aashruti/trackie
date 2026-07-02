"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import type { LeaveRequestRow, BalanceLedgerRow } from "@/lib/dal/hr/leave";
import { reviewLeaveAction } from "@/app/(app)/hr/leave/actions";

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}
function fmt(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });
}
function fmtDT(dt: Date | string) {
  return new Date(dt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
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

type Tab = "approvals" | "ledger" | "all";

export function LeaveManager({
  pending,
  all,
  ledger,
}: {
  pending: LeaveRequestRow[];
  all: LeaveRequestRow[];
  ledger: BalanceLedgerRow[];
}) {
  const [tab, setTab] = useState<Tab>("approvals");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight text-text-primary">Leave</h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            Approvals queue · {pending.length} pending
          </p>
        </div>
        {tab === "all" && (
          <button
            onClick={() => exportCsv(all)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border-strong px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-hover"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
            Export CSV
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {([
          ["approvals", `Approvals${pending.length ? ` · ${pending.length}` : ""}`],
          ["ledger", "Balance ledger"],
          ["all", "All requests"],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? "border-[var(--primary)] text-text-primary"
                : "border-transparent text-text-secondary hover:text-text-primary"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "approvals" && <Approvals pending={pending} />}
      {tab === "ledger" && <Ledger ledger={ledger} />}
      {tab === "all" && <AllRequests all={all} />}
    </div>
  );
}

function Approvals({ pending }: { pending: LeaveRequestRow[] }) {
  if (!pending.length) {
    return (
      <div className="rounded-xl border border-border bg-surface px-4 py-12 text-center text-sm text-text-muted">
        Nothing awaiting approval. 🎉
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {pending.map((r) => (
        <ApprovalCard key={r.id} r={r} />
      ))}
    </div>
  );
}

function ApprovalCard({ r }: { r: LeaveRequestRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function decide(decision: "approved" | "rejected") {
    setError(null);
    startTransition(async () => {
      try {
        const res = await reviewLeaveAction(r.id, decision, decision === "rejected" ? note.trim() || null : null);
        if (res && !res.ok) {
          // e.g. insufficient-balance guard — show it inline instead of crashing.
          setError(res.error);
          return;
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not process this request.");
      }
    });
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--primary-subtle)] text-xs font-bold text-[var(--primary-text)]">
          {initials(r.employeeName)}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-text-primary">{r.employeeName}</span>
            <span className="text-xs text-text-muted">{r.employeeCode}</span>
            <Badge tone={typeTone(r.leaveTypeCode)}>{r.leaveTypeName}</Badge>
          </div>
          <div className="mt-0.5 text-sm text-text-secondary">
            {range(r.startDate, r.endDate)} · <span className="tabular">{r.days}</span> day{r.days === 1 ? "" : "s"}
            {r.isHalfDay && " (half)"}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="mr-1 text-xs text-text-muted">applied {fmtDT(r.createdAt)}</span>
          {!rejecting && (
            <>
              <button
                onClick={() => setRejecting(true)}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-hover disabled:opacity-50"
              >
                Reject
              </button>
              <button
                onClick={() => decide("approved")}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--positive)] px-3.5 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "…" : "Approve"}
              </button>
            </>
          )}
        </div>
      </div>
      {r.reason && !rejecting && (
        <p className="mt-2 border-t border-border-subtle pt-2 text-sm text-text-secondary">{r.reason}</p>
      )}
      {error && (
        <p className="mt-2 rounded-md border border-[var(--negative-border)] bg-[var(--negative-subtle)] px-3 py-2 text-sm text-[var(--negative-text)]">
          {error}
        </p>
      )}
      {rejecting && (
        <div className="mt-3 flex items-center gap-2 border-t border-border-subtle pt-3">
          <input
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reason for rejection (optional)"
            className="flex-1 rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-[var(--primary)] focus:outline-none"
          />
          <button onClick={() => setRejecting(false)} className="rounded-md px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-hover">Cancel</button>
          <button
            onClick={() => decide("rejected")}
            disabled={pending}
            className="rounded-md bg-[var(--negative)] px-3.5 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "…" : "Confirm reject"}
          </button>
        </div>
      )}
    </div>
  );
}

function Ledger({ ledger }: { ledger: BalanceLedgerRow[] }) {
  if (!ledger.length) {
    return <div className="rounded-xl border border-border bg-surface px-4 py-12 text-center text-sm text-text-muted">No employees.</div>;
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-sunken text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            <th className="px-4 py-3">Employee</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3 text-right">Entitlement</th>
            <th className="px-4 py-3 text-right">Carry-fwd</th>
            <th className="px-4 py-3 text-right">Accrued</th>
            <th className="px-4 py-3 text-right">Used</th>
            <th className="px-4 py-3 text-right">Unpaid</th>
            <th className="px-4 py-3 text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          {ledger.map((emp) =>
            emp.types.map((t, i) => (
              <tr key={`${emp.employeeId}:${t.leaveTypeId}`} className="border-b border-border-subtle last:border-0">
                <td className="px-4 py-2.5">
                  {i === 0 && (
                    <div className="leading-tight">
                      <div className="font-medium text-text-primary">{emp.employeeName}</div>
                      <div className="text-[11px] text-text-muted">{emp.employeeCode}</div>
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5"><Badge tone={typeTone(t.code)}>{t.name}</Badge></td>
                <td className="px-4 py-2.5 text-right tabular text-text-secondary">{t.entitlement}</td>
                <td className="px-4 py-2.5 text-right tabular text-text-secondary">{t.carriedForward}</td>
                <td className="px-4 py-2.5 text-right tabular text-text-secondary">{t.accrued}</td>
                <td className="px-4 py-2.5 text-right tabular text-text-secondary">{t.used}</td>
                <td className="px-4 py-2.5 text-right tabular text-text-secondary">{t.unpaidTaken}</td>
                <td className="px-4 py-2.5 text-right tabular font-semibold text-text-primary">{t.pending}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}

function AllRequests({ all }: { all: LeaveRequestRow[] }) {
  const [status, setStatus] = useState<string>("all");
  const filtered = useMemo(
    () => (status === "all" ? all : all.filter((r) => r.status === status)),
    [all, status],
  );
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {["all", "pending", "approved", "rejected"].map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors ${
              status === s
                ? "border-[var(--primary)] bg-[var(--primary-subtle)] text-[var(--primary-text)]"
                : "border-border text-text-secondary hover:bg-surface-hover"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-sunken text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              <th className="px-4 py-3">Employee</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Dates</th>
              <th className="px-4 py-3 text-right">Days</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-text-muted">No requests.</td></tr>
            )}
            {filtered.map((r) => (
              <tr key={r.id} className="border-b border-border-subtle last:border-0">
                <td className="px-4 py-2.5">
                  <div className="leading-tight">
                    <div className="font-medium text-text-primary">{r.employeeName}</div>
                    <div className="text-[11px] text-text-muted">{r.employeeCode}</div>
                  </div>
                </td>
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
  );
}

function exportCsv(rows: LeaveRequestRow[]) {
  const head = ["Employee", "Code", "Type", "Start", "End", "Days", "Status", "Reason"];
  const body = rows.map((r) =>
    [r.employeeName, r.employeeCode, r.leaveTypeName, r.startDate, r.endDate, r.days, r.status, r.reason]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(","),
  );
  const csv = [head.join(","), ...body].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "leave-requests.csv";
  a.click();
  URL.revokeObjectURL(url);
}
