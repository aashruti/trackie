import { describe, expect, it } from "vitest";
import {
  classifyInvoiceForSalesPush,
  isInNextWindow,
  isInPastWindow,
  salesPushWindow,
} from "./push-window";

describe("salesPushWindow", () => {
  const window = salesPushWindow("2026-07-29");

  it("creates inclusive rolling fourteen-day windows", () => {
    expect(window).toEqual({
      today: "2026-07-29",
      pastStart: "2026-07-16",
      futureEnd: "2026-08-11",
    });
    expect(isInPastWindow("2026-07-16", window)).toBe(true);
    expect(isInPastWindow("2026-07-15", window)).toBe(false);
    expect(isInNextWindow("2026-08-11", window)).toBe(true);
    expect(isInNextWindow("2026-08-12", window)).toBe(false);
  });

  it("classifies missed and upcoming collections from due date and outstanding", () => {
    expect(
      classifyInvoiceForSalesPush(
        {
          invoiceDate: "2026-07-01",
          dueDate: "2026-07-28",
          status: "partially-paid",
          outstanding: 50_000,
        },
        window,
      ).missedCollection,
    ).toBe(true);
    expect(
      classifyInvoiceForSalesPush(
        {
          invoiceDate: "2026-07-01",
          dueDate: "2026-08-05",
          status: "raised",
          outstanding: 75_000,
        },
        window,
      ).upcomingCollection,
    ).toBe(true);
    expect(
      classifyInvoiceForSalesPush(
        {
          invoiceDate: "2026-07-01",
          dueDate: "2026-07-28",
          status: "paid",
          outstanding: 50_000,
        },
        window,
      ).missedCollection,
    ).toBe(false);
  });

  it("uses draft and future invoice dates as invoice-raising reminders", () => {
    const overdueDraft = classifyInvoiceForSalesPush(
      {
        invoiceDate: "2026-07-28",
        dueDate: null,
        status: "draft",
        outstanding: 0,
      },
      window,
    );
    expect(overdueDraft.missedInvoiceRaise).toBe(true);

    const futureReminder = classifyInvoiceForSalesPush(
      {
        invoiceDate: "2026-08-04",
        dueDate: null,
        status: "raised",
        outstanding: 0,
      },
      window,
    );
    expect(futureReminder.scheduledInvoiceRaise).toBe(true);
  });

  it("flags open invoices and drafts that are missing their planning dates", () => {
    const flags = classifyInvoiceForSalesPush(
      {
        invoiceDate: null,
        dueDate: null,
        status: "draft",
        outstanding: 100_000,
      },
      window,
    );
    expect(flags.draftWithoutInvoiceDate).toBe(true);
    expect(flags.openWithoutDueDate).toBe(false);

    const raised = classifyInvoiceForSalesPush(
      {
        invoiceDate: "2026-07-20",
        dueDate: null,
        status: "raised",
        outstanding: 100_000,
      },
      window,
    );
    expect(raised.openWithoutDueDate).toBe(true);
  });
});
