"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AttendancePreview, MonthGridRow, MonthGridCell } from "@/lib/dal/hr/attendance";
import type { AttendanceDayType } from "@/lib/db/enums";
import { previewAttendanceAction, commitAttendanceAction, overrideAttendanceAction, getEmployeeCalendarAction } from "@/app/(app)/hr/attendance/actions";
import type { MyAttendance } from "@/lib/dal/hr/attendance";

const OVERRIDE_OPTIONS: AttendanceDayType[] = ["office", "half-day", "wfh", "official-visit", "comp-off", "paid-leave", "unpaid-leave", "weekly-off", "holiday", "absent"];

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

type Tab = "upload" | "grid" | "calendar";

export function AttendanceManager({
  grid,
  monthLabel,
  employees,
  year,
  month,
}: {
  grid: { days: string[]; rows: MonthGridRow[] };
  monthLabel: string;
  employees: { id: number; code: string; name: string }[];
  year: number;
  month: number;
}) {
  const [tab, setTab] = useState<Tab>("upload");
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-text-primary">Attendance</h2>
        <p className="mt-0.5 text-sm text-text-secondary">Upload the fingerprint scanner file, review, then commit.</p>
      </div>
      <div className="flex gap-1 border-b border-border">
        {([["upload", "Upload device file"], ["grid", `Month grid · ${monthLabel}`], ["calendar", "Employee calendar"]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${tab === k ? "border-[var(--primary)] text-text-primary" : "border-transparent text-text-secondary hover:text-text-primary"}`}>
            {l}
          </button>
        ))}
      </div>
      {tab === "upload" && <UploadPanel />}
      {tab === "grid" && <GridPanel grid={grid} />}
      {tab === "calendar" && <EmployeeCalendarPanel employees={employees} year={year} month={month} monthLabel={monthLabel} />}
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
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [edit, setEdit] = useState<{ employeeId: number; name: string; date: string } | null>(null);

  function apply(dayType: AttendanceDayType) {
    if (!edit) return;
    startTransition(async () => {
      await overrideAttendanceAction(edit.employeeId, edit.date, dayType);
      setEdit(null);
      router.refresh();
    });
  }

  if (!grid.rows.length) return <div className="rounded-xl border border-border bg-surface px-4 py-12 text-center text-sm text-text-muted">No employees.</div>;
  const anyData = grid.rows.some((r) => Object.keys(r.cells).length);
  return (
    <div className="space-y-3">
      <Legend />
      <p className="text-[11px] text-text-muted">Click any cell to override it.</p>
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
                  return (
                    <td key={d} className="px-0.5 py-1">
                      <button onClick={() => setEdit({ employeeId: e.employeeId, name: e.name, date: d })} className="att-cell rounded transition-shadow hover:shadow-[inset_0_0_0_2px_var(--primary)]">
                        {c ? <Cell dayType={c.dayType} isLate={c.isLate} isEarlyLeave={c.isEarlyLeave} /> : <div className="grid h-7 w-10 place-items-center text-text-muted">·</div>}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <OverrideModal edit={edit} pending={pending} onPick={apply} onClose={() => setEdit(null)} />}
    </div>
  );
}

function OverrideModal({ edit, pending, onPick, onClose }: { edit: { name: string; date: string }; pending: boolean; onPick: (dt: AttendanceDayType) => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-[1px]" />
      <div className="relative w-full max-w-sm rounded-xl border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Override day</div>
        <div className="mb-3 text-sm font-semibold text-text-primary">{edit.name} · {new Date(edit.date + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}</div>
        <div className="grid grid-cols-2 gap-2">
          {OVERRIDE_OPTIONS.map((dt) => (
            <button key={dt} disabled={pending} onClick={() => onPick(dt)}
              className="flex items-center gap-2 rounded-md border border-border px-2.5 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-hover disabled:opacity-50">
              <Cell dayType={dt} /> <span className="capitalize">{dt.replace("-", " ")}</span>
            </button>
          ))}
        </div>
        <button onClick={onClose} className="mt-3 w-full rounded-md px-3 py-2 text-sm text-text-secondary hover:bg-surface-hover">Cancel</button>
      </div>
    </div>
  );
}

function EmployeeCalendarPanel({ employees, year, month, monthLabel }: { employees: { id: number; code: string; name: string }[]; year: number; month: number; monthLabel: string }) {
  const [empId, setEmpId] = useState<number | "">(employees[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const [data, setData] = useState<(MyAttendance & { name: string; code: string }) | null>(null);

  function load(id: number) {
    startTransition(async () => {
      const res = await getEmployeeCalendarAction(id, year, month);
      if (res.ok) setData(res.data);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select
          value={empId}
          onChange={(e) => { const id = Number(e.target.value); setEmpId(id); load(id); }}
          className="rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text-primary focus:border-[var(--primary)] focus:outline-none"
        >
          {employees.map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}
        </select>
        <button onClick={() => empId !== "" && load(Number(empId))} disabled={pending}
          className="rounded-md border border-border-strong px-3 py-2 text-sm font-medium text-text-secondary hover:bg-surface-hover disabled:opacity-50">
          {pending ? "Loading…" : data ? "Reload" : "Show calendar"}
        </button>
        <span className="text-sm text-text-muted">{monthLabel}</span>
      </div>
      {!data && !pending && <p className="text-sm text-text-muted">Pick an employee and click “Show calendar”.</p>}
      {data && <CalendarView data={data} />}
    </div>
  );
}

function CalendarView({ data }: { data: MyAttendance & { name: string; code: string } }) {
  const firstDow = data.days.length ? new Date(data.days[0] + "T00:00:00Z").getUTCDay() : 0;
  const s = data.summary;
  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold text-text-primary">{data.name} <span className="text-text-muted">{data.code}</span></div>
      <div className="flex flex-wrap gap-4 text-sm text-text-secondary">
        <span>Present <b className="tabular text-text-primary">{s.present}</b></span>
        <span>WFH <b className="tabular text-text-primary">{s.wfh}</b></span>
        <span>Leave <b className="tabular text-text-primary">{s.leave}</b></span>
        <span>Absent <b className="tabular text-[var(--negative-text)]">{s.absent}</b></span>
        <span>Late <b className="tabular text-[var(--pending-text)]">{s.lateCount}</b></span>
        <span>LOP <b className="tabular text-[var(--negative-text)]">{s.lopDays}</b></span>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-2 grid grid-cols-7 gap-1.5 text-center text-[11px] font-semibold text-text-muted">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: firstDow }).map((_, i) => <div key={`p${i}`} />)}
          {data.days.map((d) => {
            const c = data.cells[d];
            const m = c ? DAY_META[c.dayType] : null;
            return (
              <div key={d} className={`relative grid aspect-square place-items-center rounded-md border border-border-subtle ${m ? m.cls : "bg-surface-sunken/40"}`}>
                <span className="absolute left-1 top-0.5 text-[9px] text-text-muted">{dayNum(d)}</span>
                {m && <span className="text-[11px] font-semibold">{m.label}</span>}
                {c?.isLate && <span className="absolute right-0.5 top-0.5 rounded-sm bg-[var(--pending)] px-0.5 text-[7px] font-bold text-[var(--primary-fg)]">LC</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
