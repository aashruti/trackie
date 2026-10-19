import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import type { Role } from "@/lib/db/enums";
import type { PricingAccountRow } from "@/lib/dal/pricing-master";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), getPricingMaster: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ auth: mocks.auth }));
vi.mock("@/lib/dal/pricing-master", () => ({ getPricingMaster: mocks.getPricingMaster }));

import { GET } from "./route";

const year = "FY26–27";
const request = () => new Request(`http://localhost/pricing/export?year=${encodeURIComponent(year)}`);
const rows: PricingAccountRow[] = [{
  accountId: 12,
  accountName: "Example University",
  editable: true,
  invoices: [{
    invoiceId: 21, category: "new", semester: "1", students: 4,
    priceToUni: 1000, priceToDatagami: 600, gstRate: 0.18, tdsRate: 0.02,
    advanceAdj: 500, oemAdvanceAdj: 200, status: "raised", batches: [],
  }, {
    invoiceId: 22, category: "old", semester: "2", students: 999,
    priceToUni: 1000, priceToDatagami: 600, gstRate: 0.18, tdsRate: 0.02,
    advanceAdj: 100, oemAdvanceAdj: 50, status: "draft",
    batches: [
      { enrollmentYear: "FY25–26", count: 3, priceToUni: 800, priceToDatagami: null },
      { enrollmentYear: "FY24–25", count: 2, priceToUni: null, priceToDatagami: 0 },
    ],
  }],
}];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "7", roles: ["sales"] } });
  mocks.getPricingMaster.mockResolvedValue(rows);
});

describe("pricing master download", () => {
  it("requires authentication before loading pricing", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    expect(mocks.getPricingMaster).not.toHaveBeenCalled();
  });

  it.each<Role>(["delivery", "hr"])("denies the %s role", async (role) => {
    mocks.auth.mockResolvedValue({ user: { id: "7", roles: [role] } });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.getPricingMaster).not.toHaveBeenCalled();
  });

  it.each(["", "?year=%20%20"])("requires a non-empty year (%s)", async (query) => {
    expect((await GET(new Request(`http://localhost/pricing/export${query}`))).status).toBe(400);
    expect(mocks.getPricingMaster).not.toHaveBeenCalled();
  });

  it.each<Role>(["sales", "super-admin"])("exports scoped saved pricing for %s", async (role) => {
    mocks.auth.mockResolvedValue({ user: { id: "7", roles: [role] } });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(mocks.getPricingMaster).toHaveBeenCalledExactlyOnceWith({ id: 7, roles: [role] }, year);
    expect(response.headers.get("Content-Type")).toContain("spreadsheetml.sheet");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="trackie-pricing-master-FY26-27.xlsx"',
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const workbook = XLSX.read(await response.arrayBuffer(), { type: "array" });
    expect(workbook.SheetNames).toEqual(["Streams", "Batches"]);
    const streams = XLSX.utils.sheet_to_json(workbook.Sheets.Streams, { range: 4 });
    expect(streams).toEqual([
      { Account: "Example University", Stream: "New students · Odd sem", Students: 4,
        "Price / uni": 1000, "Price / Datagami": 600, Billing: 4130, Margin: 1600, Status: "Raised" },
      { Account: "Example University", Stream: "Old students · Even sem", Students: 5,
        "Price / uni": 1000, "Price / Datagami": 600, Billing: 5074, Margin: 2600, Status: "Draft" },
    ]);
    const batches = XLSX.utils.sheet_to_json(workbook.Sheets.Batches, { range: 4 });
    expect(batches).toMatchObject([
      { "Enrollment year": "FY25–26", "Year of study": "2nd year", Students: 3,
        "Batch price / uni": 800, "Batch price / Datagami": "",
        "Effective price / uni": 800, "Effective price / Datagami": 600 },
      { "Enrollment year": "FY24–25", "Year of study": "3rd year", Students: 2,
        "Batch price / uni": "", "Batch price / Datagami": 0,
        "Effective price / uni": 1000, "Effective price / Datagami": 0 },
    ]);
  });

  it("produces an empty workbook with headers when no pricing is accessible", async () => {
    mocks.getPricingMaster.mockResolvedValue([]);
    const response = await GET(request());
    const workbook = XLSX.read(await response.arrayBuffer(), { type: "array" });
    expect(workbook.Sheets.Streams.A5.v).toBe("Account");
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.Streams, { range: 4 })).toEqual([]);
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.Batches, { range: 4 })).toEqual([]);
  });
});
