import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { getYearContext } from "@/lib/dal/years";
import { getMyAttendanceMonth } from "@/lib/dal/hr/attendance";
import { MyAttendanceView } from "@/components/hr/my-attendance";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default async function MyAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await auth();
  const user = session!.user;
  const { currentYear: YEAR, years } = await getYearContext();
  const actor = { id: Number(user.id), role: user.role };

  const { month } = await searchParams;
  const now = new Date();
  const [y, m] = month && /^\d{4}-\d{2}$/.test(month)
    ? [Number(month.slice(0, 4)), Number(month.slice(5, 7))]
    : [now.getUTCFullYear(), now.getUTCMonth() + 1];

  const data = await getMyAttendanceMonth(actor, y, m);
  if (!data.isEmployee) redirect("/dashboard");

  return (
    <>
      <Topbar section="Me" title="My attendance" user={user} years={years} currentYear={YEAR} />
      <main className="mx-auto w-full max-w-[1440px] px-6 py-6">
        <MyAttendanceView data={data} monthLabel={`${MONTHS[m - 1]} ${y}`} />
      </main>
    </>
  );
}
