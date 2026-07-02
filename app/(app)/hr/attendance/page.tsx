import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { getYearContext } from "@/lib/dal/years";
import { canManageHr } from "@/lib/dal/authz";
import { getMonthGrid, listActiveEmployees } from "@/lib/dal/hr/attendance";
import { AttendanceManager } from "@/components/hr/attendance-manager";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default async function HrAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await auth();
  const user = session!.user;
  const { currentYear: YEAR, years } = await getYearContext();
  const actor = { id: Number(user.id), role: user.role };

  if (!canManageHr(actor)) {
    return (
      <>
        <Topbar section="HR" title="Attendance" user={user} years={years} currentYear={YEAR} />
        <main className="mx-auto w-full max-w-[1440px] px-6 py-6">
          <p className="text-sm text-text-secondary">Attendance is available to HR / Super Admin only.</p>
        </main>
      </>
    );
  }

  const { month } = await searchParams;
  const now = new Date();
  const [y, m] = month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
    ? [Number(month.slice(0, 4)), Number(month.slice(5, 7))]
    : [now.getUTCFullYear(), now.getUTCMonth() + 1];

  const [grid, employees] = await Promise.all([getMonthGrid(actor, y, m), listActiveEmployees(actor)]);

  return (
    <>
      <Topbar section="HR" title="Attendance" user={user} years={years} currentYear={YEAR} />
      <main className="mx-auto w-full max-w-[1440px] px-6 py-6">
        <AttendanceManager grid={grid} employees={employees} year={y} month={m} monthLabel={`${MONTHS[m - 1]} ${y}`} />
      </main>
    </>
  );
}
