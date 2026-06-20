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

export default async function DashboardPage() {
  const session = await auth();
  const user = session!.user;
  const { currentYear: YEAR, years } = await getYearContext();
  const userId = Number(user.id);
  const [portfolio, myTasks, myFollowups] = await Promise.all([
    getPortfolioForUser({ id: userId, role: user.role }, YEAR),
    myTasksToday(userId),
    myFollowupsToday({ id: userId, role: user.role }),
  ]);
  const { totals, reserves, counts } = portfolio;

  return (
    <>
      <Topbar section="Overview" title="Dashboard" user={user} years={years} currentYear={YEAR} />
      <main className="mx-auto w-full max-w-[1440px] space-y-6 px-6 py-6">
        <TodayPanel tasks={myTasks} followups={myFollowups} userId={userId} />

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
