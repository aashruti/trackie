"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const INITIAL: LoginState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, INITIAL);

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
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-text-primary outline-none focus:ring-2 focus:ring-primary"
          />
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
