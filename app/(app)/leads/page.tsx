import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { listLeadsWithActivities } from "@/lib/dal/leads";
import { canAccessLeads } from "@/lib/dal/authz";
import { initials } from "@/lib/board/constants";
import { LeadsBoard } from "@/components/leads/leads-board";

export default async function LeadsPage() {
  const session = await auth();
  const user = session!.user;
  const sessionUser = { id: Number(user.id), role: user.role };

  // Designer / Employee (viewer) is locked out — the nav greys this item, and
  // this guards a direct URL hit.
  if (!canAccessLeads(sessionUser)) redirect("/team");

  const leads = await listLeadsWithActivities(sessionUser);

  return (
    <>
      <Topbar section="Sales" title="Lead management" user={user} />
      <main className="flex min-h-0 flex-1 flex-col px-6 py-6">
        <LeadsBoard
          leads={leads}
          meCode={initials(user.name ?? "U")}
          currentUserId={Number(user.id)}
          isSuperAdmin={user.role === "super-admin"}
        />
      </main>
    </>
  );
}
