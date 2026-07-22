import { describe, it, expect } from "vitest";
import { getPricingMaster } from "./pricing-master";

const SUPER = { id: 1, roles: ["super-admin" as const] };
const YEAR = "FY26–27";

describe("getPricingMaster", () => {
  it("returns per-account invoice rows with batches, numerics coerced, sorted", async () => {
    const rows = await getPricingMaster(SUPER, YEAR);
    expect(rows.length).toBeGreaterThan(0);

    const names = rows.map((r) => r.accountName);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);

    for (const acc of rows) {
      expect(acc.editable).toBe(true); // super-admin edits everything
      expect(acc.invoices.length).toBeGreaterThan(0); // accounts without invoices are omitted
      for (const inv of acc.invoices) {
        expect(typeof inv.students).toBe("number");
        expect(typeof inv.priceToUni).toBe("number");
        expect(typeof inv.priceToDatagami).toBe("number");
        expect(typeof inv.gstRate).toBe("number");
        for (const b of inv.batches) {
          expect(typeof b.count).toBe("number");
          if (b.priceToUni != null) expect(typeof b.priceToUni).toBe("number");
        }
      }
    }

    // The seeded cohort-driven old invoice surfaces its batches.
    const withBatches = rows.flatMap((r) => r.invoices).filter((i) => i.batches.length > 0);
    expect(withBatches.length).toBeGreaterThan(0);

    // Advance bills never appear — student streams only (the seed has advance
    // invoices, so this asserts the filter, not their absence from the data).
    expect(rows.flatMap((r) => r.invoices).some((i) => i.category === "advance")).toBe(false);
  });

  it("returns [] for an unknown year", async () => {
    expect(await getPricingMaster(SUPER, "FY00–NOPE")).toEqual([]);
  });
});
