"use client";

import type { CalendarCell } from "@/lib/dal/delivery/util";
import { ACTIVITY_TYPE_META, EVENT_STATUS_BAR, inr } from "./meta";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Month grid for one program: event chips span their days (rounded only at the
 * true start/end so multi-day events read as bars), activities render as typed
 * dots with a tooltip. Same 7-column idiom as the HR attendance calendar.
 */
export function ProgramCalendarView({
  days,
  cells,
}: {
  days: string[];
  cells: Record<string, CalendarCell>;
}) {
  const firstDow = days.length ? new Date(days[0] + "T00:00:00Z").getUTCDay() : 0;
  const today = localToday();

  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="grid grid-cols-7 gap-1.5">
        {DOW.map((d) => (
          <div key={d} className="px-1 pb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            {d}
          </div>
        ))}
        {Array.from({ length: firstDow }).map((_, i) => (
          <div key={`pad-${i}`} />
        ))}
        {days.map((day) => {
          const cell = cells[day];
          const dayNum = Number(day.slice(-2));
          const isToday = day === today;
          return (
            <div
              key={day}
              className={`min-h-[92px] rounded-lg border p-1.5 ${isToday ? "border-[var(--primary)] bg-[var(--primary-subtle)]/40" : "border-border-subtle bg-surface-sunken/40"}`}
            >
              <div className={`mb-1 text-[11px] font-semibold tabular ${isToday ? "text-[var(--primary-text)]" : "text-text-muted"}`}>
                {dayNum}
              </div>
              <div className="space-y-1">
                {cell?.events.map((e) => {
                  const bar = EVENT_STATUS_BAR[e.status];
                  return (
                    <div
                      key={e.id}
                      title={`${e.title} (${e.status})`}
                      className={`truncate px-1.5 py-0.5 text-[10.5px] font-semibold leading-tight ${
                        e.starts && e.ends ? "rounded-md" : e.starts ? "rounded-l-md" : e.ends ? "rounded-r-md" : ""
                      } ${e.status === "cancelled" ? "line-through opacity-70" : ""}`}
                      style={{ background: bar.bg, color: bar.text }}
                    >
                      {e.starts ? e.title : "‥"}
                    </div>
                  );
                })}
                {cell?.activities && cell.activities.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {cell.activities.map((a) => {
                      const t = ACTIVITY_TYPE_META[a.type];
                      return (
                        <span
                          key={a.id}
                          title={`${t.label}: ${a.title}${a.cost > 0 ? ` · ${inr(a.cost)}` : ""}`}
                          className="inline-block h-2 w-2 cursor-default rounded-full"
                          style={{ background: t.text }}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border-subtle pt-2.5 text-[11px] text-text-muted">
        <span className="font-semibold">Events:</span>
        {(["planned", "completed", "cancelled"] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: EVENT_STATUS_BAR[s].bg }} />
            {s}
          </span>
        ))}
        <span className="ml-2 font-semibold">Activity dots:</span>
        {(Object.keys(ACTIVITY_TYPE_META) as (keyof typeof ACTIVITY_TYPE_META)[]).slice(0, 4).map((t) => (
          <span key={t} className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: ACTIVITY_TYPE_META[t].text }} />
            {ACTIVITY_TYPE_META[t].label}
          </span>
        ))}
      </div>
    </div>
  );
}

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
