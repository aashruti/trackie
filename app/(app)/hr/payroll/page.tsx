import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { getYearContext } from "@/lib/dal/years";
import { canManageHr } from "@/lib/dal/authz";
import { previewPayroll, getRunForCycle, listPayrollRuns } from "@/lib/dal/hr/payroll";
import { PayrollManager } from "@/components/hr/payroll-manager";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default async function HrPayrollPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const session = await auth();
  const user = session!.user;
  const { currentYear: YEAR, years } = await getYearContext();
  const actor = { id: Number(user.id), role: user.role };

  if (!canManageHr(actor)) {
    return (
      <>
        <Topbar section="HR" title="Payroll" user={user} years={years} currentYear={YEAR} />
        <main className="mx-auto w-full max-w-[1440px] px-6 py-6">
          <p className="text-sm text-text-secondary">Payroll is available to HR / Super Admin only.</p>
        </main>
      </>
    );
  }

  const { month } = await searchParams;
  const now = new Date();
  const [y, m] = month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
    ? [Number(month.slice(0, 4)), Number(month.slice(5, 7))]
    : [now.getUTCFullYear(), now.getUTCMonth() + 1];

  const [preview, savedRun, runs] = await Promise.all([
    previewPayroll(actor, y, m),
    getRunForCycle(actor, y, m),
    listPayrollRuns(actor),
  ]);

  return (
    <>
      <Topbar section="HR" title="Payroll" user={user} years={years} currentYear={YEAR} />
      <main className="mx-auto w-full max-w-[1440px] px-6 py-6">
        <PayrollManager preview={preview} savedRun={savedRun} runs={runs} year={y} month={m} monthLabel={`${MONTHS[m - 1]} ${y}`} />
      </main>
    </>
  );
}
