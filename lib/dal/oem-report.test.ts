import { describe, it, expect } from "vitest";
import { getOemReport } from "./oem-report";

const SUPER = { id: 1, role: "super-admin" as const };
const YEAR = "FY26–27";

describe("getOemReport", () => {
  it("compiles all IBM accounts with totals", async () => {
    const r = await getOemReport(SUPER, "IBM", YEAR);
    expect(r).not.toBeNull();
    expect(r!.oem).toBe("IBM");
    expect(r!.accounts.length).toBeGreaterThan(10);
    expect(r!.totals.billed).toBeGreaterThan(0);
    expect(r!.totals.netMargin).toBeGreaterThan(0);
    expect(r!.accounts.some((a) => a.name.includes("Pillai"))).toBe(true);
  });

  it("AAFM report has the DG Programme", async () => {
    const r = await getOemReport(SUPER, "AAFM", YEAR);
    expect(r!.accounts.some((a) => a.name.includes("Programme"))).toBe(true);
  });

  it("returns null for an unknown OEM", async () => {
    expect(await getOemReport(SUPER, "NopeOEM", YEAR)).toBeNull();
  });
});
