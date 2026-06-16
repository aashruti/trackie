export type Category = "advance" | "old" | "new";
export type Semester = "none" | "1" | "2";
export type Status = "draft" | "raised" | "partially-paid" | "paid" | "overdue";

export interface PaymentLite {
  amount: number;
}

export interface InvoiceInput {
  category: Category;
  semester: Semester;
  students: number;
  priceToUni: number;
  priceToDatagami: number;
  gstRate: number; // 0.18 default
  tdsRate: number; // 0.10 default
  advanceAdj?: number; // amount netted off the OEM taxable, pre-tax
  payments?: PaymentLite[]; // receipts only (direction handled upstream)
}

export interface InvoiceComputed extends InvoiceInput {
  taxableIn: number;
  gstIn: number;
  billing: number;
  tdsIn: number;
  afterTds: number;
  received: number;
  outstanding: number;
  taxableOut: number;
  oemTaxableNet: number;
  gstOut: number;
  tdsOut: number;
  payable: number;
  advanceTdsCost: number;
  gstDiff: number;
  tdsDiff: number;
  netMargin: number;
}

export interface InvoiceInputWithStatus extends InvoiceInput {
  status: Status;
}

export interface AccountComputed {
  invoices: (InvoiceComputed & { status: Status })[];
  billing: number;
  received: number;
  outstanding: number;
  payable: number;
  netMargin: number;
  gstDiff: number;
  hasNegative: boolean;
  status: Status;
}
