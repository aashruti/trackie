import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accounts, oems, invoices, academicYears } from "@/lib/db/schema";
import { canEdit, type SessionUser } from "./authz";
import { assignedIds } from "./accounts";
import { stampedDelete, stampedDeleteWhere } from "./audit";
import type { Category, Semester, Status } from "@/lib/money/types";

function assertSuperAdmin(user: SessionUser) {
  if (!user.roles.includes("super-admin")) throw new Error("Only a Super Admin can do this");
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
 * Delete a single draft invoice (and its cohorts/payments via cascade).
 * Rejected if the invoice is not in "draft" status — only drafts can be removed.
 * Any admin who can edit the account can delete its draft invoices.
 */
export async function deleteDraftInvoice(
  user: SessionUser,
  accountId: number,
  invoiceId: number,
): Promise<void> {
  const assigned = user.roles.includes("super-admin") ? [] : await assignedIds(user.id);
  if (!canEdit(user, accountId, assigned)) throw new Error("Not authorized for this account");

  const [row] = await db
    .select({ status: invoices.status })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!row) throw new Error("Invoice not found");
  if (row.status !== "draft") throw new Error("Only draft invoices can be deleted");

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
  // Delete invoices first — payments and cohorts cascade from invoice deletion.
  // Non-atomic on neon-http (no transactions): if a new invoice is created for
  // this account between the two calls below, the account delete fails with an
  // FK violation. Pre-existing race window, benign — nothing is lost, and the
  // caller can just retry.
  await stampedDeleteWhere(invoices, eq(invoices.accountId, accountId), user.id);
  // Delete the account — userAccounts cascades; tasks.accountId set null.
  await stampedDelete(accounts, accountId, user.id);
}
