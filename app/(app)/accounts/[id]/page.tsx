import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { StatusBadge } from "@/components/ui/badge";
import { ReservesStrip } from "@/components/dashboard/reserves-strip";
import { DetailTabs } from "@/components/accounts/detail-tabs";
import { AddInvoice } from "@/components/accounts/add-invoice";
import { AccountReportButton } from "@/components/accounts/account-report";
import { PrintButton } from "@/components/reports/print-button";
import { DeleteAccountButton } from "@/components/accounts/delete-account-button";
import { getAccountDetail } from "@/lib/dal/account-detail";
import { getYearContext } from "@/lib/dal/years";
import { canAccessDelivery, canManageGroups } from "@/lib/dal/authz";

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "default" | "positive" | "negative" | "pending" | "info" }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</div>
      <div className="mt-1.5 text-xl font-semibold">
        <Money value={value} compact tone={tone ?? "default"} />
      </div>
    </Card>
  );
}

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const user = session!.user;
  const { currentYear: YEAR, years } = await getYearContext();

  const detail = await getAccountDetail(
    { id: Number(user.id), roles: user.roles },
    Number(id),
    YEAR,
  );
  if (!detail) notFound();
  const canAccessGroups = canManageGroups({ id: Number(user.id), roles: user.roles });

  return (
    <>
      <Topbar section="Universities" title="Account" user={user} years={years} currentYear={YEAR} />
      <main className="mx-auto w-full max-w-[1440px] space-y-5 px-6 py-6">
        <div>
          <Link href="/accounts" className="text-xs text-text-muted hover:text-text-primary">
            ← All accounts
          </Link>
          <div className="mt-1 flex items-center gap-3">
            <h2 className="text-2xl font-semibold tracking-tight text-text-primary">
              {detail.name}
            </h2>
            <StatusBadge status={detail.status} />
            <div className="ml-auto flex gap-2">
              {user.roles.includes("super-admin") && (
                <DeleteAccountButton accountId={detail.id} accountName={detail.name} />
              )}
              {canAccessDelivery({ id: Number(user.id), roles: user.roles }) && (
                <Link
                  href={`/delivery/report/${detail.id}`}
                  className="no-print rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover"
                >
                  Delivery report
                </Link>
              )}
              <AccountReportButton detail={detail} year={YEAR} />
              <PrintButton label="Print / PDF" />
            </div>
          </div>
          <p className="mt-0.5 text-sm text-text-secondary">
            {detail.selfSupplied ? "Datagami own product" : detail.oem} · {detail.type} · {YEAR} ·{" "}
            {detail.totalStudents} students
            {detail.selfSupplied && (
              <span className="ml-2 rounded-full bg-[var(--positive-subtle)] px-2 py-0.5 text-[11px] font-medium text-[var(--positive-text)]">
                no OEM transfer
              </span>
            )}
            {detail.groupId && canAccessGroups && (
              <Link
                href={`/accounts/groups/${detail.groupId}`}
                className="no-print ml-2 rounded-full border border-[var(--info-border)] bg-[var(--info-subtle)] px-2 py-0.5 text-[11px] font-medium text-[var(--info-text)] hover:opacity-80"
              >
                Part of {detail.groupName} →
              </Link>
            )}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi label="Billed" value={detail.totals.billed} />
          <Kpi label="Outstanding" value={detail.totals.outstanding} tone="pending" />
          <Kpi label="Payable to OEM" value={detail.totals.payable} tone="info" />
          <Kpi label="Net margin" value={detail.totals.netMargin} tone="positive" />
        </div>

        <ReservesStrip reserves={detail.reserves} />

        {/* "Not just viewer" — a stacked {viewer, sales} user still gets the
            edit affordances; the actual mutation is separately authorized
            per-account by canEdit() in the DAL. */}
        {user.roles.some((r) => r !== "viewer") && (
          <AddInvoice accountId={detail.id} yearLabel={YEAR} selfSupplied={detail.selfSupplied} />
        )}

        {detail.invoices.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-sm text-text-secondary">
              No invoices for {YEAR} yet.
              {user.roles.some((r) => r !== "viewer") ? " Use “Add invoice” above to create the first one." : ""}
            </p>
          </Card>
        ) : (
          <DetailTabs
            invoices={detail.invoices}
            oem={detail.oem}
            accountId={detail.id}
            currentYear={YEAR}
            canEdit={user.roles.some((r) => r !== "viewer")}
          />
        )}
      </main>
    </>
  );
}
