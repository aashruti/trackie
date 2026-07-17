import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { getYearContext } from "@/lib/dal/years";
import { canManageHr } from "@/lib/dal/authz";
import { listEmployees, listShifts, listCandidateUsers } from "@/lib/dal/hr/employees";
import { EmployeesRoster } from "@/components/hr/employees-roster";

export default async function HrEmployeesPage() {
  const session = await auth();
  const user = session!.user;
  const { currentYear: YEAR, years } = await getYearContext();
  const actor = { id: Number(user.id), roles: user.roles };

  if (!canManageHr(actor)) {
    return (
      <>
        <Topbar section="HR" title="Employees" user={user} years={years} currentYear={YEAR} />
        <main className="mx-auto w-full max-w-[1440px] px-6 py-6">
          <p className="text-sm text-text-secondary">
            Employee management is available to HR / Super Admin only.
          </p>
        </main>
      </>
    );
  }

  const [employees, shifts, candidates] = await Promise.all([
    listEmployees(actor),
    listShifts(actor),
    listCandidateUsers(actor),
  ]);

  return (
    <>
      <Topbar section="HR" title="Employees" user={user} years={years} currentYear={YEAR} />
      <main className="mx-auto w-full max-w-[1440px] px-6 py-6">
        <EmployeesRoster employees={employees} shifts={shifts} candidates={candidates} />
      </main>
    </>
  );
}
