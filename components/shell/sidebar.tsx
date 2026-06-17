"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TrackieLogo } from "./logo";

type Item = { label: string; href: string; icon: string; soon?: boolean };

const OVERVIEW: Item[] = [
  { label: "Dashboard", href: "/dashboard", icon: "M3 12l9-9 9 9M5 10v10h14V10" },
  { label: "Accounts", href: "/accounts", icon: "M4 7h16M4 12h16M4 17h10" },
  { label: "Reports", href: "/reports", icon: "M7 17V9M12 17V5M17 17v-6" },
  { label: "New year setup", href: "/new-year", icon: "M12 5v14M5 12h14" },
];

const WORKSPACE: Item[] = [
  { label: "Team board", href: "#", icon: "M4 5h16v6H4zM4 13h7v6H4z", soon: true },
];

function NavLink({ item, active }: { item: Item; active: boolean }) {
  const base =
    "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors";
  if (item.soon) {
    return (
      <div className={`${base} cursor-default text-text-muted`}>
        <Icon path={item.icon} />
        <span>{item.label}</span>
        <span className="ml-auto rounded-full bg-[var(--neutral-status-subtle)] px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
          Soon
        </span>
      </div>
    );
  }
  return (
    <Link
      href={item.href}
      className={`${base} ${
        active
          ? "bg-[var(--primary-subtle)] text-[var(--primary-text)]"
          : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
      }`}
    >
      <Icon path={item.icon} />
      <span>{item.label}</span>
    </Link>
  );
}

function Icon({ path }: { path: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0">
      <path d={path} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Group({ title, items, pathname }: { title: string; items: Item[]; pathname: string }) {
  return (
    <div>
      <div className="px-3 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
        {title}
      </div>
      <div className="space-y-0.5">
        {items.map((it) => (
          <NavLink key={it.label} item={it} active={pathname.startsWith(it.href) && it.href !== "#"} />
        ))}
      </div>
    </div>
  );
}

const ADMIN: Item[] = [
  { label: "Users & access", href: "/admin/users", icon: "M16 14a4 4 0 10-8 0M12 7a3 3 0 110 6 3 3 0 010-6M3 20a6 6 0 0118 0" },
];

export function Sidebar({ year, role }: { year?: string; role?: string }) {
  const pathname = usePathname();
  return (
    <aside
      className="flex h-dvh w-[264px] shrink-0 flex-col border-r border-border bg-surface"
      style={{ position: "sticky", top: 0 }}
    >
      <div className="px-5 py-5">
        <TrackieLogo />
      </div>
      <nav className="flex-1 overflow-y-auto px-3">
        <Group title="Overview" items={OVERVIEW} pathname={pathname} />
        {role === "super-admin" && <Group title="Admin" items={ADMIN} pathname={pathname} />}
        <Group title="Workspace" items={WORKSPACE} pathname={pathname} />
      </nav>
      <div className="border-t border-border-subtle px-5 py-3 text-[11px] text-text-muted">
        Trackie{year ? ` · ${year}` : ""}
      </div>
    </aside>
  );
}
