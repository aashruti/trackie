"use client";

import { useState, useTransition } from "react";
import { sendVerificationAction } from "./actions";

export function VerifyEmailCard({ email, verified }: { email: string; verified: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function send() {
    setMsg(null);
    setErr(null);
    start(async () => {
      const res = await sendVerificationAction();
      if (res.ok) setMsg(res.message);
      else setErr(res.error);
    });
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-[15px] font-semibold text-text-primary">Email verification</h2>
        {verified ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--positive-border)] bg-[var(--positive-subtle)] px-2 py-0.5 text-[11px] font-medium text-[var(--positive-text)]">
            Verified
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full border border-[var(--pending-border)] bg-[var(--pending-subtle)] px-2 py-0.5 text-[11px] font-medium text-[var(--pending-text)]">
            Not verified
          </span>
        )}
      </div>
      <p className="mb-4 text-[12px] text-text-muted">
        {verified
          ? `${email} is confirmed — you'll receive Trackie notifications.`
          : `Verify ${email} to receive Trackie notifications (leave approvals, etc.).`}
      </p>

      {!verified && (
        <button
          onClick={send}
          disabled={pending}
          className="rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-fg)] transition-colors hover:bg-[var(--primary-hover)] disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send verification email"}
        </button>
      )}

      {msg && (
        <p className="mt-3 rounded-md border border-[var(--positive-border)] bg-[var(--positive-subtle)] px-3 py-2 text-sm text-[var(--positive-text)]">
          {msg}
        </p>
      )}
      {err && (
        <p className="mt-3 rounded-md border border-[var(--negative-border)] bg-[var(--negative-subtle)] px-3 py-2 text-sm text-[var(--negative-text)]">
          {err}
        </p>
      )}
    </div>
  );
}
