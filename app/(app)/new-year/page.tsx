import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { getCurrentYear, listYears } from "@/lib/dal/years";
import { getRolloverPlan } from "@/lib/dal/rollover";
import { RolloverWizard } from "@/components/year/rollover-wizard";

export default async function NewYearPage() {
  const session = await auth();
  const user = session!.user;
  const YEAR = await getCurrentYear();
  const years = (await listYears()).map((y) => y.label);

  if (user.role === "viewer") {
    return (
      <>
        <Topbar section="Setup" title="New year setup" user={user} years={years} currentYear={YEAR} />
        <main className="mx-auto w-full max-w-[1440px] px-6 py-6">
          <p className="text-sm text-text-secondary">
            Viewers can&apos;t roll over years. Ask an Admin or Super Admin.
          </p>
        </main>
      </>
    );
  }

  const plan = await getRolloverPlan(
    { id: Number(user.id), role: user.role },
    YEAR,
  );

  return (
    <>
      <Topbar section="Setup" title="New year setup" user={user} years={years} currentYear={YEAR} />
      <main className="mx-auto w-full max-w-[1440px] space-y-5 px-6 py-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-text-primary">
            Roll over to a new academic year
          </h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            Clone {plan.fromYear}&apos;s structure forward as Draft invoices. Prior
            years are fully retained — nothing is overwritten.
          </p>
        </div>
        <RolloverWizard
          fromYear={plan.fromYear}
          suggestedToYear={plan.suggestedToYear}
          rows={plan.rows}
        />
      </main>
    </>
  );
}
