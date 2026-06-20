import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { Card, CardHeader } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { StatusBadge } from "@/components/ui/badge";
import { getCurrentYear, listYears } from "@/lib/dal/years";
import { getOemReport } from "@/lib/dal/oem-report";
import { PrintButton } from "@/components/reports/print-button";
import { OemCsvButton } from "@/components/reports/oem-csv-button";

function Stat({ label, value, tone }: { label: string; value: number; tone?: "default" | "positive" | "negative" | "pending" | "info" }) {
  return (
    <div className="px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold">
        <Money value={value} compact tone={tone ?? "default"} />
      </div>
    </div>
  );
}

export default async function OemReportPage({
  params,
}: {
  params: Promise<{ oem: string }>;
}) {
  const { oem } = await params;
  const oemName = decodeURIComponent(oem);
  const session = await auth();
  const user = session!.user;
  const YEAR = await getCurrentYear();
  const years = (await listYears()).map((y) => y.label);

  const report = await getOemReport({ id: Number(user.id), role: user.role }, oemName, YEAR);
  if (!report) notFound();
  const t = report.totals;

  return (
    <>
      <Topbar section="Reports" title="OEM report" user={user} years={years} currentYear={YEAR} />
      <main className="mx-auto w-full max-w-[1440px] space-y-5 px-6 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link href="/reports" className="no-print text-xs text-text-muted hover:text-text-primary">
              ← Reports
            </Link>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-text-primary">
              {report.isSelf ? `${report.oem} (own product)` : report.oem}
            </h2>
            <p className="mt-0.5 text-sm text-text-secondary">
              OEM report · {YEAR} · {report.accounts.length} accounts
            </p>
          </div>
          <div className="flex gap-2">
            <OemCsvButton report={report} year={YEAR} />
            <PrintButton />
          </div>
        </div>

        <Card className="print-card">
          <div className="flex flex-wrap divide-x divide-border-subtle">
            <Stat label="Billed" value={t.billed} />
            <Stat label="Received" value={t.received} tone="positive" />
            <Stat label="Outstanding" value={t.outstanding} tone="pending" />
            <Stat label="Payable to OEM" value={t.payable} tone="info" />
            <Stat label="Outstanding to OEM" value={t.outstandingToOem} tone="pending" />
            <Stat label="Net margin" value={t.netMargin} tone="positive" />
            <Stat label="Net GST (set aside)" value={t.netGst} tone="info" />
          </div>
        </Card>

        <Card className="print-card">
          <CardHeader title="Accounts" subtitle={`${report.accounts.length} under ${report.oem}`} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-xs text-text-muted">
                  <th className="px-4 py-2.5 text-left font-medium">Account</th>
                  <th className="px-3 py-2.5 text-right font-medium">Students</th>
                  <th className="px-3 py-2.5 text-right font-medium">Billed</th>
                  <th className="px-3 py-2.5 text-right font-medium">Received</th>
                  <th className="px-3 py-2.5 text-right font-medium">Outstanding</th>
                  <th className="px-3 py-2.5 text-right font-medium">Payable</th>
                  <th className="px-3 py-2.5 text-right font-medium">Net margin</th>
                  <th className="px-4 py-2.5 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {report.accounts.map((a) => (
                  <tr key={a.id} className="border-b border-border-subtle last:border-0">
                    <td className="px-4 py-2.5 font-medium text-text-primary">
                      <Link href={`/accounts/${a.id}`} className="hover:text-[var(--primary-text)]">{a.name}</Link>
                    </td>
                    <td className="tabular px-3 py-2.5 text-right text-text-secondary">{a.students}</td>
                    <td className="px-3 py-2.5 text-right"><Money value={a.billed} compact /></td>
                    <td className="px-3 py-2.5 text-right"><Money value={a.received} compact tone="positive" /></td>
                    <td className="px-3 py-2.5 text-right"><Money value={a.outstanding} compact tone="pending" /></td>
                    <td className="px-3 py-2.5 text-right"><Money value={a.payable} compact tone="info" /></td>
                    <td className="px-3 py-2.5 text-right"><Money value={a.netMargin} compact tone="auto" /></td>
                    <td className="px-4 py-2.5"><StatusBadge status={a.status} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border-strong bg-surface-sunken font-semibold">
                  <td className="px-4 py-2.5">Total</td>
                  <td className="tabular px-3 py-2.5 text-right">{t.students}</td>
                  <td className="px-3 py-2.5 text-right"><Money value={t.billed} compact /></td>
                  <td className="px-3 py-2.5 text-right"><Money value={t.received} compact tone="positive" /></td>
                  <td className="px-3 py-2.5 text-right"><Money value={t.outstanding} compact tone="pending" /></td>
                  <td className="px-3 py-2.5 text-right"><Money value={t.payable} compact tone="info" /></td>
                  <td className="px-3 py-2.5 text-right"><Money value={t.netMargin} compact tone="auto" /></td>
                  <td className="px-4 py-2.5" />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        <Card className="print-card">
          <CardHeader title="Payments" subtitle={`${report.payments.length} entries across all ${report.oem} accounts`} />
          {report.payments.length === 0 ? (
            <p className="px-5 py-6 text-sm text-text-muted">No payments recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-subtle text-xs text-text-muted">
                    <th className="px-4 py-2.5 text-left font-medium">Account</th>
                    <th className="px-3 py-2.5 text-left font-medium">Stream</th>
                    <th className="px-3 py-2.5 text-left font-medium">Direction</th>
                    <th className="px-3 py-2.5 text-left font-medium">Date</th>
                    <th className="px-3 py-2.5 text-left font-medium">Mode</th>
                    <th className="px-3 py-2.5 text-left font-medium">Reference</th>
                    <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {report.payments.map((p, i) => (
                    <tr key={i} className="border-b border-border-subtle last:border-0">
                      <td className="px-4 py-2.5 font-medium text-text-primary">{p.account}</td>
                      <td className="px-3 py-2.5 text-text-secondary">{p.stream}</td>
                      <td className="px-3 py-2.5">
                        <span className={p.direction === "receipt" ? "text-[var(--positive-text)]" : "text-[var(--info-text)]"}>
                          {p.direction === "receipt" ? "Receipt" : "Paid OEM"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-text-secondary">{p.paidOn}</td>
                      <td className="px-3 py-2.5 text-text-muted">{p.mode}</td>
                      <td className="px-3 py-2.5 text-text-muted">{p.ref ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right"><Money value={p.amount} compact /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </main>
    </>
  );
}
