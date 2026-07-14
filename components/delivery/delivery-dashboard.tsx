import Link from "next/link";
import { Money } from "@/components/ui/money";
import type { DeliveryDashboard } from "@/lib/dal/delivery/dashboard";
import { ACTIVITY_TYPE_META } from "./meta";

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
}

/** Presentational delivery dashboard (server-rendered — no client interactivity needed). */
export function DeliveryDashboardPanel({ data }: { data: DeliveryDashboard }) {
  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Programs" value={String(data.programs.total)} href="/delivery/programs" />
        <StatCard label="Active programs" value={String(data.programs.active)} href="/delivery/programs" tone="positive" />
        <StatCard label="Events next 14 days" value={String(data.upcomingCount)} href="/delivery/programs" tone="info" />
        <StatCard label="Over budget" value={String(data.overBudgetCount)} href="/delivery/programs" tone={data.overBudgetCount > 0 ? "negative" : "default"} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Upcoming events */}
        <section className="rounded-xl border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-text-primary">Upcoming events</h2>
          <p className="mt-0.5 text-xs text-text-muted">Planned events starting or running in the next 14 days.</p>
          {data.upcoming.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-muted">Nothing planned in the next two weeks.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {data.upcoming.map((e) => (
                <li key={e.eventId}>
                  <Link
                    href={`/delivery/programs/${e.programId}?tab=calendar&month=${e.startDate.slice(0, 7)}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle px-3 py-2 hover:bg-surface-hover"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-text-primary">{e.title}</span>
                      <span className="block truncate text-[11px] text-text-muted">{e.accountName} · {e.programName}</span>
                    </span>
                    <span className="tabular shrink-0 text-xs font-semibold text-text-secondary">
                      {fmtDate(e.startDate)}
                      {e.endDate ? ` → ${fmtDate(e.endDate)}` : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Over-budget alerts */}
        <section className="rounded-xl border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-text-primary">Budget alerts</h2>
          <p className="mt-0.5 text-xs text-text-muted">Events whose spend has crossed their allocation.</p>
          {data.overBudget.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-muted">Everything is within budget. 🎯</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {data.overBudget.map((e) => (
                <li key={e.eventId}>
                  <Link
                    href={`/delivery/programs/${e.programId}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[var(--negative-border)] bg-[var(--negative-subtle)]/40 px-3 py-2 hover:bg-[var(--negative-subtle)]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-text-primary">{e.title}</span>
                      <span className="block truncate text-[11px] text-text-muted">{e.programName}</span>
                    </span>
                    <span className="shrink-0 text-xs font-semibold text-[var(--negative-text)]">
                      <Money value={e.spent} compact /> / <Money value={e.budget} compact />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Recent activity */}
      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-text-primary">Recent activity</h2>
        {data.recent.length === 0 ? (
          <p className="py-8 text-center text-sm text-text-muted">No activity logged yet — open a program and start the log.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border-subtle">
            {data.recent.map((a) => {
              const t = ACTIVITY_TYPE_META[a.type];
              return (
                <li key={a.id} className="flex items-center gap-3 py-2">
                  <span className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ color: t.text, background: t.bg }}>
                    {t.label}
                  </span>
                  <Link href={`/delivery/programs/${a.programId}`} className="min-w-0 flex-1 truncate text-[13px] text-text-primary hover:underline">
                    {a.title}
                  </Link>
                  <span className="hidden shrink-0 truncate text-[11px] text-text-muted sm:block">{a.programName}</span>
                  <span className="tabular shrink-0 text-[11px] text-text-muted">{fmtDate(a.activityDate)}</span>
                  <span className="hidden shrink-0 text-[11px] text-text-muted sm:block">{a.author}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        <QuickLink href="/delivery/programs" label="Programs" />
        <QuickLink href="/delivery/board" label="Delivery board" />
        <QuickLink href="/delivery/settings" label="Teaching styles" />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  href,
  tone = "default",
}: {
  label: string;
  value: string;
  href: string;
  tone?: "default" | "positive" | "info" | "negative";
}) {
  const color =
    tone === "positive" ? "var(--positive-text)" : tone === "info" ? "var(--info-text)" : tone === "negative" ? "var(--negative-text)" : "var(--text-primary)";
  return (
    <Link href={href} className="rounded-xl border border-border bg-surface p-4 transition-colors hover:bg-surface-hover">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold" style={{ color }}>{value}</div>
    </Link>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover"
    >
      {label} →
    </Link>
  );
}
