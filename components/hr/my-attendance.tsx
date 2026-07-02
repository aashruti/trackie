import type { MyAttendance } from "@/lib/dal/hr/attendance";
import type { AttendanceDayType } from "@/lib/db/enums";
import { MonthSwitcher } from "@/components/hr/month-switcher";

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

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{label}</div>
      <div className={`mt-0.5 text-xl font-semibold tabular ${tone ?? "text-text-primary"}`}>{value}</div>
    </div>
  );
}

export function MyAttendanceView({ data, monthLabel, year, month }: { data: MyAttendance; monthLabel: string; year: number; month: number }) {
  const { days, cells, summary } = data;
  const firstDow = days.length ? new Date(days[0] + "T00:00:00Z").getUTCDay() : 0; // 0=Sun
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-text-primary">My attendance</h2>
          <p className="mt-0.5 text-sm text-text-secondary">{monthLabel}</p>
        </div>
        <MonthSwitcher year={year} month={month} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Present" value={summary.present} tone="text-[var(--positive-text)]" />
        <Stat label="WFH" value={summary.wfh} />
        <Stat label="Leave" value={summary.leave} />
        <Stat label="Absent" value={summary.absent} tone={summary.absent ? "text-[var(--negative-text)]" : undefined} />
        <Stat label="Late" value={summary.lateCount} tone={summary.lateCount ? "text-[var(--pending-text)]" : undefined} />
        <Stat label="LOP days" value={summary.lopDays} tone={summary.lopDays ? "text-[var(--negative-text)]" : undefined} />
      </div>

      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-2 grid grid-cols-7 gap-1.5 text-center text-[11px] font-semibold text-text-muted">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: firstDow }).map((_, i) => <div key={`pad${i}`} />)}
          {days.map((d) => {
            const c = cells[d];
            const meta = c ? DAY_META[c.dayType] : null;
            return (
              <div key={d} className={`relative grid aspect-square place-items-center rounded-md border border-border-subtle ${meta ? meta.cls : "bg-surface-sunken/40"}`}>
                <span className="absolute left-1 top-0.5 text-[9px] text-text-muted">{Number(d.slice(8, 10))}</span>
                {meta && <span className="text-[11px] font-semibold">{meta.label}</span>}
                {c?.isLate && <span className="absolute right-0.5 top-0.5 rounded-sm bg-[var(--pending)] px-0.5 text-[7px] font-bold text-[var(--primary-fg)]">LC</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
