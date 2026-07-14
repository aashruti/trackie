import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { getPortfolioForUser } from "@/lib/dal/portfolio";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { ReservesStrip } from "@/components/dashboard/reserves-strip";
import {
  MarginByOemChart,
  TopAccountsChart,
  AgingChart,
} from "@/components/dashboard/charts";
import { AccountsTable } from "@/components/dashboard/accounts-table";
import { TodayPanel } from "@/components/dashboard/today-panel";
import { getYearContext } from "@/lib/dal/years";
import { fmtCompact as fmtC } from "@/lib/money/format";
import { myTasksToday } from "@/lib/dal/tasks";
import { myFollowupsToday } from "@/lib/dal/leads";
import { listOverdueInvoices } from "@/lib/dal/accounts";
import { HrDashboard } from "@/components/hr/hr-dashboard";
import { listPendingRequests } from "@/lib/dal/hr/leave";
import { getDayAttendance, listActiveEmployees } from "@/lib/dal/hr/attendance";
import { listPayrollRuns } from "@/lib/dal/hr/payroll";
import { DeliveryDashboardPanel } from "@/components/delivery/delivery-dashboard";
import { getDeliveryDashboard } from "@/lib/dal/delivery/dashboard";
import type { AttendanceDayType } from "@/lib/db/enums";
import type { SessionUser } from "@/lib/dal/authz";

type SessionShape = { id: string; name?: string | null; role: SessionUser["role"] };

// Day-types that count as "present" for the today-at-a-glance tally.
const PRESENT_TYPES = new Set<AttendanceDayType>(["office", "wfh", "official-visit", "comp-off", "half-day"]);
const ONLEAVE_TYPES = new Set<AttendanceDayType>(["paid-leave", "unpaid-leave"]);
const OFF_TYPES = new Set<AttendanceDayType>(["weekly-off", "holiday"]);

function localToday() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

/** HR-role users land on an HR overview, not the finance portfolio. */
async function HrDashboardView({ user, years, YEAR }: { user: SessionShape; years: string[]; YEAR: string }) {
  const actor: SessionUser = { id: Number(user.id), role: user.role };
  const today = localToday();
  const [employees, pending, marks, runs] = await Promise.all([
    listActiveEmployees(actor),
    listPendingRequests(actor),
    getDayAttendance(actor, today),
    listPayrollRuns(actor),
  ]);

  const counts = { present: 0, onLeave: 0, absent: 0, off: 0, unmarked: 0 };
  for (const e of employees) {
    const m = marks[e.id];
    if (!m) counts.unmarked++;
    else if (PRESENT_TYPES.has(m.dayType)) counts.present++;
    else if (ONLEAVE_TYPES.has(m.dayType)) counts.onLeave++;
    else if (OFF_TYPES.has(m.dayType)) counts.off++;
    else if (m.dayType === "absent") counts.absent++;
    else counts.unmarked++;
  }

  const now = new Date();
  const pMonth = now.getMonth() + 1;
  const pYear = now.getFullYear();
  const run = runs.find((r) => r.year === pYear && r.month === pMonth);
  const payroll = run
    ? { state: run.status, employees: run.employees, totalNet: run.totalNet }
    : { state: "none" as const };

  const todayLabel = new Date(today + "T00:00:00Z").toLocaleDateString("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <>
      <Topbar section="Overview" title="HR dashboard" user={user} years={years} currentYear={YEAR} />
      <HrDashboard
        headcount={employees.length}
        pending={pending}
        today={counts}
        todayLabel={todayLabel}
        payroll={payroll}
        payrollMonth={pMonth}
      />
    </>
  );
}

/** Delivery-role users land on programs / events / budgets, not finance. */
async function DeliveryDashboardView({ user, years, YEAR }: { user: SessionShape; years: string[]; YEAR: string }) {
  const actor: SessionUser = { id: Number(user.id), role: user.role };
  const data = await getDeliveryDashboard(actor);

  return (
    <>
      <Topbar section="Overview" title="Dashboard" user={user} years={years} currentYear={YEAR} />
      <main className="mx-auto w-full max-w-[1440px] space-y-6 px-6 py-6">
        <DeliveryDashboardPanel data={data} />
      </main>
    </>
  );
}

export default async function DashboardPage() {
  const session = await auth();
  const user = session!.user;
  const { currentYear: YEAR, years } = await getYearContext();

  // HR-only users get an HR overview; the finance portfolio would be empty and
  // irrelevant (they have no assigned accounts). Super-admin still sees finance.
  if (user.role === "hr") {
    return <HrDashboardView user={user} years={years} YEAR={YEAR} />;
  }
  // Delivery-role users likewise get a delivery overview.
  if (user.role === "delivery") {
    return <DeliveryDashboardView user={user} years={years} YEAR={YEAR} />;
  }

  const userId = Number(user.id);
  const actor = { id: userId, role: user.role };
  const [portfolio, myTasks, myFollowups, overdueInvoices] = await Promise.all([
    getPortfolioForUser(actor, YEAR),
    myTasksToday(userId),
    myFollowupsToday(actor),
    listOverdueInvoices(actor),
  ]);
  const { totals, reserves, counts } = portfolio;

  return (
    <>
      <Topbar section="Overview" title="Dashboard" user={user} years={years} currentYear={YEAR} />
      <main className="mx-auto w-full max-w-[1440px] space-y-6 px-6 py-6">
        <TodayPanel tasks={myTasks} followups={myFollowups} overdueInvoices={overdueInvoices} userId={userId} />

        <div>
          <h2 className="text-sm font-medium text-text-secondary">
            Portfolio overview · {YEAR}
          </h2>
          <p className="text-xs text-text-muted">
            {counts.accounts} accounts · {counts.openInvoices} open invoices
            {counts.negativeMargin > 0 && (
              <span className="text-[var(--negative-text)]">
                {" "}· {counts.negativeMargin} loss-making
              </span>
            )}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <KpiCard label="Total billed" value={totals.billed} />
          <KpiCard label="Received in bank" value={totals.received} tone="positive" />
          <KpiCard
            label="Outstanding"
            value={totals.outstanding}
            tone="pending"
            sublabel={`across ${counts.openInvoices} invoices`}
          />
          <KpiCard
            label="Payable to OEMs"
            value={totals.payable}
            tone="info"
            sublabel={`${fmtC(totals.paidToOem)} paid · ${fmtC(totals.outstandingToOem)} due`}
          />
          <KpiCard label="Net margin" value={totals.netMargin} tone="positive" />
        </div>

        <ReservesStrip reserves={reserves} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <MarginByOemChart data={portfolio.marginByOem} />
          <TopAccountsChart rows={portfolio.rows} />
          <AgingChart aging={portfolio.aging} />
        </div>

        <AccountsTable rows={portfolio.rows} />
      </main>
    </>
  );
}
