import Link from "next/link";
import { Card } from "@/components/ui/card";
import type { LeaveRequestRow } from "@/lib/dal/hr/leave";

type TodayCounts = {
  present: number;
  onLeave: number;
  absent: number;
  off: number;
  unmarked: number;
};

type PayrollStatus =
  | { state: "finalized"; employees: number; totalNet: number }
  | { state: "draft"; employees: number; totalNet: number }
  | { state: "none" };

function StatCard({ label, value, sublabel, href, tone }: { label: string; value: number | string; sublabel?: string; href?: string; tone?: "default" | "warn" }) {
  const body = (
    <Card className={`p-5 ${href ? "transition-colors hover:bg-surface-hover" : ""}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</div>
      <div className={`mt-2 text-[28px] font-semibold leading-none ${tone === "warn" && Number(value) > 0 ? "text-[var(--pending-text,var(--text-primary))]" : ""}`}>
        {value}
      </div>
      {sublabel && <div className="mt-2 text-xs text-text-muted">{sublabel}</div>}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
}

export function HrDashboard({
  headcount,
  pending,
  today,
  todayLabel,
  payroll,
  payrollMonth,
}: {
  headcount: number;
  pending: LeaveRequestRow[];
  today: TodayCounts;
  todayLabel: string;
  payroll: PayrollStatus;
  payrollMonth: number;
}) {
  const marked = today.present + today.onLeave + today.absent + today.off;
  return (
    <main className="mx-auto w-full max-w-[1440px] space-y-6 px-6 py-6">
      {/* Top-line KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Headcount" value={headcount} sublabel="active employees" href="/hr/employees" />
        <StatCard label="Pending approvals" value={pending.length} sublabel="leave requests" href="/hr/leave" tone="warn" />
        <StatCard label="Present today" value={today.present} sublabel={`of ${headcount} · ${today.onLeave} on leave`} href="/hr/attendance" />
        <StatCard
          label={`Payroll · ${MONTHS[payrollMonth - 1]}`}
          value={payroll.state === "none" ? "—" : payroll.state === "finalized" ? "Finalized" : "Draft"}
          sublabel={payroll.state === "none" ? "not started" : `${payroll.employees} employees`}
          href="/hr/payroll"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Pending approvals queue */}
        <Card className="lg:col-span-2 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-primary">Pending leave approvals</h2>
            <Link href="/hr/leave" className="text-xs font-medium text-[var(--primary-text)] hover:underline">
              View all →
            </Link>
          </div>
          {pending.length === 0 ? (
            <p className="mt-6 text-center text-sm text-text-muted">Nothing waiting on you. 🎉</p>
          ) : (
            <ul className="mt-3 divide-y divide-border-subtle">
              {pending.slice(0, 6).map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-text-primary">{r.employeeName}</div>
                    <div className="truncate text-xs text-text-muted">
                      {r.leaveTypeName} · {fmtDate(r.startDate)}
                      {r.endDate !== r.startDate && `–${fmtDate(r.endDate)}`}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-[var(--neutral-status-subtle)] px-2 py-0.5 text-xs font-medium text-text-secondary">
                    {r.days} day{r.days === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Today at a glance */}
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-text-primary">Attendance today</h2>
          <p className="text-xs text-text-muted">{todayLabel}</p>
          <dl className="mt-4 space-y-2.5 text-sm">
            <Row label="Present" value={today.present} dot="var(--positive-text)" />
            <Row label="On leave" value={today.onLeave} dot="var(--info-text)" />
            <Row label="Absent" value={today.absent} dot="var(--negative-text)" />
            <Row label="Weekly-off / holiday" value={today.off} dot="var(--text-muted)" />
            <Row label="Not marked" value={today.unmarked} dot="var(--pending-text)" muted />
          </dl>
          <Link
            href="/hr/attendance"
            className="mt-4 block rounded-md border border-border bg-surface px-3 py-2 text-center text-sm font-medium text-text-secondary transition-colors hover:bg-surface-hover"
          >
            {marked < headcount ? "Mark attendance" : "View attendance"}
          </Link>
        </Card>
      </div>
    </main>
  );
}

function Row({ label, value, dot, muted }: { label: string; value: number; dot: string; muted?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: dot }} />
      <dt className={`flex-1 ${muted ? "text-text-muted" : "text-text-secondary"}`}>{label}</dt>
      <dd className="font-semibold text-text-primary">{value}</dd>
    </div>
  );
}
