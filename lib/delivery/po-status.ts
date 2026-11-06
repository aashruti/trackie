// Pure helpers for delivery PO payment status. No `server-only` so client
// components can import this.

export const DEFAULT_GST_RATE = 18;

export type PaymentStatus =
  | "no_value"
  | "value_missing"
  | "not_received"
  | "part_received"
  | "fully_received"
  | "over_received";

export type PoTotals = {
  due: number | null;
  settled: number;
  outstanding: number;
  status: PaymentStatus;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function computePoTotals(input: {
  poValue: number | null;
  gstRate: number;
  received: number;
  tds: number;
}): PoTotals {
  const settled = round2(input.received + input.tds);
  if (input.poValue === null) {
    return {
      due: null,
      settled,
      outstanding: 0,
      status: settled === 0 ? "no_value" : "value_missing",
    };
  }
  const due = round2(input.poValue * (1 + input.gstRate / 100));
  if (settled === 0) {
    return { due, settled, outstanding: due, status: "not_received" };
  }
  const diff = round2(settled - due);
  if (Math.abs(diff) <= 1) {
    return { due, settled, outstanding: 0, status: "fully_received" };
  }
  if (diff > 0) {
    return { due, settled, outstanding: 0, status: "over_received" };
  }
  return { due, settled, outstanding: round2(due - settled), status: "part_received" };
}

/** Blank -> null; strips commas and a leading rupee sign; unparseable -> NaN. */
export function parseMoneyInput(raw: string): number | null {
  const s = raw.replace(/^\s*₹/, "").replace(/,/g, "").trim();
  if (s === "") return null;
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return NaN;
  return Number(s);
}
