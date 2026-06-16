export const ROLES = ["super-admin", "admin", "viewer"] as const;
export const CATEGORIES = ["advance", "old", "new"] as const;
export const SEMESTERS = ["none", "1", "2"] as const;
export const STATUSES = ["draft", "raised", "partially-paid", "paid", "overdue"] as const;
export const MODES = ["RTGS", "NEFT", "IMPS", "UPI", "Cheque"] as const;
export const DIRECTIONS = ["receipt", "oem-payment"] as const;
export const ACCOUNT_TYPES = ["university", "programme"] as const;

export type Role = (typeof ROLES)[number];
