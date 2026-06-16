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

const YEAR = "FY26–27";

export default async function DashboardPage() {
  const session = await auth();
  const user = session!.user;
  const portfolio = await getPortfolioForUser(
    { id: Number(user.id), role: user.role },
    YEAR,
  );
  const { totals, reserves, counts } = portfolio;

  return (
    <>
      <Topbar title="Dashboard" user={user} />
      <main className="mx-auto w-full max-w-[1440px] space-y-6 px-6 py-6">
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
            sublabel="net of advances"
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
