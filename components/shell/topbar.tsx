import { signOut } from "@/lib/auth/config";
import { YearSelector } from "./year-selector";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { CommandPalette } from "./command-palette";
import { canViewFinance } from "@/lib/dal/authz";
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

      {/* Global search (⌘K command palette) — finance surfaces only. */}
      <div className="hidden min-w-0 flex-1 justify-center md:flex">
        {canViewFinance({ id: 0, roles: user.roles ?? [] }) && <CommandPalette />}
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
