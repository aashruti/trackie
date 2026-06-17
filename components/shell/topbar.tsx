import { signOut } from "@/lib/auth/config";
import { Badge } from "@/components/ui/badge";
import { YearSelector } from "./year-selector";
import type { Role } from "@/lib/db/enums";

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function Topbar({
  title,
  user,
  years = [],
  currentYear,
}: {
  title: string;
  user: { name?: string | null; role?: Role };
  years?: string[];
  currentYear?: string;
}) {
  return (
    <header className="no-print sticky top-0 z-10 flex h-[60px] items-center gap-4 border-b border-border bg-surface/80 px-6 backdrop-blur">
      <h1 className="text-lg font-semibold tracking-tight text-text-primary">{title}</h1>

      <div className="ml-auto flex items-center gap-3">
        {currentYear && years.length > 0 && (
          <YearSelector years={years} current={currentYear} />
        )}

        <div className="hidden items-center gap-2 rounded-md border border-border bg-surface-sunken px-3 py-1.5 text-sm text-text-muted md:flex">
          <span>Search</span>
          <kbd className="rounded bg-surface px-1 text-[10px]">⌘K</kbd>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-[var(--primary-subtle)] text-xs font-bold text-[var(--primary-text)]">
            {initials(user.name ?? "U")}
          </div>
          <div className="hidden leading-tight sm:block">
            <div className="text-sm font-medium text-text-primary">{user.name}</div>
            {user.role && (
              <div className="-mt-0.5">
                <Badge tone="info">{user.role}</Badge>
              </div>
            )}
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button className="rounded-md border border-border-strong px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-hover">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
