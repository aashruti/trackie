import "server-only";

import { and, asc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accounts, programFiles, programPayments, programs } from "@/lib/db/schema";
import {
  assertDeliveryAccess,
  assertDeliveryManage,
  scopeAccountIds,
  type SessionUser,
} from "@/lib/dal/authz";
import { assignedIds } from "@/lib/dal/accounts";
import { UserError } from "@/lib/dal/errors";
import { DEFAULT_GST_RATE } from "@/lib/delivery/po-status";
import { deleteBlob } from "@/lib/storage/blob";
import { stampedDelete, stampedDeleteWhere } from "../audit";
import { assertPaymentInScope, assertProgramInScope } from "./scope";
import { assertIsoDate } from "./util";

/**
 * Purchase-order details and payments for a delivery program. Money is
 * validated here (computePoTotals does not guard against NaN). Files live in
 * the next layer; this one only reads them and removes them on delete.
 */

export type PoInput = {
  poNumber?: string | null;
  poDate?: string | null;
  poValue?: number | null;
  gstRate?: number | null;
  vendor?: string | null;
};

const text = (v: string | null | undefined, max: number, label: string): string | null => {
  const t = v?.trim() ?? "";
  if (!t) return null;
  if (t.length > max) throw new UserError(`${label} is too long.`);
  return t;
};

export function cleanPoInput(input: PoInput) {
  const poDate = input.poDate?.trim() || null;
  if (poDate) assertIsoDate(poDate, "PO date");
  let poValue: string | null = null;
  if (input.poValue !== null && input.poValue !== undefined) {
    if (!Number.isFinite(input.poValue) || input.poValue <= 0) {
      throw new UserError("PO value must be an amount above zero.");
    }
    poValue = String(input.poValue);
  }
  // Only null/undefined fall back to the default — 0% GST is a real rate.
  const gst = input.gstRate ?? DEFAULT_GST_RATE;
  if (!Number.isFinite(gst) || gst < 0 || gst > 100) throw new UserError("GST rate must be between 0 and 100.");
  return {
    poNumber: text(input.poNumber, 80, "PO number"),
    poDate,
    poValue,
    gstRate: String(gst),
    vendor: text(input.vendor, 160, "Vendor"),
  };
}

/** Best-effort blob removal: failures are logged, never thrown — rows are already gone. */
export async function removeBlobsBestEffort(pathnames: string[]): Promise<void> {
  const results = await Promise.allSettled(pathnames.map((p) => deleteBlob(p)));
  results.forEach((r, i) => {
    if (r.status === "rejected") console.error("[po:delete-blob]", pathnames[i], r.reason);
  });
}

async function callerScope(user: SessionUser): Promise<number[] | null> {
  const assigned = user.roles.includes("super-admin") ? [] : await assignedIds(user.id);
  return scopeAccountIds(user, assigned);
}

export async function updateProgramPo(
  user: SessionUser,
  programId: number,
  input: PoInput,
): Promise<{ duplicates: { id: number; name: string }[] }> {
  assertDeliveryManage(user);
  const values = cleanPoInput(input);
  await assertProgramInScope(user, programId);
  const [saved] = await db
    .update(programs)
    .set({ ...values, updatedBy: user.id })
    .where(eq(programs.id, programId))
    .returning({ accountId: programs.accountId, oemId: programs.oemId });
  if (!saved) throw new UserError("Program not found.");
  if (!values.poNumber) return { duplicates: [] };

  const scope = await callerScope(user);
  const duplicates = await db
    .select({ id: programs.id, name: programs.name })
    .from(programs)
    .where(
      and(
        sql`lower(${programs.poNumber}) = lower(${values.poNumber})`,
        eq(programs.accountId, saved.accountId),
        eq(programs.oemId, saved.oemId),
        ne(programs.id, programId),
        scope ? inArray(programs.accountId, scope.length ? scope : [-1]) : undefined,
      ),
    )
    .orderBy(asc(programs.name));
  return { duplicates };
}

export type NewPayment = {
  programId: number;
  receivedDate: string;
  amount: number;
  tds?: number;
  reference?: string | null;
  note?: string | null;
};

function cleanPayment(input: Omit<NewPayment, "programId">) {
  if (!input.receivedDate) throw new UserError("Pick the date the payment was received.");
  assertIsoDate(input.receivedDate, "received date");
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new UserError("Payment amount must be above zero.");
  const tds = input.tds ?? 0;
  if (!Number.isFinite(tds) || tds < 0) throw new UserError("TDS must be zero or a positive amount.");
  return {
    receivedDate: input.receivedDate,
    amount: String(input.amount),
    tds: String(tds),
    reference: text(input.reference, 120, "Reference"),
    note: text(input.note, 1000, "Note"),
  };
}

export async function addPayment(user: SessionUser, input: NewPayment): Promise<{ id: number }> {
  assertDeliveryManage(user);
  const values = cleanPayment(input);
  await assertProgramInScope(user, input.programId);
  const [exists] = await db.select({ id: programs.id }).from(programs).where(eq(programs.id, input.programId)).limit(1);
  if (!exists) throw new UserError("Program not found.");
  const [row] = await db
    .insert(programPayments)
    .values({ ...values, programId: input.programId, createdBy: user.id, updatedBy: user.id })
    .returning({ id: programPayments.id });
  return { id: row.id };
}

export async function updatePayment(
  user: SessionUser,
  id: number,
  input: Omit<NewPayment, "programId">,
): Promise<void> {
  assertDeliveryManage(user);
  const values = cleanPayment(input);
  await assertPaymentInScope(user, id);
  const updated = await db
    .update(programPayments)
    .set({ ...values, updatedBy: user.id })
    .where(eq(programPayments.id, id))
    .returning({ id: programPayments.id });
  if (!updated.length) throw new UserError("Payment not found.");
}

export async function deletePayment(user: SessionUser, id: number): Promise<void> {
  assertDeliveryManage(user);
  await assertPaymentInScope(user, id);
  const files = await db
    .select({ pathname: programFiles.pathname })
    .from(programFiles)
    .where(eq(programFiles.paymentId, id));
  // Stamp + delete the proofs first so their DELETE audit rows name the deleter.
  await stampedDeleteWhere(programFiles, eq(programFiles.paymentId, id), user.id);
  const n = await stampedDelete(programPayments, id, user.id);
  if (!n) throw new UserError("Payment not found.");
  await removeBlobsBestEffort(files.map((f) => f.pathname));
}

/** Distinct vendor names across the caller's scope, for the picker. */
export async function listVendorOptions(user: SessionUser): Promise<string[]> {
  assertDeliveryAccess(user);
  const scope = await callerScope(user);
  const rows = await db
    .selectDistinct({ vendor: programs.vendor })
    .from(programs)
    .where(
      and(
        isNotNull(programs.vendor),
        scope ? inArray(programs.accountId, scope.length ? scope : [-1]) : undefined,
      ),
    )
    .orderBy(asc(programs.vendor));
  return rows.map((r) => r.vendor!).filter(Boolean);
}

export type ProgramFileRow = {
  id: number;
  paymentId: number | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
};

export type ProgramPayment = {
  id: number;
  receivedDate: string;
  amount: number;
  tds: number;
  reference: string | null;
  note: string | null;
  proofs: ProgramFileRow[];
};

/** Internal, no authorization: callers must have checked scope already. */
export async function loadProgramPo(
  programId: number,
): Promise<{ payments: ProgramPayment[]; documents: ProgramFileRow[] }> {
  const [payRows, fileRows] = await Promise.all([
    db
      .select({
        id: programPayments.id,
        receivedDate: programPayments.receivedDate,
        amount: programPayments.amount,
        tds: programPayments.tds,
        reference: programPayments.reference,
        note: programPayments.note,
      })
      .from(programPayments)
      .where(eq(programPayments.programId, programId))
      .orderBy(asc(programPayments.receivedDate), asc(programPayments.id)),
    db
      .select({
        id: programFiles.id,
        paymentId: programFiles.paymentId,
        fileName: programFiles.fileName,
        contentType: programFiles.contentType,
        sizeBytes: programFiles.sizeBytes,
      })
      .from(programFiles)
      .where(eq(programFiles.programId, programId))
      .orderBy(asc(programFiles.id)),
  ]);
  const proofsByPayment = new Map<number, ProgramFileRow[]>();
  const documents: ProgramFileRow[] = [];
  for (const f of fileRows) {
    if (f.paymentId === null) {
      documents.push(f);
    } else {
      const list = proofsByPayment.get(f.paymentId) ?? [];
      list.push(f);
      proofsByPayment.set(f.paymentId, list);
    }
  }
  return {
    payments: payRows.map((p) => ({
      ...p,
      amount: Number(p.amount),
      tds: Number(p.tds),
      proofs: proofsByPayment.get(p.id) ?? [],
    })),
    documents,
  };
}
