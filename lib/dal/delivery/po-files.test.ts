import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";

const store = new Map<string, Uint8Array>();
let configured = true;
vi.mock("@/lib/storage/blob", () => ({
  isStorageConfigured: vi.fn(() => configured),
  uploadBlob: vi.fn(async (pathname: string, data: Uint8Array) => {
    store.set(pathname, data);
    return { url: `https://blob.example/secret/${pathname}`, pathname };
  }),
  downloadBlob: vi.fn(async (pathname: string) => Buffer.from(store.get(pathname) ?? [])),
  deleteBlob: vi.fn(async (pathname: string) => {
    store.delete(pathname);
  }),
}));

import { db } from "@/lib/db/client";
import { accounts, deliveryMethods, oems, programFiles, programs as programsTable, userAccounts, users } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import * as blob from "@/lib/storage/blob";
import { createProgram } from "./programs";
import { addPayment } from "./po";
import { deleteProgramFile, getProgramFileForDownload, storeProgramFile } from "./po-files";

const SUPER = { id: 1, roles: ["super-admin" as const] };
let DEL_A: { id: number; roles: ["delivery"] };
let DEL_B: { id: number; roles: ["delivery"] };
const RUN = String(Date.now()).slice(-6);
const f = { oemId: 0, accA: 0, accB: 0, methodId: 0, userIds: [] as number[] };
const programIds: number[] = [];
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3]);

async function mk(name: string, accountId = f.accA) {
  const { id } = await createProgram(SUPER, { accountId, oemId: f.oemId, deliveryMethodId: f.methodId, name: `${name} ${RUN}` });
  programIds.push(id);
  return id;
}

beforeAll(async () => {
  const [o] = await db.insert(oems).values({ name: `PfOEM-${RUN}` }).returning({ id: oems.id });
  f.oemId = o.id;
  const [a] = await db.insert(accounts).values({ name: `PfA-${RUN}`, type: "university", city: "Pune", oemId: o.id }).returning({ id: accounts.id });
  const [b] = await db.insert(accounts).values({ name: `PfB-${RUN}`, type: "university", city: "Pune", oemId: o.id }).returning({ id: accounts.id });
  f.accA = a.id;
  f.accB = b.id;
  const [m] = await db.insert(deliveryMethods).values({ name: `PfStyle-${RUN}`, code: `F${RUN}` }).returning({ id: deliveryMethods.id });
  f.methodId = m.id;
  const mkUser = async (label: string) => {
    const [u] = await db
      .insert(users)
      .values({ name: `Pf ${label} ${RUN}`, email: `pf-${label}-${RUN}@test.local`, passwordHash: "x", role: "delivery" })
      .returning({ id: users.id });
    f.userIds.push(u.id);
    return u.id;
  };
  DEL_A = { id: await mkUser("a"), roles: ["delivery"] };
  DEL_B = { id: await mkUser("b"), roles: ["delivery"] };
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
  await db.delete(oems).where(eq(oems.id, f.oemId));
});

beforeEach(() => {
  store.clear();
  configured = true;
  vi.mocked(blob.uploadBlob).mockClear();
  vi.mocked(blob.deleteBlob).mockClear();
});

describe("program files", () => {
  it("stores under delivery/programs/<id>/ with a generated name, ignoring the user's file name", async () => {
    const id = await mk("PfStore");
    const row = await storeProgramFile(DEL_A, { programId: id, paymentId: null, fileName: "../../evil name.pdf", bytes: PDF });
    expect(row).toMatchObject({ paymentId: null, fileName: "../../evil name.pdf", contentType: "application/pdf", sizeBytes: PDF.length });
    const [path] = [...store.keys()];
    expect(path).toMatch(new RegExp(`^delivery/programs/${id}/[0-9a-f-]{36}\\.pdf$`));
    expect(JSON.stringify(row)).not.toContain("blob.example");
    expect(row).not.toHaveProperty("pathname");
  });

  it("a proof's payment must belong to the same program", async () => {
    const p1 = await mk("PfPay1");
    const p2 = await mk("PfPay2");
    const { id: payId } = await addPayment(SUPER, { programId: p2, receivedDate: "2026-08-01", amount: 100 });
    await expect(storeProgramFile(DEL_A, { programId: p1, paymentId: payId, fileName: "x.pdf", bytes: PDF })).rejects.toThrow();
    await expect(storeProgramFile(DEL_A, { programId: p1, paymentId: 99999999, fileName: "x.pdf", bytes: PDF })).rejects.toThrow();
    expect(store.size).toBe(0);
    const ok = await storeProgramFile(DEL_A, { programId: p2, paymentId: payId, fileName: "x.pdf", bytes: PDF });
    expect(ok.paymentId).toBe(payId);
  });

  it("removes the blob if the database insert fails", async () => {
    const id = await mk("PfRollback");
    const spy = vi.spyOn(db, "insert").mockImplementationOnce(() => {
      throw new Error("db down");
    });
    await expect(storeProgramFile(DEL_A, { programId: id, paymentId: null, fileName: "x.pdf", bytes: PDF })).rejects.toThrow("db down");
    spy.mockRestore();
    expect(blob.uploadBlob).toHaveBeenCalledTimes(1);
    expect(blob.deleteBlob).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(0);
  });

  it("delivery user out of scope gets null from download and an error from upload and delete", async () => {
    const id = await mk("PfScope", f.accB);
    const row = await storeProgramFile(SUPER, { programId: id, paymentId: null, fileName: "x.pdf", bytes: PDF });
    await expect(storeProgramFile(DEL_A, { programId: id, paymentId: null, fileName: "y.pdf", bytes: PDF })).rejects.toThrow();
    expect(await getProgramFileForDownload(DEL_A, row.id)).toBeNull();
    await expect(deleteProgramFile(DEL_A, row.id)).rejects.toThrow();
    const own = await getProgramFileForDownload(DEL_B, row.id);
    expect(own).toMatchObject({ fileName: "x.pdf", contentType: "application/pdf" });
    expect([...own!.bytes]).toEqual([...PDF]);
    expect(await getProgramFileForDownload(DEL_B, 99999999)).toBeNull();
    expect(await getProgramFileForDownload({ id: 5, roles: ["viewer"] }, row.id)).toBeNull();
  });

  it("deleting a file removes the row even when blob removal fails", async () => {
    const id = await mk("PfDelete");
    const row = await storeProgramFile(DEL_A, { programId: id, paymentId: null, fileName: "x.pdf", bytes: PDF });
    vi.mocked(blob.deleteBlob).mockRejectedValueOnce(new Error("azure down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await deleteProgramFile(DEL_A, row.id);
    err.mockRestore();
    const left = await db.select({ id: programFiles.id }).from(programFiles).where(eq(programFiles.id, row.id));
    expect(left).toHaveLength(0);
  });

  it("reports a clear error when storage isn't configured", async () => {
    const id = await mk("PfNoStore");
    configured = false;
    await expect(storeProgramFile(DEL_A, { programId: id, paymentId: null, fileName: "x.pdf", bytes: PDF })).rejects.toThrow(/storage/i);
    expect(blob.uploadBlob).not.toHaveBeenCalled();
  });

  it("rejects a file that is not a PDF/JPG/PNG", async () => {
    const id = await mk("PfBad");
    await expect(storeProgramFile(DEL_A, { programId: id, paymentId: null, fileName: "x.pdf", bytes: new Uint8Array([1, 2, 3]) })).rejects.toThrow();
    expect(store.size).toBe(0);
  });
});
