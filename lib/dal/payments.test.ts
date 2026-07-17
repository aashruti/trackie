import { describe, it, expect, afterAll } from "vitest";
import { addPayment, deletePayment } from "./payments";
import { getAccountDetail } from "./account-detail";
import { listAccountsForUser } from "./accounts";

const SUPER = { id: 1, roles: ["super-admin" as const] };
const YEAR = "FY26–27";

async function pillai() {
  const all = await listAccountsForUser(SUPER, YEAR);
  const acc = all.find((a) => a.name.includes("Pillai"))!;
  const detail = await getAccountDetail(SUPER, acc.id, YEAR);
  const newInv = detail!.invoices.find((i) => i.category === "new")!;
  return { accountId: acc.id, invoiceId: newInv.id, afterTds: newInv.afterTds, payable: newInv.payable };
}

describe("payment ledger", () => {
  const created: number[] = [];

  it("a receipt increases received and reduces outstanding", async () => {
    const { accountId, invoiceId, afterTds } = await pillai();
    await addPayment(SUPER, invoiceId, {
      direction: "receipt",
      amount: 1_000_000,
      paidOn: "2026-05-01",
      mode: "RTGS",
      ref: "UTR-TEST-1",
    });
    const detail = await getAccountDetail(SUPER, accountId, YEAR);
    const inv = detail!.invoices.find((i) => i.id === invoiceId)!;
    created.push(inv.ledger[0].id);
    expect(inv.received).toBe(1_000_000);
    expect(inv.outstanding).toBe(afterTds - 1_000_000);
    expect(inv.ledger.length).toBe(1);
  });

  it("an OEM payment increases paidToOem and reduces outstandingToOem", async () => {
    const { accountId, invoiceId, payable } = await pillai();
    await addPayment(SUPER, invoiceId, {
      direction: "oem-payment",
      amount: 500_000,
      paidOn: "2026-05-02",
      mode: "NEFT",
      ref: "UTR-TEST-2",
    });
    const detail = await getAccountDetail(SUPER, accountId, YEAR);
    const inv = detail!.invoices.find((i) => i.id === invoiceId)!;
    created.push(...inv.ledger.map((l) => l.id));
    expect(inv.paidToOem).toBe(500_000);
    expect(inv.outstandingToOem).toBe(payable - 500_000);
  });

  it("rejects a viewer", async () => {
    const { invoiceId } = await pillai();
    await expect(
      addPayment({ id: 999, roles: ["viewer"] }, invoiceId, {
        direction: "receipt",
        amount: 1,
        paidOn: "2026-05-01",
        mode: "UPI",
      }),
    ).rejects.toThrow();
  });

  afterAll(async () => {
    for (const id of [...new Set(created)]) {
      try {
        await deletePayment(SUPER, id);
      } catch {
        /* already gone */
      }
    }
  });
});
