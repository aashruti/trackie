import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";

export default async function DashboardPage() {
  const session = await auth();
  const user = session!.user;

  return (
    <>
      <Topbar title="Dashboard" user={user} />
      <main className="mx-auto w-full max-w-[1440px] px-6 py-6">
        <p className="text-sm text-text-secondary">
          Portfolio overview — building KPIs, reserves, charts, and the
          all-accounts table next.
        </p>
      </main>
    </>
  );
}
