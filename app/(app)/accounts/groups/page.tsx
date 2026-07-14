import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { getYearContext } from "@/lib/dal/years";
import { canManageGroups } from "@/lib/dal/authz";
import { listGroups, listUngroupedAccounts } from "@/lib/dal/groups";
import { GroupsExplorer } from "@/components/groups/groups-explorer";

export default async function AccountGroupsPage() {
  const session = await auth();
  const user = session!.user;
  const { currentYear: YEAR, years } = await getYearContext();
  const actor = { id: Number(user.id), role: user.role };

  if (!canManageGroups(actor)) {
    return (
      <>
        <Topbar section="Universities" title="Grouped view" user={user} years={years} currentYear={YEAR} />
        <main className="mx-auto w-full max-w-[1440px] px-6 py-6">
          <p className="text-sm text-text-secondary">The grouped view is available to Admin / Super Admin only.</p>
        </main>
      </>
    );
  }

  const [groups, ungrouped] = await Promise.all([
    listGroups(actor, YEAR),
    listUngroupedAccounts(actor),
  ]);

  return (
    <>
      <Topbar section="Universities" title="Grouped view" user={user} years={years} currentYear={YEAR} />
      <main className="mx-auto w-full max-w-[1440px] space-y-5 px-6 py-6">
        <GroupsExplorer groups={groups} ungrouped={ungrouped} year={YEAR} />
      </main>
    </>
  );
}
