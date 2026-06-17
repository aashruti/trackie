import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { getCurrentYear, listYears } from "@/lib/dal/years";
import { getReportData, type ReportRow } from "@/lib/dal/reports";
import { ReportTable, type Column } from "@/components/reports/report-table";
import { Card, CardHeader } from "@/components/ui/card";
import { Money } from "@/components/ui/money";

export default async function ReportsPage() {
  const session = await auth();
  const user = session!.user;
  const YEAR = await getCurrentYear();
  const years = (await listYears()).map((y) => y.label);

  const data = await getReportData({ id: Number(user.id), role: user.role }, YEAR);
  const t = data.totals;

  const marginCols: Column<ReportRow>[] = [
    { key: "name", label: "Account" },
    { key: "oem", label: "OEM" },
    { key: "students", label: "Students", align: "right" },
    { key: "billed", label: "Billed", money: true },
    { key: "received", label: "Received", money: true, tone: "positive" },
    { key: "outstanding", label: "Outstanding", money: true, tone: "pending" },
    { key: "netMargin", label: "Net margin", money: true, tone: "auto" },
  ];
  const reserveCols: Column<ReportRow>[] = [
    { key: "name", label: "Account" },
    { key: "netGst", label: "Net GST payable", money: true, tone: "info" },
    { key: "tdsReceivable", label: "TDS receivable", money: true },
    { key: "tdsPayable", label: "TDS payable", money: true },
    { key: "advanceTdsCost", label: "Advance TDS cost", money: true },
  ];
  const oemSettleCols: Column<ReportRow>[] = [
    { key: "name", label: "Account" },
    { key: "oem", label: "OEM" },
    { key: "payable", label: "Payable", money: true, tone: "info" },
    { key: "paidToOem", label: "Paid to OEM", money: true, tone: "positive" },
    { key: "outstandingToOem", label: "Outstanding to OEM", money: true, tone: "pending" },
  ];
  const byOemCols: Column<(typeof data.byOem)[number]>[] = [
    { key: "oem", label: "OEM" },
    { key: "billed", label: "Billed", money: true },
    { key: "payable", label: "Payable", money: true, tone: "info" },
    { key: "netMargin", label: "Net margin", money: true, tone: "auto" },
  ];

  const aging = [
    { label: "Current", value: data.aging.current, tone: "info" as const },
    { label: "31–60 days", value: data.aging.d31_60, tone: "pending" as const },
    { label: "61–90 days", value: data.aging.d61_90, tone: "pending" as const },
    { label: "90+ days", value: data.aging.d90plus, tone: "negative" as const },
  ];

  return (
    <>
      <Topbar title="Reports" user={user} years={years} currentYear={YEAR} />
      <main className="mx-auto w-full max-w-[1440px] space-y-6 px-6 py-6">
        <p className="text-xs text-text-muted">
          {data.rows.length} accounts · {YEAR}
        </p>

        <ReportTable
          title="Margin & collections"
          subtitle="per account"
          columns={marginCols}
          rows={data.rows}
          totals={{
            label: "Total",
            students: t.students, billed: t.billed, received: t.received,
            outstanding: t.outstanding, netMargin: t.netMargin,
          }}
          filename={`trackie-margin-${YEAR}.csv`}
        />

        <ReportTable
          title="GST & TDS — set aside for government"
          subtitle="reserves, not profit"
          columns={reserveCols}
          rows={data.rows}
          totals={{
            label: "Total",
            netGst: t.netGst, tdsReceivable: t.tdsReceivable,
            tdsPayable: t.tdsPayable, advanceTdsCost: t.advanceTdsCost,
          }}
          filename={`trackie-gst-tds-${YEAR}.csv`}
        />

        <ReportTable
          title="OEM settlement"
          subtitle="what we owe and have paid each OEM"
          columns={oemSettleCols}
          rows={data.rows}
          totals={{
            label: "Total",
            payable: t.payable, paidToOem: t.paidToOem, outstandingToOem: t.outstandingToOem,
          }}
          filename={`trackie-oem-settlement-${YEAR}.csv`}
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ReportTable
            title="Margin by OEM"
            columns={byOemCols}
            rows={data.byOem}
            filename={`trackie-margin-by-oem-${YEAR}.csv`}
          />

          <Card>
            <CardHeader title="Receivables aging" subtitle="outstanding by bucket" />
            <div className="divide-y divide-border-subtle">
              {aging.map((a) => (
                <div key={a.label} className="flex items-center justify-between px-5 py-3">
                  <span className="text-sm text-text-secondary">{a.label}</span>
                  <Money value={a.value} compact tone={a.tone} className="font-medium" />
                </div>
              ))}
              <div className="flex items-center justify-between bg-surface-sunken px-5 py-3 font-semibold">
                <span className="text-sm text-text-primary">Total outstanding</span>
                <Money value={t.outstanding} compact className="text-text-primary" />
              </div>
            </div>
          </Card>
        </div>
      </main>
    </>
  );
}
