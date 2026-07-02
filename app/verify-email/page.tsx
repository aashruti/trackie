import Link from "next/link";
import { verifyVerifyToken } from "@/lib/auth/email-verify";
import { markEmailVerified } from "@/lib/dal/email-verify";

// Public page (outside the auth-gated (app) group) — reached from the email link.
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  let state: "ok" | "invalid" | "missing" = "missing";

  if (token) {
    const payload = verifyVerifyToken(token);
    if (payload && (await markEmailVerified(payload.userId, payload.email))) {
      state = "ok";
    } else {
      state = "invalid";
    }
  }

  const { title, body, tone } =
    state === "ok"
      ? { title: "Email verified", body: "Your email is confirmed. You'll now receive Trackie notifications.", tone: "var(--positive-text)" }
      : state === "invalid"
        ? { title: "Link invalid or expired", body: "This verification link is no longer valid. Sign in and send a fresh one from your profile.", tone: "var(--negative-text)" }
        : { title: "Nothing to verify", body: "This page needs a verification link. Send one from your profile.", tone: "var(--text-secondary)" };

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold tracking-tight" style={{ color: tone }}>
          {title}
        </h1>
        <p className="mt-2 text-sm text-text-secondary">{body}</p>
        <Link
          href="/dashboard"
          className="mt-6 inline-block rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-fg)] transition-colors hover:bg-[var(--primary-hover)]"
        >
          Go to Trackie
        </Link>
      </div>
    </main>
  );
}
