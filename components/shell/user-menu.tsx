"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { rolesShort, rolesLabel } from "@/lib/auth/role-label";
import type { Role } from "@/lib/db/enums";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export function UserMenu({
  user,
  signOutAction,
}: {
  user: { name?: string | null; email?: string | null; roles?: Role[] };
  signOutAction: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const name = user.name ?? "User";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full border border-border py-1 pl-1 pr-2 transition-colors hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
      >
        <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--primary-subtle)] text-[11px] font-bold text-[var(--primary-text)]">
          {initials(name)}
        </span>
        {user.roles && user.roles.length > 0 && (
          <span className="rounded-full border border-[var(--primary-border)] bg-[var(--primary-subtle)] px-2 py-0.5 text-[11px] font-semibold text-[var(--primary-text)]">
            {rolesShort(user.roles)}
          </span>
        )}
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-lg border border-border bg-[var(--surface-raised)] p-1 shadow-lg"
        >
          <div className="px-3 py-2">
            <div className="truncate text-sm font-semibold text-text-primary">{name}</div>
            {user.email && <div className="truncate text-xs text-text-muted">{user.email}</div>}
            {user.roles && user.roles.length > 0 && (
              <div className="mt-0.5 text-[11px] text-text-muted">{rolesLabel(user.roles)}</div>
            )}
          </div>
          <div className="my-1 border-t border-border-subtle" />
          <Link
            href="/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
            </svg>
            Change password
          </Link>
          <div className="my-1 border-t border-border-subtle" />
          <form action={signOutAction}>
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`text-text-muted transition-transform ${open ? "rotate-180" : ""}`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
