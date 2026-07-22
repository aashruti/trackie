import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { getYearContext } from "@/lib/dal/years";
import { getRolloverPlan } from "@/lib/dal/rollover";
import { RolloverWizard } from "@/components/year/rollover-wizard";

export default async function NewYearPage() {
  const session = await auth();
  const user = session!.user;
  const { currentYear: YEAR, years } = await getYearContext();

  if (!user.roles.includes("super-admin") && !user.roles.includes("sales")) {
    return (
      <>
        <Topbar section="Setup" title="New year setup" user={user} years={years} currentYear={YEAR} />
        <main className="mx-auto w-full max-w-[1440px] px-6 py-6">
          <p className="text-sm text-text-secondary">
            Year rollover is available to Sales / Super Admin only.
          </p>
        </main>
      </>
    );
  }

  const plan = await getRolloverPlan(
    { id: Number(user.id), roles: user.roles },
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
            Carry {plan.fromYear}&apos;s student counts forward as Draft invoices — the {plan.fromYear}{" "}
            intake becomes a returning batch. Prices and bills are not copied; set new-year prices on
            the Pricing master screen. Prior years are fully retained.
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
