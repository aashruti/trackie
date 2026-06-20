import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { ChangePasswordForm } from "./change-password-form";

export default async function ProfilePage() {
  const session = await auth();
  const user = session!.user;
  return (
    <>
      <Topbar section="ACCOUNT" title="My profile" user={user as { name?: string | null; email?: string | null; role?: "super-admin" | "admin" | "viewer" }} />
      <div className="mx-auto max-w-md px-6 py-10">
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
