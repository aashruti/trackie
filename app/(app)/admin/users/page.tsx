import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { getYearContext } from "@/lib/dal/years";
import { listUsers } from "@/lib/dal/user-admin";
import { listAccountsForUser } from "@/lib/dal/accounts";
import { UsersAdmin } from "@/components/admin/users-admin";

export default async function UsersAdminPage() {
  const session = await auth();
  const user = session!.user;
  const { currentYear: YEAR, years } = await getYearContext();

  if (!user.roles.includes("super-admin")) {
    return (
      <>
        <Topbar section="Admin" title="Users" user={user} years={years} currentYear={YEAR} />
        <main className="mx-auto w-full max-w-[1440px] px-6 py-6">
          <p className="text-sm text-text-secondary">Only a Super Admin can manage users.</p>
        </main>
      </>
    );
  }

  const actor = { id: Number(user.id), roles: user.roles };
  const usersList = await listUsers(actor);
  // All accounts (any year) for the assignment picker — accounts persist across years.
  const accountRows = await listAccountsForUser(actor, YEAR);
  const accounts = accountRows.map((a) => ({ id: a.id, name: a.name })).sort((x, y) => x.name.localeCompare(y.name));

  return (
    <>
      <Topbar section="Admin" title="Users & access" user={user} years={years} currentYear={YEAR} />
      <main className="mx-auto w-full max-w-[1440px] space-y-5 px-6 py-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-text-primary">Users &amp; access</h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            Create team members, set roles, and assign which accounts each can see.
          </p>
        </div>
        <UsersAdmin users={usersList} accounts={accounts} currentUserId={actor.id} />
      </main>
    </>
  );
}
