import { redirect } from "next/navigation";
import { SalesPushReport } from "@/components/sales/sales-push-report";
import { Topbar } from "@/components/shell/topbar";
import { auth } from "@/lib/auth/config";
import { canViewFinance } from "@/lib/dal/authz";
import { getSalesPushData } from "@/lib/dal/sales-push";

export default async function SalesPushPage() {
  const session = await auth();
  const user = session!.user;
  const actor = { id: Number(user.id), roles: user.roles };
  if (!canViewFinance(actor)) redirect("/dashboard");

  const data = await getSalesPushData(actor);

  return (
    <>
      <Topbar section="Sales" title="Sales push" user={user} />
      <main className="mx-auto w-full max-w-[1440px] px-6 py-6">
        <SalesPushReport data={data} />
      </main>
    </>
  );
}
