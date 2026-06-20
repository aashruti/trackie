import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { getCurrentYear, listYears } from "@/lib/dal/years";
import { getReportData } from "@/lib/dal/reports";
import { ReportsTabs } from "@/components/reports/reports-tabs";

export default async function ReportsPage() {
  const session = await auth();
  const user = session!.user;
  const YEAR = await getCurrentYear();
  const years = (await listYears()).map((y) => y.label);

  const data = await getReportData({ id: Number(user.id), role: user.role }, YEAR);

  return (
    <>
      <Topbar section="Reports" title="Reports" user={user} years={years} currentYear={YEAR} />
      <main className="mx-auto w-full max-w-[1440px] space-y-5 px-6 py-6">
        <p className="text-xs text-text-muted">
          {data.rows.length} accounts · {YEAR}
        </p>
        <ReportsTabs data={data} year={YEAR} />
      </main>
    </>
  );
}
