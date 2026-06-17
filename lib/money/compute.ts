import type {
  InvoiceInput,
  InvoiceComputed,
  InvoiceInputWithStatus,
  AccountComputed,
  Status,
} from "./types";

/**
 * The authoritative per-invoice money engine.
 *
 * Rules (confirmed by Datagami; override both the UI prototype and the source Excel):
 *  - Student profit = students × (priceToUni − priceToDatagami). Advance-independent.
 *  - The advance is a token pass-through transferred to the OEM as-is; its ONLY
 *    profit effect is the TDS Datagami fronts out of pocket: −(advance × tdsRate).
 *  - Student TDS is pass-through (never an out-of-pocket cost).
 *  - The advance is netted PRE-tax off the OEM payable only (oemTaxableNet).
 */
export function computeInvoice(i: InvoiceInput): InvoiceComputed {
  const adv = i.advanceAdj ?? 0;

  const taxableIn = i.students * i.priceToUni; // FULL — margin basis
  // The advance is a prepayment of these fees, so the university is billed the
  // NET amount once the count is known (advance was billed separately as a token).
  const billedTaxableIn = taxableIn - adv;
  const gstIn = billedTaxableIn * i.gstRate;
  const billing = billedTaxableIn + gstIn;
  const tdsIn = billedTaxableIn * i.tdsRate;
  const afterTds = billing - tdsIn;
  const received = (i.payments ?? []).reduce((a, p) => a + p.amount, 0);
  const outstanding = afterTds - received;

  // taxableOut = Datagami's cost basis (used for margin). For self-supplied
  // products it's an optional internal cost; otherwise the OEM transfer price.
  const taxableOut = i.students * i.priceToDatagami;

  // Self-supplied (Datagami is the "OEM"): no external transfer at all — no
  // payable, no OEM-side GST/TDS, no advance. Margin = revenue − internal cost.
  const self = i.selfSupplied === true;
  const oemTaxableNet = self ? 0 : taxableOut - adv; // advance token netted PRE-tax
  const gstOut = self ? 0 : oemTaxableNet * i.gstRate;
  const tdsOut = self ? 0 : oemTaxableNet * i.tdsRate;
  const payable = self ? 0 : oemTaxableNet + gstOut - tdsOut;
  const paidToOem = (i.oemPayments ?? []).reduce((a, p) => a + p.amount, 0);
  const outstandingToOem = payable - paidToOem;

  // Advance is the only out-of-pocket cost: Datagami fronts the TDS on the
  // as-is advance transfer. Student invoices net only the price difference.
  const advanceTdsCost = !self && i.category === "advance" ? taxableIn * i.tdsRate : 0;

  const gstDiff = gstIn - gstOut;
  const tdsDiff = tdsIn - tdsOut;
  // An advance is a token/prepayment — never a profit centre. Its only profit
  // impact is the TDS Datagami fronts (OEM advances); own-product advances cost
  // nothing → margin 0. Student invoices carry the real margin (price diff).
  const netMargin =
    i.category === "advance" ? -advanceTdsCost || 0 : taxableIn - taxableOut;

  return {
    ...i,
    advanceAdj: adv,
    taxableIn,
    billedTaxableIn,
    gstIn,
    billing,
    tdsIn,
    afterTds,
    received,
    outstanding,
    taxableOut,
    oemTaxableNet,
    gstOut,
    tdsOut,
    payable,
    paidToOem,
    outstandingToOem,
    advanceTdsCost,
    gstDiff,
    tdsDiff,
    netMargin,
  };
}

/**
 * Roll an account's status up from its invoices:
 *  - any overdue invoice → overdue
 *  - else outstanding ≤ ₹1 → paid
 *  - else any money received → partially-paid
 *  - else raised
 */
export function accountStatus(
  invoices: { status: Status; outstanding: number; received?: number }[],
): Status {
  if (invoices.length === 0) return "draft"; // nothing billed yet
  if (invoices.every((s) => s.status === "draft")) return "draft";
  if (invoices.some((s) => s.status === "overdue")) return "overdue";
  const outstanding = invoices.reduce((a, s) => a + s.outstanding, 0);
  if (outstanding <= 1) return "paid";
  const received = invoices.reduce((a, s) => a + (s.received ?? 0), 0);
  if (received > 0) return "partially-paid";
  return "raised";
}

export function computeAccount(
  inputs: InvoiceInputWithStatus[],
): AccountComputed {
  const invoices = inputs.map((i) => ({ ...computeInvoice(i), status: i.status }));
  const sum = (k: keyof InvoiceComputed) =>
    invoices.reduce((a, s) => a + (s[k] as number), 0);
  return {
    invoices,
    billing: sum("billing"),
    received: sum("received"),
    outstanding: sum("outstanding"),
    payable: sum("payable"),
    paidToOem: sum("paidToOem"),
    outstandingToOem: sum("outstandingToOem"),
    netMargin: sum("netMargin"),
    gstDiff: sum("gstDiff"),
    // Set-aside reserves (owed to / recoverable from govt) — never part of profit.
    netGst: sum("gstDiff"),
    tdsReceivable: sum("tdsIn"),
    tdsPayable: sum("tdsOut"),
    advanceTdsCost: sum("advanceTdsCost"),
    // Only genuine below-cost student sales trip the red flag; the advance's
    // structural negative TDS cost does not.
    hasNegative: invoices.some((s) => s.category !== "advance" && s.netMargin < 0),
    status: accountStatus(
      invoices.map((s) => ({
        status: s.status,
        outstanding: s.outstanding,
        received: s.received,
      })),
    ),
  };
}
