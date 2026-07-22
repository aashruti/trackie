import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { getYearContext } from "@/lib/dal/years";
import { canViewFinance } from "@/lib/dal/authz";
import { getPricingMaster } from "@/lib/dal/pricing-master";
import { PricingMaster } from "@/components/pricing/pricing-master";

export default async function PricingPage() {
  const session = await auth();
  const user = session!.user;
  const { currentYear: YEAR, years } = await getYearContext();
  const su = { id: Number(user.id), roles: user.roles };

  if (!canViewFinance(su)) {
    return (
      <>
        <Topbar section="Finance" title="Pricing master" user={user} years={years} currentYear={YEAR} />
        <main className="mx-auto w-full max-w-[1440px] px-6 py-6">
          <p className="text-sm text-text-secondary">
            Pricing is available to Sales / Super Admin only.
          </p>
        </main>
      </>
    );
  }

  const rows = await getPricingMaster(su, YEAR);

  return (
    <>
      <Topbar section="Finance" title="Pricing master" user={user} years={years} currentYear={YEAR} />
      <main className="mx-auto w-full max-w-[1440px] space-y-5 px-6 py-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-text-primary">
            Student &amp; pricing master · {YEAR}
          </h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            Edit student counts and per-student prices for every account in one place. Batch prices
            lock per batch — a blank batch price falls back to the invoice price. Switch the year in
            the top bar to edit another year.
          </p>
        </div>
        <PricingMaster rows={rows} currentYear={YEAR} />
      </main>
    </>
  );
}
