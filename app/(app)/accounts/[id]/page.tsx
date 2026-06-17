import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { StatusBadge } from "@/components/ui/badge";
import { ReservesStrip } from "@/components/dashboard/reserves-strip";
import { DetailTabs } from "@/components/accounts/detail-tabs";
import { getAccountDetail } from "@/lib/dal/account-detail";

const YEAR = "FY26–27";

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

  const detail = await getAccountDetail(
    { id: Number(user.id), role: user.role },
    Number(id),
    YEAR,
  );
  if (!detail) notFound();

  return (
    <>
      <Topbar title="Account" user={user} />
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
          </div>
          <p className="mt-0.5 text-sm text-text-secondary">
            {detail.oem} · {detail.type} · {YEAR} · {detail.totalStudents} students
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi label="Billed" value={detail.totals.billed} />
          <Kpi label="Outstanding" value={detail.totals.outstanding} tone="pending" />
          <Kpi label="Payable to OEM" value={detail.totals.payable} tone="info" />
          <Kpi label="Net margin" value={detail.totals.netMargin} tone="positive" />
        </div>

        <ReservesStrip reserves={detail.reserves} />

        <DetailTabs invoices={detail.invoices} oem={detail.oem} />
      </main>
    </>
  );
}
