import type { InvoiceInput, InvoiceComputed } from "./types";

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

  const taxableIn = i.students * i.priceToUni;
  const gstIn = taxableIn * i.gstRate;
  const billing = taxableIn + gstIn;
  const tdsIn = taxableIn * i.tdsRate;
  const afterTds = billing - tdsIn;
  const received = (i.payments ?? []).reduce((a, p) => a + p.amount, 0);
  const outstanding = afterTds - received;

  const taxableOut = i.students * i.priceToDatagami; // FULL — used for margin
  const oemTaxableNet = taxableOut - adv; // advance token netted PRE-tax
  const gstOut = oemTaxableNet * i.gstRate;
  const tdsOut = oemTaxableNet * i.tdsRate;
  const payable = oemTaxableNet + gstOut - tdsOut;

  // Advance is the only out-of-pocket cost: Datagami fronts the TDS on the
  // as-is advance transfer. Student invoices net only the price difference.
  const advanceTdsCost = i.category === "advance" ? taxableIn * i.tdsRate : 0;

  const gstDiff = gstIn - gstOut;
  const tdsDiff = tdsIn - tdsOut;
  const netMargin = taxableIn - taxableOut - advanceTdsCost;

  return {
    ...i,
    advanceAdj: adv,
    taxableIn,
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
    advanceTdsCost,
    gstDiff,
    tdsDiff,
    netMargin,
  };
}
