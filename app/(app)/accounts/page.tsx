import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { listAccountsForUser } from "@/lib/dal/accounts";
import { AccountsExplorer } from "@/components/accounts/accounts-explorer";
import { getYearContext } from "@/lib/dal/years";
import { canManageGroups, canViewFinance } from "@/lib/dal/authz";

export default async function AccountsPage() {
  const session = await auth();
  const user = session!.user;
  if (!canViewFinance({ id: Number(user.id), roles: user.roles })) redirect("/dashboard");
  const { currentYear: YEAR, years } = await getYearContext();
  const rows = await listAccountsForUser(
    { id: Number(user.id), roles: user.roles },
    YEAR,
  );

  return (
    <>
      <Topbar section="Universities" title="Accounts" user={user} years={years} currentYear={YEAR} />
      <main className="mx-auto w-full max-w-[1440px] space-y-4 px-6 py-6">
        <div className="flex items-center justify-between">
          <p className="text-xs text-text-muted">
            {rows.length} accounts · {YEAR}
          </p>
          {canManageGroups({ id: Number(user.id), roles: user.roles }) && (
            <Link
              href="/accounts/groups"
              className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover"
            >
              Grouped view →
            </Link>
          )}
        </div>
        <AccountsExplorer
          canCreate={user.roles.includes("super-admin")}
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
