import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { getYearContext } from "@/lib/dal/years";
import { canAccessDelivery, canManageDelivery } from "@/lib/dal/authz";
import { getProgramCalendar, getProgramDetail } from "@/lib/dal/delivery/programs";
import { listTaskOptions } from "@/lib/dal/tasks";
import { ProgramDetailView } from "@/components/delivery/program-detail";
import { Money } from "@/components/ui/money";
import { PROGRAM_STATUS_META } from "@/components/delivery/meta";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function ProgramDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string; tab?: string }>;
}) {
  const session = await auth();
  const user = session!.user;
  const { currentYear: YEAR, years } = await getYearContext();
  const actor = { id: Number(user.id), role: user.role };
  const { id: idParam } = await params;
  const sp = await searchParams;
  const id = Number(idParam);
  if (!Number.isFinite(id)) notFound();

  if (!canAccessDelivery(actor)) {
    return (
      <>
        <Topbar section="Delivery" title="Program" user={user} years={years} currentYear={YEAR} />
        <main className="mx-auto w-full max-w-[1440px] px-6 py-6">
          <p className="text-sm text-text-secondary">Delivery programs are available to the Delivery team / Admin / Super Admin only.</p>
        </main>
      </>
    );
  }

  const now = new Date();
  const fallback = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const monthParam = sp.month && MONTH_RE.test(sp.month) ? sp.month : fallback;
  const [calYear, calMonth] = monthParam.split("-").map(Number);
  const tab = sp.tab === "calendar" ? "calendar" : "events";

  const [detail, calendar, options] = await Promise.all([
    getProgramDetail(actor, id),
    getProgramCalendar(actor, id, calYear, calMonth),
    listTaskOptions(),
  ]);
  if (!detail || !calendar) notFound();

  const canManage = canManageDelivery(actor);
  const statusMeta = PROGRAM_STATUS_META[detail.status];
  const remaining = detail.allocated - detail.spent;

  return (
    <>
      <Topbar section="Delivery" title={detail.name} user={user} years={years} currentYear={YEAR} />
      <main className="mx-auto w-full max-w-[1440px] space-y-5 px-6 py-6">
        <div className="no-print">
          <Link href="/delivery/programs" className="text-sm text-text-secondary hover:text-text-primary">
            ← Programs
          </Link>
        </div>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-semibold tracking-tight text-text-primary">{detail.name}</h1>
              <span
                className="rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                style={{ background: statusMeta.bg, color: statusMeta.text, borderColor: statusMeta.border }}
              >
                {statusMeta.label}
              </span>
            </div>
            <p className="mt-1 text-sm text-text-secondary">
              {detail.accountName} · <span className="font-semibold">{detail.methodCode}</span> {detail.methodName} ·{" "}
              {detail.oemName}
              {detail.selfSupplied ? " (own product)" : ""}
              {detail.startDate || detail.endDate ? ` · ${detail.startDate ?? "…"} → ${detail.endDate ?? "…"}` : ""}
            </p>
            {detail.description && <p className="mt-1 max-w-3xl text-sm text-text-muted">{detail.description}</p>}
          </div>
          <Link
            href={`/delivery/report/${detail.accountId}`}
            className="no-print inline-flex h-9 items-center rounded-md border border-border-strong px-3 text-sm font-medium text-text-secondary hover:bg-surface-hover"
          >
            Account delivery report
          </Link>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Events" value={String(detail.events.length)} />
          <Kpi label="Budget allocated" money={detail.allocated} />
          <Kpi label="Spent" money={detail.spent} negative={detail.spent > detail.allocated} />
          <Kpi
            label={remaining >= 0 ? "Remaining" : "Over budget"}
            money={Math.abs(remaining)}
            negative={remaining < 0}
          />
        </div>

        <ProgramDetailView
          detail={detail}
          calendar={calendar}
          calYear={calYear}
          calMonth={calMonth}
          tab={tab}
          users={options.users}
          canManage={canManage}
        />
      </main>
    </>
  );
}

function Kpi({ label, value, money, negative }: { label: string; value?: string; money?: number; negative?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</div>
      <div className="mt-1 text-xl font-bold text-text-primary">
        {money !== undefined ? <Money value={money} tone={negative ? "negative" : "default"} /> : value}
      </div>
    </div>
  );
}
