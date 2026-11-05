import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { programFiles, programPayments, programs } from "@/lib/db/schema";
import { assertDeliveryAccess, assertDeliveryManage, type SessionUser } from "@/lib/dal/authz";
import { UserError } from "@/lib/dal/errors";
import { checkUpload } from "@/lib/delivery/upload-rules";
import { downloadBlob, isStorageConfigured, uploadBlob } from "@/lib/storage/blob";
import { stampedDelete } from "../audit";
import { removeBlobsBestEffort, type ProgramFileRow } from "./po";
import { assertFileInScope, assertProgramInScope } from "./scope";

/**
 * PO documents (paymentId null) and payment proofs. Blob URLs and pathnames
 * never leave this module: callers get ProgramFileRow, and bytes are streamed
 * through the download route after a scope check.
 */

/** A rejected upload (bad type/size/payment) — routes map this to 400, other UserErrors to 404. */
export class UploadError extends UserError {}

export async function storeProgramFile(
  user: SessionUser,
  input: { programId: number; paymentId: number | null; fileName: string; bytes: Uint8Array },
): Promise<ProgramFileRow> {
  assertDeliveryManage(user);
  if (!isStorageConfigured()) throw new UserError("File storage isn't configured. Ask an admin to set it up.");
  const checked = checkUpload(input.bytes, input.fileName);
  if (!checked.ok) throw new UploadError(checked.error);
  await assertProgramInScope(user, input.programId);

  const [[program], payment] = await Promise.all([
    db.select({ id: programs.id }).from(programs).where(eq(programs.id, input.programId)).limit(1),
    input.paymentId === null
      ? Promise.resolve(null)
      : db
          .select({ id: programPayments.id })
          .from(programPayments)
          // The schema doesn't tie a payment to the file's program, so enforce it here.
          .where(and(eq(programPayments.id, input.paymentId), eq(programPayments.programId, input.programId)))
          .limit(1),
  ]);
  if (!program) throw new UserError("Program not found.");
  if (input.paymentId !== null && !payment?.length) throw new UploadError("That payment doesn't belong to this program.");

  const fileName = input.fileName.replace(/[\r\n]/g, " ").trim().slice(0, 200) || `file.${checked.ext}`;
  const pathname = `delivery/programs/${input.programId}/${randomUUID()}.${checked.ext}`;
  await uploadBlob(pathname, input.bytes, checked.contentType);
  try {
    const [row] = await db
      .insert(programFiles)
      .values({
        programId: input.programId,
        paymentId: input.paymentId,
        fileName,
        pathname,
        contentType: checked.contentType,
        sizeBytes: input.bytes.length,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning({
        id: programFiles.id,
        paymentId: programFiles.paymentId,
        fileName: programFiles.fileName,
        contentType: programFiles.contentType,
        sizeBytes: programFiles.sizeBytes,
      });
    return row;
  } catch (e) {
    await removeBlobsBestEffort([pathname]);
    throw e;
  }
}

/** Null when the file is missing or out of the caller's scope (both read as not found). */
export async function getProgramFileForDownload(
  user: SessionUser,
  fileId: number,
): Promise<{ fileName: string; contentType: string; bytes: Buffer } | null> {
  try {
    assertDeliveryAccess(user);
    await assertFileInScope(user, fileId);
  } catch (e) {
    if (e instanceof UserError) return null;
    throw e;
  }
  const [row] = await db
    .select({ fileName: programFiles.fileName, contentType: programFiles.contentType, pathname: programFiles.pathname })
    .from(programFiles)
    .where(eq(programFiles.id, fileId))
    .limit(1);
  if (!row) return null;
  const bytes = await downloadBlob(row.pathname);
  return { fileName: row.fileName, contentType: row.contentType, bytes };
}

export async function deleteProgramFile(user: SessionUser, fileId: number): Promise<void> {
  assertDeliveryManage(user);
  await assertFileInScope(user, fileId);
  const [row] = await db
    .select({ pathname: programFiles.pathname })
    .from(programFiles)
    .where(eq(programFiles.id, fileId))
    .limit(1);
  if (!row) throw new UserError("File not found.");
  const n = await stampedDelete(programFiles, fileId, user.id);
  if (!n) throw new UserError("File not found.");
  await removeBlobsBestEffort([row.pathname]);
}
