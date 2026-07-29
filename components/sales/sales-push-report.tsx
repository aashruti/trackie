import Link from "next/link";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { fmtDay, fmtDayYear } from "@/lib/dates";
import type {
  SalesPushData,
  SalesPushInvoice,
  SalesPushReceipt,
} from "@/lib/dal/sales-push";
import { streamLabel } from "@/lib/money/report-view";

function Count({ value, label }: { value: number; label: string }) {
  return (
    <span className="text-xs text-text-muted">
      {value} {value === 1 ? label : `${label}s`}
    </span>
  );
}

function Kpi({
  label,
  value,
  count,
  tone,
  hint,
}: {
  label: string;
  value: number;
  count: number;
  tone: "positive" | "negative" | "pending" | "info";
  hint: string;
}) {
  const border = {
    positive: "border-l-[var(--positive-border)]",
    negative: "border-l-[var(--negative-border)]",
    pending: "border-l-[var(--pending-border)]",
    info: "border-l-[var(--info-border)]",
  }[tone];

  return (
    <Card className={`border-l-4 ${border} p-4`}>
      <p className="text-xs font-medium text-text-secondary">{label}</p>
      <Money
        value={value}
        compact
        tone={tone}
        className="mt-2 block text-2xl font-semibold tracking-tight"
      />
      <p className="mt-1 text-xs text-text-muted">
        {count} {count === 1 ? "item" : "items"} · {hint}
      </p>
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-5 py-10 text-center text-sm text-text-muted">
      {children}
    </div>
  );
}

function AccountLink({
  accountId,
  accountName,
}: {
  accountId: number;
  accountName: string;
}) {
  return (
    <Link
      href={`/accounts/${accountId}`}
      className="font-medium text-text-primary hover:text-[var(--primary-text)] hover:underline"
    >
      {accountName}
    </Link>
  );
}

function ReceiptList({ rows }: { rows: SalesPushReceipt[] }) {
  if (!rows.length) return <Empty>No receipts recorded in this window.</Empty>;
  return (
    <div className="divide-y divide-border-subtle">
      {rows.map((row) => (
        <div key={row.paymentId} className="px-5 py-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <AccountLink
                accountId={row.accountId}
                accountName={row.accountName}
              />
              <p className="mt-0.5 truncate text-xs text-text-muted">
                {streamLabel(row.category, row.semester)} · {row.owner}
              </p>
            </div>
            <Money
              value={row.amount}
              tone="positive"
              className="shrink-0 text-sm font-semibold"
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge tone="positive">{fmtDay(row.paidOn)}</Badge>
            <Badge tone="neutral">{row.mode}</Badge>
            {row.ref && (
              <span className="truncate text-[11px] text-text-muted">
                Ref: {row.ref}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function CollectionList({
  rows,
  dateTone,
  empty,
}: {
  rows: SalesPushInvoice[];
  dateTone: "negative" | "pending";
  empty: string;
}) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="divide-y divide-border-subtle">
      {rows.map((row) => (
        <div key={row.invoiceId} className="px-5 py-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <AccountLink
                accountId={row.accountId}
                accountName={row.accountName}
              />
              <p className="mt-0.5 truncate text-xs text-text-muted">
                {streamLabel(row.category, row.semester)} · {row.owner}
              </p>
            </div>
            <Money
              value={Math.max(0, row.outstanding)}
              tone={dateTone}
              className="shrink-0 text-sm font-semibold"
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge tone={dateTone}>
              Due {fmtDay(row.dueDate)}
            </Badge>
            <StatusBadge status={row.status} />
          </div>
        </div>
      ))}
    </div>
  );
}

function InvoiceList({
  rows,
  action,
}: {
  rows: SalesPushInvoice[];
  action: "raised" | "missed" | "scheduled";
}) {
  if (!rows.length) {
    return (
      <Empty>
        {action === "raised"
          ? "No invoices raised in this window."
          : "No invoices waiting in this bucket."}
      </Empty>
    );
  }
  const tone =
    action === "raised"
      ? "positive"
      : action === "missed"
        ? "negative"
        : "info";
  return (
    <div className="divide-y divide-border-subtle">
      {rows.map((row) => (
        <div key={row.invoiceId} className="px-5 py-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <AccountLink
                accountId={row.accountId}
                accountName={row.accountName}
              />
              <p className="mt-0.5 truncate text-xs text-text-muted">
                {streamLabel(row.category, row.semester)} · {row.owner}
              </p>
            </div>
            <Money
              value={row.billing}
              className="shrink-0 text-sm font-semibold"
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge tone={tone}>
              {action === "raised"
                ? "Raised"
                : action === "missed"
                  ? "Was due"
                  : "Raise"}{" "}
              {fmtDay(row.invoiceDate)}
            </Badge>
            <StatusBadge status={row.status} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SalesPushReport({ data }: { data: SalesPushData }) {
  const missingDates =
    data.dataQuality.openWithoutDueDate.length +
    data.dataQuality.draftsWithoutInvoiceDate.length;

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-3 rounded-xl border border-border bg-surface-sunken px-5 py-4 md:flex-row md:items-center">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">
            Weekly push snapshot
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-text-muted">
            Actual receipts, missed collection follow-ups, upcoming dues, and
            invoices that need to be raised—using the dates already recorded on
            each invoice.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Badge tone="neutral">
            Done · {fmtDayYear(data.window.pastStart)}–
            {fmtDayYear(data.window.today)}
          </Badge>
          <Badge tone="info">
            Next · {fmtDayYear(data.window.today)}–
            {fmtDayYear(data.window.futureEnd)}
          </Badge>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Collected"
          value={data.summary.collectedAmount}
          count={data.summary.collectedCount}
          tone="positive"
          hint="past 14 days"
        />
        <Kpi
          label="Missed collections"
          value={data.summary.missedAmount}
          count={data.summary.missedCount}
          tone="negative"
          hint="overdue now"
        />
        <Kpi
          label="Collections due"
          value={data.summary.upcomingAmount}
          count={data.summary.upcomingCount}
          tone="pending"
          hint="next 14 days"
        />
        <Kpi
          label="Invoices to raise"
          value={data.summary.invoiceToRaiseAmount}
          count={data.summary.invoiceToRaiseCount}
          tone="info"
          hint="missed + next 14 days"
        />
      </section>

      {missingDates > 0 && (
        <section className="flex flex-col justify-between gap-3 rounded-xl border border-[var(--pending-border)] bg-[var(--pending-subtle)] px-5 py-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-semibold text-[var(--pending-text)]">
              {missingDates}{" "}
              {missingDates === 1 ? "invoice needs" : "invoices need"} a
              planning date
            </p>
            <p className="mt-1 text-xs text-text-secondary">
              {data.dataQuality.openWithoutDueDate.length} open without a
              collection due date ·{" "}
              {data.dataQuality.draftsWithoutInvoiceDate.length} drafts without
              an invoice date
            </p>
          </div>
          <Link
            href="/accounts"
            className="shrink-0 text-sm font-semibold text-[var(--pending-text)] hover:underline"
          >
            Update invoices →
          </Link>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-text-primary">
              Collections
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">
              What came in, what slipped, and what the team should collect next.
            </p>
          </div>
        </div>
        <div className="grid items-start gap-4 lg:grid-cols-3">
          <Card className="overflow-hidden">
            <CardHeader
              title="Received"
              subtitle="Receipts in the past 14 days"
              action={
                <Count
                  value={data.collections.received.length}
                  label="receipt"
                />
              }
            />
            <ReceiptList rows={data.collections.received} />
          </Card>
          <Card className="overflow-hidden">
            <CardHeader
              title="Missed"
              subtitle="Open invoices past their due date"
              action={
                <Count value={data.collections.missed.length} label="invoice" />
              }
            />
            <CollectionList
              rows={data.collections.missed}
              dateTone="negative"
              empty="No overdue collections."
            />
          </Card>
          <Card className="overflow-hidden">
            <CardHeader
              title="Next 14 days"
              subtitle="Open invoices due for collection"
              action={
                <Count
                  value={data.collections.upcoming.length}
                  label="invoice"
                />
              }
            />
            <CollectionList
              rows={data.collections.upcoming}
              dateTone="pending"
              empty="No collections due in this window."
            />
          </Card>
        </div>
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-base font-semibold text-text-primary">
            Invoice raising
          </h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Future-dated invoices act as reminders; past-dated drafts remain
            visible until raised.
          </p>
        </div>
        <div className="grid items-start gap-4 lg:grid-cols-3">
          <Card className="overflow-hidden">
            <CardHeader
              title="Missed"
              subtitle="Past invoice dates still in Draft"
              action={
                <Count
                  value={data.invoices.missedToRaise.length}
                  label="invoice"
                />
              }
            />
            <InvoiceList rows={data.invoices.missedToRaise} action="missed" />
          </Card>
          <Card className="overflow-hidden">
            <CardHeader
              title="Next 14 days"
              subtitle="Invoices scheduled to be raised"
              action={
                <Count
                  value={data.invoices.scheduledToRaise.length}
                  label="invoice"
                />
              }
            />
            <InvoiceList
              rows={data.invoices.scheduledToRaise}
              action="scheduled"
            />
          </Card>
          <Card className="overflow-hidden">
            <CardHeader
              title="Raised"
              subtitle="Invoices raised in the past 14 days"
              action={
                <Count
                  value={data.invoices.raisedRecently.length}
                  label="invoice"
                />
              }
            />
            <InvoiceList rows={data.invoices.raisedRecently} action="raised" />
          </Card>
        </div>
      </section>
    </div>
  );
}
