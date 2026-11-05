import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";

vi.mock("@/lib/storage/blob", () => ({ deleteBlob: vi.fn(async () => {}) }));

import { db } from "@/lib/db/client";
import {
  accounts,
  auditLog,
  deliveryMethods,
  oems,
  programFiles,
  programPayments,
  programs as programsTable,
  userAccounts,
  users,
} from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { deleteBlob } from "@/lib/storage/blob";
import { createProgram, deleteProgram, getProgramDetail, listPrograms, updateProgram } from "./programs";
import { addPayment, deletePayment, listVendorOptions, loadProgramPo, updatePayment, updateProgramPo } from "./po";

const SUPER = { id: 1, roles: ["super-admin" as const] };
const SALES = { id: 997, roles: ["sales" as const] };
const VIEWER = { id: 999, roles: ["viewer" as const] };
const OTHER = { id: 0, roles: ["super-admin" as const] };
let DEL_A: { id: number; roles: ["delivery"] }; // in scope of account A only
let DEL_B: { id: number; roles: ["delivery"] }; // in scope of account B only

const RUN = String(Date.now()).slice(-6);
const f = { oemId: 0, oem2Id: 0, accA: 0, accB: 0, methodId: 0, userIds: [] as number[] };
const programIds: number[] = [];

async function mk(name: string, accountId = f.accA, oemId = f.oemId) {
  const { id } = await createProgram(SUPER, { accountId, oemId, deliveryMethodId: f.methodId, name: `${name} ${RUN}` });
  programIds.push(id);
  return id;
}

beforeAll(async () => {
  const [o1] = await db.insert(oems).values({ name: `PoOEM1-${RUN}` }).returning({ id: oems.id });
  const [o2] = await db.insert(oems).values({ name: `PoOEM2-${RUN}` }).returning({ id: oems.id });
  f.oemId = o1.id;
  f.oem2Id = o2.id;
  const [a] = await db.insert(accounts).values({ name: `PoA-${RUN}`, type: "university", city: "Pune", oemId: o1.id }).returning({ id: accounts.id });
  const [b] = await db.insert(accounts).values({ name: `PoB-${RUN}`, type: "university", city: "Pune", oemId: o1.id }).returning({ id: accounts.id });
  f.accA = a.id;
  f.accB = b.id;
  const [m] = await db.insert(deliveryMethods).values({ name: `PoStyle-${RUN}`, code: `P${RUN}` }).returning({ id: deliveryMethods.id });
  f.methodId = m.id;
  const mkUser = async (label: string, role: "delivery" | "super-admin") => {
    const [u] = await db
      .insert(users)
      .values({ name: `Po ${label} ${RUN}`, email: `po-${label}-${RUN}@test.local`, passwordHash: "x", role })
      .returning({ id: users.id });
    f.userIds.push(u.id);
    return u.id;
  };
  DEL_A = { id: await mkUser("a", "delivery"), roles: ["delivery"] };
  DEL_B = { id: await mkUser("b", "delivery"), roles: ["delivery"] };
  OTHER.id = await mkUser("other", "super-admin");
  await db.insert(userAccounts).values([
    { userId: DEL_A.id, accountId: a.id },
    { userId: DEL_B.id, accountId: b.id },
  ]);
});

afterAll(async () => {
  if (programIds.length) await db.delete(programsTable).where(inArray(programsTable.id, programIds));
  await db.delete(userAccounts).where(inArray(userAccounts.userId, f.userIds));
  await db.delete(users).where(inArray(users.id, f.userIds));
  await db.delete(accounts).where(inArray(accounts.id, [f.accA, f.accB]));
  await db.delete(deliveryMethods).where(eq(deliveryMethods.id, f.methodId));
  await db.delete(oems).where(inArray(oems.id, [f.oemId, f.oem2Id]));
});

beforeEach(() => {
  vi.mocked(deleteBlob).mockReset();
  vi.mocked(deleteBlob).mockResolvedValue(undefined);
});

describe("PO details", () => {
  it("saves PO fields, and updateProgram leaves them untouched", async () => {
    const id = await mk("PoSave");
    await updateProgramPo(DEL_A, id, { poNumber: " PO-77 ", poDate: "2026-08-01", poValue: 100000, gstRate: 12, vendor: " Acme Ltd " });
    await updateProgram(DEL_A, id, { accountId: f.accA, oemId: f.oemId, deliveryMethodId: f.methodId, name: `Renamed ${RUN}` });
    const d = await getProgramDetail(DEL_A, id);
    expect(d).toMatchObject({ name: `Renamed ${RUN}`, poNumber: "PO-77", poDate: "2026-08-01", poValue: 100000, gstRate: 12, vendor: "Acme Ltd" });
  });

  it("keeps a GST rate of 0", async () => {
    const id = await mk("PoGst0");
    await updateProgramPo(DEL_A, id, { poValue: 1000, gstRate: 0 });
    expect((await getProgramDetail(DEL_A, id))!.gstRate).toBe(0);
    await updateProgramPo(DEL_A, id, { poValue: 1000, gstRate: null });
    expect((await getProgramDetail(DEL_A, id))!.gstRate).toBe(18);
  });

  it("rejects a PO value of 0, and a GST rate of 101", async () => {
    const id = await mk("PoBad");
    await expect(updateProgramPo(DEL_A, id, { poValue: 0 })).rejects.toThrow();
    await expect(updateProgramPo(DEL_A, id, { poValue: NaN })).rejects.toThrow();
    await expect(updateProgramPo(DEL_A, id, { gstRate: 101 })).rejects.toThrow();
    await expect(updateProgramPo(DEL_A, id, { gstRate: -1 })).rejects.toThrow();
    await expect(updateProgramPo(DEL_A, id, { poDate: "01/08/2026" })).rejects.toThrow();
  });

  it("warns about a repeated PO number on the same account and provider, but still saves", async () => {
    const p1 = await mk("PoDup1");
    const p2 = await mk("PoDup2");
    const p3 = await mk("PoDup3", f.accA, f.oem2Id); // different provider
    const num = `DUP-${RUN}`;
    expect((await updateProgramPo(DEL_A, p1, { poNumber: num })).duplicates).toEqual([]);
    const r = await updateProgramPo(DEL_A, p2, { poNumber: num });
    expect(r.duplicates).toEqual([{ id: p1, name: `PoDup1 ${RUN}` }]);
    expect((await getProgramDetail(DEL_A, p2))!.poNumber).toBe(num);
    expect((await updateProgramPo(DEL_A, p3, { poNumber: num })).duplicates).toEqual([]);
    // blank numbers are never compared
    await updateProgramPo(DEL_A, p1, { poNumber: "  " });
    expect((await updateProgramPo(DEL_A, p2, { poNumber: "" })).duplicates).toEqual([]);
  });

  it("doesn't warn across accounts, or about a program outside the caller's scope", async () => {
    const a = await mk("PoXA");
    const b = await mk("PoXB", f.accB);
    const num = `X-${RUN}`;
    await updateProgramPo(SUPER, b, { poNumber: num });
    expect((await updateProgramPo(DEL_A, a, { poNumber: num })).duplicates).toEqual([]);
    await expect(updateProgramPo(DEL_A, b, { poNumber: "nope" })).rejects.toThrow();
  });
});

describe("payments", () => {
  it("rejects a payment of 0, a negative TDS, and a bad date", async () => {
    const id = await mk("PayBad");
    const ok = { programId: id, receivedDate: "2026-09-01", amount: 100 };
    await expect(addPayment(DEL_A, { ...ok, amount: 0 })).rejects.toThrow();
    await expect(addPayment(DEL_A, { ...ok, amount: NaN })).rejects.toThrow();
    await expect(addPayment(DEL_A, { ...ok, tds: -1 })).rejects.toThrow();
    await expect(addPayment(DEL_A, { ...ok, receivedDate: "9/1/2026" })).rejects.toThrow();
    expect((await loadProgramPo(id)).payments).toHaveLength(0);
  });

  it("lists status from payments: 100000 at 18% with 50000 received and 8000 TDS is part_received with 60000 outstanding", async () => {
    const id = await mk("PayStatus");
    await updateProgramPo(DEL_A, id, { poValue: 100000, gstRate: 18 });
    await addPayment(DEL_A, { programId: id, receivedDate: "2026-09-01", amount: 50000, tds: 8000 });
    const row = (await listPrograms(DEL_A, { accountId: f.accA })).find((p) => p.id === id)!;
    expect(row.po).toMatchObject({ due: 118000, settled: 58000, outstanding: 60000, status: "part_received" });
    const d = await getProgramDetail(DEL_A, id);
    expect(d!.po.status).toBe("part_received");
    expect(d!.payments).toHaveLength(1);
    expect(d!.payments[0]).toMatchObject({ amount: 50000, tds: 8000, proofs: [] });
  });

  it("recalculates when PO value changes after payments, and clearing it gives value_missing with payments kept", async () => {
    const id = await mk("PayRecalc");
    await updateProgramPo(DEL_A, id, { poValue: 100000 });
    await addPayment(DEL_A, { programId: id, receivedDate: "2026-09-01", amount: 118000 });
    const status = async () => (await listPrograms(DEL_A, { accountId: f.accA })).find((p) => p.id === id)!.po.status;
    expect(await status()).toBe("fully_received");
    await updateProgramPo(DEL_A, id, { poValue: 200000 });
    expect(await status()).toBe("part_received");
    await updateProgramPo(DEL_A, id, { poValue: null });
    expect(await status()).toBe("value_missing");
    expect((await getProgramDetail(DEL_A, id))!.payments).toHaveLength(1);
  });

  it("allows the same reference on two payments", async () => {
    const id = await mk("PayRef");
    const a = await addPayment(DEL_A, { programId: id, receivedDate: "2026-09-01", amount: 10, reference: "UTR1" });
    const b = await addPayment(DEL_A, { programId: id, receivedDate: "2026-09-02", amount: 20, reference: "UTR1" });
    expect(a.id).not.toBe(b.id);
    await updatePayment(DEL_A, a.id, { receivedDate: "2026-09-03", amount: 15, tds: 1, reference: " UTR1 ", note: "n" });
    const p = (await loadProgramPo(id)).payments.find((x) => x.id === a.id)!;
    expect(p).toMatchObject({ amount: 15, tds: 1, reference: "UTR1", note: "n", receivedDate: "2026-09-03" });
  });

  it("delivery user out of scope can't read, add, edit or delete payments", async () => {
    const id = await mk("PayScope");
    const { id: payId } = await addPayment(DEL_A, { programId: id, receivedDate: "2026-09-01", amount: 10 });
    expect(await getProgramDetail(DEL_B, id)).toBeNull();
    expect((await listPrograms(DEL_B)).some((p) => p.id === id)).toBe(false);
    await expect(addPayment(DEL_B, { programId: id, receivedDate: "2026-09-01", amount: 5 })).rejects.toThrow();
    await expect(updatePayment(DEL_B, payId, { receivedDate: "2026-09-01", amount: 5 })).rejects.toThrow();
    await expect(deletePayment(DEL_B, payId)).rejects.toThrow();
    expect((await loadProgramPo(id)).payments).toHaveLength(1);
  });

  it("viewer and sales can't read or write", async () => {
    const id = await mk("PayRole");
    const { id: payId } = await addPayment(DEL_A, { programId: id, receivedDate: "2026-09-01", amount: 10 });
    for (const u of [VIEWER, SALES]) {
      await expect(getProgramDetail(u, id)).rejects.toThrow();
      await expect(listPrograms(u)).rejects.toThrow();
      await expect(listVendorOptions(u)).rejects.toThrow();
      await expect(updateProgramPo(u, id, { poNumber: "x" })).rejects.toThrow();
      await expect(addPayment(u, { programId: id, receivedDate: "2026-09-01", amount: 1 })).rejects.toThrow();
      await expect(updatePayment(u, payId, { receivedDate: "2026-09-01", amount: 1 })).rejects.toThrow();
      await expect(deletePayment(u, payId)).rejects.toThrow();
    }
  });
});

describe("vendors, deletes and audit", () => {
  it("listVendorOptions returns only names from the caller's scope", async () => {
    const a = await mk("VenA");
    const b = await mk("VenB", f.accB);
    await updateProgramPo(SUPER, a, { vendor: `VendorA-${RUN}` });
    await updateProgramPo(SUPER, b, { vendor: `VendorB-${RUN}` });
    const mine = await listVendorOptions(DEL_A);
    expect(mine).toContain(`VendorA-${RUN}`);
    expect(mine).not.toContain(`VendorB-${RUN}`);
    expect(new Set(mine).size).toBe(mine.length);
    const all = await listVendorOptions(SUPER);
    expect(all).toEqual(expect.arrayContaining([`VendorA-${RUN}`, `VendorB-${RUN}`]));
  });

  it("deleteProgram refuses while payments exist, then succeeds once they're removed", async () => {
    const id = await mk("DelProg");
    const { id: payId } = await addPayment(DEL_A, { programId: id, receivedDate: "2026-09-01", amount: 10 });
    await db.insert(programFiles).values({ programId: id, paymentId: null, fileName: "po.pdf", pathname: `t/${RUN}/po.pdf`, contentType: "application/pdf", sizeBytes: 5, createdBy: 1, updatedBy: 1 });
    await expect(deleteProgram(DEL_A, id)).rejects.toThrow("This PO has payments recorded. Remove them first.");
    await deletePayment(DEL_A, payId);
    await deleteProgram(DEL_A, id);
    expect(deleteBlob).toHaveBeenCalledWith(`t/${RUN}/po.pdf`);
    expect(await db.select({ id: programsTable.id }).from(programsTable).where(eq(programsTable.id, id))).toHaveLength(0);
  });

  it("deletes rows even when blob removal fails", async () => {
    const id = await mk("DelBlobFail");
    const { id: payId } = await addPayment(DEL_A, { programId: id, receivedDate: "2026-09-01", amount: 10 });
    await db.insert(programFiles).values({ programId: id, paymentId: payId, fileName: "p.png", pathname: `t/${RUN}/p.png`, contentType: "image/png", sizeBytes: 5, createdBy: 1, updatedBy: 1 });
    vi.mocked(deleteBlob).mockRejectedValue(new Error("azure down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await deletePayment(DEL_A, payId);
    expect(deleteBlob).toHaveBeenCalledWith(`t/${RUN}/p.png`);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    expect(await db.select().from(programPayments).where(eq(programPayments.id, payId))).toHaveLength(0);
    expect(await db.select().from(programFiles).where(eq(programFiles.paymentId, payId))).toHaveLength(0);
  });

  it("audit rows for deleted payments name the deleter", async () => {
    const id = await mk("AuditPay");
    const { id: payId } = await addPayment(SUPER, { programId: id, receivedDate: "2026-09-01", amount: 10 });
    const [file] = await db
      .insert(programFiles)
      .values({ programId: id, paymentId: payId, fileName: "p.png", pathname: `t/${RUN}/a.png`, contentType: "image/png", sizeBytes: 5, createdBy: SUPER.id, updatedBy: SUPER.id })
      .returning({ id: programFiles.id });
    await deletePayment(OTHER, payId);
    const pay = await db.select().from(auditLog).where(and(eq(auditLog.tableName, "program_payments"), eq(auditLog.rowId, String(payId)), eq(auditLog.op, "DELETE")));
    expect(pay).toHaveLength(1);
    expect(pay[0].actorId).toBe(OTHER.id);
    const fl = await db.select().from(auditLog).where(and(eq(auditLog.tableName, "program_files"), eq(auditLog.rowId, String(file.id)), eq(auditLog.op, "DELETE")));
    expect(fl).toHaveLength(1);
    expect(fl[0].actorId).toBe(OTHER.id);
    await db.delete(auditLog).where(and(eq(auditLog.tableName, "program_payments"), eq(auditLog.rowId, String(payId))));
    await db.delete(auditLog).where(and(eq(auditLog.tableName, "program_files"), eq(auditLog.rowId, String(file.id))));
  });
});
