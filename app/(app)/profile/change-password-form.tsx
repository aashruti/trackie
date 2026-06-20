"use client";

import { useState, useTransition } from "react";
import { changePasswordAction } from "./actions";

export function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setMsg({ ok: false, text: "New passwords do not match." });
      return;
    }
    setMsg(null);
    startTransition(async () => {
      const res = await changePasswordAction(current, next);
      if (res.ok) {
        setMsg({ ok: true, text: "Password changed successfully." });
        setCurrent(""); setNext(""); setConfirm("");
      } else {
        setMsg({ ok: false, text: res.error });
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Current password">
        <input
          type="password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
        />
      </Field>
      <Field label="New password">
        <input
          type="password"
          required
          minLength={8}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
        />
      </Field>
      <Field label="Confirm new password">
        <input
          type="password"
          required
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
        />
      </Field>

      {msg && (
        <p
          className="rounded-lg px-3 py-2 text-[12px] font-medium"
          style={
            msg.ok
              ? { background: "var(--positive-subtle)", color: "var(--positive-text)" }
              : { background: "var(--negative-subtle)", color: "var(--negative-text)" }
          }
        >
          {msg.text}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-lg bg-[var(--primary)] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
      >
        {isPending ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[12px] font-medium text-text-secondary">{label}</label>
      {children}
    </div>
  );
}
