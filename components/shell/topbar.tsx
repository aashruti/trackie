import { signOut } from "@/lib/auth/config";
import { YearSelector } from "./year-selector";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import type { Role } from "@/lib/db/enums";

export function Topbar({
  title,
  section,
  user,
  years = [],
  currentYear,
}: {
  title: string;
  section?: string;
  user: { name?: string | null; email?: string | null; roles?: Role[] };
  years?: string[];
  currentYear?: string;
}) {
  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <header className="no-print sticky top-0 z-10 flex h-16 items-center gap-4 border-b border-border bg-surface/80 px-6 backdrop-blur">
      <div className="min-w-0 shrink-0">
        {section && (
          <div className="text-[11px] font-semibold uppercase leading-none tracking-wider text-text-muted">
            {section}
          </div>
        )}
        <h1 className="mt-0.5 text-lg font-semibold leading-tight tracking-tight text-text-primary">
          {title}
        </h1>
      </div>

      {/* Search (presentational) */}
      <div className="hidden min-w-0 flex-1 justify-center md:flex">
        <div className="flex w-full max-w-xl items-center gap-2 rounded-lg border border-border bg-surface-sunken px-3 py-2 text-sm text-text-muted">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <span className="flex-1 truncate">Search universities, invoices, OEMs…</span>
          <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 text-[10px]">⌘K</kbd>
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2.5">
        {currentYear && years.length > 0 && (
          <YearSelector years={years} current={currentYear} />
        )}
        <ThemeToggle />
        <UserMenu
          user={{ name: user.name, email: user.email, roles: user.roles }}
          signOutAction={signOutAction}
        />
      </div>
    </header>
  );
}
