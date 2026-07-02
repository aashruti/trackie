import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { getYearContext } from "@/lib/dal/years";
import { getMyPayslips } from "@/lib/dal/hr/payroll";
import { MyPayslipsView } from "@/components/hr/my-payslips";

export default async function MyPayslipsPage() {
  const session = await auth();
  const user = session!.user;
  const { currentYear: YEAR, years } = await getYearContext();
  const actor = { id: Number(user.id), role: user.role };

  const { isEmployee, slips } = await getMyPayslips(actor);
  if (!isEmployee) redirect("/dashboard");

  return (
    <>
      <Topbar section="Me" title="My payslips" user={user} years={years} currentYear={YEAR} />
      <main className="mx-auto w-full max-w-[1100px] px-6 py-6">
        <MyPayslipsView slips={slips} />
      </main>
    </>
  );
}
