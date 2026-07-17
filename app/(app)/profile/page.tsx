import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { ChangePasswordForm } from "./change-password-form";
import { VerifyEmailCard } from "./verify-email-card";
import { getUserEmailInfo } from "@/lib/dal/email-verify";
import type { Role } from "@/lib/db/enums";

export default async function ProfilePage() {
  const session = await auth();
  const user = session!.user;
  const info = await getUserEmailInfo(Number(user.id));
  return (
    <>
      <Topbar section="ACCOUNT" title="My profile" user={user as { name?: string | null; email?: string | null; roles?: Role[] }} />
      <div className="mx-auto max-w-md space-y-5 px-6 py-10">
        {info && <VerifyEmailCard email={info.email} verified={!!info.emailVerifiedAt} />}
        <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
          <h2 className="mb-1 text-[15px] font-semibold text-text-primary">Change password</h2>
          <p className="mb-6 text-[12px] text-text-muted">
            Choose a strong password of at least 8 characters.
          </p>
          <ChangePasswordForm />
        </div>
      </div>
    </>
  );
}
