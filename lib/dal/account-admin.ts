import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  accounts,
  oems,
  invoices,
  academicYears,
  cohorts,
  payments,
  userAccounts,
  tasks,
} from "@/lib/db/schema";
import { canEdit, type SessionUser } from "./authz";
import { assignedIds } from "./accounts";
import { stampedDelete, stampedDeleteWhere } from "./audit";
import { UserError } from "./errors";
import type { PaymentEntry } from "./payments";
import { computeInvoice } from "@/lib/money/compute";
import type { Category, CohortPricing, Semester, Status } from "@/lib/money/types";

function assertSuperAdmin(user: SessionUser) {
  if (!user.roles.includes("super-admin")) throw new Error("Only a Super Admin can do this");
}

/**
 * Bill-deletion's own super-admin gate: same rule and wording as
 * {@link assertSuperAdmin}, but raised as a {@link UserError} so the bill
 * actions can surface the message instead of a generic string (lib/dal/errors).
 *
 * assertSuperAdmin is deliberately left alone — it is shared with account/OEM
 * creation and account deletion, whose callers' error handling is out of scope
 * for this change.
 */
function assertBillSuperAdmin(user: SessionUser) {
  if (!user.roles.includes("super-admin")) throw new UserError("Only a Super Admin can do this");
}

export interface OemRow {
  id: number;
  name: string;
  isSelf: boolean;
}

export async function listOems(): Promise<OemRow[]> {
  return db.select().from(oems).orderBy(asc(oems.name));
}

/** Find an OEM by name, or create it. No authorization — internal helper. */
export async function ensureOem(actorId: number, name: string, isSelf = false): Promise<OemRow> {
  const clean = name.trim();
  if (!clean) throw new Error("OEM name is required");
  const existing = await db.select().from(oems).where(eq(oems.name, clean)).limit(1);
  if (existing.length) return existing[0];
  const [row] = await db
    .insert(oems)
    .values({ name: clean, isSelf, createdBy: actorId, updatedBy: actorId })
    .returning();
  return row;
}

export async function createOem(
  user: SessionUser,
  name: string,
  isSelf = false,
): Promise<OemRow> {
  assertSuperAdmin(user);
  return ensureOem(user.id, name, isSelf);
}

/** Raw account insert. No authorization — callers must authorize first. */
export async function insertAccount(
  actorId: number,
  input: {
    name: string;
    type: "university" | "programme";
    city?: string | null;
    oemId: number;
  },
): Promise<{ id: number }> {
  const name = input.name.trim();
  if (!name) throw new Error("Account name is required");
  const [row] = await db
    .insert(accounts)
    .values({
      name,
      type: input.type,
      city: input.city ?? null,
      oemId: input.oemId,
      createdBy: actorId,
      updatedBy: actorId,
    })
    .returning();
  return { id: row.id };
}

export interface NewAccount {
  name: string;
  type: "university" | "programme";
  city?: string | null;
  oemId?: number;
  newOemName?: string;
  newOemIsSelf?: boolean;
}

export async function createAccount(
  user: SessionUser,
  input: NewAccount,
): Promise<{ id: number }> {
  assertSuperAdmin(user);

  let oemId = input.oemId;
  if (!oemId) {
    if (!input.newOemName?.trim()) throw new Error("Pick an OEM or add a new one");
    const oem = await ensureOem(user.id, input.newOemName, input.newOemIsSelf ?? false);
    oemId = oem.id;
  }

  return insertAccount(user.id, { name: input.name, type: input.type, city: input.city, oemId });
}

export interface NewInvoice {
  category: Category;
  semester: Semester;
  students: number;
  priceToUni: number;
  priceToDatagami: number;
  gstRate: number; // fraction
  tdsRate: number; // fraction
  advanceAdj?: number;
  invoiceDate?: string | null;
  dueDate?: string | null;
  status?: Status;
}

export async function createInvoice(
  user: SessionUser,
  accountId: number,
  yearLabel: string,
  input: NewInvoice,
): Promise<{ id: number }> {
  const assigned = user.roles.includes("super-admin") ? [] : await assignedIds(user.id);
  if (!canEdit(user, accountId, assigned)) throw new Error("Not authorized for this account");

  let [year] = await db
    .select()
    .from(academicYears)
    .where(eq(academicYears.label, yearLabel))
    .limit(1);
  if (!year) {
    [year] = await db
      .insert(academicYears)
      .values({ label: yearLabel, createdBy: user.id, updatedBy: user.id })
      .returning();
  }

  const [row] = await db
    .insert(invoices)
    .values({
      accountId,
      yearId: year.id,
      category: input.category,
      semester: input.semester,
      students: Math.max(0, Math.floor(input.students)),
      priceToUni: String(Math.max(0, input.priceToUni)),
      priceToDatagami: String(Math.max(0, input.priceToDatagami)),
      gstRate: String(Math.max(0, Math.min(1, input.gstRate))),
      tdsRate: String(Math.max(0, Math.min(1, input.tdsRate))),
      advanceAdj: String(Math.max(0, input.advanceAdj ?? 0)),
      invoiceDate: input.invoiceDate ?? null,
      dueDate: input.dueDate ?? null,
      status: input.status ?? "draft",
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning();
  return { id: row.id };
}

/**
 * What a bill deletion will destroy — the confirmation-dialog payload (spec §8).
 * Amounts are rupees, converted the same way {@link loadPaymentLedger} does.
 */
export interface BillDeletionPreview {
  invoiceId: number;
  /**
   * The bill's billed amount in rupees — exactly the `billing` figure the
   * ladder shows, produced by running the invoice (and its cohort rows)
   * through {@link computeInvoice}. Per-cohort price overrides ARE applied:
   * when the cohorts carry locked prices, billing is Σ(count × cohort price)
   * less any advance, plus GST — matching the ladder's "Billing" line rather
   * than a naive students × priceToUni.
   *
   * Present to identify the bill: there is no unique constraint on
   * (account_id, year_id, category, semester), so two bills can share the
   * "Old · 1st sem" label the dialog shows and nothing else would tell them
   * apart.
   */
  billedAmount: number;
  /** The invoice's own date (YYYY-MM-DD), or null if it was never set. */
  invoiceDate: string | null;
  /** Every payment that will be cascade-deleted, oldest first. */
  payments: PaymentEntry[];
  /** Σ of `direction: "receipt"` — money the university paid in. */
  receiptsTotal: number;
  /** Σ of `direction: "oem-payment"` — money paid out to the OEM. */
  oemPaymentsTotal: number;
  /** How many cohort rows hang off this invoice. */
  cohortCount: number;
}

/**
 * Sum rupee amounts without binary-float drift: accumulate in integer paise,
 * then step back down. Per-row values still go through `Number(amount)` exactly
 * as loadPaymentLedger does, so a listed payment and the total it feeds agree.
 */
function sumRupees(amounts: number[]): number {
  return amounts.reduce((paise, a) => paise + Math.round(a * 100), 0) / 100;
}

/**
 * The confirmation payload for {@link deleteBill}: every payment that would be
 * cascade-deleted, the per-direction totals, and the cohort-row count.
 * Super-admin only, and the invoice must belong to `accountId` — same authz as
 * the delete it precedes, so the dialog can never preview a bill the caller
 * could not then delete.
 *
 * Two queries (spec §8): one invoice+cohorts lookup that doubles as the
 * ownership check and feeds the billing figure, one for the payment rows.
 */
export async function getBillDeletionPreview(
  user: SessionUser,
  accountId: number,
  invoiceId: number,
): Promise<BillDeletionPreview> {
  assertBillSuperAdmin(user);

  // LEFT JOIN so an invoice with zero cohorts still returns a row (with a null
  // cohort) — an inner join would make "no cohorts" indistinguishable from
  // "not found". The invoice's own columns repeat across the cohort rows; we
  // read them off the first row and rebuild the cohort list from the rest.
  //
  // We pull the cohorts' own count + prices (not just a COUNT(*)) so the billed
  // figure can be run through the SAME money engine the ladder uses — that is
  // what makes it match a cohort-priced bill's "Billing" line exactly.
  const joined = await db
    .select({
      accountId: invoices.accountId,
      category: invoices.category,
      semester: invoices.semester,
      students: invoices.students,
      priceToUni: invoices.priceToUni,
      priceToDatagami: invoices.priceToDatagami,
      gstRate: invoices.gstRate,
      tdsRate: invoices.tdsRate,
      advanceAdj: invoices.advanceAdj,
      invoiceDate: invoices.invoiceDate,
      cohortId: cohorts.id,
      cohortCount: cohorts.count,
      cohortPriceToUni: cohorts.priceToUni,
      cohortPriceToDatagami: cohorts.priceToDatagami,
    })
    .from(invoices)
    .leftJoin(cohorts, eq(cohorts.invoiceId, invoices.id))
    .where(eq(invoices.id, invoiceId));
  const inv = joined[0];
  if (!inv || inv.accountId !== accountId) throw new UserError("Invoice not found");

  // Rebuild each cohort's pricing exactly as account-detail does before handing
  // it to computeInvoice, so a locked per-cohort price feeds the ladder engine.
  const cohortPricing: CohortPricing[] = joined
    .filter((r) => r.cohortId !== null)
    .map((r) => ({
      count: Number(r.cohortCount),
      priceToUni: r.cohortPriceToUni == null ? null : Number(r.cohortPriceToUni),
      priceToDatagami: r.cohortPriceToDatagami == null ? null : Number(r.cohortPriceToDatagami),
    }));

  // Run the invoice through the authoritative money engine and take `billing`,
  // so the dialog's figure is byte-for-byte what the ladder's "Billing" line
  // shows — cohort overrides included (computeInvoice sums per-cohort prices
  // when cohortPricing is present, else falls back to students × priceToUni).
  const { billing: billedAmount } = computeInvoice({
    category: inv.category,
    semester: inv.semester,
    students: Number(inv.students),
    priceToUni: Number(inv.priceToUni),
    priceToDatagami: Number(inv.priceToDatagami),
    gstRate: Number(inv.gstRate),
    tdsRate: Number(inv.tdsRate),
    advanceAdj: Number(inv.advanceAdj),
    cohortPricing: cohortPricing.length ? cohortPricing : undefined,
  });

  const rows = await db.select().from(payments).where(eq(payments.invoiceId, invoiceId));
  const entries: PaymentEntry[] = rows
    .map((r) => ({
      id: r.id,
      invoiceId: r.invoiceId,
      direction: r.direction,
      paidOn: r.paidOn,
      amount: Number(r.amount),
      mode: r.mode,
      ref: r.ref,
    }))
    .sort((a, b) => a.paidOn.localeCompare(b.paidOn));

  return {
    invoiceId,
    billedAmount,
    invoiceDate: inv.invoiceDate,
    payments: entries,
    receiptsTotal: sumRupees(entries.filter((p) => p.direction === "receipt").map((p) => p.amount)),
    oemPaymentsTotal: sumRupees(
      entries.filter((p) => p.direction === "oem-payment").map((p) => p.amount),
    ),
    cohortCount: cohortPricing.length,
  };
}

/**
 * Permanently delete a bill (invoice) and everything under it — its payments
 * and its cohorts, via the DB cascade. Any status is deletable (draft through
 * paid); the guarantee is not "you can't destroy money data" but "every row
 * destroyed is named in the audit log, with the actor who destroyed it".
 *
 * Super-admin only (spec §8) — deliberately narrower than the retired
 * `deleteDraftInvoice`, which any account editor could call.
 *
 * The invoice is looked up by id AND checked against `accountId`. The retired
 * function authorized against the caller-supplied accountId but resolved the
 * invoice by id alone, so a caller scoped to account A could delete account B's
 * invoice by passing A's id. Both halves must agree.
 *
 * `expectedPaymentIds` and `expectedCohortCount` are the confirmation contract
 * with the dialog — see the guard below.
 */
export async function deleteBill(
  user: SessionUser,
  accountId: number,
  invoiceId: number,
  expectedPaymentIds: number[],
  expectedCohortCount: number,
): Promise<void> {
  assertBillSuperAdmin(user);

  const [row] = await db
    .select({ accountId: invoices.accountId })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!row || row.accountId !== accountId) throw new UserError("Invoice not found");

  // The confirmation dialog itemises exactly which payments and how many cohort
  // rows this delete would destroy, and that itemised list is the entire safety
  // argument for having dropped the old draft-only gate — a fully-paid bill is
  // deletable *because* the user was shown the money first. So the delete
  // re-reads the bill and refuses if it no longer matches what was previewed:
  // if a payment or cohort was added or removed between opening the dialog and
  // confirming, the user is sent back to reopen it rather than destroying a set
  // they never saw.
  //
  // What this guard does and does NOT cover — be honest about the boundary:
  // it catches changes that landed BEFORE this read. neon-http has no
  // transactions, so between this read and the cascade DELETE several lines
  // below there is a narrow window; a payment (or cohort) inserted in *that*
  // window is destroyed unpreviewed and its DELETE audit row is misattributed
  // to this deleter. That is not caught here and is not made atomic — it is the
  // accepted neon-http non-atomicity trade-off (deleteAccount carries the same
  // class of race), and it is recoverable: every destroyed row is named in the
  // audit log with its before-image. The guard shrinks the exposure to that one
  // window; it does not, and cannot on neon-http, eliminate it.
  //
  // Payments are compared as a SET — the preview sorts by date for display, but
  // ordering carries no meaning here and must not decide whether a delete is
  // allowed. Payment ids are unique, so equal length + full containment is set
  // equality. Cohorts are compared by COUNT, which is what the dialog shows.
  const currentIds = (
    await db.select({ id: payments.id }).from(payments).where(eq(payments.invoiceId, invoiceId))
  ).map((r) => r.id);
  const expected = new Set(expectedPaymentIds);
  const paymentsMatch =
    currentIds.length === expected.size && currentIds.every((id) => expected.has(id));

  const currentCohortCount = (
    await db.select({ id: cohorts.id }).from(cohorts).where(eq(cohorts.invoiceId, invoiceId))
  ).length;
  const cohortsMatch = currentCohortCount === expectedCohortCount;

  if (!paymentsMatch || !cohortsMatch) {
    throw new UserError(
      "This bill changed since you opened this dialog — reopen it to see what would be deleted.",
    );
  }

  // Pre-stamp cascade children so their DELETE audit rows carry the deleter
  // rather than whoever last edited them (spec §4 Cascades; mirrors deleteYear
  // and deleteAccount).
  await db.update(cohorts).set({ updatedBy: user.id }).where(eq(cohorts.invoiceId, invoiceId));
  await db.update(payments).set({ updatedBy: user.id }).where(eq(payments.invoiceId, invoiceId));
  // Payments and cohorts cascade from the invoice row.
  await stampedDelete(invoices, invoiceId, user.id);
}

/**
 * Permanently delete an account and all its data (invoices, payments, cohorts,
 * user assignments). Tasks are unlinked (set null), not deleted.
 * Super-admin only — no recovery once done.
 *
 * Invoices have no CASCADE on accounts.id in the DB, so we delete them
 * explicitly first; their payments and cohorts then cascade automatically.
 */
export async function deleteAccount(
  user: SessionUser,
  accountId: number,
): Promise<void> {
  assertSuperAdmin(user);
  // Pre-stamp every audited row this delete will take down, so each one's
  // DELETE/UPDATE audit entry names the deleter.
  //
  // The spec (§4 Cascades) originally accepted stale actors here on the theory
  // that a whole-account delete is coarse enough not to need per-row precision.
  // We tighten it: the fallback is not the NULL the spec assumed — the trigger
  // reads OLD.updated_by, which is a real, specific, uninvolved person. An audit
  // log that names the wrong human as the destroyer of an account's entire
  // financial history is worse than one that names nobody.
  const invoiceIds = (
    await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.accountId, accountId))
  ).map((r) => r.id);
  if (invoiceIds.length) {
    // cohorts + payments CASCADE from invoices, so scope them by invoice id
    // (mirrors deleteYear in rollover.ts).
    await db.update(cohorts).set({ updatedBy: user.id }).where(inArray(cohorts.invoiceId, invoiceIds));
    await db.update(payments).set({ updatedBy: user.id }).where(inArray(payments.invoiceId, invoiceIds));
  }
  // user_accounts CASCADEs from the account; tasks.account_id is SET NULL (an
  // audited UPDATE, which also reads updated_by). Both hang off accountId.
  await db.update(userAccounts).set({ updatedBy: user.id }).where(eq(userAccounts.accountId, accountId));
  await db.update(tasks).set({ updatedBy: user.id }).where(eq(tasks.accountId, accountId));

  // Delete invoices first — payments and cohorts cascade from invoice deletion.
  // Non-atomic on neon-http (no transactions): if a new invoice is created for
  // this account between the two calls below, the account delete fails with an
  // FK violation. Pre-existing race window, benign — nothing is lost, and the
  // caller can just retry.
  await stampedDeleteWhere(invoices, eq(invoices.accountId, accountId), user.id);
  // Delete the account — userAccounts cascades; tasks.accountId set null.
  await stampedDelete(accounts, accountId, user.id);
}
