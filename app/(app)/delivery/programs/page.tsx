import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { getYearContext } from "@/lib/dal/years";
import { canAccessDelivery, canManageDelivery } from "@/lib/dal/authz";
import { listMethods } from "@/lib/dal/delivery/methods";
import { listAccountOptions, listOemOptions, listPrograms } from "@/lib/dal/delivery/programs";
import { ProgramsExplorer } from "@/components/delivery/programs-explorer";

export default async function DeliveryProgramsPage() {
  const session = await auth();
  const user = session!.user;
  const { currentYear: YEAR, years } = await getYearContext();
  const actor = { id: Number(user.id), roles: user.roles };

  if (!canAccessDelivery(actor)) {
    return (
      <>
        <Topbar section="Delivery" title="Programs" user={user} years={years} currentYear={YEAR} />
        <main className="mx-auto w-full max-w-[1440px] px-6 py-6">
          <p className="text-sm text-text-secondary">Delivery programs are available to the Delivery team / Admin / Super Admin only.</p>
        </main>
      </>
    );
  }

  const [programs, methods, accounts, oems] = await Promise.all([
    listPrograms(actor),
    listMethods(actor, { includeInactive: false }),
    listAccountOptions(actor),
    listOemOptions(actor),
  ]);

  return (
    <>
      <Topbar section="Delivery" title="Programs" user={user} years={years} currentYear={YEAR} />
      <main className="mx-auto w-full max-w-[1440px] space-y-5 px-6 py-6">
        <ProgramsExplorer
          programs={programs}
          methods={methods.map((m) => ({ id: m.id, name: m.name, code: m.code }))}
          accounts={accounts}
          oems={oems}
          canManage={canManageDelivery(actor)}
        />
      </main>
    </>
  );
}
