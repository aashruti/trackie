import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { getYearContext } from "@/lib/dal/years";
import { canAccessDelivery } from "@/lib/dal/authz";
import { getAccountDeliveryReport } from "@/lib/dal/delivery/report";
import { PrintButton } from "@/components/reports/print-button";
import { Money } from "@/components/ui/money";
import { ACTIVITY_TYPE_META, EVENT_STATUS_META, PROGRAM_STATUS_META } from "@/components/delivery/meta";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * The renewal / annual delivery report: a printable narrative of everything the
 * delivery team did for an account — per program, per event, per activity.
 * Sales (admin) can open it and hand the PDF over at renewal time.
 */
export default async function DeliveryReportPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const session = await auth();
  const user = session!.user;
  const { currentYear: YEAR, years } = await getYearContext();
  const actor = { id: Number(user.id), roles: user.roles };
  const { accountId: accountParam } = await params;
  const accountId = Number(accountParam);
  if (!Number.isFinite(accountId)) notFound();

  if (!canAccessDelivery(actor)) {
    return (
      <>
        <Topbar section="Delivery" title="Delivery report" user={user} years={years} currentYear={YEAR} />
        <main className="mx-auto w-full max-w-[1440px] px-6 py-6">
          <p className="text-sm text-text-secondary">The delivery report is available to the Delivery team / Admin / Super Admin only.</p>
        </main>
      </>
    );
  }

  const report = await getAccountDeliveryReport(actor, accountId);
  if (!report) notFound();

  const generatedOn = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });

  return (
    <>
      <Topbar section="Delivery" title="Delivery report" user={user} years={years} currentYear={YEAR} />
      <main className="mx-auto w-full max-w-[1100px] space-y-6 px-6 py-6">
        <div className="no-print flex items-center justify-between">
          <Link href={`/accounts/${report.account.id}`} className="text-sm text-text-secondary hover:text-text-primary">
            ← {report.account.name}
          </Link>
          <PrintButton label="Print / PDF" />
        </div>

        {/* Report head */}
        <header className="print-card rounded-xl border border-border bg-surface p-6">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-text-muted">Delivery report</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-text-primary">{report.account.name}</h1>
          <p className="mt-1 text-sm text-text-secondary">
            {report.account.city ? `${report.account.city} · ` : ""}Sales partner: {report.account.oemName} · Generated {generatedOn}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <ReportStat label="Programs" value={String(report.totals.programs)} />
            <ReportStat label="Events" value={String(report.totals.events)} />
            <ReportStat label="Activities" value={String(report.totals.activities)} />
            <ReportStat label="Budget allocated" money={report.totals.allocated} />
            <ReportStat label="Spent" money={report.totals.spent} negative={report.totals.spent > report.totals.allocated} />
          </div>
        </header>

        {report.programs.length === 0 && (
          <p className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-text-muted">
            No delivery programs recorded for this account yet.
          </p>
        )}

        {report.programs.map((program) => {
          const pMeta = PROGRAM_STATUS_META[program.status];
          return (
            <section key={program.id} className="print-card rounded-xl border border-border bg-surface p-6">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-lg font-semibold tracking-tight text-text-primary">{program.name}</h2>
                <span className="rounded-full border px-2 py-0.5 text-[11px] font-semibold" style={{ background: pMeta.bg, color: pMeta.text, borderColor: pMeta.border }}>
                  {pMeta.label}
                </span>
              </div>
              <p className="mt-1 text-sm text-text-secondary">
                <span className="font-semibold">{program.methodCode}</span> {program.methodName} · Provider: {program.oemName}
                {program.startDate || program.endDate ? ` · ${fmtDate(program.startDate)} → ${fmtDate(program.endDate)}` : ""}
              </p>
              {program.description && <p className="mt-1 text-sm text-text-muted">{program.description}</p>}
              <p className="mt-2 text-sm text-text-secondary">
                {program.events.length} event{program.events.length === 1 ? "" : "s"} · Allocated{" "}
                <Money value={program.allocated} compact className="font-semibold" /> · Spent{" "}
                <Money value={program.spent} compact className="font-semibold" tone={program.spent > program.allocated ? "negative" : "default"} />
              </p>

              {program.events.map((event) => {
                const eMeta = EVENT_STATUS_META[event.status];
                return (
                  <div key={event.id} className="mt-5 rounded-lg border border-border-subtle">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle bg-surface-sunken/50 px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-text-primary">{event.title}</h3>
                        <span className="rounded-full border px-2 py-0.5 text-[10.5px] font-semibold" style={{ background: eMeta.bg, color: eMeta.text, borderColor: eMeta.border }}>
                          {eMeta.label}
                        </span>
                      </div>
                      <span className="text-xs text-text-muted">
                        {fmtDate(event.startDate)}
                        {event.endDate ? ` → ${fmtDate(event.endDate)}` : ""}
                        {event.venue ? ` · ${event.venue}` : ""}
                        {event.ownerName ? ` · ${event.ownerName}` : ""}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2 text-xs text-text-secondary">
                      <span>Budget <Money value={event.budget} compact className="font-semibold" /></span>
                      <span>
                        Spent <Money value={event.spent} compact className="font-semibold" tone={event.spent > event.budget ? "negative" : "default"} />
                      </span>
                      {event.spent > event.budget && (
                        <span className="font-semibold text-[var(--negative-text)]">
                          Over by <Money value={event.spent - event.budget} compact />
                        </span>
                      )}
                    </div>
                    {event.description && <p className="px-4 pb-2 text-xs text-text-muted">{event.description}</p>}
                    {event.activities.length > 0 && (
                      <table className="w-full border-t border-border-subtle text-xs">
                        <thead>
                          <tr className="text-left text-[10.5px] uppercase tracking-wide text-text-muted">
                            <th className="px-4 py-1.5 font-semibold">Date</th>
                            <th className="px-2 py-1.5 font-semibold">Type</th>
                            <th className="px-2 py-1.5 font-semibold">Activity</th>
                            <th className="px-2 py-1.5 text-right font-semibold">Cost</th>
                            <th className="px-4 py-1.5 font-semibold">By</th>
                          </tr>
                        </thead>
                        <tbody>
                          {event.activities.map((a) => {
                            const t = ACTIVITY_TYPE_META[a.type];
                            return (
                              <tr key={a.id} className="border-t border-border-subtle align-top">
                                <td className="tabular whitespace-nowrap px-4 py-1.5 text-text-muted">{fmtDate(a.activityDate)}</td>
                                <td className="px-2 py-1.5">
                                  <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ color: t.text, background: t.bg }}>
                                    {t.label}
                                  </span>
                                </td>
                                <td className="px-2 py-1.5">
                                  <span className="font-medium text-text-primary">{a.title}</span>
                                  {a.body && <div className="mt-0.5 whitespace-pre-wrap text-text-muted">{a.body}</div>}
                                </td>
                                <td className="tabular whitespace-nowrap px-2 py-1.5 text-right">
                                  {a.cost > 0 ? <Money value={a.cost} compact /> : <span className="text-text-muted">—</span>}
                                </td>
                                <td className="whitespace-nowrap px-4 py-1.5 text-text-muted">{a.author}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
              {program.events.length === 0 && (
                <p className="mt-4 rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-text-muted">
                  No events recorded under this program yet.
                </p>
              )}
            </section>
          );
        })}

        {report.programs.length > 0 && (
          <footer className="print-card rounded-xl border border-border bg-surface px-6 py-4 text-sm text-text-secondary">
            Across {report.totals.programs} program{report.totals.programs === 1 ? "" : "s"}: {report.totals.events} event
            {report.totals.events === 1 ? "" : "s"}, {report.totals.activities} logged activit{report.totals.activities === 1 ? "y" : "ies"} —{" "}
            <Money value={report.totals.spent} compact className="font-semibold" /> spent against{" "}
            <Money value={report.totals.allocated} compact className="font-semibold" /> allocated.
          </footer>
        )}
      </main>
    </>
  );
}

function ReportStat({ label, value, money, negative }: { label: string; value?: string; money?: number; negative?: boolean }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-sunken/50 px-3 py-2.5">
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-text-muted">{label}</div>
      <div className="mt-0.5 text-base font-bold text-text-primary">
        {money !== undefined ? <Money value={money} compact tone={negative ? "negative" : "default"} /> : value}
      </div>
    </div>
  );
}
