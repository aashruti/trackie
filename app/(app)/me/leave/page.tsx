import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { getYearContext } from "@/lib/dal/years";
import {
  getEmployeeForUser,
  listLeaveTypesPublic,
  listMyRequests,
  listMyBalances,
} from "@/lib/dal/hr/leave";
import { LeaveApply } from "@/components/hr/leave-apply";

export default async function MyLeavePage() {
  const session = await auth();
  const user = session!.user;
  const { currentYear: YEAR, years } = await getYearContext();
  const actor = { id: Number(user.id), roles: user.roles };

  const me = await getEmployeeForUser(actor.id);
  if (!me) redirect("/dashboard");

  const calYear = new Date().getFullYear();
  const [types, balances, requests] = await Promise.all([
    listLeaveTypesPublic(),
    listMyBalances(actor, calYear),
    listMyRequests(actor),
  ]);

  return (
    <>
      <Topbar section="Me" title="Apply for leave" user={user} years={years} currentYear={YEAR} />
      <main className="mx-auto w-full max-w-[1440px] px-6 py-6">
        <LeaveApply types={types} balances={balances} requests={requests} />
      </main>
    </>
  );
}
