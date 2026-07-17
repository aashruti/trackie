"use client";

import { useActionState, useState } from "react";
import { login, type LoginState } from "./actions";

const INITIAL: LoginState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, INITIAL);
  const [showPw, setShowPw] = useState(false);

  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6">
      <form
        action={formAction}
        className="w-full max-w-sm rounded-xl border border-border bg-surface p-8 shadow-sm"
      >
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
          Trackie
        </h1>
        <p className="mt-1 text-sm text-text-secondary">Sign in to continue</p>

        <label className="mt-6 block text-sm font-medium text-text-secondary">
          Email
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            defaultValue={state.email}
            key={state.email ?? ""}
            className="mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-text-primary outline-none focus:ring-2 focus:ring-primary"
          />
        </label>

        <label className="mt-4 block text-sm font-medium text-text-secondary">
          Password
          <div className="relative mt-1">
            <input
              name="password"
              type={showPw ? "text" : "password"}
              required
              autoComplete="current-password"
              // pr-11 keeps the value clear of the reveal button.
              className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 pr-11 text-text-primary outline-none focus:ring-2 focus:ring-primary"
            />
            <button
              // type="button" is load-bearing: the default inside a <form> is
              // "submit", so revealing the password would submit the form.
              type="button"
              onClick={() => setShowPw((s) => !s)}
              aria-label={showPw ? "Hide password" : "Show password"}
              aria-pressed={showPw}
              className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-md text-text-muted transition-colors hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            >
              {showPw ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
        </label>

        {state.error && (
          <p
            role="alert"
            className="mt-4 rounded-md border border-border-strong px-3 py-2 text-sm text-[var(--negative-text)]"
          >
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-6 w-full rounded-md bg-primary px-3 py-2 font-medium text-primary-fg transition-colors hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

/* Inline SVGs, matching the house convention (topbar.tsx, theme-toggle.tsx):
   24×24 viewBox, currentColor, strokeWidth 2 — the repo has no icon library. */

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a18.5 18.5 0 0 1-2.4 3.4M6.6 6.6A18.4 18.4 0 0 0 2 12s3.6 7 10 7a10.8 10.8 0 0 0 5.4-1.4" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="M3 3l18 18" />
    </svg>
  );
}
