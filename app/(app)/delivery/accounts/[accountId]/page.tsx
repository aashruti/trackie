import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { Card } from "@/components/ui/card";
import { AccountLogisticsCard } from "@/components/accounts/account-logistics-card";
import { PROGRAM_STATUS_META } from "@/components/delivery/meta";
import { canAccessDelivery } from "@/lib/dal/authz";
import { getAccountDeliveryReport } from "@/lib/dal/delivery/report";
import { getYearContext } from "@/lib/dal/years";

function formatPeriod(startDate: string | null, endDate: string | null) {
  if (!startDate && !endDate) return "Dates not recorded";
  return `${startDate || "…"} → ${endDate || "…"}`;
}

export default async function DeliveryAccountPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const session = await auth();
  const user = session!.user;
  const actor = { id: Number(user.id), roles: user.roles };
  const { currentYear: year, years } = await getYearContext();

  if (!canAccessDelivery(actor)) {
    return (
      <>
        <Topbar section="Delivery" title="Account" user={user} years={years} currentYear={year} />
        <main className="mx-auto w-full max-w-[1180px] px-6 py-6">
          <p className="text-sm text-text-secondary">
            Delivery accounts are available to the Delivery team / Super Admin only.
          </p>
        </main>
      </>
    );
  }

  const { accountId: accountParam } = await params;
  const accountId = Number(accountParam);
  if (!Number.isInteger(accountId)) notFound();
  const report = await getAccountDeliveryReport(actor, accountId);
  if (!report) notFound();

  const activePrograms = report.programs.filter((program) => program.status === "active").length;

  return (
    <>
      <Topbar section="Delivery" title="Account" user={user} years={years} currentYear={year} />
      <main className="mx-auto w-full max-w-[1180px] space-y-5 px-6 py-6">
        <div>
          <Link href="/delivery/accounts" className="text-xs text-text-muted hover:text-text-primary">
            ← Delivery accounts
          </Link>
          <div className="mt-1 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-text-muted">Delivery account</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-text-primary">{report.account.name}</h1>
              <p className="mt-1 text-sm text-text-secondary">{report.account.city || "City not recorded"}</p>
            </div>
            <Link
              href={`/delivery/report/${report.account.id}`}
              className="no-print rounded-md border border-border-strong px-3 py-2 text-sm font-medium text-text-secondary hover:bg-surface-hover"
            >
              Full delivery report
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card className="p-4">
            <p className="text-xs uppercase tracking-wide text-text-muted">Programs</p>
            <p className="mt-1 text-xl font-semibold text-text-primary">{report.totals.programs}</p>
            <p className="text-xs text-text-muted">{activePrograms} active</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs uppercase tracking-wide text-text-muted">Events</p>
            <p className="mt-1 text-xl font-semibold text-text-primary">{report.totals.events}</p>
            <p className="text-xs text-text-muted">across all programs</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs uppercase tracking-wide text-text-muted">Activities</p>
            <p className="mt-1 text-xl font-semibold text-text-primary">{report.totals.activities}</p>
            <p className="text-xs text-text-muted">logged by Delivery</p>
          </Card>
        </div>

        <AccountLogisticsCard
          accountId={report.account.id}
          accountName={report.account.name}
          city={report.account.city}
          logistics={{
            latitude: report.account.latitude,
            longitude: report.account.longitude,
            guestHouseAvailable: report.account.guestHouseAvailable,
            guestHouseCostPerNight: report.account.guestHouseCostPerNight,
          }}
          preferredStays={report.account.preferredStays}
          canEdit
        />

        <section>
          <div className="mb-3">
            <h2 className="text-base font-semibold text-text-primary">Programs</h2>
            <p className="mt-0.5 text-xs text-text-muted">Delivery work linked to this university.</p>
          </div>
          {report.programs.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-sm font-medium text-text-secondary">No delivery programs yet</p>
              <p className="mt-1 text-xs text-text-muted">
                This account remains available here so logistics can be prepared before a program starts.
              </p>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {report.programs.map((program) => {
                const status = PROGRAM_STATUS_META[program.status];
                const activityCount = program.events.reduce((sum, event) => sum + event.activities.length, 0);
                return (
                  <Link
                    key={program.id}
                    href={`/delivery/programs/${program.id}`}
                    className="rounded-xl border border-border bg-surface p-4 transition hover:border-[var(--primary-border)] hover:bg-surface-hover"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-text-primary">{program.name}</h3>
                        <p className="mt-1 text-xs text-text-secondary">
                          {program.methodCode} · {program.methodName}
                        </p>
                      </div>
                      <span
                        className="rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                        style={{ background: status.bg, color: status.text, borderColor: status.border }}
                      >
                        {status.label}
                      </span>
                    </div>
                    <p className="mt-3 text-xs text-text-muted">{formatPeriod(program.startDate, program.endDate)}</p>
                    <p className="mt-2 text-xs text-text-secondary">
                      {program.events.length} event{program.events.length === 1 ? "" : "s"} · {activityCount} activit{activityCount === 1 ? "y" : "ies"}
                    </p>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
