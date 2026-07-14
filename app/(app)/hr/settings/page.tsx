import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { getYearContext } from "@/lib/dal/years";
import { canManageHr } from "@/lib/dal/authz";
import { listHolidays } from "@/lib/dal/hr/holidays";
import { HrSettingsManager } from "@/components/hr/hr-settings-manager";

export default async function HrSettingsPage() {
  const session = await auth();
  const user = session!.user;
  const { currentYear: YEAR, years } = await getYearContext();
  const actor = { id: Number(user.id), role: user.role };

  if (!canManageHr(actor)) {
    return (
      <>
        <Topbar section="HR" title="HR settings" user={user} years={years} currentYear={YEAR} />
        <main className="mx-auto w-full max-w-[1440px] px-6 py-6">
          <p className="text-sm text-text-secondary">HR settings are available to HR / Super Admin only.</p>
        </main>
      </>
    );
  }

  const holidays = await listHolidays(actor);

  return (
    <>
      <Topbar section="HR" title="HR settings" user={user} years={years} currentYear={YEAR} />
      <main className="mx-auto w-full max-w-[1440px] space-y-5 px-6 py-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-text-primary">HR settings</h1>
          <p className="mt-0.5 text-sm text-text-secondary">Company holiday calendar and HR policy.</p>
        </div>
        <HrSettingsManager holidays={holidays} />
      </main>
    </>
  );
}
