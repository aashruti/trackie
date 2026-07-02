import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { getYearContext } from "@/lib/dal/years";
import { canManageHr } from "@/lib/dal/authz";
import {
  listPendingRequests,
  listAllRequests,
  listBalanceLedger,
} from "@/lib/dal/hr/leave";
import { LeaveManager } from "@/components/hr/leave-manager";

export default async function HrLeavePage() {
  const session = await auth();
  const user = session!.user;
  const { currentYear: YEAR, years } = await getYearContext();
  const actor = { id: Number(user.id), role: user.role };

  if (!canManageHr(actor)) {
    return (
      <>
        <Topbar section="HR" title="Leave" user={user} years={years} currentYear={YEAR} />
        <main className="mx-auto w-full max-w-[1440px] px-6 py-6">
          <p className="text-sm text-text-secondary">
            Leave management is available to HR / Super Admin only.
          </p>
        </main>
      </>
    );
  }

  const calYear = new Date().getFullYear();
  const [pending, all, ledger] = await Promise.all([
    listPendingRequests(actor),
    listAllRequests(actor),
    listBalanceLedger(actor, calYear),
  ]);

  return (
    <>
      <Topbar section="HR" title="Leave" user={user} years={years} currentYear={YEAR} />
      <main className="mx-auto w-full max-w-[1440px] px-6 py-6">
        <LeaveManager pending={pending} all={all} ledger={ledger} />
      </main>
    </>
  );
}
