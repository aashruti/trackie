import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { getYearContext } from "@/lib/dal/years";
import { canAccessDelivery, canManageDelivery } from "@/lib/dal/authz";
import { listPoVendors } from "@/lib/dal/delivery/po-vendors";
import { PoVendorsManager } from "@/components/delivery/po-vendors-manager";

export default async function PoVendorsPage() {
  const session = await auth();
  const user = session!.user;
  const { currentYear: YEAR, years } = await getYearContext();
  const actor = { id: Number(user.id), roles: user.roles };

  if (!canAccessDelivery(actor)) {
    return (
      <>
        <Topbar section="Delivery" title="PO vendors" user={user} years={years} currentYear={YEAR} />
        <main className="mx-auto w-full max-w-[1440px] px-6 py-6">
          <p className="text-sm text-text-secondary">PO vendors are available to the Delivery team / Super Admin only.</p>
        </main>
      </>
    );
  }

  const vendors = await listPoVendors(actor);

  return (
    <>
      <Topbar section="Delivery" title="PO vendors" user={user} years={years} currentYear={YEAR} />
      <main className="mx-auto w-full max-w-[1440px] space-y-5 px-6 py-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-text-primary">PO vendors</h1>
          <p className="mt-0.5 text-sm text-text-secondary">The vendors who issue POs to us and are billed. Only active vendors can be picked for a new PO.</p>
        </div>
        <PoVendorsManager vendors={vendors} canManage={canManageDelivery(actor)} />
      </main>
    </>
  );
}
