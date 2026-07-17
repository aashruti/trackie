import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { getYearContext } from "@/lib/dal/years";
import { canAccessDelivery, canManageDelivery } from "@/lib/dal/authz";
import { listMethods } from "@/lib/dal/delivery/methods";
import { DeliverySettingsManager } from "@/components/delivery/delivery-settings-manager";

export default async function DeliverySettingsPage() {
  const session = await auth();
  const user = session!.user;
  const { currentYear: YEAR, years } = await getYearContext();
  const actor = { id: Number(user.id), roles: user.roles };

  if (!canAccessDelivery(actor)) {
    return (
      <>
        <Topbar section="Delivery" title="Delivery settings" user={user} years={years} currentYear={YEAR} />
        <main className="mx-auto w-full max-w-[1440px] px-6 py-6">
          <p className="text-sm text-text-secondary">Delivery settings are available to the Delivery team / Admin / Super Admin only.</p>
        </main>
      </>
    );
  }

  const methods = await listMethods(actor);

  return (
    <>
      <Topbar section="Delivery" title="Delivery settings" user={user} years={years} currentYear={YEAR} />
      <main className="mx-auto w-full max-w-[1440px] space-y-5 px-6 py-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-text-primary">Delivery settings</h1>
          <p className="mt-0.5 text-sm text-text-secondary">Teaching styles that can be attached to programs.</p>
        </div>
        <DeliverySettingsManager methods={methods} canManage={canManageDelivery(actor)} />
      </main>
    </>
  );
}
