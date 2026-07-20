import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { getYearContext } from "@/lib/dal/years";
import { getReportData } from "@/lib/dal/reports";
import { canViewFinance } from "@/lib/dal/authz";
import { ReportsTabs } from "@/components/reports/reports-tabs";

export default async function ReportsPage() {
  const session = await auth();
  const user = session!.user;
  // Finance-only: a delivery/hr user (who may hold account assignments for
  // delivery scoping) must not reach finance reports.
  if (!canViewFinance({ id: Number(user.id), roles: user.roles })) redirect("/dashboard");
  const { currentYear: YEAR, years } = await getYearContext();

  const data = await getReportData({ id: Number(user.id), roles: user.roles }, YEAR);

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
