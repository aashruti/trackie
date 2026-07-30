import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { DeliveryAccountsExplorer } from "@/components/delivery/accounts-explorer";
import { canAccessDelivery } from "@/lib/dal/authz";
import { listDeliveryAccounts } from "@/lib/dal/delivery/accounts";
import { getYearContext } from "@/lib/dal/years";

export default async function DeliveryAccountsPage() {
  const session = await auth();
  const user = session!.user;
  const actor = { id: Number(user.id), roles: user.roles };
  const { currentYear: year, years } = await getYearContext();

  if (!canAccessDelivery(actor)) {
    return (
      <>
        <Topbar section="Delivery" title="Accounts" user={user} years={years} currentYear={year} />
        <main className="mx-auto w-full max-w-[1440px] px-6 py-6">
          <p className="text-sm text-text-secondary">
            Delivery accounts are available to the Delivery team / Super Admin only.
          </p>
        </main>
      </>
    );
  }

  const accounts = await listDeliveryAccounts(actor);

  return (
    <>
      <Topbar section="Delivery" title="Accounts" user={user} years={years} currentYear={year} />
      <main className="mx-auto w-full max-w-[1440px] px-6 py-6">
        <DeliveryAccountsExplorer accounts={accounts} />
      </main>
    </>
  );
}
