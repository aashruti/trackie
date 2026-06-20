import Link from "next/link";
import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { getCurrentYear, listYears } from "@/lib/dal/years";
import { listOems } from "@/lib/dal/account-admin";
import { NewAccountForm } from "@/components/accounts/new-account-form";

export default async function NewAccountPage() {
  const session = await auth();
  const user = session!.user;
  const YEAR = await getCurrentYear();
  const years = (await listYears()).map((y) => y.label);

  if (user.role !== "super-admin") {
    return (
      <>
        <Topbar section="Universities" title="New account" user={user} years={years} currentYear={YEAR} />
        <main className="mx-auto w-full max-w-[1440px] px-6 py-6">
          <p className="text-sm text-text-secondary">Only a Super Admin can create accounts.</p>
        </main>
      </>
    );
  }

  const oems = await listOems();

  return (
    <>
      <Topbar section="Universities" title="New account" user={user} years={years} currentYear={YEAR} />
      <main className="mx-auto w-full max-w-[1440px] space-y-5 px-6 py-6">
        <div>
          <Link href="/accounts" className="text-xs text-text-muted hover:text-text-primary">
            ← All accounts
          </Link>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-text-primary">Create account</h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            Add a university, programme, or own-product account. You can add invoices after.
          </p>
        </div>
        <NewAccountForm oems={oems} />
      </main>
    </>
  );
}
