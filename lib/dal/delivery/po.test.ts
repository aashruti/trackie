import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";

vi.mock("@/lib/storage/blob", () => ({
  deleteBlob: vi.fn(async () => {}),
  downloadBlob: vi.fn(async () => Buffer.from("proof-bytes")),
}));

import { db } from "@/lib/db/client";
import {
  accounts,
  auditLog,
  deliveryActivities,
  deliveryEvents,
  deliveryMethods,
  oems,
  tasks,
  programFiles,
  programPayments,
  programs as programsTable,
  userAccounts,
  users,
} from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { deleteBlob } from "@/lib/storage/blob";
import { createProgram, deleteProgram, getProgramDetail, listPrograms, updateProgram } from "./programs";
import { addPayment, deletePayment, listVendorOptions, loadProgramPo, moveToNewPo, updatePayment, updateProgramPo } from "./po";
import { addActivity, createEvent } from "./events";
import { getProgramFileForDownload } from "./po-files";

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

describe("moveToNewPo", () => {
  async function ev(programId: number, title: string, startDate: string, endDate?: string, budget = 100) {
    const { id } = await createEvent(SUPER, { programId, title: `${title} ${RUN}`, startDate, endDate, budget });
    return id;
  }
  const stateOf = async (programId: number) => {
    const events = await db.select({ id: deliveryEvents.id }).from(deliveryEvents).where(eq(deliveryEvents.programId, programId));
    const pays = await db.select({ id: programPayments.id }).from(programPayments).where(eq(programPayments.programId, programId));
    return { events: events.map((e) => e.id).sort(), pays: pays.map((p) => p.id).sort() };
  };

  it("moves selected events with activities, leaving other events behind, and totals add up to the original", async () => {
    const src = await mk("MvSrc");
    const e1 = await ev(src, "E1", "2026-09-01", undefined, 100);
    const e2 = await ev(src, "E2", "2026-09-10", undefined, 200);
    const e3 = await ev(src, "E3", "2026-09-20", undefined, 300);
    await addActivity(SUPER, "T", { eventId: e2, type: "note", title: "a", activityDate: "2026-09-10", cost: 50 });
    await addActivity(SUPER, "T", { eventId: e3, type: "note", title: "b", activityDate: "2026-09-20", cost: 70 });
    const before = await getProgramDetail(SUPER, src);
    const { id } = await moveToNewPo(DEL_A, src, { name: `  Split ${RUN} `, eventIds: [e2, e3, e3] });
    programIds.push(id);
    const a = await getProgramDetail(SUPER, src);
    const b = await getProgramDetail(SUPER, id);
    expect(a!.events.map((e) => e.id)).toEqual([e1]);
    expect(b!.events.map((e) => e.id).sort()).toEqual([e2, e3].sort());
    expect(b!.name).toBe(`Split ${RUN}`);
    expect(a!.allocated + b!.allocated).toBe(before!.allocated);
    expect(a!.spent + b!.spent).toBe(before!.spent);
    expect(b!.spent).toBe(120);
    const acts = await db.select().from(deliveryActivities).where(inArray(deliveryActivities.eventId, [e2, e3]));
    expect(acts).toHaveLength(2);
  });

  it("copies account, provider, teaching style and status; dates span the moved events, treating a blank end as the start date", async () => {
    const src = await mk("MvCopy", f.accA, f.oem2Id);
    await db.update(programsTable).set({ status: "on-hold" }).where(eq(programsTable.id, src));
    const e1 = await ev(src, "C1", "2026-10-05");
    const e2 = await ev(src, "C2", "2026-10-01", "2026-10-03");
    const { id } = await moveToNewPo(SUPER, src, { name: `Copy ${RUN}`, eventIds: [e1, e2], poNumber: "NEW-1", poValue: 5000, gstRate: 5, vendor: "V", poDate: "2026-10-02" });
    programIds.push(id);
    const [row] = await db.select().from(programsTable).where(eq(programsTable.id, id));
    expect(row).toMatchObject({
      accountId: f.accA, oemId: f.oem2Id, deliveryMethodId: f.methodId, status: "on-hold",
      startDate: "2026-10-01", endDate: "2026-10-05", poNumber: "NEW-1", poDate: "2026-10-02", poValue: "5000", gstRate: "5", vendor: "V",
      createdBy: SUPER.id, updatedBy: SUPER.id,
    });
  });

  it("moves ticked payments and their proofs, and proofs still download", async () => {
    const src = await mk("MvPay");
    const e1 = await ev(src, "P1", "2026-09-01");
    const p1 = await addPayment(SUPER, { programId: src, receivedDate: "2026-09-02", amount: 10 });
    const p2 = await addPayment(SUPER, { programId: src, receivedDate: "2026-09-03", amount: 20 });
    const [file] = await db
      .insert(programFiles)
      .values({ programId: src, paymentId: p1.id, fileName: "mv.pdf", pathname: `t/${RUN}/mv.pdf`, contentType: "application/pdf", sizeBytes: 5, createdBy: 1, updatedBy: 1 })
      .returning({ id: programFiles.id });
    const { id } = await moveToNewPo(SUPER, src, { name: `MvP ${RUN}`, eventIds: [e1], paymentIds: [p1.id] });
    programIds.push(id);
    expect((await stateOf(src)).pays).toEqual([p2.id]);
    expect((await stateOf(id)).pays).toEqual([p1.id]);
    const [moved] = await db.select().from(programFiles).where(eq(programFiles.id, file.id));
    expect(moved).toMatchObject({ programId: id, paymentId: p1.id, updatedBy: SUPER.id });
    expect((await loadProgramPo(id)).payments[0].proofs.map((x) => x.id)).toEqual([file.id]);
    const dl = await getProgramFileForDownload(DEL_A, file.id);
    expect(dl?.fileName).toBe("mv.pdf");
    expect(dl?.bytes.toString()).toBe("proof-bytes");
  });

  it("leaves the source's PO fields, documents, total budget and linked board tasks alone", async () => {
    const src = await mk("MvKeep");
    await db.update(programsTable).set({ totalBudget: "999" }).where(eq(programsTable.id, src));
    await updateProgramPo(SUPER, src, { poNumber: "KEEP", poDate: "2026-08-01", poValue: 777, gstRate: 12, vendor: "Keep" });
    const e1 = await ev(src, "K1", "2026-09-01");
    const [doc] = await db
      .insert(programFiles)
      .values({ programId: src, paymentId: null, fileName: "po.pdf", pathname: `t/${RUN}/keep.pdf`, contentType: "application/pdf", sizeBytes: 5, createdBy: 1, updatedBy: 1 })
      .returning({ id: programFiles.id });
    const [task] = await db.insert(tasks).values({ title: `KeepTask ${RUN}`, programId: src }).returning({ id: tasks.id });
    const { id } = await moveToNewPo(SUPER, src, { name: `K ${RUN}`, eventIds: [e1] });
    programIds.push(id);
    const [row] = await db.select().from(programsTable).where(eq(programsTable.id, src));
    expect(row).toMatchObject({ totalBudget: "999", poNumber: "KEEP", poValue: "777", gstRate: "12", vendor: "Keep" });
    const [d] = await db.select().from(programFiles).where(eq(programFiles.id, doc.id));
    expect(d.programId).toBe(src);
    const [t] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(t.programId).toBe(src);
    await db.delete(tasks).where(eq(tasks.id, task.id));
  });

  it("can move every event, leaving the source empty but intact", async () => {
    const src = await mk("MvAll");
    const e1 = await ev(src, "A1", "2026-09-01");
    const { id } = await moveToNewPo(SUPER, src, { name: `All ${RUN}`, eventIds: [e1] });
    programIds.push(id);
    expect((await getProgramDetail(SUPER, src))!.events).toHaveLength(0);
    expect((await getProgramDetail(SUPER, id))!.events).toHaveLength(1);
  });

  it("fails with no changes when an event belongs to another program, or was already moved", async () => {
    const src = await mk("MvBad");
    const other = await mk("MvBadOther");
    const e1 = await ev(src, "B1", "2026-09-01");
    const eo = await ev(other, "B2", "2026-09-02");
    const count = async () => (await db.select({ id: programsTable.id }).from(programsTable).where(eq(programsTable.accountId, f.accA))).length;
    const n = await count();
    await expect(moveToNewPo(SUPER, src, { name: `Bad ${RUN}`, eventIds: [e1, eo] })).rejects.toThrow("already moved");
    expect(await count()).toBe(n);
    expect((await stateOf(src)).events).toEqual([e1]);
    expect((await stateOf(other)).events).toEqual([eo]);
    const { id } = await moveToNewPo(SUPER, src, { name: `Ok ${RUN}`, eventIds: [e1] });
    programIds.push(id);
    await expect(moveToNewPo(SUPER, src, { name: `Again ${RUN}`, eventIds: [e1] })).rejects.toThrow("already moved");
    expect(await count()).toBe(n + 1);
  });

  it("fails with no changes when a payment belongs to another program", async () => {
    const src = await mk("MvBadPay");
    const other = await mk("MvBadPayO");
    const e1 = await ev(src, "BP", "2026-09-01");
    const po = await addPayment(SUPER, { programId: other, receivedDate: "2026-09-02", amount: 10 });
    await expect(moveToNewPo(SUPER, src, { name: `BadPay ${RUN}`, eventIds: [e1], paymentIds: [po.id] })).rejects.toThrow("already moved");
    expect((await stateOf(src)).events).toEqual([e1]);
    expect((await stateOf(other)).pays).toEqual([po.id]);
  });

  it("rejects an empty selection and a blank name", async () => {
    const src = await mk("MvEmpty");
    const e1 = await ev(src, "EM", "2026-09-01");
    await expect(moveToNewPo(SUPER, src, { name: `X ${RUN}`, eventIds: [] })).rejects.toThrow();
    await expect(moveToNewPo(SUPER, src, { name: "   ", eventIds: [e1] })).rejects.toThrow();
    await expect(moveToNewPo(SUPER, src, { name: "x".repeat(161), eventIds: [e1] })).rejects.toThrow("too long");
    expect((await stateOf(src)).events).toEqual([e1]);
  });

  it("delivery user out of scope can't split, and the audit rows name the mover", async () => {
    const src = await mk("MvScope");
    const e1 = await ev(src, "S1", "2026-09-01");
    await expect(moveToNewPo(DEL_B, src, { name: `Nope ${RUN}`, eventIds: [e1] })).rejects.toThrow();
    await expect(moveToNewPo(VIEWER, src, { name: `Nope ${RUN}`, eventIds: [e1] })).rejects.toThrow();
    expect((await stateOf(src)).events).toEqual([e1]);
    const { id } = await moveToNewPo(DEL_A, src, { name: `Yes ${RUN}`, eventIds: [e1] });
    programIds.push(id);
    const ins = await db.select().from(auditLog).where(and(eq(auditLog.tableName, "programs"), eq(auditLog.rowId, String(id)), eq(auditLog.op, "INSERT")));
    expect(ins).toHaveLength(1);
    expect(ins[0].actorId).toBe(DEL_A.id);
    const upd = await db.select().from(auditLog).where(and(eq(auditLog.tableName, "delivery_events"), eq(auditLog.rowId, String(e1)), eq(auditLog.op, "UPDATE")));
    expect(upd.some((r) => r.actorId === DEL_A.id)).toBe(true);
  });

  it("runs without db.transaction", async () => {
    const src = await mk("MvTx");
    const e1 = await ev(src, "T1", "2026-09-01");
    const spy = vi.spyOn(db, "transaction");
    const { id } = await moveToNewPo(SUPER, src, { name: `Tx ${RUN}`, eventIds: [e1] });
    programIds.push(id);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
