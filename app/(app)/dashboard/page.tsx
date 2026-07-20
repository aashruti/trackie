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

// Day-types that count as "present" for the today-at-a-glance tally.
const PRESENT_TYPES = new Set<AttendanceDayType>(["office", "wfh", "official-visit", "comp-off", "half-day"]);
const ONLEAVE_TYPES = new Set<AttendanceDayType>(["paid-leave", "unpaid-leave"]);
const OFF_TYPES = new Set<AttendanceDayType>(["weekly-off", "holiday"]);

function localToday() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

/** HR panel — headcount, pending leave, today's attendance, payroll status. */
async function HrPanel({ actor }: { actor: SessionUser }) {
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
    <HrDashboard
      headcount={employees.length}
      pending={pending}
      today={counts}
      todayLabel={todayLabel}
      payroll={payroll}
      payrollMonth={pMonth}
    />
  );
}

/** Delivery panel — programs, upcoming events, budget status. */
async function DeliveryPanel({ actor }: { actor: SessionUser }) {
  const data = await getDeliveryDashboard(actor);
  return <DeliveryDashboardPanel data={data} />;
}

/** Finance panel — portfolio KPIs, charts, accounts table. */
async function FinancePanel({ actor, YEAR }: { actor: SessionUser; YEAR: string }) {
  const userId = actor.id;
  const [portfolio, myTasks, myFollowups, overdueInvoices] = await Promise.all([
    getPortfolioForUser(actor, YEAR),
    myTasksToday(userId),
    myFollowupsToday(actor),
    listOverdueInvoices(actor),
  ]);
  const { totals, reserves, counts } = portfolio;

  return (
    <>
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
    </>
  );
}

export default async function DashboardPage() {
  const session = await auth();
  const user = session!.user;
  const { currentYear: YEAR, years } = await getYearContext();
  const actor: SessionUser = { id: Number(user.id), roles: user.roles };

  const isSuper = user.roles.includes("super-admin");
  const showHr = user.roles.includes("hr");
  const showDelivery = user.roles.includes("delivery");
  // Finance panel: super-admin or sales — the same gate as canAccessLeads /
  // canManageGroups, not a bare "everyone else" catch-all.
  const showFinance = isSuper || user.roles.includes("sales");
  // Additive by design: a {sales, delivery} (or any other stack) user sees
  // every panel their role set grants, not just the first match.
  const panelCount = [showHr, showDelivery, showFinance].filter(Boolean).length;

  return (
    <>
      <Topbar section="Overview" title="Dashboard" user={user} years={years} currentYear={YEAR} />
      <main className="mx-auto w-full max-w-[1440px] space-y-8 px-6 py-6">
        {showHr && (
          <section className="space-y-4">
            {panelCount > 1 && <h2 className="text-sm font-semibold text-text-primary">HR</h2>}
            <HrPanel actor={actor} />
          </section>
        )}
        {showDelivery && (
          <section className="space-y-4">
            {panelCount > 1 && <h2 className="text-sm font-semibold text-text-primary">Delivery</h2>}
            <DeliveryPanel actor={actor} />
          </section>
        )}
        {showFinance && (
          <section className="space-y-6">
            {panelCount > 1 && <h2 className="text-sm font-semibold text-text-primary">Finance</h2>}
            <FinancePanel actor={actor} YEAR={YEAR} />
          </section>
        )}
        {panelCount === 0 && (
          <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-text-muted">
            No dashboard panels available for your role yet.
          </div>
        )}
      </main>
    </>
  );
}
