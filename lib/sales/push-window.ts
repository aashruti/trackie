import type { Status } from "@/lib/money/types";

export type SalesPushWindow = {
  today: string;
  pastStart: string;
  futureEnd: string;
};

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Two rolling call-planning views:
 * - past: today plus the preceding 13 calendar days
 * - next: today plus the following 13 calendar days
 *
 * Today intentionally appears in both operational views: money received today
 * is "done", while a collection or invoice due today is still actionable.
 */
export function salesPushWindow(today: string): SalesPushWindow {
  return {
    today,
    pastStart: addDays(today, -13),
    futureEnd: addDays(today, 13),
  };
}

export function isInPastWindow(
  date: string | null,
  window: SalesPushWindow,
): boolean {
  return !!date && date >= window.pastStart && date <= window.today;
}

export function isInNextWindow(
  date: string | null,
  window: SalesPushWindow,
): boolean {
  return !!date && date >= window.today && date <= window.futureEnd;
}

export type InvoiceWindowInput = {
  invoiceDate: string | null;
  dueDate: string | null;
  status: Status;
  outstanding: number;
};

export type InvoiceWindowFlags = {
  raisedRecently: boolean;
  missedInvoiceRaise: boolean;
  scheduledInvoiceRaise: boolean;
  missedCollection: boolean;
  upcomingCollection: boolean;
  openWithoutDueDate: boolean;
  draftWithoutInvoiceDate: boolean;
};

export function classifyInvoiceForSalesPush(
  invoice: InvoiceWindowInput,
  window: SalesPushWindow,
): InvoiceWindowFlags {
  const collectable =
    invoice.outstanding > 1 &&
    invoice.status !== "draft" &&
    invoice.status !== "paid";

  return {
    raisedRecently:
      invoice.status !== "draft" && isInPastWindow(invoice.invoiceDate, window),
    missedInvoiceRaise:
      invoice.status === "draft" &&
      !!invoice.invoiceDate &&
      invoice.invoiceDate < window.today,
    // A future invoice date is the reminder even if an older row was already
    // marked Raised. For today, only a Draft invoice is still waiting to raise.
    scheduledInvoiceRaise:
      !!invoice.invoiceDate &&
      isInNextWindow(invoice.invoiceDate, window) &&
      (invoice.status === "draft" || invoice.invoiceDate > window.today),
    missedCollection:
      collectable && !!invoice.dueDate && invoice.dueDate < window.today,
    upcomingCollection: collectable && isInNextWindow(invoice.dueDate, window),
    openWithoutDueDate: collectable && !invoice.dueDate,
    draftWithoutInvoiceDate: invoice.status === "draft" && !invoice.invoiceDate,
  };
}
