import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { getYearContext } from "@/lib/dal/years";
import { canManageGroups } from "@/lib/dal/authz";
import { getGroupDetail, listUngroupedAccounts } from "@/lib/dal/groups";
import { GroupDetailView } from "@/components/groups/group-detail";

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  const user = session!.user;
  const { currentYear: YEAR, years } = await getYearContext();
  const actor = { id: Number(user.id), role: user.role };
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isFinite(id)) notFound();

  if (!canManageGroups(actor)) {
    return (
      <>
        <Topbar section="Universities" title="Group" user={user} years={years} currentYear={YEAR} />
        <main className="mx-auto w-full max-w-[1440px] px-6 py-6">
          <p className="text-sm text-text-secondary">The grouped view is available to Admin / Super Admin only.</p>
        </main>
      </>
    );
  }

  const [detail, ungrouped] = await Promise.all([
    getGroupDetail(actor, id, YEAR),
    listUngroupedAccounts(actor),
  ]);
  if (!detail) notFound();

  return (
    <>
      <Topbar section="Universities" title={detail.name} user={user} years={years} currentYear={YEAR} />
      <main className="mx-auto w-full max-w-[1440px] space-y-5 px-6 py-6">
        <div>
          <Link href="/accounts/groups" className="text-sm text-text-secondary hover:text-text-primary">
            ← Grouped view
          </Link>
        </div>
        <GroupDetailView detail={detail} ungrouped={ungrouped} year={YEAR} />
      </main>
    </>
  );
}
