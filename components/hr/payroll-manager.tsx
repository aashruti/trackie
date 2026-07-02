"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MonthSwitcher } from "@/components/hr/month-switcher";
import { generatePayrollAction, finalizePayrollAction } from "@/app/(app)/hr/payroll/actions";
import type { PayrollPreview, PayrollRunDetail, PayrollRunRow, PayslipLine } from "@/lib/dal/hr/payroll";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const iso = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
const round2 = (n: number) => Math.round(n * 100) / 100;

export function PayrollManager({
  preview,
  savedRun,
  runs,
  year,
  month,
  monthLabel,
}: {
  preview: PayrollPreview;
  savedRun: PayrollRunDetail | null;
  runs: PayrollRunRow[];
  year: number;
  month: number;
  monthLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<PayslipLine | null>(null);

  const status: "none" | "draft" | "finalized" = savedRun ? savedRun.run.status : "none";
  const lines = savedRun ? savedRun.lines : preview.lines;
  const totals = savedRun ? savedRun.totals : preview.totals;

  function generate() {
    setError(null);
    startTransition(async () => {
      const res = await generatePayrollAction(year, month);
      if (!res.ok) { setError(res.error); return; }
      router.refresh();
    });
  }
  function finalize() {
    if (!savedRun) return;
    if (!confirm(`Finalize ${monthLabel}? Payslips lock and become visible to employees.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await finalizePayrollAction(savedRun.run.id);
      if (!res.ok) { setError(res.error); return; }
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-text-primary">Payroll</h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            Cycle {iso(savedRun ? savedRun.run.cycleStart : preview.cycleStart)} – {iso(savedRun ? savedRun.run.cycleEnd : preview.cycleEnd)} · {monthLabel}
          </p>
        </div>
        <MonthSwitcher year={year} month={month} />
      </div>

      {/* Status + actions */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
        <StatusChip status={status} finalizedAt={savedRun?.run.finalizedAt ?? null} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {status !== "finalized" && (
            <button onClick={generate} disabled={pending}
              className="rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-fg)] transition-colors hover:bg-[var(--primary-hover)] disabled:opacity-50">
              {pending ? "Working…" : status === "draft" ? "Regenerate draft" : "Generate draft"}
            </button>
          )}
          {status === "draft" && (
            <button onClick={finalize} disabled={pending}
              className="rounded-md border border-[var(--positive-border)] bg-[var(--positive-subtle)] px-4 py-2 text-sm font-semibold text-[var(--positive-text)] transition-colors hover:brightness-95 disabled:opacity-50">
              Finalize &amp; lock
            </button>
          )}
          {savedRun && (
            <a href={`/hr/payroll/export?year=${year}&month=${month}`}
              className="rounded-md border border-border-strong px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-hover">
              Export .xlsx
            </a>
          )}
        </div>
      </div>

      {error && <p className="rounded-md border border-[var(--negative-border)] bg-[var(--negative-subtle)] px-3 py-2 text-sm text-[var(--negative-text)]">{error}</p>}
      {status === "none" && (
        <p className="text-sm text-text-muted">Live preview from committed attendance — not saved yet. Click “Generate draft” to persist payslips.</p>
      )}

      {/* Totals */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Gross (base)" value={inr(totals.base)} />
        <Stat label="LOP deduction" value={inr(totals.lop)} tone={totals.lop ? "text-[var(--negative-text)]" : undefined} />
        <Stat label="Net payable" value={inr(totals.net)} tone="text-[var(--positive-text)]" />
      </div>

      {/* Payslip table */}
      {lines.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface px-4 py-12 text-center text-sm text-text-muted">No active employees.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-sunken text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                <th className="px-3 py-2 text-left">Employee</th>
                <th className="px-3 py-2 text-right">Gross</th>
                <th className="px-3 py-2 text-right">Per day</th>
                <th className="px-3 py-2 text-right">Days worked</th>
                <th className="px-3 py-2 text-right">LOP days</th>
                <th className="px-3 py-2 text-right">Earned</th>
                <th className="px-3 py-2 text-right">Deductions</th>
                <th className="px-3 py-2 text-right">Net ₹</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const deductions = round2(l.insurance + l.professionalTax + l.tds - l.additions);
                return (
                <tr key={l.employeeId} onClick={() => setDetail(l)}
                  className="cursor-pointer border-b border-border-subtle last:border-0 hover:bg-surface-hover">
                  <td className="px-3 py-2">
                    <div className="font-medium text-text-primary">{l.name}</div>
                    <div className="text-[11px] text-text-muted">{l.employeeCode}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular text-text-secondary">{l.baseSalary.toLocaleString("en-IN")}</td>
                  <td className="px-3 py-2 text-right tabular text-text-secondary">{l.perDay.toLocaleString("en-IN")}</td>
                  <td className={`px-3 py-2 text-right tabular ${l.lopDays ? "text-[var(--negative-text)]" : "text-text-secondary"}`}>{l.daysWorked}</td>
                  <td className={`px-3 py-2 text-right tabular ${l.lopDays ? "text-[var(--negative-text)]" : "text-text-muted"}`}>{l.lopDays}</td>
                  <td className="px-3 py-2 text-right tabular text-text-secondary">{l.earnedGross.toLocaleString("en-IN")}</td>
                  <td className={`px-3 py-2 text-right tabular ${deductions ? "text-[var(--negative-text)]" : "text-text-muted"}`}>{deductions.toLocaleString("en-IN")}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular text-text-primary">{l.netPay.toLocaleString("en-IN")}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-text-muted">Click a row for the calculation breakdown.</p>

      {/* Runs history */}
      {runs.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-text-primary">All runs</h3>
          <div className="flex flex-wrap gap-2">
            {runs.map((r) => (
              <Link key={r.id} href={`/hr/payroll?month=${r.year}-${String(r.month).padStart(2, "0")}`}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-surface-hover ${r.year === year && r.month === month ? "border-[var(--primary)] bg-[var(--primary-subtle)]" : "border-border bg-surface"}`}>
                <span className="font-medium text-text-primary">{MONTHS[r.month - 1]} {r.year}</span>
                <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${r.status === "finalized" ? "bg-[var(--positive-subtle)] text-[var(--positive-text)]" : "bg-[var(--pending-subtle)] text-[var(--pending-text)]"}`}>{r.status}</span>
                <span className="ml-2 text-[11px] text-text-muted">{inr(r.totalNet)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {detail && <BreakdownModal line={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function StatusChip({ status, finalizedAt }: { status: "none" | "draft" | "finalized"; finalizedAt: Date | null }) {
  if (status === "finalized")
    return (
      <span className="inline-flex items-center gap-2 text-sm">
        <span className="rounded-full bg-[var(--positive-subtle)] px-2.5 py-1 text-xs font-semibold text-[var(--positive-text)]">Finalized · locked</span>
        {finalizedAt && <span className="text-[11px] text-text-muted">{new Date(finalizedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>}
      </span>
    );
  if (status === "draft")
    return <span className="rounded-full bg-[var(--pending-subtle)] px-2.5 py-1 text-xs font-semibold text-[var(--pending-text)]">Draft — not locked</span>;
  return <span className="rounded-full bg-[var(--neutral-status-subtle)] px-2.5 py-1 text-xs font-semibold text-text-muted">Not generated</span>;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular ${tone ?? "text-text-primary"}`}>{value}</div>
    </div>
  );
}

function BreakdownModal({ line, onClose }: { line: PayslipLine; onClose: () => void }) {
  const b = line.breakdown;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-[1px]" />
      <div className="relative w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Payslip breakdown</div>
        <div className="mb-3 text-sm font-semibold text-text-primary">{line.name} · {line.employeeCode}</div>
        {b ? (
          <dl className="space-y-1.5 text-sm">
            <Row k="Gross salary" v={inr(b.gross)} />
            <Row k="Basic (40%)" v={inr(b.basic)} />
            <Row k="HRA (16%)" v={inr(b.hra)} />
            <Row k="Other allowance (44%)" v={inr(b.otherAllowance)} />
            <div className="my-2 border-t border-border-subtle" />
            <Row k={`Per day (gross ÷ ${b.daysInMonth})`} v={inr(b.perDay)} />
            <Row k="Present days" v={String(b.presentDays)} />
            <Row k="Paid leave days" v={String(b.paidLeaveDays)} />
            <Row k="LOP from unpaid days (unpaid/½/HR-marked)" v={String(b.lop.fromDays)} />
            <Row k={`LOP from lates (${b.lateCount} late ÷ policy)`} v={String(b.lop.fromLate)} />
            <Row k="Total LOP days" v={String(b.lop.total)} strong />
            <Row k={`Days worked (${b.daysInMonth} − LOP)`} v={String(b.daysWorked)} strong />
            <div className="my-2 border-t border-border-subtle" />
            <Row k="Earned (per day × days worked)" v={inr(b.earnedGross)} strong />
            {b.insurance > 0 && <Row k="Insurance" v={"− " + inr(b.insurance)} tone="text-[var(--negative-text)]" />}
            {b.professionalTax > 0 && <Row k="Professional tax" v={"− " + inr(b.professionalTax)} tone="text-[var(--negative-text)]" />}
            {b.tds > 0 && <Row k="TDS" v={"− " + inr(b.tds)} tone="text-[var(--negative-text)]" />}
            {b.additions > 0 && <Row k="Additions" v={"+ " + inr(b.additions)} tone="text-[var(--positive-text)]" />}
            <div className="my-2 border-t border-border-subtle" />
            <Row k="Net pay" v={inr(b.netPay)} strong tone="text-[var(--positive-text)]" />
          </dl>
        ) : (
          <p className="text-sm text-text-muted">No breakdown stored.</p>
        )}
        <button onClick={onClose} className="mt-4 w-full rounded-md px-3 py-2 text-sm text-text-secondary hover:bg-surface-hover">Close</button>
      </div>
    </div>
  );
}

function Row({ k, v, strong, tone }: { k: string; v: string; strong?: boolean; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-text-secondary">{k}</dt>
      <dd className={`tabular ${strong ? "font-semibold" : ""} ${tone ?? "text-text-primary"}`}>{v}</dd>
    </div>
  );
}
