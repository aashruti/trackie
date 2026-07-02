"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AttendancePreview, MonthGridRow, MonthGridCell } from "@/lib/dal/hr/attendance";
import type { AttendanceDayType } from "@/lib/db/enums";
import { previewAttendanceAction, commitAttendanceAction } from "@/app/(app)/hr/attendance/actions";

// day_type → short label + tone chip
const DAY_META: Record<AttendanceDayType, { label: string; cls: string }> = {
  office: { label: "P", cls: "bg-[var(--positive-subtle)] text-[var(--positive-text)]" },
  wfh: { label: "WFH", cls: "bg-[var(--info-subtle)] text-[var(--info-text)]" },
  "official-visit": { label: "OV", cls: "bg-[var(--info-subtle)] text-[var(--info-text)]" },
  "comp-off": { label: "CL", cls: "bg-[var(--primary-subtle)] text-[var(--primary-text)]" },
  "paid-leave": { label: "L", cls: "bg-[var(--pending-subtle)] text-[var(--pending-text)]" },
  "unpaid-leave": { label: "LWP", cls: "bg-[var(--negative-subtle)] text-[var(--negative-text)]" },
  "weekly-off": { label: "WO", cls: "bg-surface-sunken text-text-muted" },
  holiday: { label: "H", cls: "bg-surface-sunken text-text-secondary" },
  absent: { label: "A", cls: "bg-[var(--negative-subtle)] text-[var(--negative-text)]" },
  "half-day": { label: "½P", cls: "bg-[var(--pending-subtle)] text-[var(--pending-text)]" },
};

function Cell({ dayType, isLate, isEarlyLeave }: { dayType: AttendanceDayType; isLate?: boolean; isEarlyLeave?: boolean }) {
  const m = DAY_META[dayType];
  return (
    <div className={`relative grid h-7 w-10 place-items-center rounded text-[11px] font-semibold ${m.cls}`}>
      {m.label}
      {isLate && <span className="absolute -right-0.5 -top-1 rounded-sm bg-[var(--pending)] px-0.5 text-[7px] font-bold text-[var(--primary-fg)]">LC</span>}
      {isEarlyLeave && <span className="absolute -bottom-1 -right-0.5 rounded-sm bg-[var(--negative)] px-0.5 text-[7px] font-bold text-white">LE</span>}
    </div>
  );
}

function dayNum(iso: string) {
  return Number(iso.slice(8, 10));
}

const LEGEND: [AttendanceDayType, string][] = [
  ["office", "Present"], ["wfh", "WFH"], ["official-visit", "Official visit"], ["paid-leave", "Leave"],
  ["absent", "Absent"], ["weekly-off", "Weekly off"], ["half-day", "Half day"], ["holiday", "Holiday"],
];
function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-secondary">
      {LEGEND.map(([dt, label]) => (
        <span key={dt} className="inline-flex items-center gap-1"><Cell dayType={dt} /> {label}</span>
      ))}
      <span className="inline-flex items-center gap-1"><span className="rounded-sm bg-[var(--pending)] px-1 text-[8px] font-bold text-[var(--primary-fg)]">LC</span> Late</span>
      <span className="inline-flex items-center gap-1"><span className="rounded-sm bg-[var(--negative)] px-1 text-[8px] font-bold text-white">LE</span> Early</span>
    </div>
  );
}

type Tab = "upload" | "grid";

export function AttendanceManager({
  grid,
  monthLabel,
}: {
  grid: { days: string[]; rows: MonthGridRow[] };
  monthLabel: string;
}) {
  const [tab, setTab] = useState<Tab>("upload");
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-text-primary">Attendance</h2>
        <p className="mt-0.5 text-sm text-text-secondary">Upload the fingerprint scanner file, review, then commit.</p>
      </div>
      <div className="flex gap-1 border-b border-border">
        {([["upload", "Upload device file"], ["grid", `Month grid · ${monthLabel}`]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${tab === k ? "border-[var(--primary)] text-text-primary" : "border-transparent text-text-secondary hover:text-text-primary"}`}>
            {l}
          </button>
        ))}
      </div>
      {tab === "upload" ? <UploadPanel /> : <GridPanel grid={grid} />}
    </div>
  );
}

function UploadPanel() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<AttendancePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const fileRef = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function onPick(file: File | null) {
    setError(null); setDone(null); setPreview(null);
    if (!file) return;
    fileRef.current = file;
    const fd = new FormData();
    fd.append("file", file);
    startTransition(async () => {
      const res = await previewAttendanceAction(fd);
      if (!res.ok) { setError(res.error); return; }
      setPreview(res.preview);
    });
  }

  function commit() {
    if (!fileRef.current) return;
    setError(null);
    const fd = new FormData();
    fd.append("file", fileRef.current);
    startTransition(async () => {
      const res = await commitAttendanceAction(fd);
      if (!res.ok) { setError(res.error); return; }
      setDone(`Committed ${res.committed} day records for ${res.matchedEmployees} employees${res.unmatched ? ` · ${res.unmatched} unmatched device codes skipped` : ""}.`);
      setPreview(null);
      fileRef.current = null;
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    });
  }

  const dates = preview ? [...new Set(preview.matched.flatMap((e) => e.records.map((r) => r.date)))].sort() : [];

  return (
    <div className="space-y-4">
      {/* Dropzone */}
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border-strong bg-surface-sunken px-6 py-10 text-center transition-colors hover:border-[var(--primary)]">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted"><path d="M12 15V3M7 8l5-5 5 5M5 21h14" /></svg>
        <span className="text-sm font-medium text-text-primary">Choose the scanner file (.xls)</span>
        <span className="text-xs text-text-muted">ZKTeco “Basic Work Duration Report”</span>
        <input ref={inputRef} type="file" accept=".xls,.xlsx" className="hidden" onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
      </label>

      {pending && !preview && <p className="text-sm text-text-muted">Reading file…</p>}
      {error && <p className="rounded-md border border-[var(--negative-border)] bg-[var(--negative-subtle)] px-3 py-2 text-sm text-[var(--negative-text)]">{error}</p>}
      {done && <p className="rounded-md border border-[var(--positive-border)] bg-[var(--positive-subtle)] px-3 py-2 text-sm text-[var(--positive-text)]">{done}</p>}

      {preview && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--pending-border)] bg-[var(--pending-subtle)] px-4 py-3">
            <span className="text-sm font-semibold text-[var(--pending-text)]">Preview — not saved yet</span>
            <span className="text-sm text-text-secondary">
              {preview.periodStart} → {preview.periodEnd} · {preview.matched.length} matched employees · {preview.unmatched.length} unmatched codes
            </span>
            <button onClick={commit} disabled={pending}
              className="ml-auto rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-fg)] transition-colors hover:bg-[var(--primary-hover)] disabled:opacity-50">
              {pending ? "Committing…" : `Commit ${preview.matched.reduce((n, e) => n + e.records.length, 0)} records`}
            </button>
          </div>

          <Legend />

          {/* Unmatched codes */}
          {preview.unmatched.length > 0 && (
            <div className="rounded-lg border border-[var(--negative-border)] bg-[var(--negative-subtle)] p-3">
              <div className="mb-1 text-sm font-semibold text-[var(--negative-text)]">Unmatched device codes (skipped)</div>
              <div className="text-xs text-text-secondary">
                {preview.unmatched.map((u) => `#${u.code}${u.name ? ` (${u.name})` : ""} — ${u.days}d`).join("  ·  ")}
              </div>
              <div className="mt-1 text-[11px] text-text-muted">Set these enrollment numbers as an employee’s Biometric # (Employees → edit) to include them next time.</div>
            </div>
          )}

          <PreviewGrid dates={dates} matched={preview.matched} />
        </div>
      )}
    </div>
  );
}

function PreviewGrid({ dates, matched }: { dates: string[]; matched: AttendancePreview["matched"] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-sunken">
            <th className="sticky left-0 z-10 bg-surface-sunken px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">Employee</th>
            {dates.map((d) => (
              <th key={d} className="px-1 py-2 text-center text-[10px] font-semibold text-text-muted">{dayNum(d)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matched.map((e) => {
            const byDate = new Map(e.records.map((r) => [r.date, r]));
            return (
              <tr key={e.employeeId} className="border-b border-border-subtle last:border-0">
                <td className="sticky left-0 z-10 bg-surface px-3 py-1.5 leading-tight">
                  <div className="font-medium text-text-primary">{e.name}</div>
                  <div className="text-[11px] text-text-muted">{e.employeeCode}</div>
                </td>
                {dates.map((d) => {
                  const r = byDate.get(d);
                  return <td key={d} className="px-0.5 py-1">{r ? <Cell dayType={r.dayType} isLate={r.isLate} isEarlyLeave={r.isEarlyLeave} /> : <div className="h-7 w-10" />}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GridPanel({ grid }: { grid: { days: string[]; rows: MonthGridRow[] } }) {
  if (!grid.rows.length) return <div className="rounded-xl border border-border bg-surface px-4 py-12 text-center text-sm text-text-muted">No employees.</div>;
  const anyData = grid.rows.some((r) => Object.keys(r.cells).length);
  return (
    <div className="space-y-3">
      <Legend />
      {!anyData && <p className="text-sm text-text-muted">No attendance committed for this month yet — upload a device file.</p>}
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-sunken">
              <th className="sticky left-0 z-10 bg-surface-sunken px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">Employee</th>
              {grid.days.map((d) => <th key={d} className="px-1 py-2 text-center text-[10px] font-semibold text-text-muted">{dayNum(d)}</th>)}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((e) => (
              <tr key={e.employeeId} className="border-b border-border-subtle last:border-0">
                <td className="sticky left-0 z-10 bg-surface px-3 py-1.5 leading-tight">
                  <div className="font-medium text-text-primary">{e.name}</div>
                  <div className="text-[11px] text-text-muted">{e.employeeCode}</div>
                </td>
                {grid.days.map((d) => {
                  const c: MonthGridCell | undefined = e.cells[d];
                  return <td key={d} className="px-0.5 py-1">{c ? <Cell dayType={c.dayType} isLate={c.isLate} isEarlyLeave={c.isEarlyLeave} /> : <div className="h-7 w-10" />}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
