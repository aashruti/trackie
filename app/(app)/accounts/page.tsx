import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { listAccountsForUser } from "@/lib/dal/accounts";
import { AccountsExplorer } from "@/components/accounts/accounts-explorer";
import { getYearContext } from "@/lib/dal/years";

export default async function AccountsPage() {
  const session = await auth();
  const user = session!.user;
  const { currentYear: YEAR, years } = await getYearContext();
  const rows = await listAccountsForUser(
    { id: Number(user.id), role: user.role },
    YEAR,
  );

  return (
    <>
      <Topbar section="Universities" title="Accounts" user={user} years={years} currentYear={YEAR} />
      <main className="mx-auto w-full max-w-[1440px] space-y-4 px-6 py-6">
        <p className="text-xs text-text-muted">
          {rows.length} accounts · {YEAR}
        </p>
        <AccountsExplorer
          canCreate={user.role === "super-admin"}
          rows={rows.map((r) => ({
            id: r.id,
            name: r.name,
            oem: r.oem,
            billing: r.billing,
            received: r.received,
            outstanding: r.outstanding,
            netMargin: r.netMargin,
            hasNegative: r.hasNegative,
            status: r.status,
          }))}
        />
      </main>
    </>
  );
}
