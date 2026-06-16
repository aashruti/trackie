import { auth, signOut } from "@/lib/auth/config";

export default async function DashboardPage() {
  const session = await auth();
  const user = session?.user;

  return (
    <main className="mx-auto max-w-3xl p-10">
      <div className="rounded-xl border border-border bg-surface p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
          Trackie
        </h1>
        <p className="mt-2 text-text-secondary">
          Foundation is live. Signed in as{" "}
          <span className="font-medium text-text-primary">{user?.name}</span>{" "}
          <span className="rounded-full bg-primary-subtle px-2 py-0.5 text-xs font-medium text-primary">
            {user?.role}
          </span>
        </p>
        <p className="mt-4 text-sm text-text-muted">
          Dashboard, accounts, and account-detail screens are the next milestone.
        </p>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
          className="mt-6"
        >
          <button className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
