"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TrackieLogo } from "./logo";
import { roleLabel } from "@/lib/auth/role-label";
import type { Role } from "@/lib/db/enums";

type Item = { label: string; href: string; icon: string; soon?: boolean; locked?: boolean };

const FINANCE_BASE: Item[] = [
  { label: "Dashboard", href: "/dashboard", icon: "M3 12l9-9 9 9M5 10v10h14V10" },
  { label: "Accounts", href: "/accounts", icon: "M4 7h16M4 12h16M4 17h10" },
  // Leads is spliced in here (with lock state) by Sidebar based on role.
  { label: "Reports", href: "/reports", icon: "M7 17V9M12 17V5M17 17v-6" },
  { label: "New year setup", href: "/new-year", icon: "M12 5v14M5 12h14" },
];

const ADMIN: Item[] = [
  { label: "Users & access", href: "/admin/users", icon: "M16 14a4 4 0 10-8 0M12 7a3 3 0 110 6 3 3 0 010-6M3 20a6 6 0 0118 0" },
];

const WORKSPACE: Item[] = [
  { label: "Team board", href: "/team", icon: "M4 5h16v6H4zM4 13h7v6H4z" },
];

const HR: Item[] = [
  { label: "Employees", href: "/hr/employees", icon: "M16 14a4 4 0 10-8 0M12 7a3 3 0 110 6 3 3 0 010-6M3 20a6 6 0 0118 0" },
  { label: "Leave", href: "/hr/leave", icon: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" },
  { label: "Attendance", href: "/hr/attendance", icon: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" },
  { label: "Payroll", href: "/hr/payroll", icon: "M3 6h18v12H3zM3 10h18M7 15h4" },
  { label: "HR settings", href: "/hr/settings", icon: "M12 9a3 3 0 100 6 3 3 0 000-6M4 12h2M18 12h2M12 4v2M12 18v2M6 6l1.5 1.5M16.5 16.5L18 18M18 6l-1.5 1.5M7.5 16.5L6 18" },
];

const ME: Item[] = [
  { label: "Apply for leave", href: "/me/leave", icon: "M12 5v14M5 12h14" },
  { label: "My attendance", href: "/me/attendance", icon: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" },
  { label: "My payslips", href: "/me/payslips", icon: "M6 3h9l3 3v15H6zM9 12h6M9 16h4" },
];

function LockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="ml-auto shrink-0">
      <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function NavLink({ item, active }: { item: Item; active: boolean }) {
  const base =
    "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors";
  if (item.locked) {
    return (
      <div
        className={`${base} cursor-not-allowed text-text-muted opacity-50`}
        aria-disabled="true"
        title="Available to Admin / Finance only"
      >
        <Icon path={item.icon} />
        <span>{item.label}</span>
        <LockIcon />
      </div>
    );
  }
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

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export function Sidebar({
  role,
  user,
  version,
  isEmployee,
}: {
  role?: Role;
  user?: { name?: string | null; role?: Role };
  version?: string;
  isEmployee?: boolean;
}) {
  const pathname = usePathname();
  // Finance/admin are for super-admin & admin; HR is for super-admin & hr; the
  // "Me" self-service group appears for anyone flagged as an employee.
  const showFinance = role === "super-admin" || role === "admin";
  const showHr = role === "super-admin" || role === "hr";
  const finance: Item[] = [
    FINANCE_BASE[0],
    FINANCE_BASE[1],
    { label: "Leads", href: "/leads", icon: "M3 4h18l-7 8v6l-4 2v-8z" },
    FINANCE_BASE[2],
    FINANCE_BASE[3],
  ];

  const name = user?.name ?? "User";

  return (
    <aside
      className="no-print flex h-dvh w-[264px] shrink-0 flex-col border-r border-border bg-surface"
      style={{ position: "sticky", top: 0 }}
    >
      <div className="px-5 py-5">
        <TrackieLogo />
      </div>
      <nav className="flex-1 overflow-y-auto px-3">
        {showFinance && <Group title="Finance" items={finance} pathname={pathname} />}
        {role === "super-admin" && <Group title="Admin" items={ADMIN} pathname={pathname} />}
        {showHr && (
          <Group
            title="HR"
            items={showFinance ? HR : [{ label: "Dashboard", href: "/dashboard", icon: "M3 12l9-9 9 9M5 10v10h14V10" }, ...HR]}
            pathname={pathname}
          />
        )}
        {isEmployee && <Group title="Me" items={ME} pathname={pathname} />}
        <Group title="Workspace" items={WORKSPACE} pathname={pathname} />
      </nav>

      {/* Footer: user identity + product version */}
      <div className="border-t border-border-subtle p-3">
        <div className="flex items-center gap-2.5 rounded-lg border border-border bg-surface-sunken px-2.5 py-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--primary-subtle)] text-xs font-bold text-[var(--primary-text)]">
            {initials(name)}
          </span>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-semibold text-text-primary">{name}</div>
            <div className="truncate text-[11px] text-text-muted">{roleLabel(user?.role ?? role)}</div>
          </div>
        </div>
        <div className="px-1 pt-2 text-[11px] text-text-muted">
          Trackie{version ? ` v${version}` : ""}
        </div>
      </div>
    </aside>
  );
}
