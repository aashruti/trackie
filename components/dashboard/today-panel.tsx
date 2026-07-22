import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { PRIORITY_META, stageLabel, type TaskRow } from "@/lib/board/constants";
import type { LeadFollowup } from "@/lib/dal/leads";
import type { OverdueInvoice } from "@/lib/dal/accounts";
import { fmtDay, isToday } from "@/lib/dates";
import { CATEGORY_LABEL, type ReportCategory } from "@/lib/money/report-view";

/** Daily action panel: the signed-in user's tasks + lead follow-ups due today/overdue. */
export function TodayPanel({
  tasks,
  followups,
  overdueInvoices,
  userId,
}: {
  tasks: TaskRow[];
  followups: LeadFollowup[];
  overdueInvoices: OverdueInvoice[];
  userId: number;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader
          title={`My tasks today${tasks.length ? ` · ${tasks.length}` : ""}`}
          subtitle="Due today or overdue · assigned to you"
          action={<ViewLink href={`/team?assignee=${userId}&due=today`} />}
        />
        <div className="divide-y divide-border-subtle">
          {tasks.length === 0 && <Empty>Nothing due today. 🎉</Empty>}
          {tasks.map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-5 py-2.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: PRIORITY_META[t.priority].color }}
                title={`${PRIORITY_META[t.priority].label} priority`}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-text-primary">{t.title}</div>
                <div className="truncate text-[11px] text-text-muted">
                  {t.accountName ?? "Internal"}
                  {t.oem ? ` · ${t.oem}` : ""}
                </div>
              </div>
              <DateBadge iso={t.dueDate} />
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader
          title={`My follow-ups today${followups.length ? ` · ${followups.length}` : ""}`}
          subtitle="Lead reminders due today or overdue · your leads"
          action={<ViewLink href="/leads" />}
        />
        <div className="divide-y divide-border-subtle">
          {followups.length === 0 && <Empty>No follow-ups due today.</Empty>}
          {followups.map((l) => (
            <div key={l.id} className="flex items-center gap-3 px-5 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-medium text-text-primary">{l.prospect}</span>
                  <span className="shrink-0 rounded-full border border-[var(--neutral-status-border)] bg-[var(--neutral-status-subtle)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--neutral-status-text)]">
                    {stageLabel(l.stage)}
                  </span>
                </div>
                <div className="truncate text-[11px] text-text-muted">
                  {l.action}
                  {l.oem ? ` · ${l.oem}` : ""}
                </div>
              </div>
              <DateBadge iso={l.dueDate} />
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader
          title={`Overdue invoices${overdueInvoices.length ? ` · ${overdueInvoices.length}` : ""}`}
          subtitle="Past due date · unpaid or partially paid"
          action={<ViewLink href="/accounts" />}
        />
        <div className="divide-y divide-border-subtle">
          {overdueInvoices.length === 0 && <Empty>No overdue invoices. 🎉</Empty>}
          {overdueInvoices.map((inv) => (
            <Link
              key={inv.invoiceId}
              href={`/accounts/${inv.accountId}`}
              className="flex items-center gap-3 px-5 py-2.5 hover:bg-surface-hover"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-text-primary">{inv.accountName}</div>
                <div className="truncate text-[11px] text-text-muted">
                  {/* OverdueInvoice.category is DAL-typed as plain string, not the
                      Category enum, so a value outside CATEGORY_LABEL is possible
                      in principle — keep the runtime fallback. */}
                  {CATEGORY_LABEL[inv.category as ReportCategory] ?? inv.category}
                  {inv.semester !== "none" ? ` · ${inv.semester === "1" ? "Odd" : "Even"} sem` : ""}
                </div>
              </div>
              <span className="tabular shrink-0 text-[11px] font-semibold text-[var(--negative-text)]">
                {fmtDay(inv.dueDate)} · overdue
              </span>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}

function DateBadge({ iso }: { iso: string | null }) {
  if (!iso) return null;
  const today = isToday(iso);
  // Only today/overdue items reach this panel, so anything not "today" is overdue.
  if (today) {
    return (
      <span className="shrink-0 rounded-full bg-[var(--primary-subtle)] px-2 py-0.5 text-[11px] font-semibold text-[var(--primary-text)]">
        Today
      </span>
    );
  }
  return (
    <span className="tabular shrink-0 text-[11px] font-semibold text-[var(--negative-text)]">
      {fmtDay(iso)} · overdue
    </span>
  );
}

function ViewLink({ href }: { href: string }) {
  return (
    <Link href={href} className="text-xs font-medium text-[var(--primary-text)] hover:underline">
      View →
    </Link>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-5 py-6 text-center text-xs text-text-muted">{children}</div>;
}
